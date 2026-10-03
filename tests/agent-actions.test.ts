import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  initialSnapshot,
  type AutomationPlan,
  type Snapshot,
} from "../packages/contracts/src/index";
import { assertAgentPlanAuthority } from "../apps/desktop/main/agent-action-authority";

function fixture(): { state: Snapshot; plan: AutomationPlan } {
  const state = initialSnapshot();
  const { version, sources, agents, activeAgentId, ...engine } = state;
  const agentId = randomUUID();
  const plan: AutomationPlan = {
    id: randomUUID(),
    agentId,
    agentRevision: 1,
    sourceId: randomUUID(),
    sourceRevision: 1,
    capturedAt: Date.now() - 100,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30_000,
    goal: "Synthetic authority test",
    modelId: "fixture-vision",
    steps: [
      {
        type: "key",
        key: "ENTER",
        description: "Synthetic step; no native input",
      },
    ],
  };
  const binding = {
    ...engine.binding,
    modelId: plan.modelId,
    status: "verified" as const,
  };
  state.binding = binding;
  state.pendingPlan = plan;
  state.activeAgentId = agentId;
  state.agents = [
    {
      ...engine,
      id: agentId,
      name: "Fixture operator",
      role: "operator",
      revision: 1,
      sourceIds: [plan.sourceId],
      binding,
      pendingPlan: plan,
    },
  ];
  return { state, plan };
}

test("only the active operator's exact assigned plan passes native authority", () => {
  const { state, plan } = fixture();
  assert.doesNotThrow(() => assertAgentPlanAuthority(state, plan));
});

const changes: Record<string, (state: Snapshot) => void> = {
  "different selected agent": (state) => {
    state.activeAgentId = randomUUID();
  },
  "observer role": (state) => {
    state.agents[0].role = "observer";
  },
  "new assignment revision": (state) => {
    state.agents[0].revision++;
  },
  "unassigned source": (state) => {
    state.agents[0].sourceIds = [];
  },
  "stopped agent": (state) => {
    state.agents[0].session = "stopped";
  },
  "unverified own binding": (state) => {
    state.agents[0].binding.status = "selected";
  },
  "different own model": (state) => {
    state.agents[0].binding.modelId = "other-model";
  },
  "missing own plan": (state) => {
    state.agents[0].pendingPlan = undefined;
  },
  "missing active alias plan": (state) => {
    state.pendingPlan = undefined;
  },
  "different own plan": (state) => {
    state.agents[0].pendingPlan = { ...state.pendingPlan!, id: randomUUID() };
  },
  "removed agent": (state) => {
    state.agents = [];
  },
};
for (const [name, change] of Object.entries(changes)) {
  test(`native authority rejects ${name}`, () => {
    const { state, plan } = fixture();
    change(state);
    assert.throws(
      () => assertAgentPlanAuthority(state, plan),
      /authority changed/,
    );
  });
}
test("a legacy unstamped plan is rejected by the production agent authority boundary", () => {
  const { state, plan } = fixture();
  assert.throws(
    () =>
      assertAgentPlanAuthority(state, {
        ...plan,
        agentId: undefined,
        agentRevision: undefined,
      }),
    /authority changed/,
  );
});
