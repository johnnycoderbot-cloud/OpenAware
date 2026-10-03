import type { Snapshot } from "@openaware/contracts";
import type { AgentDeskSeat, AgentDeskState } from "./AgentDesk";

/** Seats represent the two existing roles sharing the explicit model binding. */
export function buildAgentDeskSeats(
  snapshot: Snapshot,
  desktopAvailable: boolean,
  split: boolean,
): AgentDeskSeat[] {
  const connected = desktopAvailable && snapshot.binding.status === "verified";
  const disconnectedState: AgentDeskState = !desktopAvailable
    ? "disconnected"
    : snapshot.binding.status === "probing"
      ? "probing"
      : snapshot.binding.status === "selected"
        ? "selected"
        : snapshot.binding.status === "failed"
          ? "failed"
          : "unconfigured";
  const enabledSources = snapshot.sources.filter(
    (source) => source.analysisEnabled,
  );
  const observing =
    snapshot.session === "monitoring" &&
    enabledSources.some((source) => source.status === "live");
  const observer: AgentDeskSeat = {
    id: "observer",
    label: "Observer",
    connected,
    state: !connected
      ? disconnectedState
      : observing
        ? "watching"
        : snapshot.session === "paused"
          ? "paused"
          : "ready",
    modelName: connected ? snapshot.binding.modelId : undefined,
    assignments: enabledSources.map((source) => source.name),
    detail: connected
      ? split
        ? "Shared model · Monitoring"
        : "Monitoring"
      : snapshot.binding.error || "Connect and verify a vision model",
    actionLabel: "Configure model",
    disabled: !desktopAvailable,
  };
  if (!split) return [observer];
  const target = snapshot.sources.find(
    (source) => source.id === snapshot.pendingPlan?.sourceId,
  );
  return [
    observer,
    {
      id: "operator",
      label: "Operator",
      connected,
      state: connected ? "ready" : disconnectedState,
      modelName: connected ? snapshot.binding.modelId : undefined,
      assignments: target ? [target.name] : [],
      detail: connected
        ? "Shared model · You approve each action"
        : "Connect and verify a vision model",
      actionLabel: connected ? "Open Operator" : "Configure model",
      disabled: !desktopAvailable,
    },
  ];
}
