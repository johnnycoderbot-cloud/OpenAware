import type {
  DesktopCaptureError,
  DesktopCaptureFrame,
  Frame,
  Mask,
  OpenAwareBridge,
  Source,
} from "@openaware/contracts";

export interface CaptureInfo {
  stream?: MediaStream;
  canvas?: HTMLCanvasElement;
  previewAt: number;
  blocked: boolean;
  error?: string;
}
interface Pipeline {
  id: string;
  captureId?: string;
  deviceId?: string;
  stream?: MediaStream;
  video?: HTMLVideoElement;
  demo?: HTMLCanvasElement;
  nativeWidth?: number;
  nativeHeight?: number;
  fps?: number;
  pendingFrame?: DesktopCaptureFrame;
  decoding?: boolean;
  receivedSequence: number;
  firstDesktopFrame?: Promise<void>;
  firstDesktopFrameReady?: () => void;
  firstDesktopFrameTimer?: ReturnType<typeof setTimeout>;
  timer?: ReturnType<typeof setInterval>;
  animation?: number;
  decodedCallback?: number;
  deliveredAt: number;
  deliveredMonotonic: number;
  deliverySequence: number;
  sampledSequence: number;
  stopped: boolean;
  busy: boolean;
  frameAt: number;
  previewAt: number;
  previous?: Uint8Array;
  width: number;
  height: number;
  blocked: boolean;
  baselineRevision: number;
}

function paintMasks(
  context: CanvasRenderingContext2D,
  masks: Mask[],
  width: number,
  height: number,
) {
  context.fillStyle = "#000";
  for (const m of masks)
    context.fillRect(
      Math.floor(m.x * width),
      Math.floor(m.y * height),
      Math.ceil(m.width * width) + 1,
      Math.ceil(m.height * height) + 1,
    );
}

export function createProbe(source: Source): Frame {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, 640, 360);
  c.fillStyle = "#ed3044";
  c.fillRect(55, 100, 130, 130);
  c.fillStyle = "#125be8";
  c.beginPath();
  c.arc(350, 165, 65, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#111111";
  c.font = "bold 30px sans-serif";
  c.fillText("OPENAWARE 42", 45, 310);
  return {
    id: crypto.randomUUID(),
    sourceId: source.id,
    sourceRevision: source.revision,
    capturedAt: Date.now(),
    width: 640,
    height: 360,
    dataUrl: canvas.toDataURL("image/jpeg", 0.85),
  };
}

