import { contextBridge, ipcRenderer } from "electron";
import type {
  OpenAwareBridge,
  DesktopState,
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
