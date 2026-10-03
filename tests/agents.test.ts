import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAgentService } from "../apps/service/agents.js";
import type { AgentService } from "../apps/service/agents.js";
import type { AgentSnapshot, Frame } from "../packages/contracts/src/index.js";
import {
  DEFAULT_AGENT_ID,
  MAX_SOURCES,
} from "../packages/contracts/src/index.js";
import type {
  AnalysisInput,
  VisionProvider,
  TextSummaryInput,
} from "../packages/providers/src/index.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN/8AAAAASUVORK5CYII=";
const challenge = "A red square, blue circle and OPENAWARE42.";
const settle = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
class Provider implements VisionProvider {
  requests: {
    input: AnalysisInput;
    signal: AbortSignal;
    resolve: (text: string) => void;
  }[] = [];
  summaries: {
    input: TextSummaryInput;
    signal: AbortSignal;
    resolve: (text: string) => void;
  }[] = [];
  holdProbe = false;
  outstanding = 0;
  maximum = 0;
  async discover() {
    return [
      {
        id: "vision",
        name: "Vision",
        vision: "declared" as const,
        loaded: true,
      },
      { id: "other", name: "Other", vision: "unknown" as const, loaded: true },
    ];
  }
  analyze(input: AnalysisInput, signal: AbortSignal) {
    if (input.mode === "probe" && !this.holdProbe)
      return Promise.resolve(challenge);
    this.outstanding++;
    this.maximum = Math.max(this.maximum, this.outstanding);
    return new Promise<string>((resolve) =>
      this.requests.push({ input, signal, resolve }),
    ).finally(() => {
      this.outstanding--;
    });
  }
  summarize(input: TextSummaryInput, signal: AbortSignal) {
    return new Promise<string>((resolve) =>
      this.summaries.push({ input, signal, resolve }),
    );
  }
}
function setup() {
  const providers: Provider[] = [];
  let wall = 1_000_000,
    mono = 0;
  const service = createAgentService({
    autoTick: false,
    clock: { wall: () => wall, mono: () => mono },
    providerFactory: () => {
      const provider = new Provider();
      providers.push(provider);
      return provider;
    },
  });
  return {
    service,
    providers,
    advance(ms = 1) {
      wall += ms;
      mono += ms;
    },
    image(sourceId: string = randomUUID(), sourceRevision = 1): Frame {
      return {
        id: randomUUID(),
        sourceId,
        sourceRevision,
        capturedAt: wall,
        width: 1,
        height: 1,
        dataUrl: png,
      };
    },
  };
}
async function addSource(
  service: AgentService,
  kind: "demo" | "video_file" = "demo",
) {
  const id = randomUUID();
  await service.command({
    type: "source.add",
    source: {
      id,
      name: "Synthetic",
      kind,
      deviceId: kind === "demo" ? "synthetic" : `video:${randomUUID()}`,
    },
  });
  await service.command({
    type: "source.update",
    sourceId: id,
    patch: { status: "live" },
  });
  return id;
}
async function addAgent(
  service: AgentService,
  role: "observer" | "operator" = "observer",
) {
  return (await service.command({
    type: "agent.add",
    name: "Second agent",
    role,
  })) as AgentSnapshot;
}
async function bind(
  context: ReturnType<typeof setup>,
  agentId = DEFAULT_AGENT_ID,
) {
  await context.service.command({
    type: "provider.discover",
    agentId,
    provider: "lmstudio",
    endpoint: "http://127.0.0.1:1234",
  });
  await context.service.command({
    type: "provider.select",
    agentId,
    modelId: "vision",
  });
  await context.service.command({
    type: "provider.probe",
    agentId,
    frame: context.image(),
  });
  return context.providers.at(-1)!;
}
async function frame(context: ReturnType<typeof setup>, sourceId: string) {
  context.advance();
  const source = context.service
    .snapshot()
    .sources.find((source) => source.id === sourceId)!;
  await context.service.command({
    type: "source.frame",
    frame: context.image(sourceId, source.revision),
  });
}

