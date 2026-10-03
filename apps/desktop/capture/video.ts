// Fixed, sandboxed decoder: only the owner's same-origin opaque media route.
const video = document.querySelector<HTMLVideoElement>("#capture")!;
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", { alpha: false })!;
const MAX_URL_LENGTH = 23 + 4 * Math.ceil(1_572_864 / 3);
let latest: unknown;
let callbackId: number | undefined;
let started = false;
let ended = false;
let stopped = false;
let encodedAt = -Infinity;
let sequence = 0;
let rejectFirst: ((error: Error) => void) | undefined;
function stop(): void {
  stopped = true;
  if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId);
  callbackId = undefined;
  video.pause();
  video.removeAttribute("src");
  video.load();
  latest = undefined;
  canvas.width = canvas.height = 1;
}
function fail(): void {
  ended = true;
  stop();
  rejectFirst?.(new Error("Video unavailable."));
  rejectFirst = undefined;
}
async function start(): Promise<void> {
  if (started || stopped) throw new Error("Video player already used.");
  started = true;
  try {
    video.muted = true;
    video.volume = 0;
    video.addEventListener("error", fail, { once: true });
    video.addEventListener("ended", fail, { once: true });
    const first = new Promise<void>((resolve, reject) => {
      rejectFirst = reject;
      const delivered = (now: number): void => {
        if (stopped) return;
        try {
          const nativeWidth = video.videoWidth,
            nativeHeight = video.videoHeight;
          if (
            nativeWidth < 1 ||
            nativeHeight < 1 ||
            nativeWidth > 32768 ||
            nativeHeight > 32768
          )
            throw new Error("Video dimensions invalid.");
          if (now - encodedAt >= 1000 / 15) {
            encodedAt = now;
            const scale = Math.min(
              1,
              1280 / Math.max(nativeWidth, nativeHeight),
            );
            const width = Math.max(1, Math.round(nativeWidth * scale)),
              height = Math.max(1, Math.round(nativeHeight * scale));
            canvas.width = width;
            canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
            if (dataUrl.length > MAX_URL_LENGTH)
              dataUrl = canvas.toDataURL("image/jpeg", 0.45);
            if (dataUrl.length > MAX_URL_LENGTH)
              throw new Error("Video frame too large.");
            latest = {
              dataUrl,
              width,
              height,
              nativeWidth,
              nativeHeight,
              capturedAt: Date.now(),
              sequence: ++sequence,
              fps: 15,
            };
            rejectFirst = undefined;
            resolve();
          }
          callbackId = video.requestVideoFrameCallback(delivered);
        } catch {
          fail();
        }
      };
      callbackId = video.requestVideoFrameCallback(delivered);
    });
    video.src = "./media";
    await Promise.all([video.play(), first]);
    if (stopped) throw new Error("Video stopped.");
  } catch {
    fail();
    throw new Error("Video could not play.");
  }
}
function take(): { frame?: unknown; ended?: boolean } {
  if (ended) return { ended: true };
  const frame = latest;
  latest = undefined;
  return frame ? { frame } : {};
}
Object.defineProperty(window, "openAwareVideo", {
  value: Object.freeze({ start, take }),
  writable: false,
  configurable: false,
});
window.addEventListener("pagehide", stop, { once: true });
export {};
