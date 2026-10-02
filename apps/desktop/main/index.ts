import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  commandSchema,
  initialSnapshot,
  type AutomationPlan,
  type AutomationStep,
  type CaptureChoice,
  type Snapshot,
} from "../../../packages/contracts/src/index";
import {
  ActionBroker,
  automationPlanSchema,
  normalizedPoint,
  planDigest,
  type Inspection,
} from "../../../packages/actions/src/index";
import {
  applyWindowsStep,
  inspectWindowsTarget,
} from "../../../packages/actions/src/windows";
import { ServiceClient } from "./service-client";
import { DisplayCaptureGrant } from "./capture-grant";

const rendererPath = join(__dirname, "renderer", "index.html");
const rendererUrl = pathToFileURL(rendererPath).href;
const testMode = process.env.OPENAWARE_TEST === "1";
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let state = initialSnapshot();
const captureGrant = new DisplayCaptureGrant(!testMode);
const selectedDevices = new Set<string>();
const listedDesktopDevices = new Map<
  string,
  { kind: "monitor" | "window"; expiresAt: number }
>();
let captureGeneration = 0;
let quitting = false;
const cameraDialogs = new Set<AbortController>();

function trustedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.href === rendererUrl;
  } catch {
    return false;
  }
}
function frameKey(): string {
  const frame = window?.webContents.mainFrame;
  return frame ? `${frame.processId}:${frame.routingId}` : "";
}
function assertSender(event: IpcMainInvokeEvent): void {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !trustedUrl(event.senderFrame.url)
  )
    throw new Error("Untrusted IPC sender");
}
function broadcast(next: Snapshot): void {
  state = next;
  if (window && !window.isDestroyed())
    window.webContents.send("openaware:state", next);
}
const service = new ServiceClient(broadcast, (message) => {
  broker.revoke();
  captureGrant.revoke();
  selectedDevices.clear();
  listedDesktopDevices.clear();
  captureGeneration += 1;
  for (const controller of cameraDialogs) controller.abort();
  cameraDialogs.clear();
  broadcast({
    ...state,
    session: "stopped",
    epoch: state.epoch + 1,
    busy: false,
    queueSize: 0,
    pendingPlan: undefined,
    sources: state.sources.map((source) => ({ ...source, status: "stopped" })),
    lastError: message,
  });
  if (window && !window.isDestroyed())
    window.webContents.send("openaware:stop");
});
function stopImmediately(): void {
  broker.revoke();
  captureGrant.revoke();
  selectedDevices.clear();
  listedDesktopDevices.clear();
  captureGeneration += 1;
  for (const controller of cameraDialogs) controller.abort();
  cameraDialogs.clear();
  broadcast({
    ...state,
    session: "stopped",
    epoch: state.epoch + 1,
    busy: false,
    queueSize: 0,
    pendingPlan: undefined,
    sources: state.sources.map((source) => ({ ...source, status: "stopped" })),
  });
  if (window && !window.isDestroyed())
    window.webContents.send("openaware:stop");
  void service.request({ type: "session.stop" }).catch(() => {});
}
async function inspect(
  plan: AutomationPlan,
  step: AutomationStep,
  signal: AbortSignal,
): Promise<Inspection> {
  if (process.platform !== "win32")
    throw new Error("Native actions currently require Windows");
  if (signal.aborted) throw new Error("Actions stopped");
  const authoritative = await service.request<Snapshot>({ type: "state.get" });
  if (signal.aborted) throw new Error("Actions stopped");
  const source = authoritative.sources.find(
    (item) => item.id === plan.sourceId,
  );
  if (
    !authoritative.pendingPlan ||
    planDigest(authoritative.pendingPlan) !== planDigest(plan) ||
    authoritative.session === "stopped"
  )
    throw new Error("Plan was cancelled or replaced");
  if (
    !source ||
    source.kind !== "monitor" ||
    source.status !== "live" ||
    source.revision !== plan.sourceRevision ||
    source.masks.length > 0
  )
    throw new Error(
      "Actions require a live, unmasked, explicitly selected monitor",
    );
  if (
    !selectedDevices.has(source.deviceId) ||
    authoritative.binding.modelId !== plan.modelId ||
    authoritative.binding.status !== "verified"
  )
    throw new Error("Source or model consent changed");
  // Preview health is separate from the ≤2s native screenshot used to authorize input.
  if (
    !source.lastFrameAt ||
    Date.now() - source.lastFrameAt > 5000 ||
    source.lastFrameAt > Date.now()
  )
    throw new Error(
      "Monitor preview is stale; resume capture and request a new plan",
    );
  const targets = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1024, height: 1024 },
    fetchWindowIcons: false,
  });
  const target = targets.find((item) => item.id === source.deviceId);
  if (!target || target.thumbnail.isEmpty() || !target.display_id)
    throw new Error("Selected monitor is no longer available");
  const display = screen
    .getAllDisplays()
    .find((item) => String(item.id) === target.display_id);
  if (!display || display.id < 0 || display.rotation !== 0)
    throw new Error(
      "Monitor geometry cannot be verified; rotated/virtual displays are not supported for input",
    );
  const acquiredAt = Date.now();
  const point = normalizedPoint(step, display.bounds, (position) =>
    screen.dipToScreenPoint(position),
  );
  const physicalOrigin = screen.dipToScreenPoint({
    x: display.bounds.x,
    y: display.bounds.y,
  });
  const physicalEnd = screen.dipToScreenPoint({
    x: display.bounds.x + display.bounds.width - 1,
    y: display.bounds.y + display.bounds.height - 1,
  });
  const bounds = {
    x: physicalOrigin.x,
    y: physicalOrigin.y,
    width: physicalEnd.x - physicalOrigin.x + 1,
    height: physicalEnd.y - physicalOrigin.y + 1,
  };
  if (
    bounds.width < 1 ||
    bounds.height < 1 ||
    (point &&
      (point.x < bounds.x ||
        point.y < bounds.y ||
        point.x >= bounds.x + bounds.width ||
        point.y >= bounds.y + bounds.height))
  )
    throw new Error("Physical monitor mapping is invalid");
  const nativeTarget = await inspectWindowsTarget(step, bounds, point, signal);
  return {
    acquiredAt,
    sourceId: source.id,
    sourceRevision: source.revision,
    planDigest: planDigest(plan),
    modelId: plan.modelId,
    epoch: authoritative.epoch,
    displayId: target.display_id,
    geometry: JSON.stringify({
      id: display.id,
      bounds: display.bounds,
      scale: display.scaleFactor,
      physical: bounds,
    }),
    contentDigest: createHash("sha256")
      .update(target.thumbnail.toBitmap())
      .digest("hex"),
    targetWindow: nativeTarget.window,
    targetTitle: nativeTarget.title,
    point,
    bounds,
  };
}
const broker = new ActionBroker({
  now: Date.now,
  inspect,
  approve: async (plan, step, index, evidence, signal) => {
    const effect =
      step.type === "click"
        ? `Left click at physical pixel (${evidence.point!.x}, ${evidence.point!.y})`
        : step.type === "type"
          ? `Type this exact text: ${JSON.stringify(step.text)}`
          : `Press ${step.key}`;
    // An unparented native dialog allows Windows to restore the previously active target window.
    const answer = await dialog.showMessageBox({
      type: "warning",
      title: "OpenAware: approve one operation",
      message: `${index + 1}/${plan.steps.length}: ${effect}`,
      detail: `Goal: ${plan.goal}\nTarget: ${JSON.stringify(evidence.targetTitle || "(untitled window)")}\nMonitor: ${evidence.displayId}\nModel suggestion: ${step.description}\n\nThe 1024 px monitor thumbnail must remain unchanged during this review. This plan expires 30 seconds after creation. Ctrl+Shift+F12 revokes all remaining operations and closes this review. Input may affect real applications.`,
      buttons: ["Cancel remaining operations", "Approve this operation"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal,
    });
    return answer.response === 1;
  },
  effect: async (step, evidence, deadline, signal) => {
    // Recheck trusted service state after the second native inspection, immediately before dispatch.
    const authoritative = await service.request<Snapshot>({
      type: "state.get",
    });
    if (
      signal.aborted ||
      authoritative.session === "stopped" ||
      authoritative.epoch !== evidence.epoch ||
      Date.now() >= deadline
    )
      throw new Error("Action authority or fresh inspection expired");
    const source = authoritative.sources.find(
      (item) =>
        item.id === evidence.sourceId &&
        item.revision === evidence.sourceRevision &&
        item.kind === "monitor" &&
        selectedDevices.has(item.deviceId),
    );
    if (
      !source ||
      source.status !== "live" ||
      source.masks.length > 0 ||
      !authoritative.pendingPlan ||
      planDigest(authoritative.pendingPlan) !== evidence.planDigest ||
      authoritative.binding.modelId !== evidence.modelId ||
      authoritative.binding.status !== "verified"
    )
      throw new Error("Monitor, plan, or model authority changed");
    await applyWindowsStep(step, evidence, deadline, signal);
  },
});

function registerIpc(): void {
  ipcMain.handle("openaware:invoke", async (event, raw: unknown) => {
    assertSender(event);
    const command = commandSchema.parse(raw);
    if (command.type === "session.stop") {
      stopImmediately();
      return state;
    }
    if (
      command.type === "source.add" &&
      ["monitor", "window"].includes(command.source.kind)
    ) {
      const listed = listedDesktopDevices.get(command.source.deviceId);
      if (
        !listed ||
        listed.expiresAt < Date.now() ||
        listed.kind !== command.source.kind
      )
        throw new Error("List and choose this desktop source first");
    }
    if (command.type === "source.update" && command.patch.status === "live") {
      const source = state.sources.find((item) => item.id === command.sourceId);
      if (
        source &&
        ["monitor", "window"].includes(source.kind) &&
        !selectedDevices.has(source.deviceId)
      )
        throw new Error("Grant desktop capture before starting this source");
    }
    if (
      [
        "source.remove",
        "source.update",
        "provider.discover",
        "provider.select",
        "provider.probe",
        "automation.cancel",
        "automation.plan",
        "monitor.pause",
      ].includes(command.type)
    )
      broker.revoke();
    return service.request(command);
  });
  ipcMain.handle("openaware:list-desktop", async (event) => {
    assertSender(event);
    if (testMode) return [];
    const choices = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    listedDesktopDevices.clear();
    for (const choice of choices)
      listedDesktopDevices.set(choice.id, {
        kind: choice.id.startsWith("screen:") ? "monitor" : "window",
        expiresAt: Date.now() + 60_000,
      });
    return choices.map((choice) => ({
      id: choice.id,
      name: choice.name,
      kind: choice.id.startsWith("screen:") ? "monitor" : "window",
      thumbnail: choice.thumbnail.toDataURL(),
      displayId: choice.display_id,
    })) as CaptureChoice[];
  });
  ipcMain.handle("openaware:select-desktop", async (event, id: unknown) => {
    assertSender(event);
    if (typeof id !== "string" || id.length > 512)
      throw new Error("Invalid desktop source");
    if (testMode) throw new Error("Desktop capture is disabled in test mode");
    const generation = captureGeneration;
    const choices = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (
      generation !== captureGeneration ||
      !choices.some((choice) => choice.id === id)
    )
      throw new Error("Desktop source selection expired");
    captureGrant.select(id, frameKey());
  });
  ipcMain.handle("openaware:execute-plan", async (event, planId: unknown) => {
    assertSender(event);
    if (typeof planId !== "string" || !/^[0-9a-f-]{36}$/i.test(planId))
      throw new Error("Invalid plan id");
    if (testMode) throw new Error("Native effects are disabled in test mode");
    const authoritative = await service.request<Snapshot>({
      type: "state.get",
    });
    if (!authoritative.pendingPlan || authoritative.pendingPlan.id !== planId)
      throw new Error("No matching authoritative action plan");
    const plan = automationPlanSchema.parse(
      authoritative.pendingPlan,
    ) as AutomationPlan;
    const reviewingWindow = window;
    reviewingWindow?.minimize();
    try {
      // Take inspection only after the workspace is exposed. Never reuse evidence from before minimize.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const results = await broker.execute(plan);
      await service.request({ type: "automation.cancel" }).catch(() => {});
      return results;
    } finally {
      if (reviewingWindow && !reviewingWindow.isDestroyed() && !quitting) {
        reviewingWindow.restore();
        reviewingWindow.show();
        reviewingWindow.focus();
      }
    }
  });
  ipcMain.handle("openaware:stop", (event) => {
    assertSender(event);
    stopImmediately();
  });
}

function configurePermissions(): void {
  const current = session.defaultSession;
  // Camera checks proceed to their explicit dialog. Display checks need an exact one-shot lease.
  // Both callback orders are supported; the selector itself always consumes only one lease.
  // https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler
  current.setPermissionCheckHandler(
    (contents, permission, _origin, details) => {
      const trusted =
        contents === window?.webContents &&
        details.isMainFrame &&
        trustedUrl(details.requestingUrl ?? contents?.mainFrame.url ?? "");
      return (
        !!trusted &&
        permission === "display-capture" &&
        captureGrant.check(frameKey())
      );
    },
  );
  current.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (permission === "display-capture") {
        const trusted =
          contents === window?.webContents &&
          details.isMainFrame &&
          trustedUrl(details.requestingUrl);
        callback(!!trusted && captureGrant.request(frameKey()));
        return;
      }
      const permitted =
        !testMode &&
        contents === window?.webContents &&
        details.isMainFrame &&
        trustedUrl(details.requestingUrl) &&
        permission === "media" &&
        "mediaTypes" in details &&
        details.mediaTypes?.length === 1 &&
        details.mediaTypes[0] === "video";
      if (!permitted) {
        callback(false);
        return;
      }
      const generation = captureGeneration;
      const controller = new AbortController();
      cameraDialogs.add(controller);
      void dialog
        .showMessageBox({
          type: "question",
          title: "OpenAware camera permission",
          message:
            "Allow the selected camera or virtual camera for this session?",
          detail:
            "Frames stay in memory and are sent only to the local model you explicitly select. Stop ends capture. Audio is not requested.",
          buttons: ["Deny", "Allow video"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal: controller.signal,
        })
        .then((answer) =>
          callback(answer.response === 1 && generation === captureGeneration),
        )
        .catch(() => callback(false))
        .finally(() => cameraDialogs.delete(controller));
    },
  );
  current.setDisplayMediaRequestHandler(
    (request, callback) => {
      const generation = captureGeneration;
      if (
        testMode ||
        !request.frame ||
        request.frame !== window?.webContents.mainFrame ||
        !trustedUrl(request.frame.url) ||
        !request.videoRequested ||
        request.audioRequested
      ) {
        callback({});
        return;
      }
      const selection = captureGrant.begin(frameKey());
      if (!selection) {
        callback({});
        return;
      }
      void desktopCapturer
        .getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })
        .then((choices) => {
          const choice = choices.find((item) => item.id === selection.id);
          if (
            !choice ||
            generation !== captureGeneration ||
            !request.frame ||
            request.frame !== window?.webContents.mainFrame ||
            !trustedUrl(request.frame.url) ||
            !captureGrant.complete(selection, true)
          ) {
            captureGrant.complete(selection, false);
            callback({});
            return;
          }
          selectedDevices.add(choice.id);
          callback({ video: choice });
        })
        .catch(() => {
          captureGrant.complete(selection, false);
          callback({});
        });
    },
    { useSystemPicker: false },
  );
  current.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // UI has no network role; provider requests live in the isolated service process.
    callback({
      cancel:
        !url.startsWith("file:") &&
        !url.startsWith("data:") &&
        !url.startsWith("blob:") &&
        !url.startsWith("devtools:"),
    });
  });
  current.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    }),
  );
}

