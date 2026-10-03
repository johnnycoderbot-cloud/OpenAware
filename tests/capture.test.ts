import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CaptureManager } from "../apps/desktop/renderer/capture";
import {
  initialSnapshot,
  type Command,
  type DesktopCaptureError,
  type DesktopCaptureFrame,
  type OpenAwareBridge,
  type Source,
} from "../packages/contracts/src/index";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function media() {
  let stops = 0;
  const track = {
    stop: () => {
      stops++;
    },
    addEventListener: () => {},
    getSettings: () => ({ frameRate: 15 }),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stops: () => stops };
}

/** Minimal browser stand-ins. These tests verify lifecycle and command routing, not camera hardware or JPEG encoding. */
function browser(
  t: TestContext,
  getUserMedia: () => Promise<MediaStream>,
  manualImages = false,
) {
  let luminance = 0;
  const encodedLuminance: number[] = [];
  const videos: Array<{ callbacks: Map<number, () => void> }> = [];
  function deliver() {
    const video = videos.at(-1);
    if (!video) throw new Error("No video is connected");
    const next = video.callbacks.entries().next().value;
    if (!next) throw new Error("No decoded frame callback is registered");
    video.callbacks.delete(next[0]);
    next[1]();
  }
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const images: Array<{
    naturalWidth: number;
    naturalHeight: number;
    onload?: () => void;
  }> = [];
  class PreviewImage {
    naturalWidth = 1280;
    naturalHeight = 720;
    onload?: () => void;
    onerror?: () => void;
    constructor() {
      images.push(this);
    }
    set src(value: string) {
      if (value && !manualImages) queueMicrotask(() => this.onload?.());
    }
  }
  const document = {
    createElement(tag: string) {
      if (tag === "video") {
        const callbacks = new Map<number, () => void>();
        let handle = 0;
        const video = {
          callbacks,
          muted: true,
          playsInline: true,
          srcObject: null,
          videoWidth: 640,
          videoHeight: 360,
          play: async () => {
            deliver();
          },
          pause: () => {},
          requestVideoFrameCallback: (callback: () => void) => {
            const id = ++handle;
            callbacks.set(id, callback);
            return id;
          },
          cancelVideoFrameCallback: (id: number) => {
            callbacks.delete(id);
          },
        };
        videos.push(video);
        return video;
      }
      if (tag === "canvas") {
        let drawnLuminance = 0;
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {
              drawnLuminance = luminance;
            },
            fillRect: () => {},
            getImageData: (
              _x: number,
              _y: number,
              width: number,
              height: number,
            ) => {
              const data = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = drawnLuminance;
                data[i + 1] = drawnLuminance;
                data[i + 2] = drawnLuminance;
                data[i + 3] = 255;
              }
              return { data };
            },
          }),
          // The bridge fixture does not decode image content; transport is asserted separately in providers/UI tests.
          toDataURL: () => {
            encodedLuminance.push(drawnLuminance);
            return "data:image/jpeg;base64,/9j/2Q==";
          },
        };
      }
      throw new Error(`Unexpected element ${tag}`);
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia } },
  });
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: PreviewImage,
  });
  t.after(() => {
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalNavigator)
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalImage)
      Object.defineProperty(globalThis, "Image", originalImage);
    else Reflect.deleteProperty(globalThis, "Image");
  });
  return {
    setLuminance: (value: number) => {
      luminance = value;
    },
    deliver,
    encodedLuminance,
    images,
    decodeImage(index: number, width = 1280, height = 720) {
      const image = images[index];
      if (!image) throw new Error("No desktop image is waiting to decode");
      image.naturalWidth = width;
      image.naturalHeight = height;
      image.onload?.();
    },
  };
}

async function eventually(condition: () => boolean) {
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 1500;
    const poll = setInterval(() => {
      if (condition()) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(poll);
        reject(new Error("Capture sampling condition was not reached"));
      }
    }, 10);
  });
}

