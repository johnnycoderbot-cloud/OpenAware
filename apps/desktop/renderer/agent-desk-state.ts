import type { Snapshot } from "@openaware/contracts";
import type { AgentDeskSeat, AgentDeskState } from "./AgentDesk";

/** Each seat derives readiness and scope from its own independently bound agent. */
export function buildAgentDeskSeats(
  snapshot: Snapshot,
  desktopAvailable: boolean,
): AgentDeskSeat[] {
  return snapshot.agents.map((agent) => {
    const connected = desktopAvailable && agent.binding.status === "verified";
    const disconnectedState: AgentDeskState = !desktopAvailable
      ? "disconnected"
      : agent.binding.status === "probing"
        ? "probing"
        : agent.binding.status === "selected"
          ? "selected"
          : agent.binding.status === "failed"
            ? "failed"
            : "unconfigured";
    const enabledSources = snapshot.sources.filter(
      (source) => agent.sourceIds.includes(source.id) && source.analysisEnabled,
    );
    const observing =
      agent.session === "monitoring" &&
      enabledSources.some((source) => source.status === "live");
    return {
      id: agent.id,
      label: agent.name,
      roleLabel: agent.role === "operator" ? "Operator" : "Observer",
      selected: agent.id === snapshot.activeAgentId,
      connected,
      state: !connected
        ? disconnectedState
        : agent.lastError
          ? "error"
          : observing
            ? "watching"
            : agent.session === "paused"
              ? "paused"
              : "ready",
      modelName: connected
        ? agent.models.find((model) => model.id === agent.binding.modelId)
            ?.name || agent.binding.modelId
        : undefined,
      assignments: snapshot.sources
        .filter((source) => agent.sourceIds.includes(source.id))
        .map((source) => source.name),
      assignmentCount: agent.sourceIds.length,
      monitoring: agent.session === "monitoring",
      canStart:
        snapshot.sources.some(
          (source) =>
            agent.sourceIds.includes(source.id) &&
            source.status === "live" &&
            (source.analysisEnabled || source.motionEnabled),
        ) &&
        (!enabledSources.some((source) => source.status === "live") ||
          connected),
      detail:
        agent.lastError ||
        (connected
          ? `${agent.role === "operator" ? "Operator" : "Observer"} · ${agent.sourceIds.length}/4 feeds`
          : agent.binding.error || "Connect and verify a vision model"),
      actionLabel: "Configure model",
      disabled: !desktopAvailable,
    };
  });
}
