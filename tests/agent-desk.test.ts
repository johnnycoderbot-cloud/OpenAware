import test from "node:test";
import assert from "node:assert/strict";
import { initialSnapshot } from "../packages/contracts/src/index";
import { buildAgentDeskSeats } from "../apps/desktop/renderer/agent-desk-state";

test("selected, probing and failed model bindings leave both agent seats empty", () => {
  for (const status of [
    "unconfigured",
    "selected",
    "probing",
    "failed",
  ] as const) {
    const state = initialSnapshot();
    state.binding.status = status;
    state.binding.modelId = "Selected model";
    const seats = buildAgentDeskSeats(state, true, true);
    assert.equal(seats.length, 2);
    assert.ok(seats.every((seat) => !seat.connected && !seat.modelName));
  }
});

test("a verified binding without the desktop bridge cannot occupy a seat", () => {
  const state = initialSnapshot();
  state.binding.status = "verified";
  const [seat] = buildAgentDeskSeats(state, false, false);
  assert.equal(seat?.connected, false);
  assert.equal(seat?.state, "disconnected");
});

test("motion-only monitoring does not represent an AI agent as watching", () => {
  const state = initialSnapshot();
  state.binding.status = "verified";
  state.binding.modelId = "Verified fixture";
  state.session = "monitoring";
  state.sources.push({
    id: "fixture",
    name: "Motion camera",
    kind: "camera",
    deviceId: "fixture",
    revision: 1,
    status: "live",
    analysisEnabled: false,
    motionEnabled: true,
    masks: [],
  });
  const [seat] = buildAgentDeskSeats(state, true, false);
  assert.equal(seat?.connected, true);
  assert.equal(seat?.state, "ready");
  assert.deepEqual(seat?.assignments, []);
});

test("split roles share the actual binding while Observer follows enabled source scope", () => {
  const state = initialSnapshot();
  state.binding.status = "verified";
  state.binding.modelId = "Verified fixture";
  state.session = "monitoring";
  state.sources.push({
    id: "alpha",
    name: "Alpha",
    kind: "monitor",
    deviceId: "fixture",
    revision: 1,
    status: "live",
    analysisEnabled: true,
    motionEnabled: false,
    masks: [],
  });
  state.sources.push({
    ...state.sources[0]!,
    id: "beta",
    name: "Beta",
    analysisEnabled: false,
  });
  const seats = buildAgentDeskSeats(state, true, true);
  assert.deepEqual(
    seats.map((seat) => seat.modelName),
    ["Verified fixture", "Verified fixture"],
  );
  assert.deepEqual(seats[0]?.assignments, ["Alpha"]);
  assert.equal(seats[0]?.state, "watching");
  assert.equal(seats[1]?.state, "ready");
  assert.ok(seats.every((seat) => seat.detail?.includes("Shared model")));
  state.session = "paused";
  assert.equal(buildAgentDeskSeats(state, true, true)[0]?.state, "paused");
  state.session = "stopped";
  state.sources[0]!.status = "stopped";
  const stopped = buildAgentDeskSeats(state, true, true);
  assert.ok(stopped.every((seat) => seat.connected && seat.state === "ready"));
});