test("registry starts idle with one unbound operator and new seats inherit no binding", async () => {
  const context = setup();
  const { service } = context;
  try {
    assert.equal(service.snapshot().agents.length, 1);
    assert.equal(service.snapshot().agents[0].role, "operator");
    await bind(context);
    const added = await addAgent(service);
    assert.equal(added.binding.status, "unconfigured");
    assert.deepEqual(added.sourceIds, []);
    assert.deepEqual(added.chat, []);
    assert.equal(service.snapshot().binding.status, "verified");
    await service.command({ type: "agent.select", agentId: added.id });
    assert.equal(service.snapshot().binding.status, "unconfigured");
  } finally {
    service.dispose();
  }
});

test("sixteen shared sources and four agents are bounded independently of four assignments", async () => {
  const { service } = setup();
  try {
    const ids: string[] = [];
    for (let i = 0; i < MAX_SOURCES; i++) ids.push(await addSource(service));
    assert.equal(service.snapshot().sources.length, 16);
    assert.equal(service.snapshot().agents[0].sourceIds.length, 4);
    await assert.rejects(addSource(service), /Maximum 16 sources/);
    const second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: ids.slice(4, 8) },
    });
    await assert.rejects(
      service.command({
        type: "agent.update",
        agentId: second.id,
        patch: { sourceIds: ids.slice(0, 5) },
      }),
      /Invalid command/,
    );
    await assert.rejects(
      service.command({
        type: "agent.update",
        agentId: second.id,
        patch: { sourceIds: [randomUUID()] },
      }),
      /Unknown source assignment/,
    );
    await addAgent(service);
    await addAgent(service);
    await assert.rejects(addAgent(service), /Maximum four agents/);
  } finally {
    service.dispose();
  }
});

test("explicit empty assignments remain empty when more sources are added", async () => {
  const { service } = setup();
  try {
    await service.command({
      type: "agent.update",
      agentId: DEFAULT_AGENT_ID,
      patch: { sourceIds: [] },
    });
    await addSource(service);
    assert.deepEqual(service.snapshot().agents[0].sourceIds, []);
    await assert.rejects(
      service.command({ type: "monitor.start" }),
      /Start a source/,
    );
  } finally {
    service.dispose();
  }
});

test("independent physical inference is concurrent across agents and serial within one", async () => {
  const context = setup();
  const { service } = context;
  try {
    const one = await addSource(service),
      two = await addSource(service);
    await service.command({
      type: "agent.update",
      agentId: DEFAULT_AGENT_ID,
      patch: { sourceIds: [one] },
    });
    const second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [two] },
    });
    const firstProvider = await bind(context),
      secondProvider = await bind(context, second.id);
    await service.command({ type: "monitor.start", agentId: DEFAULT_AGENT_ID });
    await service.command({ type: "monitor.start", agentId: second.id });
    await frame(context, one);
    await frame(context, two);
    assert.equal(firstProvider.requests.length, 1);
    assert.equal(secondProvider.requests.length, 1);
    assert.deepEqual(
      firstProvider.requests[0].input.frames.map((frame) => frame.sourceId),
      [one],
    );
    assert.deepEqual(
      secondProvider.requests[0].input.frames.map((frame) => frame.sourceId),
      [two],
    );
    const ask = service.command({
      type: "conversation.ask",
      agentId: DEFAULT_AGENT_ID,
      sourceIds: [one],
      text: "What is visible?",
    });
    assert.equal(firstProvider.requests.length, 1);
    firstProvider.requests[0].resolve("First agent caption");
    secondProvider.requests[0].resolve("Second agent caption");
    await settle();
    assert.equal(firstProvider.requests.length, 2);
    assert.equal(firstProvider.maximum, 1);
    firstProvider.requests[1].resolve("First agent answer");
    await ask;
    await settle();
    const state = service.snapshot();
    assert.equal(state.agents[0].chat.length, 2);
    assert.equal(state.agents[1].chat.length, 0);
    assert.equal(state.agents[0].observations[0].agentId, DEFAULT_AGENT_ID);
    assert.equal(state.agents[1].observations[0].agentId, second.id);
    assert.equal(
      state.agents[1].observations[0].agentRevision,
      state.agents[1].revision,
    );
    await assert.rejects(
      service.command({
        type: "conversation.ask",
        agentId: second.id,
        sourceIds: [one],
        text: "Outside scope",
      }),
      /not assigned/,
    );
    await assert.rejects(
      service.command({
        type: "rule.add",
        agentId: second.id,
        sourceIds: [one],
        name: "Outside",
        condition: "Visible",
      }),
      /not assigned/,
    );
  } finally {
    service.dispose();
  }
});

