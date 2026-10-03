import { BrowserWindow, session, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_SOURCES,
  type DesktopCaptureFrame,
} from "../../../packages/contracts/src/index";
import { validateDesktopCaptureFrame } from "./desktop-capture";
import {
  localVideoResponse,
  remoteVideoResponse,
  validateVideoUrl,
  type RegisteredVideo,
  type VideoSourceRegistry,
} from "./video-sources";

export const VIDEO_SCHEME = "openaware-video";
const PLAYER_URL = `${VIDEO_SCHEME}://capture/video.html`;
const PLAYER_ORIGIN = `${VIDEO_SCHEME}://capture`;
const VIDEO_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'none'; img-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const FAILURE =
  "Video ended, was closed or became unavailable. Reconnect to resume.";
interface Entry {
  sourceId: string;
  deviceId: string;
  captureId: string;
  video: RegisteredVideo;
  window: BrowserWindow;
  session: Session;
  controller: AbortController;
  stopped: boolean;
  sequence: number;
  capturedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  wakeTimer?: ReturnType<typeof setTimeout>;
}
export interface VideoCaptureOptions {
  registry: VideoSourceRegistry;
  onFrame(frame: DesktopCaptureFrame): void;
  onError(sourceId: string, message: string, captureId: string): void;
  capturePath?: string;
}

/** Files/direct streams decode inside a fixed document; web players run as
 * unprivileged isolated pages. Neither receives dashboard preload, IPC or paths. */
