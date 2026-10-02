// This fixed document has no Node, preload, IPC, network, or source-selection API.
// Main selects one native source in this document's disposable session.
interface PreviewFrame {
  dataUrl: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
  capturedAt: number;
  sequence: number;
  fps: number;
}
const video = document.querySelector<HTMLVideoElement>("#capture")!;
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", { alpha: false })!;
const MAX_URL_LENGTH = 23 + 4 * Math.ceil(1_572_864 / 3);
let stream: MediaStream | undefined;
let callbackId: number | undefined;
let latest: PreviewFrame | undefined;
let started = false;
let stopped = false;
let ended = false;
let sequence = 0;
let encodedAt = -Infinity;
let previewFps = 15;
let rejectFirstFrame: ((error: Error) => void) | undefined;

function stop() {
  stopped = true;
  if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId);
  callbackId = undefined;
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  video.pause();
  video.srcObject = null;
  latest = undefined;
  canvas.width = canvas.height = 1;
}
function fail() {
  ended = true;
  stop();
  rejectFirstFrame?.(new Error("Capture worker stopped."));
  rejectFirstFrame = undefined;
}
async function start(): Promise<void> {
  if (started || stopped) throw new Error("Capture worker is already used.");
  started = true;
  try {
    const acquired = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 15 } },
      audio: false,
    });
    if (stopped) {
      acquired.getTracks().forEach((track) => track.stop());
      throw new Error("Capture worker stopped.");
    }
    stream = acquired;
    if (stream.getAudioTracks().length || stream.getVideoTracks().length !== 1)
      throw new Error("Unexpected capture tracks.");
    if (typeof video.requestVideoFrameCallback !== "function")
      throw new Error("Decoded-frame tracking is unavailable.");
    const settings = stream.getVideoTracks()[0]!.getSettings();
    if (settings.frameRate && Number.isFinite(settings.frameRate))
      previewFps = Math.min(15, settings.frameRate);
    video.srcObject = stream;
    const firstFrame = new Promise<void>((resolve, reject) => {
      rejectFirstFrame = reject;
      const delivered = (now: number) => {
        if (stopped) return;
        try {
          const nativeWidth = video.videoWidth;
          const nativeHeight = video.videoHeight;
          if (
            nativeWidth < 1 ||
            nativeHeight < 1 ||
            nativeWidth > 32768 ||
            nativeHeight > 32768
          )
            throw new Error("Invalid capture dimensions.");
          // Encode only actual decoded deliveries, at most 15 per second. Keep
          // one latest frame; a main-process drain never refreshes old pixels.
          if (now - encodedAt >= 1000 / 15) {
            encodedAt = now;
            const capturedAt = Date.now();
            const scale = Math.min(
              1,
              1280 / Math.max(nativeWidth, nativeHeight),
            );
            const width = Math.max(1, Math.round(nativeWidth * scale));
            const height = Math.max(1, Math.round(nativeHeight * scale));
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }
            context.drawImage(video, 0, 0, width, height);
            let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
            if (dataUrl.length > MAX_URL_LENGTH)
              dataUrl = canvas.toDataURL("image/jpeg", 0.45);
            if (dataUrl.length > MAX_URL_LENGTH)
              throw new Error("Encoded capture frame is too large.");
            latest = {
              dataUrl,
              width,
              height,
              nativeWidth,
              nativeHeight,
              capturedAt,
              sequence: ++sequence,
              fps: previewFps,
            };
            rejectFirstFrame = undefined;
            resolve();
          }
          callbackId = video.requestVideoFrameCallback(delivered);
        } catch {
          fail();
        }
      };
      callbackId = video.requestVideoFrameCallback(delivered);
    });
    for (const track of stream.getTracks())
      track.addEventListener("ended", fail, { once: true });
    await Promise.all([video.play(), firstFrame]);
    if (stopped) throw new Error("Capture worker stopped.");
  } catch {
    fail();
    throw new Error("Desktop capture could not start.");
  }
}
function take(): { frame?: PreviewFrame; ended?: boolean } {
  if (ended) return { ended: true };
  const frame = latest;
  latest = undefined;
  return frame ? { frame } : {};
}
Object.defineProperty(window, "openAwareCapture", {
  value: Object.freeze({ start, take }),
  writable: false,
  configurable: false,
});
window.addEventListener("pagehide", stop, { once: true });
export {};
