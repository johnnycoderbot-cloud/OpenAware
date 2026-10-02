import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CaptureManager } from "../apps/desktop/renderer/capture";
import {
  initialSnapshot,
  type Command,
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
function browser(t: TestContext, getUserMedia: () => Promise<MediaStream>) {
  let luminance = 0;
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
      if (tag === "canvas")
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {},
            fillRect: () => {},
            getImageData: (
              _x: number,
              _y: number,
              width: number,
              height: number,
            ) => {
              const data = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = luminance;
                data[i + 1] = luminance;
                data[i + 2] = luminance;
                data[i + 3] = 255;
              }
              return { data };
            },
          }),
          // The bridge fixture does not decode image content; transport is asserted separately in providers/UI tests.
          toDataURL: () => "data:image/jpeg;base64,/9j/2Q==",
        };
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
  t.after(() => {
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalNavigator)
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  return {
    setLuminance: (value: number) => {
      luminance = value;
    },
    deliver,
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

function harness(motionEnabled = false) {
  const state = initialSnapshot();
  const source: Source = {
    id: randomUUID(),
    name: "Selected camera fixture",
    kind: "camera",
    deviceId: "explicit-camera-id",
    revision: 1,
    status: "stopped",
    analysisEnabled: true,
    motionEnabled,
    masks: [],
  };
  state.sources = [source];
  const commands: Command[] = [];
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
    executePlan: async () => [],
    stopAll: async () => {},
  };
  const manager = new CaptureManager(
    bridge,
    (id) => state.sources.find((item) => item.id === id),
    () => {},
    (message) => {
      throw new Error(message);
    },
  );
  return { state, source, commands, manager };
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