test("pausing or changing one binding never cancels another agent", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [source] },
    });
    const one = await bind(context),
      two = await bind(context, second.id);
    await service.command({ type: "monitor.start", agentId: DEFAULT_AGENT_ID });
    await service.command({ type: "monitor.start", agentId: second.id });
    await frame(context, source);
    await service.command({ type: "monitor.pause", agentId: DEFAULT_AGENT_ID });
    assert.equal(one.requests[0].signal.aborted, true);
    assert.equal(two.requests[0].signal.aborted, false);
    assert.equal(service.snapshot().sources[0].status, "live");
    await service.command({
      type: "provider.select",
      agentId: DEFAULT_AGENT_ID,
      modelId: "other",
    });
    assert.equal(service.snapshot().agents[1].binding.status, "verified");
    one.requests[0].resolve("Discard old first caption");
    two.requests[0].resolve("Keep second caption");
    await settle();
    assert.equal(service.snapshot().agents[0].observations.length, 0);
    assert.equal(service.snapshot().agents[1].observations.length, 1);
  } finally {
    service.dispose();
  }
});

test("assignment changes invalidate in-flight work and preserve exact source revision", async () => {
  const context = setup();
  const { service } = context;
  try {
    const one = await addSource(service),
      two = await addSource(service);
    const provider = await bind(context);
    await frame(context, one);
    const ask = service.command({
      type: "conversation.ask",
      sourceIds: [one],
      text: "Old scope",
    });
    const rejected = assert.rejects(ask, /revoked|stale/);
    await service.command({
      type: "agent.update",
      agentId: DEFAULT_AGENT_ID,
      patch: { sourceIds: [two] },
    });
    assert.equal(provider.requests[0].signal.aborted, true);
    provider.requests[0].resolve("Must disappear");
    await rejected;
    await settle();
    assert.equal(service.snapshot().observations.length, 0);
    await service.command({
      type: "source.update",
      sourceId: two,
      patch: { name: "Renamed synthetic" },
    });
    await frame(context, two);
    const current = service.command({
      type: "conversation.ask",
      sourceIds: [two],
      text: "New scope",
    });
    assert.equal(
      provider.requests[1].input.frames[0].sourceRevision,
      service.snapshot().sources.find((source) => source.id === two)!.revision,
    );
    provider.requests[1].resolve("Correct new scope");
    await current;
  } finally {
    service.dispose();
  }
});

test("removal and global Stop revoke every child and discard late results", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [source] },
    });
    const one = await bind(context),
      two = await bind(context, second.id);
    await service.command({ type: "monitor.start", agentId: DEFAULT_AGENT_ID });
    await service.command({ type: "monitor.start", agentId: second.id });
    await frame(context, source);
    await service.command({ type: "agent.remove", agentId: second.id });
    assert.equal(two.requests[0].signal.aborted, true);
    assert.equal(one.requests[0].signal.aborted, false);
    await service.command({ type: "session.stop" });
    assert.equal(one.requests[0].signal.aborted, true);
    assert.equal(service.snapshot().sources[0].status, "stopped");
    assert.equal(service.snapshot().agents[0].session, "stopped");
    one.requests[0].resolve("Stopped result");
    two.requests[0].resolve("Removed result");
    await settle();
    assert.equal(service.snapshot().observations.length, 0);
    assert.equal(service.snapshot().agents.length, 1);
    await assert.rejects(
      service.command({ type: "agent.remove", agentId: DEFAULT_AGENT_ID }),
      /At least one/,
    );
  } finally {
    service.dispose();
  }
});

