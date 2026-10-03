import { planDigest } from "../../../packages/actions/src/index";
import type {
  AutomationPlan,
  Snapshot,
} from "../../../packages/contracts/src/index";

/** Native authority belongs to one currently selected operator and assignment revision. */
export function assertAgentPlanAuthority(
  state: Snapshot,
  plan: AutomationPlan,
): void {
  const agent = state.agents.find((item) => item.id === plan.agentId);
  if (
    !agent ||
    state.activeAgentId !== agent.id ||
    agent.role !== "operator" ||
    agent.revision !== plan.agentRevision ||
    !agent.sourceIds.includes(plan.sourceId) ||
    agent.session === "stopped" ||
    agent.binding.status !== "verified" ||
    agent.binding.modelId !== plan.modelId ||
    !agent.pendingPlan ||
    !state.pendingPlan ||
    planDigest(agent.pendingPlan) !== planDigest(plan) ||
    planDigest(state.pendingPlan) !== planDigest(plan)
  )
    throw new Error("Operator identity, assignment or plan authority changed");
}
