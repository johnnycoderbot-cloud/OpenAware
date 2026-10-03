import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import packageMetadata from "../package.json" with { type: "json" };
import {
  commandSchema,
  initialSnapshot,
} from "../packages/contracts/src/index";

test("service snapshots report the application package version", () => {
  assert.equal(initialSnapshot().version, packageMetadata.version);
});

test("privileged bridge refuses unknown operations and additional raw command fields", () => {
  assert.equal(
    commandSchema.safeParse({ type: "shell.exec", command: "anything" })
      .success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({ type: "session.stop", script: "anything" })
      .success,
    false,
  );
  assert.equal(commandSchema.safeParse({ type: "session.stop" }).success, true);
});
test("source scope excludes duplicates, missing identifiers, and batches above four", () => {
  const sourceId = randomUUID();
  const ask = { type: "conversation.ask", text: "Describe these sources" };
  assert.equal(
    commandSchema.safeParse({ ...ask, sourceIds: [sourceId, sourceId] })
      .success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({ ...ask, sourceIds: [] }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      ...ask,
      sourceIds: Array.from({ length: 5 }, () => randomUUID()),
    }).success,
    false,
  );
});
test("mask geometry cannot expose pixels through coordinates outside the selected source", () => {
  const base = { type: "source.update", sourceId: randomUUID() };
  assert.equal(
    commandSchema.safeParse({
      ...base,
      patch: { masks: [{ x: 0.8, y: 0, width: 0.3, height: 0.1 }] },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      ...base,
      patch: { masks: [{ x: 0, y: 0, width: 1, height: 1 }] },
    }).success,
    true,
  );
});
test("frame transport accepts embedded bounded images but refuses remote image references", () => {
  const frame = {
    id: randomUUID(),
    sourceId: randomUUID(),
    sourceRevision: 1,
    capturedAt: Date.now(),
    width: 1,
    height: 1,
    dataUrl: "https://example.com/private.png",
  };
  assert.equal(
    commandSchema.safeParse({ type: "source.frame", frame }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "source.frame",
      frame: { ...frame, dataUrl: "data:image/png;base64,aGVsbG8=" },
    }).success,
    true,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "source.frame",
      frame: {
        ...frame,
        width: 2048,
        dataUrl: "data:image/png;base64,aGVsbG8=",
      },
    }).success,
    false,
  );
});
test("startup snapshot has no capture, inference, content history, or provider credential", () => {
  const state = initialSnapshot();
  assert.equal(state.session, "idle");
  assert.equal(state.binding.status, "unconfigured");
  assert.deepEqual(state.sources, []);
  assert.deepEqual(state.chat, []);
  assert.equal("token" in state.binding, false);
});

test("numeric transport fields refuse nonfinite, unsafe integer and string coercion edges", () => {
  const sourceId = randomUUID();
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    "1",
    null,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.equal(
      commandSchema.safeParse({
        type: "source.motion",
        sourceId,
        sourceRevision: value,
        capturedAt: Date.now(),
        value: 0.5,
      }).success,
      false,
    );
  for (const value of [NaN, Infinity, -Infinity, "1", null, -0.1, 1.1])
    assert.equal(
      commandSchema.safeParse({
        type: "source.motion",
        sourceId,
        sourceRevision: 1,
        capturedAt: Date.now(),
        value,
      }).success,
      false,
    );
  for (const value of [NaN, Infinity, -Infinity, "1", null, -1])
    assert.equal(
      commandSchema.safeParse({
        type: "history.search",
        query: "q",
        from: value,
      }).success,
      false,
    );
});
