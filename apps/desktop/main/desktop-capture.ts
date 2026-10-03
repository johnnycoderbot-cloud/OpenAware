import {
  BrowserWindow,
  desktopCapturer,
  session,
  type Session,
  type WebContents,
  type WebFrameMain,
} from "electron";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAX_SOURCES,
  type DesktopCaptureFrame,
} from "../../../packages/contracts/src/index";
import { DisplayCaptureGrant } from "./capture-grant";

// The helper has no preload or IPC API. Only these fixed calls cross its boundary.
const START_CAPTURE = "window.openAwareCapture.start()";
const TAKE_FRAME = "window.openAwareCapture.take()";
const MAX_PREVIEW_BYTES = 1_572_864;
const MAX_PREVIEW_URL_LENGTH = 23 + 4 * Math.ceil(MAX_PREVIEW_BYTES / 3);
const MAX_CAPTURE_CLOCK_SKEW_MS = 1000;
const POLL_INTERVAL_MS = 67;
const CAPTURE_FAILURE =
  "Desktop capture ended or became unavailable. Reconnect to resume.";
const CAPTURE_START_FAILURE =
  "The selected desktop source could not start. Reconnect to try again.";

type HelperFrame = Omit<
  DesktopCaptureFrame,
  "sourceId" | "deviceId" | "captureId"
>;
interface HelperResult {
  frame?: unknown;
  ended?: unknown;
}
interface CaptureEntry {
  sourceId: string;
  deviceId: string;
  captureId: string;
  window: BrowserWindow;
  session: Session;
  grant: DisplayCaptureGrant;
  controller: AbortController;
  frame?: WebFrameMain;
  timer?: ReturnType<typeof setTimeout>;
  lastSequence: number;
  lastCapturedAt: number;
  stopped: boolean;
}
export interface DesktopCaptureOptions {
  onFrame(frame: DesktopCaptureFrame): void;
  onError(sourceId: string, message: string, captureId: string): void;
  enabled?: boolean;
  capturePath?: string;
}

/** Validate the bounded, newly decoded result before it reaches the dashboard.
 * The original timestamp survives transport; polling cached pixels never makes
 * a stalled capture look fresh. Source identity is added by the owner in main.
 */
export function validateDesktopCaptureFrame(
  raw: unknown,
  lastSequence: number,
  lastCapturedAt: number,
  now = Date.now(),
): HelperFrame | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const integer = (key: string, min: number, max: number): boolean =>
    typeof value[key] === "number" &&
    Number.isSafeInteger(value[key]) &&
    (value[key] as number) >= min &&
    (value[key] as number) <= max;
  if (
    !integer("width", 1, 1280) ||
    !integer("height", 1, 1280) ||
    !integer("nativeWidth", 1, 32768) ||
    !integer("nativeHeight", 1, 32768) ||
    !integer("sequence", lastSequence + 1, Number.MAX_SAFE_INTEGER) ||
    // Renderer/main clocks can differ by a few milliseconds on Windows. Match
    // the renderer's preview tolerance while retaining the original timestamp
    // and stale/replay/order checks. Service inference admission stays stricter.
    !integer(
      "capturedAt",
      Math.max(1, lastCapturedAt),
      now + MAX_CAPTURE_CLOCK_SKEW_MS,
    ) ||
    now - (value.capturedAt as number) > 5000 ||
    typeof value.dataUrl !== "string" ||
    value.dataUrl.length > MAX_PREVIEW_URL_LENGTH ||
    !value.dataUrl.startsWith("data:image/jpeg;base64,") ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl) ||
    (value.fps !== undefined &&
      (typeof value.fps !== "number" ||
        !Number.isFinite(value.fps) ||
        value.fps <= 0 ||
        value.fps > 15))
  )
    return undefined;
  const width = value.width as number;
  const height = value.height as number;
  const nativeWidth = value.nativeWidth as number;
  const nativeHeight = value.nativeHeight as number;
  const scale = Math.min(1, 1280 / Math.max(nativeWidth, nativeHeight));
  if (
    width !== Math.max(1, Math.round(nativeWidth * scale)) ||
    height !== Math.max(1, Math.round(nativeHeight * scale))
  )
    return undefined;
  const encoded = value.dataUrl.slice(23);
  if (encoded.length % 4 !== 0) return undefined;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const byteLength = (encoded.length / 4) * 3 - padding;
  if (byteLength > MAX_PREVIEW_BYTES || byteLength < 4) return undefined;
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length !== byteLength ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    return undefined;
  return {
    dataUrl: value.dataUrl,
    width,
    height,
    nativeWidth,
    nativeHeight,
    capturedAt: value.capturedAt as number,
    sequence: value.sequence as number,
    fps: typeof value.fps === "number" ? value.fps : 15,
  };
}

