import type { DesktopState } from "../../../packages/contracts/src/index";

interface BackgroundControls {
  showWindow(): void;
  hideWindow(): void;
  getWindowVisibility?(): boolean;
  stop(): void;
  closeService(): void;
  destroyTray(): void;
  quitApp(): void;
  onState(state: DesktopState): void;
  onCleanupError?(): void;
}

export function launchModeFromArgs(
  args: readonly string[],
): DesktopState["launchMode"] {
  return args.some((arg) => arg === "--background" || arg === "--headless")
    ? "background"
    : "window";
}

// This controls window lifetime only. Entering background mode never starts a
// source, grants capture permission, changes the model, or authorizes input.
export class DesktopBackgroundController {
  private state: DesktopState;
  private quitting = false;
  private serviceHasFailed = false;

  constructor(
    private readonly controls: BackgroundControls,
    launchMode: DesktopState["launchMode"],
    private readonly allowSyntheticBackground = false,
  ) {
    this.state = {
      backgroundMode: false,
      windowVisible: false,
      trayAvailable: false,
      launchMode,
    };
  }

  snapshot(): DesktopState {
    return {
      ...this.state,
      windowVisible:
        this.controls.getWindowVisibility?.() ?? this.state.windowVisible,
    };
  }

  isQuitting(): boolean {
    return this.quitting;
  }

  private publish(): DesktopState {
    const state = this.snapshot();
    this.controls.onState(state);
    return state;
  }

  setTrayAvailable(available: boolean): void {
    this.state.trayAvailable = available;
    if (
      !available &&
      this.state.backgroundMode &&
      !this.allowSyntheticBackground
    ) {
      this.state.backgroundMode = false;
      this.show();
    } else this.publish();
  }

  launch(): boolean {
    if (this.serviceHasFailed || this.quitting) return false;
    if (this.state.launchMode !== "background") return false;
    if (!this.state.trayAvailable && !this.allowSyntheticBackground)
      return false;
    this.setBackgroundMode(true);
    return true;
  }

  setBackgroundMode(enabled: unknown): DesktopState {
    if (typeof enabled !== "boolean")
      throw new Error("Background mode must be a boolean");
    if (this.quitting) throw new Error("OpenAware is closing");
    if (enabled && !this.state.trayAvailable && !this.allowSyntheticBackground)
      throw new Error("Background mode requires an available system tray");
    this.state.backgroundMode = enabled;
    enabled ? this.hide() : this.show();
    return this.snapshot();
  }

  windowVisibilityChanged(visible: boolean): void {
    if (this.state.windowVisible === visible) return;
    this.state.windowVisible = visible;
    this.publish();
  }

  show(): void {
    if (this.quitting) return;
    this.controls.showWindow();
    this.state.windowVisible = this.controls.getWindowVisibility?.() ?? true;
    this.publish();
  }

  hide(): void {
    if (this.quitting) return;
    this.controls.hideWindow();
    this.state.windowVisible = this.controls.getWindowVisibility?.() ?? false;
    this.publish();
  }

  // The caller prevents the first native close. app.quit() then closes for real
  // after beginQuit has synchronously revoked capture and native input authority.
  closeRequested(): void {
    if (this.quitting) return;
    if (this.state.backgroundMode) this.hide();
    else this.quit();
  }

  restoreAfterReview(wasVisible: boolean): void {
    if (this.quitting) return;
    if (this.state.backgroundMode) this.hide();
    else if (wasVisible) this.show();
  }

  serviceFailed(): void {
    // Surface stopped/error state. Do not restart the service or any feed.
    // Renderer loading may still be pending; initial launch must not hide this.
    this.serviceHasFailed = true;
    this.show();
  }

  beginQuit(): void {
    if (this.quitting) return;
    this.quitting = true;
    this.state.backgroundMode = false;
    this.publish();
    // Continue cleanup even if one native cleanup operation fails.
    for (const cleanup of [
      this.controls.stop,
      this.controls.closeService,
      this.controls.destroyTray,
    ]) {
      try {
        cleanup();
      } catch {
        this.controls.onCleanupError?.();
      }
    }
  }

  quit(): void {
    if (this.quitting) return;
    this.beginQuit();
    this.controls.quitApp();
  }
}