function harness(motionEnabled = false, kind: Source["kind"] = "camera") {
  const state = initialSnapshot();
  const source: Source = {
    id: randomUUID(),
    name: "Selected camera fixture",
    kind,
    deviceId: "explicit-camera-id",
    revision: 1,
    status: "stopped",
    analysisEnabled: true,
    motionEnabled,
    masks: [],
  };
  state.sources = [source];
  const commands: Command[] = [];
  let desktopFrame: (frame: DesktopCaptureFrame) => void = () => {};
  let desktopError: (error: DesktopCaptureError) => void = () => {};
  const starts: Array<{ sourceId: string; captureId: string }> = [];
  const stops: Array<{ sourceId: string; captureId: string }> = [];
  const emitFrame = (
    captureId: string,
    patch: Partial<DesktopCaptureFrame> = {},
  ) => {
    desktopFrame({
      sourceId: source.id,
      deviceId: source.deviceId,
      captureId,
      dataUrl: "data:image/jpeg;base64,/9j/2Q==",
      width: 1280,
      height: 720,
      nativeWidth: 3840,
      nativeHeight: 2160,
      capturedAt: Date.now(),
      sequence: 1,
      fps: 15,
      ...patch,
    });
  };
  const bridge: OpenAwareBridge = {
    async invoke<T>(command: Command): Promise<T> {
      commands.push(command);
      if (command.type === "source.update")
        state.sources = state.sources.map((item) =>
          item.id === command.sourceId
            ? { ...item, ...command.patch, revision: item.revision + 1 }
            : item,
        );
      return state as T;
    },
    onState: () => () => {},
    listDesktopSources: async () => [],
    selectDesktopSource: async () => {},
    chooseVideoFile: async () => undefined,
    prepareVideoUrl: async () => {
      throw new Error("No video selection in fixture");
    },
    openVideoSource: async () => {},
    startDesktopCapture: async (sourceId, captureId) => {
      starts.push({ sourceId, captureId });
      emitFrame(captureId);
    },
    stopDesktopCapture: async (sourceId, captureId) => {
      stops.push({ sourceId, captureId });
    },
    onDesktopFrame: (callback) => {
      desktopFrame = callback;
      return () => {
        desktopFrame = () => {};
      };
    },
    onDesktopError: (callback) => {
      desktopError = callback;
      return () => {
        desktopError = () => {};
      };
    },
    executePlan: async () => [],
    stopAll: async () => {},
    getDesktopState: async () => ({
      backgroundMode: false,
      windowVisible: true,
      trayAvailable: false,
      launchMode: "window",
    }),
    setBackgroundMode: async (enabled) => ({
      backgroundMode: enabled,
      windowVisible: !enabled,
      trayAvailable: false,
      launchMode: "window",
    }),
    onDesktopState: () => () => {},
    quit: async () => {},
  };
  const manager = new CaptureManager(
    bridge,
    (id) => state.sources.find((item) => item.id === id),
    () => {},
    (message) => {
      throw new Error(message);
    },
  );
  return {
    state,
    source,
    commands,
    manager,
    bridge,
    starts,
    stops,
    emitFrame,
    emitError: (error: DesktopCaptureError) => desktopError(error),
  };
}

test("a late rejected camera permission request cannot tear down its replacement after Stop and reconnect", async (t) => {
  const oldAcquisition = deferred<MediaStream>();
  const replacement = media();
  let acquisitions = 0;
  browser(t, () =>
    ++acquisitions === 1
      ? oldAcquisition.promise
      : Promise.resolve(replacement.stream),
  );
  const h = harness();
  t.after(() => h.manager.stopAll());
  // Consume either cancellation outcome: the required behavior is isolation of the new acquisition.
  const oldStart = h.manager.start(h.source).catch(() => {});
  h.manager.stop(h.source.id);
  await h.manager.start(h.source);
  assert.equal(h.manager.info(h.source.id)?.stream, replacement.stream);
  oldAcquisition.reject(
    new Error("The old permission prompt was rejected late"),
  );
  await oldStart;
  assert.equal(acquisitions, 2);
  assert.equal(h.manager.info(h.source.id)?.stream, replacement.stream);
  assert.equal(
    replacement.stops(),
    0,
    "old completion must not stop the replacement track",
  );
  assert.equal(
    h.state.sources[0].status,
    "live",
    "old failure must not mark the replacement unavailable",
  );
  assert.equal(
    h.commands.some(
      (command) =>
        command.type === "source.update" &&
        command.patch.status === "unavailable",
    ),
    false,
  );
  h.manager.stopAll();
  assert.equal(
    replacement.stops(),
    1,
    "explicit stop still releases the replacement track",
  );
});