/** One isolated, disposable capture document owns one explicit native source.
 * Dashboard media permission can never select an arbitrary legacy desktop ID.
 */
export class DesktopCaptureBroker {
  private readonly entries = new Map<string, CaptureEntry>();
  private closed = false;
  private readonly capturePath: string;
  private readonly captureUrl: string;
  private readonly scriptUrl: string;
  constructor(private readonly options: DesktopCaptureOptions) {
    this.capturePath =
      options.capturePath ?? join(__dirname, "capture", "index.html");
    this.captureUrl = pathToFileURL(this.capturePath).href;
    this.scriptUrl = pathToFileURL(
      join(dirname(this.capturePath), "capture.js"),
    ).href;
  }

  async start(
    sourceId: string,
    deviceId: string,
    captureId: string,
  ): Promise<void> {
    if (this.closed) throw new Error("Desktop capture is closing.");
    if (this.options.enabled === false)
      throw new Error("Desktop capture is disabled in test mode");
    if (
      typeof sourceId !== "string" ||
      typeof deviceId !== "string" ||
      typeof captureId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        captureId,
      ) ||
      !sourceId ||
      sourceId.length > 128 ||
      deviceId.length > 512 ||
      !/^(screen|window):/.test(deviceId)
    )
      throw new Error("Invalid desktop source");
    this.stop(sourceId);
    if (this.entries.size >= MAX_SOURCES)
      throw new Error("Too many desktop capture sources");
    const captureSession = session.fromPartition(
      `openaware-capture-${randomUUID()}`,
      {
        cache: false,
      },
    );
    const helper = new BrowserWindow({
      title: "OpenAware capture worker",
      width: 640,
      height: 360,
      show: false,
      skipTaskbar: true,
      frame: false,
      focusable: false,
      webPreferences: {
        session: captureSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        backgroundThrottling: false,
        offscreen: true,
        spellcheck: false,
        devTools: false,
      },
    });
    const entry: CaptureEntry = {
      sourceId,
      deviceId,
      captureId,
      window: helper,
      session: captureSession,
      grant: new DisplayCaptureGrant(true),
      controller: new AbortController(),
      stopped: false,
      lastSequence: 0,
      lastCapturedAt: 0,
    };
    this.entries.set(sourceId, entry);
    this.configureSession(entry);
    helper.webContents.setFrameRate(15);
    helper.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    helper.webContents.on("will-navigate", (event) => event.preventDefault());
    helper.webContents.on("will-redirect", (event) => event.preventDefault());
    helper.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    helper.webContents.on("render-process-gone", () => this.fail(entry));
    helper.on("closed", () => this.fail(entry));
    try {
      await this.withTimeout(
        helper.loadFile(this.capturePath),
        entry.controller.signal,
      );
      if (!this.current(entry)) throw new Error(CAPTURE_START_FAILURE);
      entry.frame = helper.webContents.mainFrame;
      if (!this.ownedFrame(entry, entry.frame))
        throw new Error(CAPTURE_START_FAILURE);
      entry.grant.select(deviceId, this.frameKey(entry));
      // Main received an explicit Connect for this authoritative source. The
      // helper accepts no arguments and cannot choose a source or call IPC.
      await this.withTimeout(
        helper.webContents.executeJavaScript(START_CAPTURE, true),
        entry.controller.signal,
      );
      if (!this.ownedFrame(entry, entry.frame))
        throw new Error(CAPTURE_START_FAILURE);
      await this.poll(entry);
      if (!this.current(entry)) throw new Error(CAPTURE_START_FAILURE);
    } catch {
      if (this.current(entry)) {
        this.stop(sourceId, captureId);
        throw new Error(CAPTURE_START_FAILURE);
      }
      throw new Error("Desktop capture connection was stopped.");
    }
  }

  stop(sourceId: string, captureId?: string): void {
    const entry = this.entries.get(sourceId);
    if (!entry || (captureId !== undefined && captureId !== entry.captureId))
      return;
    entry.stopped = true;
    this.entries.delete(sourceId);
    entry.grant.revoke();
    entry.controller.abort();
    if (entry.timer) clearTimeout(entry.timer);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    // The nonpersistent session contains no other document. Keep its handlers
    // denying late requests until Electron disposes it, and clear any storage.
    void entry.session.clearStorageData().catch(() => {});
  }
  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }
  close(): void {
    this.closed = true;
    this.stopAll();
  }
  private current(entry: CaptureEntry): boolean {
    return (
      !entry.stopped &&
      this.entries.get(entry.sourceId) === entry &&
      !entry.window.isDestroyed() &&
      !entry.window.webContents.isDestroyed()
    );
  }
  private ownedFrame(
    entry: CaptureEntry,
    frame: WebFrameMain | null | undefined,
  ): boolean {
    return (
      this.current(entry) &&
      !!frame &&
      frame === entry.frame &&
      frame === entry.window.webContents.mainFrame &&
      frame.url === this.captureUrl
    );
  }
  private trustedRequest(
    entry: CaptureEntry,
    contents: WebContents | null,
    details: {
      isMainFrame: boolean;
      requestingUrl?: string;
    },
  ): boolean {
    return (
      this.current(entry) &&
      contents === entry.window.webContents &&
      details.isMainFrame &&
      details.requestingUrl === this.captureUrl &&
      this.ownedFrame(entry, entry.frame)
    );
  }
  private frameKey(entry: CaptureEntry): string {
    const frame = entry.frame;
    return frame ? `${frame.processId}:${frame.routingId}` : "";
  }
  private configureSession(entry: CaptureEntry): void {
    const current = entry.session;
    current.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        this.trustedRequest(entry, contents, details) &&
        permission === "display-capture" &&
        entry.grant.check(this.frameKey(entry)),
    );
    current.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        const displayRequest =
          permission === "display-capture" ||
          (permission === "media" &&
            "mediaTypes" in details &&
            Array.isArray(details.mediaTypes) &&
            details.mediaTypes.length === 0);
        callback(
          displayRequest &&
            this.trustedRequest(entry, contents, details) &&
            entry.grant.request(this.frameKey(entry)),
        );
      },
    );
    current.setDisplayMediaRequestHandler(
      (request, callback) => {
        if (
          !this.ownedFrame(entry, request.frame) ||
          !request.videoRequested ||
          request.audioRequested ||
          !request.userGesture
        ) {
          callback({});
          return;
        }
        const ticket = entry.grant.begin(this.frameKey(entry));
        if (!ticket || ticket.id !== entry.deviceId) {
          callback({});
          return;
        }
        void this.withTimeout(
          desktopCapturer.getSources({
            types: [entry.deviceId.startsWith("screen:") ? "screen" : "window"],
            thumbnailSize: { width: 0, height: 0 },
            fetchWindowIcons: false,
          }),
          entry.controller.signal,
        )
          .then((choices) => {
            const choice = choices.find((item) => item.id === entry.deviceId);
            if (
              !choice ||
              !this.ownedFrame(entry, request.frame) ||
              !entry.grant.complete(ticket, true)
            ) {
              entry.grant.complete(ticket, false);
              callback({});
              return;
            }
            callback({ video: choice });
          })
          .catch(() => {
            entry.grant.complete(ticket, false);
            callback({});
          });
      },
      { useSystemPicker: false },
    );
    current.webRequest.onBeforeRequest((details, callback) =>
      callback({
        cancel:
          details.url !== this.captureUrl && details.url !== this.scriptUrl,
      }),
    );
    current.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src blob:; connect-src 'none'; img-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
          ],
        },
      }),
    );
    current.on("will-download", (event) => event.preventDefault());
  }
  private async poll(entry: CaptureEntry): Promise<void> {
    if (!this.ownedFrame(entry, entry.frame)) return;
    try {
      const raw: unknown = await this.withTimeout(
        entry.window.webContents.executeJavaScript(TAKE_FRAME),
        entry.controller.signal,
        5000,
      );
      if (!this.ownedFrame(entry, entry.frame)) return;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        this.fail(entry);
        return;
      }
      const result = raw as HelperResult;
      if (result.ended === true) {
        this.fail(entry);
        return;
      }
      if (result.frame !== undefined) {
        const frame = validateDesktopCaptureFrame(
          result.frame,
          entry.lastSequence,
          entry.lastCapturedAt,
        );
        if (!frame) {
          this.fail(entry);
          return;
        }
        entry.lastSequence = frame.sequence;
        entry.lastCapturedAt = frame.capturedAt;
        this.options.onFrame({
          ...frame,
          sourceId: entry.sourceId,
          deviceId: entry.deviceId,
          captureId: entry.captureId,
        });
      }
      if (this.current(entry))
        entry.timer = setTimeout(() => void this.poll(entry), POLL_INTERVAL_MS);
    } catch {
      this.fail(entry);
    }
  }
  private fail(entry: CaptureEntry): void {
    // Destroy emits closed synchronously; remove ownership before destruction
    // so that cancellation and late results cannot produce duplicate errors.
    if (entry.stopped || this.entries.get(entry.sourceId) !== entry) return;
    this.stop(entry.sourceId, entry.captureId);
    this.options.onError(entry.sourceId, CAPTURE_FAILURE, entry.captureId);
  }
  private async withTimeout<T>(
    pending: Promise<T>,
    signal: AbortSignal,
    timeoutMs = 15_000,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          abort = () =>
            reject(new Error("Desktop capture connection was stopped."));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          timer = setTimeout(
            () => reject(new Error(CAPTURE_START_FAILURE)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
