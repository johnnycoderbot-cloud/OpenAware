import { contextBridge, ipcRenderer } from "electron";
import type {
  OpenAwareBridge,
  DesktopState,
  DesktopCaptureFrame,
  DesktopCaptureError,
  Snapshot,
} from "../../../packages/contracts/src/index";

// Named functions only. Never expose ipcRenderer, channels, event objects, fs, or process.
const bridge: OpenAwareBridge = {
  invoke: (command) => ipcRenderer.invoke("openaware:invoke", command),
  onState: (callback) => {
    if (typeof callback !== "function")
      throw new Error("State callback must be a function");
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Snapshot,
    ): void => callback(state);
    ipcRenderer.on("openaware:state", listener);
    // Stop broadcasts the stopped snapshot before this event; this is a second cleanup signal.
    const stopListener = (): void => {
      void ipcRenderer
        .invoke("openaware:invoke", { type: "state.get" })
        .then(callback)
        .catch(() => {});
    };
    ipcRenderer.on("openaware:stop", stopListener);
    return () => {
      ipcRenderer.removeListener("openaware:state", listener);
      ipcRenderer.removeListener("openaware:stop", stopListener);
    };
  },
  listDesktopSources: () => ipcRenderer.invoke("openaware:list-desktop"),
  selectDesktopSource: (id) =>
    ipcRenderer.invoke("openaware:select-desktop", id),
  chooseVideoFile: () => ipcRenderer.invoke("openaware:choose-video-file"),
  prepareVideoUrl: (url, mode) =>
    ipcRenderer.invoke("openaware:prepare-video-url", url, mode),
  openVideoSource: (sourceId) =>
    ipcRenderer.invoke("openaware:open-video-source", sourceId),
  startDesktopCapture: (sourceId, captureId) =>
    ipcRenderer.invoke("openaware:start-desktop-capture", sourceId, captureId),
  stopDesktopCapture: (sourceId, captureId) =>
    ipcRenderer.invoke("openaware:stop-desktop-capture", sourceId, captureId),
  onDesktopFrame: (callback) => {
    if (typeof callback !== "function")
      throw new Error("Desktop frame callback must be a function");
    const listener = (
      _event: Electron.IpcRendererEvent,
      frame: DesktopCaptureFrame,
    ): void => callback(frame);
    ipcRenderer.on("openaware:desktop-frame", listener);
    return () =>
      ipcRenderer.removeListener("openaware:desktop-frame", listener);
  },
  onDesktopError: (callback) => {
    if (typeof callback !== "function")
      throw new Error("Desktop error callback must be a function");
    const listener = (
      _event: Electron.IpcRendererEvent,
      error: DesktopCaptureError,
    ): void => callback(error);
    ipcRenderer.on("openaware:desktop-error", listener);
    return () =>
      ipcRenderer.removeListener("openaware:desktop-error", listener);
  },
  executePlan: (planId) => ipcRenderer.invoke("openaware:execute-plan", planId),
  stopAll: () => ipcRenderer.invoke("openaware:stop"),
  getDesktopState: () => ipcRenderer.invoke("openaware:desktop-state"),
  setBackgroundMode: (enabled) =>
    ipcRenderer.invoke("openaware:background-mode", enabled),
  onDesktopState: (callback) => {
    if (typeof callback !== "function")
      throw new Error("Desktop state callback must be a function");
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: DesktopState,
    ): void => callback(state);
    ipcRenderer.on("openaware:desktop-state", listener);
    return () =>
      ipcRenderer.removeListener("openaware:desktop-state", listener);
  },
  quit: () => ipcRenderer.invoke("openaware:quit"),
};
contextBridge.exposeInMainWorld("openAware", bridge);