app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      title: "OpenAware",
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 720,
      backgroundColor: "#10151b",
      show: false,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    window.webContents.on("render-process-gone", () => stopImmediately());
    window.on("closed", () => {
      window = undefined;
      app.quit();
    });
    configurePermissions();
    registerIpc();
    service.start(join(__dirname, "service.cjs"));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "OpenAware",
          submenu: [
            {
              label: "Stop all capture and actions",
              accelerator: "CommandOrControl+Shift+F12",
              click: stopImmediately,
            },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "View",
          submenu: [
            { role: "toggleDevTools" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
          ],
        },
      ]),
    );
    const icon = nativeImage.createFromBuffer(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#18242f"/><circle cx="16" cy="16" r="8" fill="#7edabf"/><circle cx="16" cy="16" r="3" fill="#18242f"/></svg>',
      ),
    );
    // Electron may not decode SVG on every platform; a bitmap fallback keeps the tray real.
    const trayIcon = icon.isEmpty()
      ? nativeImage.createFromBitmap(
          Buffer.from(
            Array(16 * 16)
              .fill([126, 218, 191, 255])
              .flat(),
          ),
          { width: 16, height: 16 },
        )
      : icon;
    if (!testMode) {
      tray = new Tray(trayIcon);
      tray.setToolTip("OpenAware — Ctrl+Shift+F12 stops all");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Show OpenAware", click: () => window?.show() },
          { label: "Stop all capture and actions", click: stopImmediately },
          { label: "Quit", click: () => app.quit() },
        ]),
      );
      tray.on("double-click", () => window?.show());
      if (
        !globalShortcut.register("CommandOrControl+Shift+F12", stopImmediately)
      )
        broadcast({
          ...state,
          lastError:
            "Global Stop shortcut unavailable. Use the tray, menu, or Stop button.",
        });
    }
    screen.on("display-added", () => broker.revoke());
    screen.on("display-removed", () => broker.revoke());
    screen.on("display-metrics-changed", () => broker.revoke());
    await window.loadFile(rendererPath);
    if (!testMode) window.show();
  })
  .catch((error) => {
    console.error(
      "OpenAware startup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    app.quit();
  });
app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  stopImmediately();
  service.close();
  globalShortcut.unregisterAll();
  tray?.destroy();
});
app.on("window-all-closed", () => app.quit());
