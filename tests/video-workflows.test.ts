import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  temporalWindow,
  parseSemanticObservation,
  initialSemanticState,
  evaluateSemantic,
  searchCaptions,
  filteredCaptions,
  selectSummaryCaptions,
  summaryCaption,
} from "../packages/core/src/video-workflows.js";
import {
  commandSchema,
  initialSnapshot,
  type Observation,
} from "../packages/contracts/src/index.js";

const a = randomUUID(),
  b = randomUUID(),
  ruleId = randomUUID();
const receipt = (at: number, revision = 1, epoch = 1) => ({
  epoch,
  frame: {
    id: randomUUID(),
    sourceId: a,
    sourceRevision: revision,
    capturedAt: at,
  },
});
const caption = (
  summary: string,
  capturedAt: number,
  sourceIds = [a],
): Observation => ({
  id: randomUUID(),
  sourceIds,
  sourceNames: sourceIds.map(() => "Synthetic"),
  capturedAt,
  completedAt: capturedAt + 1,
  modelId: "fixture",
  provider: "ollama",
  summary,
  status: "stale",
  durationMs: 1,
});

test("temporal receipts retain three chronological frames inside four seconds and reset on revision/epoch/stall", () => {
  let window: ReturnType<typeof receipt>[] = [];
  for (const at of [1000, 2000, 3000, 4000])
    window = temporalWindow(window, receipt(at));
  assert.deepEqual(
    window.map((item) => item.frame.capturedAt),
    [2000, 3000, 4000],
  );
  window = temporalWindow(window, receipt(8000));
  assert.deepEqual(
    window.map((item) => item.frame.capturedAt),
    [4000, 8000],
  );
  window = temporalWindow(window, receipt(8001, 2));
  assert.equal(window.length, 1);
  window = temporalWindow(window, receipt(8002, 2, 2));
  assert.equal(window.length, 1);
  window = temporalWindow(window, receipt(20_000, 2, 2));
  assert.equal(window.length, 1);
  const same = window[0]!;
  assert.equal(temporalWindow(window, same).length, 1);
});

test("semantic JSON accepts only an exact complete rule identity/revision set; ambiguity is unknown", () => {
  const rules = [{ id: ruleId, revision: 2 }];
  const valid = {
    summary: "Person appeared",
    rules: [
      { ruleId, ruleRevision: 2, verdict: "match", evidence: "Visible person" },
    ],
  };
  assert.equal(
    parseSemanticObservation(JSON.stringify(valid), rules).evidence[0]!.verdict,
    "match",
  );
  for (const text of [
    "Person detected!",
    "```json\n" + JSON.stringify(valid) + "\n```",
    JSON.stringify({ ...valid, rules: [] }),
    JSON.stringify({ ...valid, tools: ["click"] }),
    JSON.stringify({ ...valid, rules: [...valid.rules, ...valid.rules] }),
    JSON.stringify({
      ...valid,
      rules: [{ ...valid.rules[0], ruleRevision: 1 }],
    }),
    JSON.stringify({ ...valid, rules: [{ ...valid.rules[0], verdict: true }] }),
    JSON.stringify({
      ...valid,
      rules: [{ ...valid.rules[0], ruleId: randomUUID() }],
    }),
  ])
    assert.equal(
      parseSemanticObservation(text, rules).evidence[0]!.verdict,
      "unknown",
    );
});

test("semantic stability needs two distinct inputs two seconds apart and cannot rearm from unknown evidence", () => {
  const state = initialSemanticState();
  const evaluate = (
    verdict: "match" | "no_match" | "unknown",
    at: number,
    input = String(at),
  ) => evaluateSemantic(state, verdict, String(at), input, at);
  assert.equal(evaluate("match", 0).status, "pending");
  assert.equal(evaluate("match", 1000).alert, false);
  assert.equal(evaluate("match", 2000).alert, true);
  assert.equal(evaluate("match", 4000).alert, false);
  assert.equal(evaluate("unknown", 6000).status, "unknown");
  assert.equal(state.active, true);
  assert.equal(evaluate("no_match", 8000).alert, false);
  assert.equal(evaluate("no_match", 10_000).status, "clear");
  assert.equal(
    evaluate("match", 32_000).alert,
    false,
    "fresh clear evidence must rearm after cooldown",
  );
  evaluate("no_match", 34_000);
  evaluate("no_match", 36_000);
  assert.equal(state.active, false);
  assert.equal(evaluate("match", 38_000).alert, false);
  assert.equal(evaluate("match", 40_000).alert, true);
  const duplicate = evaluate("match", 42_000, "40000");
  assert.equal(duplicate.alert, false);
});