export class CaptureManager {
  private pipelines = new Map<string, Pipeline>();
  private unsubscribeDesktopFrame: () => void;
  private unsubscribeDesktopError: () => void;
  constructor(
    private bridge: OpenAwareBridge,
    private getSource: (id: string) => Source | undefined,
    private changed: () => void,
    private report: (message: string) => void,
  ) {
    this.unsubscribeDesktopFrame = bridge.onDesktopFrame((frame) => {
      const p = this.pipelines.get(frame.sourceId);
      if (
        !p ||
        p.stopped ||
        p.captureId !== frame.captureId ||
        p.deviceId !== frame.deviceId ||
        frame.sequence <= p.receivedSequence
      )
        return;
      p.receivedSequence = frame.sequence;
      // Keep only the latest packet while one JPEG is decoding. A slow dashboard
      // cannot accumulate captured images or replay an old connection's pixels.
      p.pendingFrame = frame;
      void this.decodeDesktop(p);
    });
    this.unsubscribeDesktopError = bridge.onDesktopError((error) => {
      const p = this.pipelines.get(error.sourceId);
      if (p && p.captureId === error.captureId) this.desktopFailed(p, error);
    });
  }
  info(id: string): CaptureInfo | undefined {
    const p = this.pipelines.get(id);
    return (
      p && {
        stream: p.stream,
        canvas: p.demo,
        previewAt: p.previewAt,
        blocked: p.blocked,
      }
    );
  }
  has(id: string) {
    return this.pipelines.has(id);
  }
  reviewMasks(id: string) {
    const p = this.pipelines.get(id);
    if (p) {
      p.blocked = false;
      p.previous = undefined;
      this.changed();
    }
  }
  async start(source: Source) {
    this.stop(source.id);
    const p: Pipeline = {
      id: source.id,
      stopped: false,
      busy: false,
      frameAt: 0,
      previewAt: 0,
      deliveredAt: 0,
      deliveredMonotonic: 0,
      deliverySequence: 0,
      receivedSequence: 0,
      sampledSequence: 0,
      width: 0,
      height: 0,
      blocked: false,
      baselineRevision: 0,
    };
    this.pipelines.set(source.id, p);
    this.changed();
    try {
      if (source.kind === "demo") {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 540;
        p.demo = canvas;
        const animate = () => {
          if (p.stopped) return;
          this.paintDemo(canvas, Date.now());
          p.previewAt = p.deliveredAt = Date.now();
          p.deliveredMonotonic = performance.now();
          p.deliverySequence += 1;
          p.animation = requestAnimationFrame(animate);
        };
        animate();
      } else if (source.kind === "monitor" || source.kind === "window") {
        p.captureId = crypto.randomUUID();
        p.deviceId = source.deviceId;
        p.demo = document.createElement("canvas");
        p.firstDesktopFrame = new Promise<void>((resolve) => {
          p.firstDesktopFrameReady = resolve;
        });
        p.firstDesktopFrameTimer = setTimeout(() => {
          this.desktopFailed(p, {
            sourceId: p.id,
            captureId: p.captureId!,
            message: "The selected source did not provide a preview frame.",
          });
        }, 15_000);
        // Only the fixed, isolated capture owner receives native desktop media.
        // Its token also keeps a late stop or packet from affecting reconnect.
        await this.bridge.startDesktopCapture(source.id, p.captureId);
        if (p.stopped) return;
        await p.firstDesktopFrame;
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: source.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 15, max: 30 },
          },
          audio: false,
        });
        if (p.stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        p.stream = stream;
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        p.video = video;
        if (typeof video.requestVideoFrameCallback !== "function")
          throw new Error("Decoded video-frame tracking is unavailable.");
        const delivered = () => {
          if (p.stopped || this.pipelines.get(source.id) !== p) return;
          p.previewAt = p.deliveredAt = Date.now();
          p.deliveredMonotonic = performance.now();
          p.deliverySequence += 1;
          p.decodedCallback = video.requestVideoFrameCallback(delivered);
        };
        p.decodedCallback = video.requestVideoFrameCallback(delivered);
        await video.play();
        for (const track of stream.getTracks())
          track.addEventListener("ended", () => {
            if (!p.stopped) {
              this.stop(source.id);
              void this.bridge
                .invoke({
                  type: "source.update",
                  sourceId: source.id,
                  patch: {
                    status: "unavailable",
                    error: "Capture ended. Reconnect to resume.",
                  },
                })
                .catch((e) => this.report(String(e)));
            }
          });
      }
      if (p.stopped) return;
      p.width = p.nativeWidth || p.video?.videoWidth || p.demo?.width || 0;
      p.height = p.nativeHeight || p.video?.videoHeight || p.demo?.height || 0;
      if (!p.width || !p.height)
        throw new Error("The selected source did not provide a video frame.");
      const settings = p.stream?.getVideoTracks()[0]?.getSettings();
      p.blocked =
        source.masks.length > 0 &&
        !!source.width &&
        (source.width !== p.width || source.height !== p.height);
      await this.bridge.invoke({
        type: "source.update",
        sourceId: source.id,
        patch: {
          status: "live",
          width: p.width,
          height: p.height,
          fps:
            settings?.frameRate || p.fps || (source.kind === "demo" ? 30 : 0),
          error: p.blocked
            ? "Source dimensions changed. Review privacy masks before analysis."
            : "",
          ...(p.blocked
            ? { analysisEnabled: false, motionEnabled: false }
            : {}),
        },
      });
      if (p.stopped) return;
      p.timer = setInterval(() => {
        void this.sample(p);
      }, 200);
      await this.sample(p);
      this.changed();
    } catch (error) {
      // A rejected acquisition may belong to a pipeline that Stop already replaced.
      // Its completion must not tear down or mark the new acquisition unavailable.
      if (this.pipelines.get(source.id) !== p || p.stopped) return;
      this.stop(source.id);
      const message = error instanceof Error ? error.message : String(error);
      await this.bridge
        .invoke({
          type: "source.update",
          sourceId: source.id,
          patch: { status: "unavailable", error: message.slice(0, 300) },
        })
        .catch(() => {});
      throw error;
    }
  }
  stop(id: string) {
    const p = this.pipelines.get(id);
    if (!p) return;
    p.stopped = true;
    p.pendingFrame = undefined;
    if (p.firstDesktopFrameTimer) clearTimeout(p.firstDesktopFrameTimer);
    p.firstDesktopFrameReady?.();
    p.firstDesktopFrameReady = undefined;
    if (p.captureId)
      void this.bridge.stopDesktopCapture(id, p.captureId).catch(() => {});
    if (p.timer) clearInterval(p.timer);
    if (p.animation) cancelAnimationFrame(p.animation);
    p.stream?.getTracks().forEach((track) => track.stop());
    if (p.video) {
      if (p.decodedCallback !== undefined)
        p.video.cancelVideoFrameCallback(p.decodedCallback);
      p.video.pause();
      p.video.srcObject = null;
    }
    this.pipelines.delete(id);
    this.changed();
  }
  stopAll() {
    for (const id of [...this.pipelines.keys()]) this.stop(id);
  }
  dispose() {
    this.stopAll();
    this.unsubscribeDesktopFrame();
    this.unsubscribeDesktopError();
  }
  private desktopFailed(p: Pipeline, error: DesktopCaptureError) {
    if (p.stopped || this.pipelines.get(p.id) !== p) return;
    this.stop(p.id);
    const message = error.message.slice(0, 300);
    void this.bridge
      .invoke({
        type: "source.update",
        sourceId: p.id,
        patch: { status: "unavailable", error: message },
      })
      .catch(() => {});
    this.report(message);
  }
  private async decodeDesktop(p: Pipeline) {
    if (p.decoding) return;
    p.decoding = true;
    try {
      while (!p.stopped && p.pendingFrame) {
        const frame = p.pendingFrame;
        p.pendingFrame = undefined;
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () =>
            reject(new Error("Desktop preview decoding failed."));
          image.src = frame.dataUrl;
        });
        if (p.stopped || this.pipelines.get(p.id) !== p) return;
        if (
          image.naturalWidth !== frame.width ||
          image.naturalHeight !== frame.height ||
          frame.width < 1 ||
          frame.height < 1 ||
          !Number.isFinite(frame.capturedAt) ||
          frame.capturedAt <= 0 ||
          frame.capturedAt > Date.now() + 1000
        )
          throw new Error("Desktop preview metadata is invalid.");
        const canvas = p.demo!;
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        }
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        p.nativeWidth = frame.nativeWidth;
        p.nativeHeight = frame.nativeHeight;
        p.fps = frame.fps;
        p.previewAt = p.deliveredAt = frame.capturedAt;
        // Use the owner's decoded-frame time, including transport/decode delay.
        // Repainting a cached JPEG never gives it a fresh sampling deadline.
        p.deliveredMonotonic =
          performance.now() - Math.max(0, Date.now() - frame.capturedAt);
        p.deliverySequence = frame.sequence;
        if (p.firstDesktopFrameTimer) clearTimeout(p.firstDesktopFrameTimer);
        p.firstDesktopFrameReady?.();
        p.firstDesktopFrameReady = undefined;
        this.changed();
      }
    } catch (error) {
      this.desktopFailed(p, {
        sourceId: p.id,
        captureId: p.captureId!,
        message:
          error instanceof Error ? error.message : "Desktop preview failed.",
      });
    } finally {
      p.decoding = false;
    }
  }
  private async sample(p: Pipeline) {
    if (p.stopped || p.busy) return;
    const source = this.getSource(p.id);
    if (!source || source.status !== "live") return;
    if (p.baselineRevision !== source.revision) {
      p.previous = undefined;
      p.baselineRevision = source.revision;
      p.frameAt = 0;
    }
    const input = p.video || p.demo;
    if (!input) return;
    const width = p.nativeWidth || p.video?.videoWidth || p.demo?.width || 0;
    const height =
      p.nativeHeight || p.video?.videoHeight || p.demo?.height || 0;
    if (width !== p.width || height !== p.height) {
      p.width = width;
      p.height = height;
      p.previous = undefined;
      p.blocked = source.masks.length > 0;
      await this.bridge
        .invoke({
          type: "source.update",
          sourceId: source.id,
          patch: {
            width,
            height,
            ...(p.blocked
              ? {
                  analysisEnabled: false,
                  motionEnabled: false,
                  error:
                    "Source dimensions changed. Review privacy masks before analysis.",
                }
              : {}),
          },
        })
        .catch((e) => this.report(String(e)));
      this.changed();
      return;
    }
    if (p.blocked || !width || !height) return;
    // A live track can stop delivering frames without an ended event. Never
    // refresh cached pixels using the sampling timer, or count a frame twice.
    if (
      !p.deliveredAt ||
      performance.now() - p.deliveredMonotonic > 5000 ||
      p.deliverySequence === p.sampledSequence
    )
      return;
    p.sampledSequence = p.deliverySequence;
    const capturedAt = p.deliveredAt;
    const capturedMonotonic = p.deliveredMonotonic;
    p.busy = true;
    try {
      const motionCanvas = document.createElement("canvas");
      motionCanvas.width = 160;
      motionCanvas.height = 90;
      const mc = motionCanvas.getContext("2d", { willReadFrequently: true })!;
      mc.drawImage(input, 0, 0, 160, 90);
      paintMasks(mc, source.masks, 160, 90);
      const pixels = mc.getImageData(0, 0, 160, 90).data;
      const luminance = new Uint8Array(160 * 90);
      let changed = 0;
      for (let i = 0; i < luminance.length; i++) {
        luminance[i] = Math.round(
          0.299 * pixels[i * 4]! +
            0.587 * pixels[i * 4 + 1]! +
            0.114 * pixels[i * 4 + 2]!,
        );
        if (p.previous && Math.abs(luminance[i]! - p.previous[i]!) > 15)
          changed++;
      }
      const motion = p.previous ? changed / luminance.length : 0;
      p.previous = luminance;
      // Freeze pixels and their reviewed masks before the asynchronous metric
      // command. A newer camera frame or desktop JPEG may replace the preview
      // while that command is pending.
      let canvas: HTMLCanvasElement | undefined;
      if (Date.now() - p.frameAt >= 2000) {
        const scale = Math.min(1, 1024 / Math.max(width, height));
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const c = canvas.getContext("2d")!;
        c.drawImage(input, 0, 0, canvas.width, canvas.height);
        paintMasks(c, source.masks, canvas.width, canvas.height);
      }
      if (source.motionEnabled)
        await this.bridge.invoke({
          type: "source.motion",
          sourceId: source.id,
          sourceRevision: source.revision,
          capturedAt,
          value: motion,
        });
      const authority = this.getSource(p.id);
      if (
        !canvas ||
        p.stopped ||
        this.pipelines.get(p.id) !== p ||
        (p.nativeWidth || p.video?.videoWidth || p.demo?.width || 0) !==
          width ||
        (p.nativeHeight || p.video?.videoHeight || p.demo?.height || 0) !==
          height ||
        performance.now() - capturedMonotonic > 5000 ||
        !authority ||
        authority.status !== "live" ||
        authority.revision !== source.revision
      )
        return;
      let dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      if (dataUrl.length > 1_398_100)
        dataUrl = canvas.toDataURL("image/jpeg", 0.4);
      if (dataUrl.length > 1_398_100)
        throw new Error("Encoded frame exceeds the 1 MiB limit.");
      const latest = this.getSource(p.id);
      if (p.stopped || !latest || latest.revision !== source.revision) return;
      p.frameAt = Date.now();
      await this.bridge.invoke({
        type: "source.frame",
        frame: {
          id: crypto.randomUUID(),
          sourceId: source.id,
          sourceRevision: source.revision,
          capturedAt,
          width: canvas.width,
          height: canvas.height,
          dataUrl,
        },
      });
    } catch (e) {
      if (!p.stopped) this.report(e instanceof Error ? e.message : String(e));
    } finally {
      p.busy = false;
    }
  }
  private paintDemo(canvas: HTMLCanvasElement, time: number) {
    const c = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;
    c.fillStyle = "#0e1927";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#20354a";
    c.lineWidth = 1;
    for (let x = 0; x < w; x += 60) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = 0; y < h; y += 60) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.fillStyle = "#90a9bc";
    c.font = "18px monospace";
    c.fillText("OPENAWARE / SYNTHETIC SIGNAL", 35, 46);
    c.fillStyle = "#dce7f0";
    c.font = "bold 34px sans-serif";
    c.fillText("Motion calibration", 35, 102);
    c.strokeStyle = "#57e8bb";
    c.lineWidth = 3;
    c.beginPath();
    for (let x = 35; x < w - 35; x += 3) {
      const y =
        h * 0.68 +
        Math.sin(x / 70 + time / 900) * 40 +
        Math.sin(x / 26 + time / 1100) * 16;
      if (x === 35) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    const x = 70 + ((time / 15) % (w - 210));
    c.fillStyle = "#297ced";
    c.fillRect(x, 165, 110, 85);
    c.fillStyle = "#ffb754";
    c.beginPath();
    c.arc(w - 135, 198, 44 + Math.sin(time / 1000) * 6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#90a9bc";
    c.font = "16px monospace";
    c.fillText("Generated locally. No camera or desktop capture.", 35, h - 35);
  }
}