test("capture sends motion once through the dedicated metric path without repeating it in JPEG frames", async (t) => {
  const current = media();
  const scene = browser(t, () => Promise.resolve(current.stream));
  const h = harness(true);
  t.after(() => h.manager.stopAll());
  await h.manager.start(h.source);
  const firstMetrics = h.commands.filter(
    (command) => command.type === "source.motion",
  );
  const firstFrames = h.commands.filter(
    (command) => command.type === "source.frame",
  );
  assert.equal(
    firstMetrics.length,
    1,
    "one sampled baseline produces one dedicated metric",
  );
  assert.equal(firstFrames.length, 1, "initial image frame is still delivered");
  assert.equal(
    Object.hasOwn(firstFrames[0].frame, "motion"),
    false,
    "JPEG transport must not double-count the metric",
  );
  assert.equal(firstMetrics[0].value, 0);
  scene.setLuminance(255);
  scene.deliver();
  // Exercise the public interval-driven sampling path rather than calling a private sampler.
  await eventually(
    () =>
      h.commands.filter((command) => command.type === "source.motion").length >=
      2,
  );
  const metrics = h.commands.filter(
    (command) => command.type === "source.motion",
  );
  assert.equal(metrics.length, 2);
  assert.equal(
    metrics[1].value,
    1,
    "changed pixels are measured by the next independent sample",
  );
  assert.equal(
    h.commands.filter((command) => command.type === "source.frame").length,
    1,
    "200 ms motion sampling does not require another 2 second JPEG",
  );
  assert.equal(
    h.commands
      .filter((command) => command.type === "source.frame")
      .every((command) => !Object.hasOwn(command.frame, "motion")),
    true,
  );
});

test("sampling a stalled video does not refresh evidence or repeat motion until another decoded frame arrives", async (t) => {
  const current = media();
  const scene = browser(t, () => Promise.resolve(current.stream));
  const h = harness(true);
  t.after(() => h.manager.stopAll());
  await h.manager.start(h.source);
  const firstPreviewAt = h.manager.info(h.source.id)!.previewAt;
  const firstFrame = h.commands.find(
    (command) => command.type === "source.frame",
  )!;
  assert.equal(
    firstFrame.frame.capturedAt,
    firstPreviewAt,
    "frame time comes from delivery, not a later sampling timer",
  );
  // Cross the JPEG interval while the track remains live but provides no new decoded frames.
  await new Promise((resolve) => setTimeout(resolve, 2250));
  assert.equal(h.manager.info(h.source.id)!.previewAt, firstPreviewAt);
  assert.equal(
    h.commands.filter((command) => command.type === "source.motion").length,
    1,
  );
  assert.equal(
    h.commands.filter((command) => command.type === "source.frame").length,
    1,
  );
  scene.setLuminance(255);
  scene.deliver();
  const newDeliveryAt = h.manager.info(h.source.id)!.previewAt;
  assert.ok(newDeliveryAt > firstPreviewAt);
  await eventually(
    () =>
      h.commands.filter((command) => command.type === "source.frame").length >=
      2,
  );
  const frames = h.commands.filter(
    (command) => command.type === "source.frame",
  );
  const metrics = h.commands.filter(
    (command) => command.type === "source.motion",
  );
  assert.equal(frames.length, 2);
  assert.equal(metrics.length, 2);
  assert.equal(frames[1].frame.capturedAt, newDeliveryAt);
  assert.equal(metrics[1].capturedAt, newDeliveryAt);
  assert.equal(metrics[1].value, 1);
});