test("source revocation is forwarded to every assigned child before late completion", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [source] },
    });
    const one = await bind(context),
      two = await bind(context, second.id);
    await service.command({ type: "monitor.start", agentId: DEFAULT_AGENT_ID });
    await service.command({ type: "monitor.start", agentId: second.id });
    await frame(context, source);
    await service.command({ type: "source.remove", sourceId: source });
    assert.equal(one.requests[0].signal.aborted, true);
    assert.equal(two.requests[0].signal.aborted, true);
    one.requests[0].resolve("Old caption");
    two.requests[0].resolve("Old caption");
    await settle();
    assert(
      service
        .snapshot()
        .agents.every(
          (agent) =>
            agent.sourceIds.length === 0 && agent.observations.length === 0,
        ),
    );
  } finally {
    service.dispose();
  }
});

test("active-agent aliases do not retarget a pending chat response", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service);
    const provider = await bind(context);
    await frame(context, source);
    const ask = service.command({
      type: "conversation.ask",
      sourceIds: [source],
      text: "Pinned first agent",
    });
    await service.command({ type: "agent.select", agentId: second.id });
    provider.requests[0].resolve("First agent only");
    const observation = (await ask) as { agentId: string };
    assert.equal(observation.agentId, DEFAULT_AGENT_ID);
    assert.deepEqual(service.snapshot().chat, []);
    assert.equal(service.snapshot().agents[0].chat.length, 2);
    assert.equal(service.snapshot().binding.status, "unconfigured");
  } finally {
    service.dispose();
  }
});

test("only the active operator can plan, video sources never target native actions, switching revokes plans", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      video = await addSource(service, "video_file"),
      second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [source] },
    });
    const provider = await bind(context);
    await frame(context, source);
    await frame(context, video);
    await assert.rejects(
      service.command({
        type: "automation.plan",
        agentId: second.id,
        sourceId: source,
        goal: "Observe only",
      }),
      /active operator/,
    );
    await assert.rejects(
      service.command({
        type: "automation.plan",
        sourceId: video,
        goal: "Act on video",
      }),
      /desktop or synthetic/,
    );
    const plan = service.command({
      type: "automation.plan",
      sourceId: source,
      goal: "Synthetic action",
    });
    const rejection = assert.rejects(plan, /revoked|stale/);
    await service.command({ type: "agent.select", agentId: second.id });
    assert.equal(provider.requests[0].signal.aborted, true);
    provider.requests[0].resolve(
      '{"steps":[{"type":"key","key":"ENTER","description":"Synthetic"}]}',
    );
    await rejection;
    await settle();
    assert(service.snapshot().agents.every((agent) => !agent.pendingPlan));
    await service.command({ type: "agent.select", agentId: DEFAULT_AGENT_ID });
    await frame(context, source);
    const currentPlan = service.command({
      type: "automation.plan",
      sourceId: source,
      goal: "Synthetic action",
    });
    provider.requests[1].resolve(
      '{"steps":[{"type":"key","key":"ENTER","description":"Synthetic"}]}',
    );
    const result = (await currentPlan) as {
      agentId: string;
      agentRevision: number;
    };
    assert.equal(result.agentId, DEFAULT_AGENT_ID);
    assert.equal(result.agentRevision, service.snapshot().agents[0].revision);
    await service.command({ type: "agent.select", agentId: second.id });
    assert.equal(service.snapshot().agents[0].pendingPlan, undefined);
  } finally {
    service.dispose();
  }
});

