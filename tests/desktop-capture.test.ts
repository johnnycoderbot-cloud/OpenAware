import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDesktopCaptureFrame } from "../apps/desktop/main/desktop-capture";

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
  assert.equal(validateDesktopCaptureFrame(fixture, 3, 9990, 9999), undefined);
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