test("continuous delivery during delayed motion IPC does not starve frozen AI samples", async (t) => {
  const current = media();
  const scene = browser(t, async () => current.stream);
  const h = harness(true);
  const invoke = h.bridge.invoke;
  h.bridge.invoke = async <T>(command: Command): Promise<T> => {
    const result = await invoke<T>(command);
    if (command.type === "source.motion")
      await new Promise((resolve) => setTimeout(resolve, 80));
    return result;
  };
  const continuous = setInterval(() => scene.deliver(), 20);
  t.after(() => {
    clearInterval(continuous);
    h.manager.stopAll();
  });
  await h.manager.start(h.source);
  const firstMotion = h.commands.find(
    (command) => command.type === "source.motion",
  )!;
  const frames = h.commands.filter(
    (command) => command.type === "source.frame",
  );
  assert.equal(
    frames.length,
    1,
    "new deliveries must not discard already frozen, still-fresh pixels",
  );
  assert.equal(frames[0].frame.capturedAt, firstMotion.capturedAt);
  assert.ok(
    h.manager.info(h.source.id)!.previewAt > frames[0].frame.capturedAt,
  );
});

for (const kind of ["video_file", "video_url", "web_video"] as const)
  test(`${kind} samples bounded owner packets and rejects frames after Stop`, async (t) => {
    browser(t, async () => {
      throw new Error("Video must not acquire dashboard media");
    });
    const h = harness(false, kind);
    t.after(() => h.manager.dispose());
    await h.manager.start(h.source);
    assert.ok(h.manager.info(h.source.id)?.canvas);
    const analysis = h.commands.find(
      (command) => command.type === "source.frame",
    );
    assert.ok(analysis);
    assert.equal(analysis.frame.width, 1024);
    assert.equal(analysis.frame.height, 576);
    const token = h.starts[0]!.captureId;
    h.manager.stopAll();
    const count = h.commands.length;
    h.emitFrame(token, { sequence: 2 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(h.manager.info(h.source.id), undefined);
    assert.equal(h.commands.length, count);
    assert.equal(h.stops.at(-1)?.captureId, token);
  });

test("isolated desktop previews preserve native geometry and the original decoded frame time", async (t) => {
  browser(t, async () => {
    throw new Error("Desktop previews must not request dashboard camera media");
  });
  const h = harness(true, "monitor");
  t.after(() => h.manager.dispose());
  const capturedAt = Date.now() - 250;
  h.bridge.startDesktopCapture = async (sourceId, captureId) => {
    h.starts.push({ sourceId, captureId });
    h.emitFrame(captureId, { capturedAt });
  };
  await h.manager.start(h.source);
  const info = h.manager.info(h.source.id)!;
  assert.equal(info.stream, undefined);
  assert.equal(info.canvas?.width, 1280);
  assert.equal(info.canvas?.height, 720);
  assert.equal(info.previewAt, capturedAt);
  assert.equal(h.state.sources[0].width, 3840);
  assert.equal(h.state.sources[0].height, 2160);
  assert.equal(h.state.sources[0].fps, 15);
  const frame = h.commands.find((command) => command.type === "source.frame")!;
  assert.equal(frame.frame.capturedAt, capturedAt);
  assert.equal(frame.frame.width, 1024);
  assert.equal(frame.frame.height, 576);
  assert.equal(
    h.commands.find((command) => command.type === "source.motion")!.capturedAt,
    capturedAt,
  );

  // Neither duplicate packets nor sampling timers renew this image's evidence.
  h.emitFrame(h.starts[0].captureId, { capturedAt: Date.now(), sequence: 1 });
  await new Promise((resolve) => setTimeout(resolve, 2250));
  assert.equal(h.manager.info(h.source.id)!.previewAt, capturedAt);
  assert.equal(
    h.commands.filter((command) => command.type === "source.frame").length,
    1,
  );
  assert.equal(
    h.commands.filter((command) => command.type === "source.motion").length,
    1,
  );
  const staleAt = Date.now() - 6000;
  h.emitFrame(h.starts[0].captureId, { capturedAt: staleAt, sequence: 2 });
  await eventually(() => h.manager.info(h.source.id)!.previewAt === staleAt);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    h.commands.filter((command) => command.type === "source.frame").length,
    1,
    "old transported pixels remain too old to submit as evidence",
  );
  assert.equal(
    h.commands.filter((command) => command.type === "source.motion").length,
    1,
  );
});

test("Stop and reconnect isolate delayed desktop start, decode, packets, and errors with a capture token", async (t) => {
  const scene = browser(
    t,
    async () => {
      throw new Error("Unexpected camera request");
    },
    true,
  );
  const h = harness(false, "window");
  t.after(() => h.manager.dispose());
  const oldAcquisition = deferred<void>();
  h.bridge.startDesktopCapture = async (sourceId, captureId) => {
    h.starts.push({ sourceId, captureId });
    h.emitFrame(captureId);
    if (h.starts.length === 1) await oldAcquisition.promise;
  };
  const oldStart = h.manager.start(h.source).catch(() => {});
  const oldToken = h.starts[0].captureId;
  assert.equal(scene.images.length, 1);
  h.manager.stop(h.source.id);
  const replacementStart = h.manager.start(h.source);
  const replacementToken = h.starts[1].captureId;
  assert.notEqual(replacementToken, oldToken);
  assert.deepEqual(h.stops, [{ sourceId: h.source.id, captureId: oldToken }]);
  scene.decodeImage(1);
  await replacementStart;
  const replacementCanvas = h.manager.info(h.source.id)!.canvas;
  const replacementAt = h.manager.info(h.source.id)!.previewAt;
  scene.decodeImage(0);
  oldAcquisition.reject(new Error("Old native acquisition rejected late"));
  await oldStart;
  h.emitFrame(oldToken, { sequence: 99, capturedAt: Date.now() });
  h.emitError({
    sourceId: h.source.id,
    captureId: oldToken,
    message: "Old capture ended",
  });
  await Promise.resolve();
  assert.equal(
    scene.images.length,
    2,
    "old packets are discarded before decoding",
  );
  assert.equal(h.manager.info(h.source.id)!.canvas, replacementCanvas);
  assert.equal(h.manager.info(h.source.id)!.previewAt, replacementAt);
  assert.equal(h.state.sources[0].status, "live");
  assert.equal(
    h.commands.some(
      (command) =>
        command.type === "source.update" &&
        command.patch.status === "unavailable",
    ),
    false,
  );
  h.manager.stopAll();
  assert.deepEqual(h.stops[1], {
    sourceId: h.source.id,
    captureId: replacementToken,
  });
});

test("desktop decode queues retain only the newest packet and dimension changes require mask review", async (t) => {
  const scene = browser(
    t,
    async () => {
      throw new Error("Unexpected camera request");
    },
    true,
  );
  const h = harness(true, "monitor");
  h.source.masks = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }];
  t.after(() => h.manager.dispose());
  const start = h.manager.start(h.source);
  const captureId = h.starts[0].captureId;
  scene.decodeImage(0);
  await start;
  const secondAt = Date.now();
  h.emitFrame(captureId, { sequence: 2, capturedAt: secondAt });
  h.emitFrame(captureId, { sequence: 3, capturedAt: secondAt + 1 });
  h.emitFrame(captureId, {
    sequence: 4,
    capturedAt: secondAt + 2,
    nativeWidth: 2560,
    nativeHeight: 1440,
  });
  assert.equal(
    scene.images.length,
    2,
    "only one JPEG decodes while newer packets replace one pending slot",
  );
  scene.decodeImage(1);
  await eventually(() => scene.images.length === 3);
  scene.decodeImage(2);
  await eventually(() => h.state.sources[0].width === 2560);
  assert.equal(h.manager.info(h.source.id)!.previewAt, secondAt + 2);
  assert.equal(h.manager.info(h.source.id)!.blocked, true);
  assert.equal(h.state.sources[0].analysisEnabled, false);
  assert.equal(h.state.sources[0].motionEnabled, false);
  assert.equal(
    scene.images.length,
    3,
    "the intermediate pending packet was never decoded",
  );
  h.manager.reviewMasks(h.source.id);
  assert.equal(h.manager.info(h.source.id)!.blocked, false);
});