test("semantic rules, events, caption search and summaries stay in their owning engine", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [source] },
    });
    const one = await bind(context),
      two = await bind(context, second.id);
    for (const agentId of [DEFAULT_AGENT_ID, second.id]) {
      await service.command({
        type: "pipeline.configure",
        agentId,
        temporalEnabled: false,
      });
      await service.command({
        type: "rule.add",
        agentId,
        name: "Own condition",
        condition: "Visible synthetic red",
        sourceIds: [source],
      });
      await service.command({ type: "monitor.start", agentId });
    }
    const evidence = (
      agentId: string,
      summary: string,
      verdict: "match" | "no_match",
    ) => {
      const rule = service
        .snapshot()
        .agents.find((agent) => agent.id === agentId)!.pipeline.rules[0];
      return JSON.stringify({
        summary,
        rules: [
          {
            ruleId: rule.id,
            ruleRevision: rule.revision,
            verdict,
            evidence: "Synthetic evidence",
          },
        ],
      });
    };
    await frame(context, source);
    one.requests[0].resolve(
      evidence(DEFAULT_AGENT_ID, "First red caption", "match"),
    );
    two.requests[0].resolve(
      evidence(second.id, "Second blue caption", "no_match"),
    );
    await settle();
    context.advance(2000);
    await frame(context, source);
    one.requests[1].resolve(
      evidence(DEFAULT_AGENT_ID, "First red caption again", "match"),
    );
    two.requests[1].resolve(
      evidence(second.id, "Second blue caption again", "no_match"),
    );
    await settle();
    const agents = service.snapshot().agents;
    assert(
      agents[0].events.some(
        (event) => event.type === "alert" && event.agentId === DEFAULT_AGENT_ID,
      ),
    );
    assert(!agents[1].events.some((event) => event.type === "alert"));
    const firstSearch = (await service.command({
      type: "history.search",
      agentId: DEFAULT_AGENT_ID,
      query: "red",
    })) as { matches: unknown[] };
    const secondSearch = (await service.command({
      type: "history.search",
      agentId: second.id,
      query: "red",
    })) as { matches: unknown[] };
    assert.equal(firstSearch.matches.length, 2);
    assert.equal(secondSearch.matches.length, 0);
    await service.command({
      type: "history.summarize",
      agentId: DEFAULT_AGENT_ID,
    });
    assert.equal(one.summaries.length, 1);
    assert.equal(two.summaries.length, 0);
    assert(
      one.summaries[0].input.captions.every((caption) =>
        caption.summary.includes("First"),
      ),
    );
    await service.command({ type: "monitor.pause", agentId: DEFAULT_AGENT_ID });
    assert.equal(one.summaries[0].signal.aborted, true);
    one.summaries[0].resolve("Must not restore summary");
    await settle();
    assert.equal(
      service.snapshot().agents[0].historySummary?.status,
      "cancelled",
    );
    assert.equal(service.snapshot().agents[1].session, "monitoring");
  } finally {
    service.dispose();
  }
});

test("selection is visible before yielding, closing concurrent old-operator plan admission", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service, "operator");
    await bind(context);
    await frame(context, source);
    const selecting = service.command({
      type: "agent.select",
      agentId: second.id,
    });
    await assert.rejects(
      service.command({
        type: "automation.plan",
        agentId: DEFAULT_AGENT_ID,
        sourceId: source,
        goal: "Old operator",
      }),
      /active operator/,
    );
    await selecting;
    assert.equal(context.providers[0].requests.length, 0);
  } finally {
    service.dispose();
  }
});

