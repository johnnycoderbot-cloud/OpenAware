import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DesktopCaptureBroker,
  validateDesktopCaptureFrame,
} from "../apps/desktop/main/desktop-capture";
import { DisplayCaptureGrant } from "../apps/desktop/main/capture-grant";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fixture = {
  // JPEG marker fixture; native workflow tests exercise real canvas encoding.
  dataUrl: "data:image/jpeg;base64,/9j/2Q==",
  width: 1280,
  height: 720,
  nativeWidth: 1920,
  nativeHeight: 1080,
  capturedAt: 10_000,
  sequence: 4,
  fps: 15,
};

test("a newly decoded preview retains its timestamp and exact native dimensions", () => {
  const frame = validateDesktopCaptureFrame(fixture, 3, 9990, 10_100);
  assert.deepEqual(frame, fixture);
  assert.equal(
    validateDesktopCaptureFrame(fixture, 4, 9990, 10_100),
    undefined,
  );
  assert.equal(
    validateDesktopCaptureFrame(fixture, 3, 10_001, 10_100),
    undefined,
  );
  assert.equal(
    validateDesktopCaptureFrame(fixture, 3, 9990, 15_001),
    undefined,
  );
  assert.equal(validateDesktopCaptureFrame(fixture, 3, 9990, 8999), undefined);
});

test("native transport preserves small renderer clock skew and rejects excessive future timestamps", () => {
  const now = 10_100;
  for (const skew of [1, 1000]) {
    const ahead = { ...fixture, capturedAt: now + skew };
    assert.deepEqual(validateDesktopCaptureFrame(ahead, 3, 9990, now), ahead);
  }
  assert.equal(
    validateDesktopCaptureFrame(
      { ...fixture, capturedAt: now + 1001 },
      3,
      9990,
      now,
    ),
    undefined,
  );
});

test("capture packets enforce native geometry, aspect ratio and preview bounds", () => {
  for (const patch of [
    { width: 1281 },
    { height: 1281 },
    { width: 0 },
    { nativeWidth: 32769 },
    { nativeHeight: -1 },
    { nativeWidth: 960 },
    { height: 721 },
    { sequence: 4.5 },
    { capturedAt: Infinity },
    { fps: 16 },
    { fps: 0 },
  ])
    assert.equal(
      validateDesktopCaptureFrame({ ...fixture, ...patch }, 3, 9990, 10_100),
      undefined,
    );
  assert.ok(
    validateDesktopCaptureFrame(
      {
        ...fixture,
        nativeWidth: 1080,
        nativeHeight: 1920,
        width: 720,
        height: 1280,
      },
      3,
      9990,
      10_100,
    ),
  );
  assert.ok(
    validateDesktopCaptureFrame(
      {
        ...fixture,
        nativeWidth: 640,
        nativeHeight: 360,
        width: 640,
        height: 360,
      },
      3,
      9990,
      10_100,
    ),
  );
});

test("capture transport accepts only a bounded JPEG payload and strips extra fields", () => {
  for (const dataUrl of [
    "data:image/png;base64,/9j/2Q==",
    "data:image/jpeg;base64,/9j/2Q==\n",
    "data:image/jpeg;base64,YWFhYQ==",
    "data:image/jpeg;base64,/9j/2Q=",
    `data:image/jpeg;base64,${"A".repeat(2_097_156)}`,
  ])
    assert.equal(
      validateDesktopCaptureFrame({ ...fixture, dataUrl }, 3, 9990, 10_100),
      undefined,
    );
  assert.deepEqual(
    validateDesktopCaptureFrame(
      {
        ...fixture,
        sourceId: "forged-owner",
        deviceId: "forged-target",
        captureId: "forged-pipeline",
        url: "https://example.com",
      },
      3,
      9990,
      10_100,
    ),
    fixture,
  );
  for (const raw of [null, [], "frame", false])
    assert.equal(validateDesktopCaptureFrame(raw, 3, 9990, 10_100), undefined);
});

function stalledOwner() {
  const capturePath = resolve("synthetic-capture", "index.html");
  const sourceId = randomUUID();
  const captureId = randomUUID();
  const errors: unknown[] = [];
  let destroyed = false;
  const broker = new DesktopCaptureBroker({
    capturePath,
    onFrame() {
      throw new Error("A stalled fixture cannot deliver a frame");
    },
    onError: (...error) => errors.push(error),
  });
  const frame = {
    url: pathToFileURL(capturePath).href,
    processId: 1,
    routingId: 1,
  };
  const entry = {
    sourceId,
    captureId,
    deviceId: "screen:synthetic",
    frame,
    grant: new DisplayCaptureGrant(true),
    controller: new AbortController(),
    stopped: false,
    lastSequence: 0,
    lastCapturedAt: 0,
    session: { clearStorageData: async () => {} },
    window: {
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
      },
      webContents: {
        mainFrame: frame,
        isDestroyed: () => destroyed,
        executeJavaScript: () => new Promise(() => {}),
      },
    },
  };
  Reflect.get(broker, "entries").set(sourceId, entry);
  return {
    broker,
    sourceId,
    captureId,
    errors,
    destroyed: () => destroyed,
    poll: () =>
      Reflect.get(broker, "poll").call(broker, entry) as Promise<void>,
  };
}

test("Stop settles an unresponsive hidden capture poll without reporting a replacement error", async () => {
  const h = stalledOwner();
  const polling = h.poll();
  h.broker.stop(h.sourceId, h.captureId);
  await Promise.race([
    polling,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error("Stopped capture poll did not settle")),
        100,
      ),
    ),
  ]);
  assert.equal(h.destroyed(), true);
  assert.deepEqual(h.errors, []);
});

test("an unresponsive hidden capture poll expires and destroys its owner", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = stalledOwner();
  t.after(() => h.broker.close());
  const polling = h.poll();
  t.mock.timers.tick(5001);
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  assert.equal(
    h.destroyed(),
    true,
    "a hung helper must not retain capture indefinitely",
  );
  assert.equal(h.errors.length, 1);
  await polling;
});