test("a desktop dimension change while motion submission is pending cannot send new pixels with old mask authority", async (t) => {
  browser(t, async () => {
    throw new Error("Unexpected camera request");
  });
  const h = harness(true, "monitor");
  t.after(() => h.manager.dispose());
  h.source.width = 3840;
  h.source.height = 2160;
  h.source.masks = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }];
  const pendingMotion = deferred<void>();
  const invoke = h.bridge.invoke;
  h.bridge.invoke = async <T>(command: Command): Promise<T> => {
    const result = await invoke<T>(command);
    if (command.type === "source.motion") await pendingMotion.promise;
    return result;
  };
  const start = h.manager.start(h.source);
  await eventually(() =>
    h.commands.some((command) => command.type === "source.motion"),
  );
  const captureId = h.starts[0].captureId;
  const changedAt = Date.now();
  h.emitFrame(captureId, {
    sequence: 2,
    capturedAt: changedAt,
    nativeWidth: 2560,
    nativeHeight: 1440,
  });
  await eventually(() => h.manager.info(h.source.id)!.previewAt === changedAt);
  pendingMotion.resolve();
  await start;
  assert.equal(
    h.commands.filter((command) => command.type === "source.frame").length,
    0,
    "the in-flight frame must be discarded before JPEG submission",
  );
  await eventually(() => h.manager.info(h.source.id)!.blocked);
  assert.equal(h.state.sources[0].width, 2560);
  assert.equal(h.state.sources[0].analysisEnabled, false);
  assert.equal(h.state.sources[0].motionEnabled, false);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    h.commands.filter((command) => command.type === "source.frame").length,
    0,
    "changed geometry remains blocked until masks are reviewed",
  );
  h.manager.reviewMasks(h.source.id);
  const reviewedAt = Date.now();
  h.emitFrame(captureId, {
    sequence: 3,
    capturedAt: reviewedAt,
    nativeWidth: 2560,
    nativeHeight: 1440,
  });
  await eventually(() =>
    h.commands.some((command) => command.type === "source.frame"),
  );
  const frame = h.commands.find((command) => command.type === "source.frame")!;
  assert.equal(frame.frame.capturedAt, reviewedAt);
  assert.equal(frame.frame.sourceRevision, h.state.sources[0].revision);
});