test("removed agents cannot restore delayed discovery results", async () => {
  let release:
    | ((models: Awaited<ReturnType<VisionProvider["discover"]>>) => void)
    | undefined;
  let discoverySignal: AbortSignal | undefined;
  const service = createAgentService({
    autoTick: false,
    providerFactory: () => ({
      discover(signal) {
        discoverySignal = signal;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      analyze: async () => challenge,
    }),
  });
  try {
    const second = await addAgent(service);
    const discovery = service.command({
      type: "provider.discover",
      agentId: second.id,
      provider: "lmstudio",
      endpoint: "http://127.0.0.1:1234",
    });
    const rejection = assert.rejects(discovery, /cancelled|failed/);
    await service.command({ type: "agent.remove", agentId: second.id });
    assert.equal(discoverySignal?.aborted, true);
    release!([{ id: "late", name: "Late", vision: "declared", loaded: true }]);
    await rejection;
    assert.equal(service.snapshot().agents.length, 1);
    assert.deepEqual(service.snapshot().models, []);
  } finally {
    service.dispose();
  }
});

test("concurrent selection and removal never leave an unknown active agent", async () => {
  const { service } = setup();
  try {
    const second = await addAgent(service);
    const selection = service.command({
      type: "agent.select",
      agentId: second.id,
    });
    const removal = service.command({
      type: "agent.remove",
      agentId: second.id,
    });
    await Promise.all([selection, removal]);
    assert.equal(service.snapshot().activeAgentId, DEFAULT_AGENT_ID);
    assert.equal(service.snapshot().agents.length, 1);
    await service.command({ type: "state.get" });
  } finally {
    service.dispose();
  }
});

test("assignment or role revision invalidates in-flight discovery before late binding can apply", async () => {
  for (const change of ["assignment", "role"] as const) {
    let release:
      | ((models: Awaited<ReturnType<VisionProvider["discover"]>>) => void)
      | undefined;
    let discoverySignal: AbortSignal | undefined;
    const service = createAgentService({
      autoTick: false,
      providerFactory: () => ({
        discover(signal) {
          discoverySignal = signal;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
        analyze: async () => challenge,
      }),
    });
    try {
      const source = await addSource(service),
        second = await addAgent(service);
      const discovery = service.command({
        type: "provider.discover",
        agentId: second.id,
        provider: "lmstudio",
        endpoint: "http://127.0.0.1:1234",
      });
      const rejection = assert.rejects(discovery, /cancelled|failed/);
      await service.command({
        type: "agent.update",
        agentId: second.id,
        patch:
          change === "assignment"
            ? { sourceIds: [source] }
            : { role: "operator" },
      });
      assert.equal(discoverySignal?.aborted, true);
      release!([
        { id: "late", name: "Late", vision: "declared", loaded: true },
      ]);
      await rejection;
      const state = service
        .snapshot()
        .agents.find((agent) => agent.id === second.id)!;
      assert.deepEqual(state.models, []);
      assert.equal(state.binding.status, "unconfigured");
    } finally {
      service.dispose();
    }
  }
});

test("global frame forwarding interleaved with Stop never delivers retained late evidence", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service);
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [source] },
    });
    const one = await bind(context),
      two = await bind(context, second.id);
    await service.command({ type: "monitor.start", agentId: DEFAULT_AGENT_ID });
    await service.command({ type: "monitor.start", agentId: second.id });
    const current = service.snapshot().sources[0];
    const forwarding = service.command({
      type: "source.frame",
      frame: context.image(source, current.revision),
    });
    const stopping = service.command({ type: "session.stop" });
    await Promise.all([forwarding, stopping]);
    for (const provider of [one, two])
      for (const request of provider.requests) {
        assert.equal(request.signal.aborted, true);
        request.resolve("Discard after Stop");
      }
    await settle();
    assert(
      service
        .snapshot()
        .agents.every(
          (agent) =>
            agent.session === "stopped" && agent.observations.length === 0,
        ),
    );
    assert.equal(service.snapshot().sources[0].status, "stopped");
  } finally {
    service.dispose();
  }
});

