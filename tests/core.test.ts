import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parsePlan, validateImage } from "../packages/core/src/index.js";
import type { Frame } from "../packages/contracts/src/index.js";
import { parseUnambiguousJson } from "../packages/core/src/json.js";
import { automationPlanSchema } from "../packages/actions/src/index.js";

const proposal = (text: string) =>
  JSON.stringify({
    steps: [
      { type: "type", text, description: "Type the exact provided text" },
    ],
  });
function executable(steps: ReturnType<typeof parsePlan>) {
  return automationPlanSchema.safeParse({
    id: randomUUID(),
    sourceId: randomUUID(),
    sourceRevision: 1,
    capturedAt: 1000,
    createdAt: 1100,
    expiresAt: 31_100,
    goal: "Write a note",
    modelId: "local-vision",
    steps,
  });
}

test("operator parser accepts exactly 1000 characters and produces native-reviewable steps", () => {
  const steps = parsePlan(proposal("x".repeat(1000)));
  assert.equal(steps[0].text?.length, 1000);
  assert.equal(executable(steps).success, true);
  assert.throws(() => parsePlan(proposal("x".repeat(1001))));
});

test("operator parser and native broker reject C0, DEL and C1 controls including TAB and newline", () => {
  for (const code of [
    ...Array.from({ length: 32 }, (_, index) => index),
    ...Array.from({ length: 33 }, (_, index) => index + 127),
  ]) {
    assert.throws(
      () => parsePlan(proposal(`before${String.fromCharCode(code)}after`)),
      `Control character ${code} must not reach a native review`,
    );
    assert.equal(
      executable([
        {
          type: "type",
          text: `before${String.fromCharCode(code)}after`,
          description: "Invalid control",
        },
      ]).success,
      false,
    );
  }
});

test("an explicit ENTER key step remains available for a reviewed line break", () => {
  const steps = parsePlan(
    JSON.stringify({
      steps: [
        { type: "type", text: "First line", description: "Type first line" },
        { type: "key", key: "ENTER", description: "Insert a line break" },
        { type: "type", text: "Second line", description: "Type second line" },
      ],
    }),
  );
  assert.equal(steps[1].key, "ENTER");
  assert.equal(executable(steps).success, true);
});

test("printable Unicode text remains exact through proposal parsing", () => {
  const text = "Café — שלום — 日本語 — 🛰️";
  const steps = parsePlan(proposal(text));
  assert.equal(steps[0].text, text);
  assert.equal(executable(steps).success, true);
});

test("strict model JSON rejects duplicate keys at every object depth, including Unicode-escaped equivalents", () => {
  for (const text of [
    '{"steps":[],"steps":[]}',
    '{"steps":[{"type":"key","type":"key","key":"TAB","description":"Move"}]}',
    '{"steps":[{"type":"key","key":"TAB","k\\u0065y":"ENTER","description":"Move"}]}',
  ])
    assert.throws(() => parsePlan(text));
  assert.deepEqual(
    parseUnambiguousJson(
      '{"outer":[{"key":"value with \\\" , } :"},{"key":"second object"}],"empty":{}}',
    ),
    {
      outer: [{ key: 'value with " , } :' }, { key: "second object" }],
      empty: {},
    },
  );
  assert.deepEqual(
    parseUnambiguousJson(
      '{"0":0,"bool":true,"null":null,"array":[0,false,null,"key",{"same":1}],"object":{"same":2}}',
    ),
    {
      "0": 0,
      bool: true,
      null: null,
      array: [0, false, null, "key", { same: 1 }],
      object: { same: 2 },
    },
  );
});

const imageFrame = (bytes: Buffer, type: "png" | "jpeg" = "png"): Frame => ({
  id: randomUUID(),
  sourceId: randomUUID(),
  sourceRevision: 1,
  capturedAt: 1000,
  width: 1,
  height: 1,
  dataUrl: `data:image/${type};base64,${bytes.toString("base64")}`,
});
const smallPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN/8AAAAASUVORK5CYII=",
  "base64",
);

test("PNG admission rejects header-only, truncated chunk, missing end and invalid header structures", () => {
  const wrongLength = Buffer.from(smallPng),
    wrongCompression = Buffer.from(smallPng);
  wrongLength.writeUInt32BE(12, 8);
  wrongCompression[26] = 1;
  for (const bytes of [
    smallPng.subarray(0, 33),
    smallPng.subarray(0, -12),
    smallPng.subarray(0, -1),
    wrongLength,
    wrongCompression,
  ])
    assert.throws(() => validateImage(imageFrame(bytes)), /PNG/);
  assert.doesNotThrow(() => validateImage(imageFrame(smallPng)));
});

test("JPEG admission rejects zero-component headers and image headers without a scan", () => {
  const zeroComponents = Buffer.from("ffd8ffc00008080001000100ffd9", "hex");
  const sof = Buffer.from("ffc0000b080001000101011100", "hex");
  const headerOnly = Buffer.concat([
    Buffer.from("ffd8", "hex"),
    sof,
    Buffer.from("ffd9", "hex"),
  ]);
  const emptyScan = Buffer.concat([
    Buffer.from("ffd8", "hex"),
    sof,
    Buffer.from("ffda0008010100003f00ffd9", "hex"),
  ]);
  for (const bytes of [zeroComponents, headerOnly, emptyScan])
    assert.throws(() => validateImage(imageFrame(bytes, "jpeg")), /JPEG/);
  // A generated one-pixel grayscale baseline marker stream with one entropy byte.
  const valid = Buffer.concat([
    Buffer.from("ffd8ffdb004300", "hex"),
    Buffer.alloc(64, 1),
    sof,
    Buffer.from("ffc400140001", "hex"),
    Buffer.alloc(15),
    Buffer.from([0]),
    Buffer.from("ffc400141001", "hex"),
    Buffer.alloc(15),
    Buffer.from([0]),
    Buffer.from("ffda0008010100003f003fffd9", "hex"),
  ]);
  assert.doesNotThrow(() => validateImage(imageFrame(valid, "jpeg")));
});

test("JPEG admission rejects repeated SOF markers instead of replacing bounded geometry", () => {
  const small = Buffer.from("ffc0000b080001000101011100", "hex");
  const oversized = Buffer.from(small);
  oversized.writeUInt16BE(65535, 5);
  oversized.writeUInt16BE(65535, 7);
  const earlyScan = Buffer.from("ffda0008010100003f003f", "hex");
  for (const headers of [
    [oversized, small],
    [small, small],
    [small, oversized],
    [oversized],
    [small, earlyScan, oversized],
    [small, earlyScan, small],
  ]) {
    const bytes = Buffer.concat([
      Buffer.from("ffd8", "hex"),
      ...headers,
      Buffer.from("ffda0008010100003f003fffd9", "hex"),
    ]);
    assert.throws(
      () => validateImage(imageFrame(bytes, "jpeg")),
      /JPEG|dimensions/,
    );
  }
});