test("a stalled or ambiguous semantic condition loses qualifying stability", () => {
  const state = initialSemanticState();
  evaluateSemantic(state, "match", "1", "frame1", 0);
  evaluateSemantic(state, "unknown", "2", "frame2", 2000);
  assert.equal(
    evaluateSemantic(state, "match", "3", "frame3", 4000).alert,
    false,
  );
  assert.equal(
    evaluateSemantic(state, "match", "4", "frame4", 30_000).alert,
    false,
  );
});

test("reusing the same visual input cannot satisfy semantic stability across different observation IDs", () => {
  const state = initialSemanticState();
  evaluateSemantic(state, "match", "first", "same-frame", 0);
  assert.equal(
    evaluateSemantic(state, "match", "second", "same-frame", 2000).alert,
    false,
  );
  assert.equal(
    evaluateSemantic(state, "match", "third", "new-frame", 4000).alert,
    true,
  );
});

test("historical summary selection fits actual serialized text including escapes and keeps newest complete captions", () => {
  const observations = Array.from({ length: 30 }, (_, index) =>
    caption(`caption ${index} ` + '"'.repeat(1980), index + 1),
  );
  const selected = selectSummaryCaptions(observations);
  assert.ok(selected.length > 0 && selected.length < 25);
  assert.ok(JSON.stringify(selected.map(summaryCaption)).length <= 32_000);
  assert.deepEqual(selected, observations.slice(-selected.length));
  assert.ok(
    JSON.stringify(observations.slice(-selected.length - 1).map(summaryCaption))
      .length > 32_000,
  );
  assert.deepEqual(selectSummaryCaptions([]), []);
  assert.equal(observations.length, 30);
});

test("caption search deterministically ranks bounded text and applies complete-source and overlapping interval scope", () => {
  const older = caption("door opened", 200),
    latest = caption("door opened", 400),
    partial = caption("the door is closed", 500),
    combined = caption("door opened", 600, [a, b]);
  older.captureStartAt = 100;
  const observations = [older, latest, partial, combined];
  const found = searchCaptions(observations, "door opened", {
    sourceIds: [a],
    limit: 2,
  });
  assert.deepEqual(
    found.matches.map((item) => item.observation.id),
    [latest.id, older.id],
  );
  assert.deepEqual(
    filteredCaptions(observations, { from: 150, to: 175 }).map(
      (item) => item.id,
    ),
    [older.id],
  );
  assert.equal(searchCaptions(observations, "   ").matches.length, 0);
  const many = Array.from({ length: 70 }, (_, index) =>
    caption("door opened", index),
  );
  assert.equal(searchCaptions(many, "door").matches.length, 50);
  found.matches[0]!.observation.summary = "mutated";
  assert.equal(latest.summary, "door opened");
});

test("workflow commands enforce bounded fields, unique source scopes and ordered timestamps", () => {
  assert.equal(initialSnapshot().pipeline.temporalEnabled, true);
  assert.equal(
    commandSchema.safeParse({
      type: "rule.add",
      name: "Entry",
      condition: "A person appears",
      sourceIds: [a],
    }).success,
    true,
  );
  for (const command of [
    {
      type: "rule.add",
      name: "Entry",
      condition: "x".repeat(513),
      sourceIds: [a],
    },
    { type: "rule.add", name: "Entry", condition: "Person", sourceIds: [a, a] },
    { type: "rule.update", ruleId, patch: {} },
    { type: "history.search", query: "door", from: 2, to: 1 },
    { type: "history.search", query: "door", limit: 51 },
    { type: "history.summarize", question: "x".repeat(501) },
    { type: "pipeline.configure", temporalEnabled: true, execute: "click" },
  ])
    assert.equal(commandSchema.safeParse(command).success, false);
});