test("cancelled probes after assignment or role changes return to selected and can be retried", async () => {
  for (const change of ["assignment", "role"] as const) {
    const context = setup();
    const { service } = context;
    try {
      await addSource(service);
      await service.command({
        type: "provider.discover",
        provider: "lmstudio",
        endpoint: "http://127.0.0.1:1234",
      });
      await service.command({ type: "provider.select", modelId: "vision" });
      const provider = context.providers[0];
      provider.holdProbe = true;
      const oldProbe = service.command({
        type: "provider.probe",
        frame: context.image(),
      });
      const cancelled = assert.rejects(oldProbe, /revoked|stale/);
      assert.equal(service.snapshot().binding.status, "probing");
      await service.command({
        type: "agent.update",
        agentId: DEFAULT_AGENT_ID,
        patch:
          change === "assignment" ? { sourceIds: [] } : { role: "observer" },
      });
      assert.equal(provider.requests[0].signal.aborted, true);
      assert.equal(service.snapshot().binding.status, "selected");
      assert.equal(service.snapshot().binding.verifiedAt, undefined);
      provider.holdProbe = false;
      const retry = service.command({
        type: "provider.probe",
        frame: context.image(),
      });
      provider.requests[0].resolve(challenge);
      await cancelled;
      await retry;
      assert.equal(service.snapshot().binding.status, "verified");
    } finally {
      service.dispose();
    }
  }
});

test("shared catalog validates sixteen large feeds without retaining unassigned images or requiring cached old pixels", async () => {
  const context = setup();
  const { service } = context;
  try {
    await service.command({
      type: "agent.update",
      agentId: DEFAULT_AGENT_ID,
      patch: { sourceIds: [] },
    });
    const sources: string[] = [];
    for (let i = 0; i < 16; i++) sources.push(await addSource(service));
    const payload = Buffer.alloc(1_000_000);
    Buffer.from(png.split(",")[1]!, "base64").copy(payload);
    const dataUrl = `data:image/png;base64,${payload.toString("base64")}`;
    let last: Frame | undefined;
    for (let generation = 0; generation < 2; generation++)
      for (const id of sources) {
        context.advance();
        const source = service
          .snapshot()
          .sources.find((source) => source.id === id)!;
        last = { ...context.image(id, source.revision), dataUrl };
        const result = (await service.command({
          type: "source.frame",
          frame: last,
        })) as { accepted: boolean; agentsAccepted: number };
        assert.equal(result.accepted, true);
        assert.equal(result.agentsAccepted, 0);
      }
    assert.equal(context.providers.length, 0);
    assert.equal(service.snapshot().observations.length, 0);
    assert.equal(service.snapshot().queueSize, 0);
    await assert.rejects(
      service.command({ type: "source.frame", frame: last! }),
      /Duplicate frame/,
    );
    await assert.rejects(
      service.command({
        type: "source.frame",
        frame: { ...last!, id: randomUUID(), capturedAt: last!.capturedAt - 1 },
      }),
      /capture order/,
    );
    await assert.rejects(
      service.command({
        type: "source.frame",
        frame: {
          ...last!,
          id: randomUUID(),
          capturedAt: last!.capturedAt - 6000,
        },
      }),
      /stale/,
    );
    await service.command({
      type: "agent.update",
      agentId: DEFAULT_AGENT_ID,
      patch: { sourceIds: [sources[0]] },
    });
    const provider = await bind(context);
    await assert.rejects(
      service.command({
        type: "conversation.ask",
        sourceIds: [sources[0]],
        text: "Cannot read cached unassigned pixels",
      }),
      /fresh analysis-enabled frame/,
    );
    await frame(context, sources[0]);
    const ask = service.command({
      type: "conversation.ask",
      sourceIds: [sources[0]],
      text: "Fresh assigned frame",
    });
    provider.requests[0].resolve("Only fresh assigned pixels");
    await ask;
    assert.equal(service.snapshot().observations.length, 1);
  } finally {
    service.dispose();
  }
});