test("a camera delivery during motion submission preserves frozen pixels and their original timestamp", async (t) => {
  const current = media();
  const scene = browser(t, async () => current.stream);
  const h = harness(true);
  t.after(() => h.manager.dispose());
  const pendingMotion = deferred<void>();
  const invoke = h.bridge.invoke;
  h.bridge.invoke = async <T>(command: Command): Promise<T> => {
    const result = await invoke<T>(command);
    if (command.type === "source.motion") await pendingMotion.promise;
    return result;
  };
  const start = h.manager.start(h.source);
  await eventually(() =>
    h.commands.some((command) => command.type === "source.motion"),
  );
  const motion = h.commands.find(
    (command) => command.type === "source.motion",
  )!;
  scene.setLuminance(255);
  scene.deliver();
  const latestAt = h.manager.info(h.source.id)!.previewAt;
  pendingMotion.resolve();
  await start;
  assert.equal(
    h.commands.filter((command) => command.type === "source.frame").length,
    1,
    "the frozen frame remains eligible while the preview advances",
  );
  const frame = h.commands.find((command) => command.type === "source.frame")!;
  assert.equal(frame.frame.capturedAt, motion.capturedAt);
  assert.ok(latestAt! > frame.frame.capturedAt);
  assert.deepEqual(scene.encodedLuminance, [0]);
});
