import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parsePlan } from "../packages/core/src/index.js";
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