test("pinned cancellation of another operator never revokes the active agent's newer plan", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      second = await addAgent(service, "operator");
    await service.command({
      type: "agent.update",
      agentId: second.id,
      patch: { sourceIds: [source] },
    });
    const provider = await bind(context, second.id);
    await service.command({ type: "agent.select", agentId: second.id });
    await frame(context, source);
    const planning = service.command({
      type: "automation.plan",
      agentId: second.id,
      sourceId: source,
      goal: "Current operator proposal",
    });
    provider.requests[0].resolve(
      '{"steps":[{"type":"key","key":"ENTER","description":"Synthetic"}]}',
    );
    const plan = (await planning) as { id: string; agentId: string };
    assert.equal(plan.agentId, second.id);
    await service.command({
      type: "automation.cancel",
      agentId: DEFAULT_AGENT_ID,
    });
    assert.equal(service.snapshot().activeAgentId, second.id);
    assert.equal(service.snapshot().pendingPlan?.id, plan.id);
    await service.command({ type: "automation.cancel", agentId: second.id });
    assert.equal(service.snapshot().pendingPlan, undefined);
  } finally {
    service.dispose();
  }
});

test("global Stop, pause and history clear reset cancelled probing bindings for explicit retry", async () => {
  for (const type of [
    "session.stop",
    "monitor.pause",
    "history.clear",
  ] as const) {
    const context = setup();
    const { service } = context;
    try {
      await service.command({
        type: "provider.discover",
        provider: "lmstudio",
        endpoint: "http://127.0.0.1:1234",
      });
      await service.command({ type: "provider.select", modelId: "vision" });
      const provider = context.providers[0];
      provider.holdProbe = true;
      const oldProbe = service.command({
        type: "provider.probe",
        frame: context.image(),
      });
      const cancelled = assert.rejects(oldProbe, /revoked|stale/);
      await service.command({ type });
      assert.equal(provider.requests[0].signal.aborted, true);
      assert.equal(service.snapshot().binding.status, "selected");
      provider.holdProbe = false;
      const retry = service.command({
        type: "provider.probe",
        frame: context.image(),
      });
      provider.requests[0].resolve(challenge);
      await cancelled;
      await retry;
      assert.equal(service.snapshot().binding.status, "verified");
      assert.equal(service.snapshot().agents[0].observations.length, 0);
    } finally {
      service.dispose();
    }
  }
});

test("native cleanup for an older plan cannot cancel a superseding goal or proposal in the same agent", async () => {
  const context = setup();
  const { service } = context;
  try {
    const source = await addSource(service),
      provider = await bind(context);
    await frame(context, source);
    const response =
      '{"steps":[{"type":"key","key":"ENTER","description":"Synthetic"}]}';
    const first = service.command({
      type: "automation.plan",
      sourceId: source,
      goal: "First proposal",
    });
    provider.requests[0].resolve(response);
    const oldPlan = (await first) as { id: string };
    const newer = service.command({
      type: "automation.plan",
      sourceId: source,
      goal: "Superseding goal",
    });
    assert.equal(service.snapshot().pendingPlan, undefined);
    await service.command({
      type: "automation.cancel",
      agentId: DEFAULT_AGENT_ID,
      planId: oldPlan.id,
    });
    assert.equal(provider.requests[1].signal.aborted, false);
    provider.requests[1].resolve(response);
    const newPlan = (await newer) as { id: string };
    assert.notEqual(newPlan.id, oldPlan.id);
    await service.command({
      type: "automation.cancel",
      agentId: DEFAULT_AGENT_ID,
      planId: oldPlan.id,
    });
    assert.equal(service.snapshot().pendingPlan?.id, newPlan.id);
    await service.command({
      type: "automation.cancel",
      agentId: DEFAULT_AGENT_ID,
      planId: newPlan.id,
    });
    assert.equal(service.snapshot().pendingPlan, undefined);
    const explicit = service.command({
      type: "automation.plan",
      sourceId: source,
      goal: "Explicit cancellation still cancels",
    });
    const cancelled = assert.rejects(explicit, /revoked|stale/);
    await service.command({
      type: "automation.cancel",
      agentId: DEFAULT_AGENT_ID,
    });
    assert.equal(provider.requests[2].signal.aborted, true);
    provider.requests[2].resolve(response);
    await cancelled;
    assert.equal(service.snapshot().pendingPlan, undefined);
  } finally {
    service.dispose();
  }
});