export class VideoCaptureBroker {
  private readonly entries = new Map<string, Entry>();
  private readonly capturePath: string;
  private closed = false;
  constructor(private readonly options: VideoCaptureOptions) {
    this.capturePath = options.capturePath ?? join(__dirname, "capture");
  }
  async start(
    sourceId: string,
    deviceId: string,
    captureId: string,
  ): Promise<void> {
    if (this.closed) throw new Error("Video capture is closing.");
    const video = this.options.registry.get(deviceId, undefined, sourceId);
    if (
      !video ||
      !/^[0-9a-f-]{36}$/i.test(sourceId) ||
      !/^[0-9a-f-]{36}$/i.test(captureId)
    )
      throw new Error("Choose a registered video first.");
    this.stop(sourceId);
    if (this.entries.size >= MAX_SOURCES)
      throw new Error("Too many video sources.");
    const isolated = session.fromPartition(`openaware-video-${randomUUID()}`, {
      cache: false,
    });
    const player = new BrowserWindow({
      title: "OpenAware video player",
      width: 960,
      height: 600,
      show: false,
      webPreferences: {
        session: isolated,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: false,
        autoplayPolicy:
          video.kind === "web_video"
            ? "user-gesture-required"
            : "no-user-gesture-required",
      },
    });
    const entry: Entry = {
      sourceId,
      deviceId,
      captureId,
      video,
      window: player,
      session: isolated,
      controller: new AbortController(),
      stopped: false,
      sequence: 0,
      capturedAt: 0,
    };
    this.entries.set(sourceId, entry);
    player.webContents.setAudioMuted(true);
    player.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    player.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    player.webContents.on("render-process-gone", () => this.fail(entry));
    player.on("closed", () => this.fail(entry));
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    isolated.setDisplayMediaRequestHandler((_request, callback) =>
      callback({}),
    );
    isolated.on("will-download", (event) => event.preventDefault());
    try {
      if (video.kind === "web_video") {
        const selectedHttps = new URL(video.url).protocol === "https:";
        const validNavigation = (url: string): boolean => {
          try {
            const parsed = validateVideoUrl(url);
            return !selectedHttps || parsed.protocol === "https:";
          } catch {
            return false;
          }
        };
        player.webContents.on("will-navigate", (event, url) => {
          if (!validNavigation(url)) event.preventDefault();
        });
        player.webContents.on("will-redirect", (event, url) => {
          if (!validNavigation(url)) event.preventDefault();
        });
        isolated.webRequest.onBeforeRequest((details, callback) => {
          let allowed = false;
          try {
            const parsed = new URL(details.url);
            allowed =
              !parsed.username &&
              !parsed.password &&
              (["https:", "blob:", "data:"].includes(parsed.protocol) ||
                (parsed.protocol === "http:" && !selectedHttps));
          } catch {}
          callback({ cancel: !this.current(entry) || !allowed });
        });
        // Connect is an explicit user action. The player opens for site Play or
        // login; subsequent Open player is equally explicit. No DOM extraction.
        await this.wait(entry, player.loadURL(video.url), 30_000);
        if (!this.current(entry)) throw new Error("Video stopped.");
        player.show();
      } else {
        const [html, script] = await Promise.all([
          readFile(join(this.capturePath, "video.html")),
          readFile(join(this.capturePath, "video.js")),
        ]);
        if (!this.current(entry)) throw new Error("Video stopped.");
        isolated.protocol.handle(VIDEO_SCHEME, async (request) => {
          try {
            const url = new URL(request.url);
            const initiatorOrigin = (
              request as Request & { initiatorOrigin?: string }
            ).initiatorOrigin;
            if (
              !this.current(entry) ||
              request.method !== "GET" ||
              url.protocol !== `${VIDEO_SCHEME}:` ||
              url.host !== "capture" ||
              url.search ||
              url.hash ||
              (initiatorOrigin && initiatorOrigin !== PLAYER_ORIGIN)
            )
              return new Response(null, { status: 403 });
            if (url.pathname === "/video.html")
              return new Response(html, {
                headers: {
                  "Content-Type": "text/html",
                  "Content-Security-Policy": VIDEO_CSP,
                  "Cache-Control": "no-store",
                },
              });
            if (url.pathname === "/video.js")
              return new Response(script, {
                headers: {
                  "Content-Type": "text/javascript",
                  "Cache-Control": "no-store",
                },
              });
            if (url.pathname === "/media")
              return video.kind === "video_file"
                ? await localVideoResponse(
                    video.path,
                    request.headers.get("range"),
                    entry.controller.signal,
                  )
                : await remoteVideoResponse(
                    video.url,
                    request.headers.get("range"),
                    entry.controller.signal,
                  );
            return new Response(null, { status: 404 });
          } catch {
            return new Response(null, { status: 503 });
          }
        });
        isolated.webRequest.onBeforeRequest((details, callback) =>
          callback({
            cancel:
              !this.current(entry) ||
              ![
                PLAYER_URL,
                `${PLAYER_ORIGIN}/video.js`,
                `${PLAYER_ORIGIN}/media`,
              ].includes(details.url),
          }),
        );
        player.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
        player.webContents.on("will-redirect", (event) =>
          event.preventDefault(),
        );
        await this.wait(entry, player.loadURL(PLAYER_URL));
        // A hidden normal BrowserWindow can otherwise play to completion while
        // Chromium withholds compositor deliveries. Keep capture visibility
        // alive without showing it; discarded one-pixel images are never feed
        // evidence. Only the decoder's actual video callbacks timestamp frames.
        void this.wakeDirect(entry);
        await this.wait(
          entry,
          player.webContents.executeJavaScript("window.openAwareVideo.start()"),
        );
      }
      await this.poll(entry);
      if (!this.current(entry)) throw new Error("Video stopped.");
    } catch {
      this.stop(sourceId, captureId);
      throw new Error(
        "The video could not start. Check its format or open a supported web player.",
      );
    }
  }
  open(sourceId: string): void {
    const entry = this.entries.get(sourceId);
    if (!entry || !this.current(entry))
      throw new Error("Connect the video before opening its player.");
    if (entry.video.kind !== "web_video")
      void entry.window.webContents
        .executeJavaScript("document.querySelector('#capture').controls = true")
        .catch(() => {});
    if (entry.window.isMinimized()) entry.window.restore();
    entry.window.show();
    entry.window.focus();
  }
  stop(sourceId: string, captureId?: string): void {
    const entry = this.entries.get(sourceId);
    if (!entry || (captureId !== undefined && captureId !== entry.captureId))
      return;
    this.entries.delete(sourceId);
    entry.stopped = true;
    entry.controller.abort();
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.wakeTimer) clearTimeout(entry.wakeTimer);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    void entry.session.clearStorageData().catch(() => {});
    void entry.session.closeAllConnections().catch(() => {});
  }
  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }
  close(): void {
    this.closed = true;
    this.stopAll();
  }
  private current(entry: Entry): boolean {
    return (
      !entry.stopped &&
      this.entries.get(entry.sourceId) === entry &&
      !entry.window.isDestroyed() &&
      !entry.window.webContents.isDestroyed()
    );
  }
  private async wakeDirect(entry: Entry): Promise<void> {
    if (!this.current(entry)) return;
    try {
      if (!entry.window.isVisible()) {
        const [width, height] = entry.window.getContentSize();
        await this.wait(
          entry,
          entry.window.webContents.capturePage(
            {
              x: Math.floor(width / 2),
              y: Math.floor(height / 2),
              width: 1,
              height: 1,
            },
            { stayHidden: true, stayAwake: true },
          ),
          // This discarded compositor wake is not evidence of playback health.
          // A paused hidden renderer may leave it pending. Retain one serial
          // wake until it settles or Stop aborts it; poll/start/crash guards
          // still detect actual owner failures, without refreshing stale pixels.
          null,
        );
      }
      if (this.current(entry))
        entry.wakeTimer = setTimeout(() => void this.wakeDirect(entry), 67);
    } catch {
      this.fail(entry);
    }
  }
  private async poll(entry: Entry): Promise<void> {
    if (!this.current(entry)) return;
    try {
      let frame:
        | Omit<DesktopCaptureFrame, "sourceId" | "deviceId" | "captureId">
        | undefined;
      if (entry.video.kind === "web_video") {
        const captureStartedAt = Date.now();
        const image = await this.wait(
          entry,
          entry.window.webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          }),
          5000,
        );
        if (!this.current(entry)) return;
        const { width: nativeWidth, height: nativeHeight } = image.getSize();
        if (
          nativeWidth < 1 ||
          nativeHeight < 1 ||
          nativeWidth > 32768 ||
          nativeHeight > 32768
        )
          throw new Error("Video page capture unavailable.");
        const scale = Math.min(1, 1280 / Math.max(nativeWidth, nativeHeight));
        const width = Math.max(1, Math.round(nativeWidth * scale)),
          height = Math.max(1, Math.round(nativeHeight * scale));
        const resized = scale < 1 ? image.resize({ width, height }) : image;
        let jpeg = resized.toJPEG(78);
        if (jpeg.length > 1_572_864) jpeg = resized.toJPEG(45);
        frame = validateDesktopCaptureFrame(
          {
            dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
            width,
            height,
            nativeWidth,
            nativeHeight,
            capturedAt: captureStartedAt,
            sequence: entry.sequence + 1,
            fps: 10,
          },
          entry.sequence,
          entry.capturedAt,
        );
        if (!frame) throw new Error("Video page frame unavailable.");
      } else {
        if (entry.window.webContents.mainFrame.url !== PLAYER_URL)
          throw new Error("Video player changed.");
        const raw = (await this.wait(
          entry,
          entry.window.webContents.executeJavaScript(
            "window.openAwareVideo.take()",
          ),
          5000,
        )) as { frame?: unknown; ended?: boolean };
        if (!this.current(entry)) return;
        if (!raw || typeof raw !== "object" || raw.ended)
          throw new Error("Video ended.");
        if (raw.frame !== undefined) {
          frame = validateDesktopCaptureFrame(
            raw.frame,
            entry.sequence,
            entry.capturedAt,
          );
          if (!frame) throw new Error("Video frame unavailable.");
        }
      }
      if (frame && this.current(entry)) {
        entry.sequence = frame.sequence;
        entry.capturedAt = frame.capturedAt;
        this.options.onFrame({
          ...frame,
          sourceId: entry.sourceId,
          deviceId: entry.deviceId,
          captureId: entry.captureId,
        });
      }
      if (this.current(entry))
        entry.timer = setTimeout(
          () => void this.poll(entry),
          entry.video.kind === "web_video" ? 100 : 67,
        );
    } catch {
      this.fail(entry);
    }
  }
  private fail(entry: Entry): void {
    if (
      !this.current(entry) &&
      (entry.stopped || this.entries.get(entry.sourceId) !== entry)
    )
      return;
    this.stop(entry.sourceId, entry.captureId);
    this.options.onError(entry.sourceId, FAILURE, entry.captureId);
  }
  private async wait<T>(
    entry: Entry,
    pending: Promise<T>,
    timeoutMs: number | null = 15_000,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(new Error("Video stopped."));
          entry.controller.signal.addEventListener("abort", abort, {
            once: true,
          });
          if (entry.controller.signal.aborted) abort();
          if (timeoutMs !== null)
            timer = setTimeout(
              () => reject(new Error("Video unavailable.")),
              timeoutMs,
            );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) entry.controller.signal.removeEventListener("abort", abort);
    }
  }
}
