import test from "node:test";
import assert from "node:assert/strict";
import {
  initialSnapshot,
  type AgentSnapshot,
  type Source,
} from "../packages/contracts/src/index";
import { buildAgentDeskSeats } from "../apps/desktop/renderer/agent-desk-state";

function agent(id: string, name = id): AgentSnapshot {
  const {
    agents: _agents,
    activeAgentId: _active,
    sources: _sources,
    version: _version,
    ...state
  } = initialSnapshot();
  return { ...state, id, name, role: "observer", revision: 1, sourceIds: [] };
}
function source(id: string): Source {
  return {
    id,
    name: id,
    kind: "demo",
    deviceId: "fixture",
    revision: 1,
    status: "live",
    analysisEnabled: true,
    motionEnabled: false,
    masks: [],
  };
}

test("each selected, probing or failed binding leaves its own seat empty", () => {
  const state = initialSnapshot();
  state.agents = ["unconfigured", "selected", "probing", "failed"].map(
    (status, index) => {
      const seat = agent(`${index}`);
      seat.binding.status = status as AgentSnapshot["binding"]["status"];
      seat.binding.modelId = "Selected model";
      return seat;
    },
  );
  const seats = buildAgentDeskSeats(state, true);
  assert.equal(seats.length, 4);
  assert.ok(seats.every((seat) => !seat.connected && !seat.modelName));
});

test("independent seats retain their actual model, role, assignment and selected identity", () => {
  const state = initialSnapshot();
  const first = agent("first", "Chart observer");
  const second = agent("second", "Computer operator");
  first.binding.status = second.binding.status = "verified";
  first.binding.modelId = "vision-a";
  second.binding.modelId = "vision-b";
  second.role = "operator";
  first.sourceIds = ["alpha"];
  second.sourceIds = ["beta"];
  first.session = "monitoring";
  state.sources = [source("alpha"), source("beta"), source("unassigned")];
  state.agents = [first, second];
  state.activeAgentId = second.id;
  const seats = buildAgentDeskSeats(state, true);
  assert.deepEqual(
    seats.map((seat) => seat.modelName),
    ["vision-a", "vision-b"],
  );
  assert.deepEqual(
    seats.map((seat) => seat.assignments),
    [["alpha"], ["beta"]],
  );
  assert.deepEqual(
    seats.map((seat) => seat.roleLabel),
    ["Observer", "Operator"],
  );
  assert.deepEqual(
    seats.map((seat) => seat.selected),
    [false, true],
  );
  assert.deepEqual(
    seats.map((seat) => seat.state),
    ["watching", "ready"],
  );
  assert.ok(seats.every((seat) => !seat.detail?.includes("Shared model")));
  state.activeAgentId = first.id;
  assert.deepEqual(
    buildAgentDeskSeats(state, true).map((seat) => seat.modelName),
    ["vision-a", "vision-b"],
  );
});

test("a verified binding needs the bridge and a live enabled assigned source to watch", () => {
  const state = initialSnapshot();
  const first = agent("first");
  first.binding.status = "verified";
  first.sourceIds = ["alpha"];
  first.session = "monitoring";
  state.agents = [first];
  state.sources = [source("alpha"), source("unassigned")];
  assert.equal(buildAgentDeskSeats(state, false)[0]?.state, "disconnected");
  assert.equal(buildAgentDeskSeats(state, false)[0]?.connected, false);
  state.sources[0]!.analysisEnabled = false;
  state.sources[0]!.motionEnabled = true;
  const seat = buildAgentDeskSeats(state, true)[0]!;
  assert.equal(seat.state, "ready");
  assert.equal(seat.monitoring, true);
  assert.equal(seat.canStart, true);
  assert.deepEqual(seat.assignments, ["alpha"]);
  first.session = "paused";
  assert.equal(buildAgentDeskSeats(state, true)[0]?.state, "paused");
  first.sourceIds = [];
  assert.equal(buildAgentDeskSeats(state, true)[0]?.canStart, false);
});

test("unbound new seats inherit neither the active alias binding nor source scope", () => {
  const state = initialSnapshot();
  state.binding.status = "verified";
  state.binding.modelId = "Active alias";
  state.session = "monitoring";
  state.sources = [source("alpha")];
  state.agents = [agent("new")];
  const seat = buildAgentDeskSeats(state, true)[0]!;
  assert.equal(seat.connected, false);
  assert.equal(seat.state, "unconfigured");
  assert.equal(seat.modelName, undefined);
  assert.equal(seat.assignmentCount, 0);
  assert.equal(seat.canStart, false);
  assert.deepEqual(seat.assignments, []);
});

test("a verified agent error stays local and preserves its model identity and pause control", () => {
  const state = initialSnapshot();
  const first = agent("first");
  const second = agent("second");
  first.binding.status = second.binding.status = "verified";
  first.binding.modelId = "vision-a";
  first.session = "monitoring";
  first.lastError = "Fixture inference failed";
  state.lastError = first.lastError;
  state.agents = [first, second];
  const seats = buildAgentDeskSeats(state, true);
  assert.equal(seats[0]?.state, "error");
  assert.equal(seats[0]?.connected, true);
  assert.equal(seats[0]?.modelName, "vision-a");
  assert.equal(seats[0]?.monitoring, true);
  assert.equal(seats[0]?.detail, "Fixture inference failed");
  assert.equal(seats[1]?.state, "ready");
});
