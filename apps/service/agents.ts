import { randomUUID } from "node:crypto";
import {
  commandSchema,
  DEFAULT_AGENT_ID,
  MAX_AGENTS,
  MAX_AGENT_SOURCES,
  MAX_SOURCES,
} from "../../packages/contracts/src/index.js";
import type {
  AgentRole,
  AgentSnapshot,
  Command,
  Snapshot,
  Source,
} from "../../packages/contracts/src/index.js";
import { createService } from "./engine.js";
import type { Service, ServiceOptions } from "./engine.js";

interface AgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  revision: number;
  sourceIds: string[];
  autoAssign: boolean;
  engine: Service;
}
export interface AgentService {
  command(command: Command): Promise<unknown>;
  snapshot(): Snapshot;
  tick(): void;
  dispose(): void;
}

/** Shared source catalog, independent bounded local inference engines. */
export function createAgentService(options: ServiceOptions = {}): AgentService {
  const agents = new Map<string, AgentRecord>();
  let activeAgentId = DEFAULT_AGENT_ID;
  let disposed = false;
  let batching = 0;
  const catalog = createService({
    ...options,
    agent: undefined,
    maxSources: MAX_SOURCES,
    retainFrames: false,
    onState: () => emit(),
  });

  function resolveAgent(id = activeAgentId): AgentRecord {
    const agent = agents.get(id);
    if (!agent) throw new Error("Unknown agent");
    return agent;
  }
  function view(agent: AgentRecord): AgentSnapshot {
    const {
      version: _version,
      sources: _sources,
      agents: _agents,
      activeAgentId: _active,
      ...engine
    } = agent.engine.snapshot();
    return {
      ...engine,
      id: agent.id,
      name: agent.name,
      role: agent.role,
      revision: agent.revision,
      sourceIds: [...agent.sourceIds],
    };
  }
  function snapshot(): Snapshot {
    const library = catalog.snapshot();
    const active = view(resolveAgent());
    const {
      id: _id,
      name: _name,
      role: _role,
      revision: _revision,
      sourceIds: _sourceIds,
      ...aliases
    } = active;
    return {
      ...aliases,
      version: library.version,
      sources: library.sources,
      agents: [...agents.values()].map(view),
      activeAgentId,
    };
  }
  function emit() {
    if (!disposed && !batching && agents.size) options.onState?.(snapshot());
  }
  function assignedSources(
    agent: AgentRecord,
    sources = catalog.snapshot().sources,
  ): Source[] {
    return agent.sourceIds.map((id) => {
      const source = sources.find((item) => item.id === id);
      if (!source) throw new Error("Assigned source is unavailable");
      return source;
    });
  }
  function addAgent(
    id: string,
    name: string,
    role: AgentRole,
    autoAssign = false,
  ) {
    const metadata = {
      id,
      name,
      role,
      revision: 1,
      sourceIds: [] as string[],
      autoAssign,
    };
    const record: AgentRecord = {
      ...metadata,
      engine: createService({
        ...options,
        maxSources: MAX_AGENT_SOURCES,
        agent: { id, revision: () => record.revision },
        onState: () => emit(),
      }),
    };
    agents.set(id, record);
    return record;
  }
  addAgent(DEFAULT_AGENT_ID, "Agent 1", "operator", true);

  function requireScope(agent: AgentRecord, ids: string[]) {
    if (ids.some((id) => !agent.sourceIds.includes(id)))
      throw new Error("Source is not assigned to this agent");
  }
  function isSnapshot(value: unknown): value is Snapshot {
    return (
      !!value &&
      typeof value === "object" &&
      "binding" in value &&
      "sources" in value
    );
  }
  async function command(input: Command): Promise<unknown> {
    if (disposed) throw new Error("Service is disposed");
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid command");
    const command = parsed.data;
    switch (command.type) {
      case "state.get":
        return snapshot();
      case "agent.add": {
        if (agents.size >= MAX_AGENTS) throw new Error("Maximum four agents");
        const agent = addAgent(randomUUID(), command.name, command.role);
        emit();
        return view(agent);
      }
      case "agent.select": {
        const next = resolveAgent(command.agentId);
        if (next.id !== activeAgentId) {
          // Switching the visible operator revokes every proposal, including in-flight work.
          batching++;
          try {
            // Publish the identity before yielding, so a concurrent command cannot obtain
            // a new old-seat proposal between cancellation and selection.
            activeAgentId = next.id;
            await Promise.all(
              [...agents.values()].map((agent) =>
                agent.engine.command({ type: "automation.cancel" }),
              ),
            );
          } finally {
            batching--;
          }
        }
        emit();
        return snapshot();
      }
      case "agent.update": {
        const agent = resolveAgent(command.agentId);
        const sources = catalog.snapshot().sources;
        if (
          command.patch.sourceIds?.some(
            (id) => !sources.some((source) => source.id === id),
          )
        )
          throw new Error("Unknown source assignment");
        const changed = Object.entries(command.patch).some(
          ([key, value]) =>
            JSON.stringify(agent[key as "name" | "role" | "sourceIds"]) !==
            JSON.stringify(value),
        );
        if (command.patch.sourceIds !== undefined) agent.autoAssign = false;
        if (changed) {
          batching++;
          try {
            agent.revision++;
            agent.engine.invalidateContext("Agent configuration changed");
            Object.assign(agent, command.patch);
            agent.engine.synchronizeSources(assignedSources(agent, sources));
          } finally {
            batching--;
          }
        }
        emit();
        return snapshot();
      }
      case "agent.remove": {
        const agent = resolveAgent(command.agentId);
        if (agents.size === 1)
          throw new Error("At least one agent is required");
        batching++;
        try {
          agent.revision++;
          agent.engine.dispose();
          agents.delete(agent.id);
          if (activeAgentId === agent.id)
            activeAgentId = agents.keys().next().value!;
          for (const remaining of agents.values())
            await remaining.engine.command({ type: "automation.cancel" });
        } finally {
          batching--;
        }
        emit();
        return snapshot();
      }
      case "source.add": {
        batching++;
        try {
          await catalog.command(command);
          const agent = agents.get(DEFAULT_AGENT_ID);
          if (agent?.autoAssign && agent.sourceIds.length < MAX_AGENT_SOURCES) {
            agent.revision++;
            agent.engine.invalidateContext("Source assignment changed");
            agent.sourceIds.push(command.source.id);
            agent.engine.synchronizeSources(assignedSources(agent));
          }
        } finally {
          batching--;
        }
        emit();
        return snapshot();
      }
      case "source.update":
      case "source.remove": {
        batching++;
        try {
          await catalog.command(command);
          const sources = catalog.snapshot().sources;
          for (const agent of agents.values()) {
            if (!agent.sourceIds.includes(command.sourceId)) continue;
            if (command.type === "source.remove") {
              agent.revision++;
              agent.engine.invalidateContext("Assigned source was removed");
              agent.sourceIds = agent.sourceIds.filter(
                (id) => id !== command.sourceId,
              );
            }
            agent.engine.synchronizeSources(assignedSources(agent, sources));
          }
        } finally {
          batching--;
        }
        emit();
        return snapshot();
      }
      case "source.frame":
      case "source.motion": {
        // Validate global capture order/revision before any inference engine sees pixels.
        await catalog.command(command);
        const sourceId =
          command.type === "source.frame"
            ? command.frame.sourceId
            : command.sourceId;
        const assigned = [...agents.values()].filter((agent) =>
          agent.sourceIds.includes(sourceId),
        );
        const outcomes = await Promise.allSettled(
          assigned.map((agent) => agent.engine.command(command)),
        );
        // One agent's bounded buffer pressure cannot prevent another agent from receiving the frame.
        const failed = outcomes.filter(
          (outcome) => outcome.status === "rejected",
        ).length;
        return {
          accepted: true,
          agentsAccepted: assigned.length - failed,
          agentsRejected: failed,
        };
      }
      case "session.stop": {
        batching++;
        try {
          await catalog.command(command);
          await Promise.all(
            [...agents.values()].map((agent) => agent.engine.command(command)),
          );
          const sources = catalog.snapshot().sources;
          for (const agent of agents.values())
            agent.engine.synchronizeSources(assignedSources(agent, sources));
        } finally {
          batching--;
        }
        emit();
        return snapshot();
      }
      default: {
        // Resolve once before the first await: a later UI selection cannot retarget this request.
        const agent = resolveAgent(
          "agentId" in command ? command.agentId : undefined,
        );
        if (
          command.type === "automation.plan" &&
          (agent.role !== "operator" || agent.id !== activeAgentId)
        )
          throw new Error(
            "Only the active operator agent can propose computer actions",
          );
        if ("sourceIds" in command && command.sourceIds)
          requireScope(agent, command.sourceIds);
        if ("sourceId" in command) requireScope(agent, [command.sourceId]);
        if (command.type === "rule.update" && command.patch.sourceIds)
          requireScope(agent, command.patch.sourceIds);
        const result = await agent.engine.command(command);
        if (disposed || !agents.has(agent.id))
          throw new Error("Agent was removed");
        return isSnapshot(result) ? snapshot() : result;
      }
    }
  }
  return {
    command,
    snapshot,
    tick() {
      catalog.tick();
      for (const agent of agents.values()) agent.engine.tick();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      catalog.dispose();
      for (const agent of agents.values()) agent.engine.dispose();
      agents.clear();
    },
  };
}
