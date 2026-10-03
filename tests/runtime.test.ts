import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createService, type Service } from "../apps/service/engine.js";
import type {
  AnalysisInput,
  VisionProvider,
  TextSummaryInput,
} from "../packages/providers/src/index.js";
import type { Frame, Snapshot } from "../packages/contracts/src/index.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN/8AAAAASUVORK5CYII=";
const challenge = "A red square, a blue circle, and the label OPENAWARE42.";
class Clock {
  value = 1_000_000;
  monotonic = 0;
  wall = () => this.value;
  mono = () => this.monotonic;
  advance(ms: number) {
    this.value += ms;
    this.monotonic += ms;
  }
}
class FakeProvider implements VisionProvider {
  requests: {
    input: AnalysisInput;
    signal: AbortSignal;
    resolve: (text: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  maximum = 0;
  outstanding = 0;
  holdProbes = false;
  summaries: {
    input: TextSummaryInput;
    signal: AbortSignal;
    resolve: (text: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  async discover() {
    return [
      {
        id: "vision",
        name: "Vision",
        vision: "declared" as const,
        loaded: true,
      },
      { id: "other", name: "Other", vision: "unknown" as const, loaded: false },
      {
        id: "text",
        name: "Text only",
        vision: "unsupported" as const,
        loaded: false,
      },
    ];
  }
  analyze(input: AnalysisInput, signal: AbortSignal): Promise<string> {
    if (input.mode === "probe" && !this.holdProbes)
      return Promise.resolve(challenge);
    this.outstanding++;
    this.maximum = Math.max(this.maximum, this.outstanding);
    return new Promise<string>((resolve, reject) =>
      this.requests.push({ input, signal, resolve, reject }),
    ).finally(() => {
      this.outstanding--;
    });
  }
  finish(text = "Visible state") {
    const request = this.requests.shift();
    assert(request);
    request.resolve(text);
    return request;
  }
  summarize(input: TextSummaryInput, signal: AbortSignal): Promise<string> {
    this.outstanding++;
    this.maximum = Math.max(this.maximum, this.outstanding);
    return new Promise<string>((resolve, reject) =>
      this.summaries.push({ input, signal, resolve, reject }),
    ).finally(() => {
      this.outstanding--;
    });
  }
  finishSummary(text = "Historical summary") {
    const request = this.summaries.shift();
    assert(request);
    request.resolve(text);
    return request;
  }
}
const settle = async () => {
  for (let count = 0; count < 4; count++)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
function image(
  clock: Clock,
  sourceId: string = randomUUID(),
  sourceRevision = 1,
): Frame {
  return {
    id: randomUUID(),
    sourceId,
    sourceRevision,
    capturedAt: clock.wall(),
    width: 1,
    height: 1,
    dataUrl: png,
  };
}
async function configured(t: test.TestContext) {
  const clock = new Clock(),
    provider = new FakeProvider();
  const service = createService({
    providerFactory: () => provider,
    clock,
    autoTick: false,
  });
  t.after(() => service.dispose());
  await service.command({
    type: "provider.discover",
    provider: "lmstudio",
    endpoint: "http://localhost:1234",
    token: "never-show-secret",
  });
  await service.command({ type: "provider.select", modelId: "vision" });
  await service.command({ type: "provider.probe", frame: image(clock) });
  await settle();
  assert.equal(service.snapshot().binding.status, "verified");
  assert.equal(service.snapshot().session, "paused");
  return { clock, provider, service };
}
async function addSource(
  service: Service,
  clock: Clock,
  name = "Synthetic monitor",
  analysisEnabled = true,
  motionEnabled = false,
): Promise<string> {
  const id = randomUUID();
  await service.command({
    type: "source.add",
    source: { id, name, kind: "demo", deviceId: "synthetic" },
  });
  await service.command({
    type: "source.update",
    sourceId: id,
    patch: { status: "live", analysisEnabled, motionEnabled },
  });
  const item = service.snapshot().sources.find((item) => item.id === id)!;
  await service.command({
    type: "source.frame",
    frame: image(clock, id, item.revision),
  });
  return id;
}
async function sendFrame(service: Service, clock: Clock, sourceId: string) {
  const source = service
    .snapshot()
    .sources.find((item) => item.id === sourceId)!;
  return service.command({
    type: "source.frame",
    frame: image(clock, sourceId, source.revision),
  });
}

const semanticReply = (
  service: Service,
  verdict: "match" | "no_match" | "unknown" = "match",
) =>
  JSON.stringify({
    summary: "Synthetic entry changed",
    rules: service
      .snapshot()
      .pipeline.rules.filter((rule) => rule.enabled)
      .map((rule) => ({
        ruleId: rule.id,
        ruleRevision: rule.revision,
        verdict,
        evidence: "A generated person silhouette is visible.",
      })),
  });
async function makeCaption(
  service: Service,
  provider: FakeProvider,
  sourceId: string,
  text = "Synthetic door opened",
) {
  const pending = service.command({
    type: "conversation.ask",
    text: "Describe fixture",
    sourceIds: [sourceId],
  });
  provider.finish(text);
  await pending;
  await settle();
}

test("temporal background uses bounded chronological masked-revision windows while questions remain one fresh frame", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  for (let count = 0; count < 3; count++) {
    clock.advance(800);
    await sendFrame(service, clock, id);
  }
  await service.command({ type: "monitor.start" });
  const input = provider.requests[0]!.input;
  assert.equal(input.frames.length, 3);
  assert.deepEqual(
    input.frames.map((frame) => frame.capturedAt),
    [...input.frames.map((frame) => frame.capturedAt)].sort((a, b) => a - b),
  );
  assert.ok(
    input.frames.at(-1)!.capturedAt - input.frames[0]!.capturedAt <= 4000,
  );
  provider.finish();
  await settle();
  const observation = service.snapshot().observations[0]!;
  assert.equal(observation.frameCount, 3);
  assert.deepEqual(observation.sourceIds, [id]);
  assert.equal(observation.captureStartAt, input.frames[0]!.capturedAt);
  assert.equal(observation.capturedAt, input.frames.at(-1)!.capturedAt);
  const question = service.command({
    type: "conversation.ask",
    text: "What is current?",
    sourceIds: [id],
  });
  assert.equal(provider.requests[0]!.input.frames.length, 1);
  provider.finish();
  await question;
  await settle();
  clock.advance(6000);
  service.tick();
  await assert.rejects(
    service.command({
      type: "conversation.ask",
      text: "Current?",
      sourceIds: [id],
    }),
    /fresh/,
  );
});

test("temporal older inputs may span four seconds but latest completion freshness and source-mask revocation still apply", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  clock.advance(2000);
  await sendFrame(service, clock, id);
  clock.advance(2000);
  await sendFrame(service, clock, id);
  await service.command({ type: "monitor.start" });
  assert.equal(provider.requests[0]!.input.frames.length, 3);
  clock.advance(11_000);
  provider.finish();
  await settle();
  assert.equal(service.snapshot().observations[0]!.status, "current");
  await sendFrame(service, clock, id);
  assert.equal(
    provider.requests[0]!.input.frames.length,
    1,
    "stall removes temporal predecessors",
  );
  const old = provider.requests[0]!;
  await service.command({
    type: "source.update",
    sourceId: id,
    patch: { masks: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] },
  });
  assert.equal(old.signal.aborted, true);
  provider.finish("Old masked revision");
  await settle();
  assert.equal(service.snapshot().observations.length, 1);
  clock.advance(1);
  await sendFrame(service, clock, id);
  assert.equal(provider.requests[0]!.input.frames.length, 1);
  clock.advance(15_001);
  provider.finish("Historical caption");
  await settle();
  assert.equal(service.snapshot().observations.length, 2);
  assert.equal(service.snapshot().observations.at(-1)!.status, "stale");
});

test("slow background captions stay historical and cannot qualify semantic alerts, while fresh evidence still can", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await service.command({
    type: "rule.add",
    name: "Entry",
    condition: "A person appears",
    sourceIds: [id],
  });
  clock.advance(1);
  await sendFrame(service, clock, id);
  await service.command({ type: "monitor.start" });
  for (let count = 0; count < 2; count++) {
    if (count) {
      clock.advance(1);
      await sendFrame(service, clock, id);
    }
    clock.advance(18_000);
    provider.finish(semanticReply(service));
    await settle();
    const observation = service.snapshot().observations.at(-1)!;
    assert.equal(observation.status, "stale");
    assert.equal(observation.ruleEvidence![0]!.verdict, "unknown");
    assert.equal(service.snapshot().pipeline.rules[0]!.status, "unknown");
    assert.equal(
      service.snapshot().events.filter((event) => event.type === "alert")
        .length,
      0,
    );
  }
  for (let count = 0; count < 2; count++) {
    clock.advance(2000);
    await sendFrame(service, clock, id);
    provider.finish(semanticReply(service));
    await settle();
  }
  assert.equal(
    service.snapshot().events.filter((event) => event.type === "alert").length,
    1,
  );
  assert.equal(service.snapshot().pendingPlan, undefined);
  assert.equal(
    service.snapshot().events.filter((event) => event.type === "action").length,
    0,
  );
});

test("background completion has a bounded 65-second historical age, independently of live-question freshness", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  clock.advance(5000);
  await service.command({ type: "monitor.start" });
  clock.advance(60_000);
  provider.finish("Last admissible historical caption");
  await settle();
  assert.equal(service.snapshot().observations.length, 1);
  assert.equal(service.snapshot().observations[0]!.status, "stale");
  await sendFrame(service, clock, id);
  clock.advance(65_001);
  provider.finish("Outside bounded historical age");
  await settle();
  assert.equal(service.snapshot().observations.length, 1);
  await sendFrame(service, clock, id);
  provider.finish("Fresh monitoring");
  await settle();
  const question = service.command({
    type: "conversation.ask",
    text: "Current?",
    sourceIds: [id],
  });
  const rejected = assert.rejects(question, /stale/);
  clock.advance(15_001);
  provider.finish("Old live question");
  await rejected;
  await settle();
  assert.equal(service.snapshot().observations.length, 2);
  assert.equal(
    service.snapshot().chat.filter((item) => item.role === "assistant").length,
    0,
  );
});

test("synthetic model probes allow the 20-second capability deadline without granting live evidence", async (t) => {
  const { service, clock, provider } = await configured(t);
  provider.holdProbes = true;
  await service.command({ type: "provider.select", modelId: "vision" });
  const first = service.command({
    type: "provider.probe",
    frame: image(clock),
  });
  clock.advance(18_000);
  provider.finish(challenge);
  await first;
  await settle();
  assert.equal(service.snapshot().binding.status, "verified");
  assert.equal(service.snapshot().session, "paused");
  assert.equal(service.snapshot().observations.length, 0);
  await service.command({ type: "provider.select", modelId: "vision" });
  const second = service.command({
    type: "provider.probe",
    frame: image(clock),
  });
  const rejected = assert.rejects(second, /stale/);
  clock.advance(20_001);
  provider.finish(challenge);
  await rejected;
  await settle();
  assert.equal(service.snapshot().binding.status, "failed");
});

test("background and historical summaries get 60-second deadlines while current chat and Operator keep 20 seconds", async (t) => {
  const fixtures = [];
  for (const kind of ["observe", "summary", "chat", "plan"] as const) {
    const fixture = await configured(t);
    const id = await addSource(fixture.service, fixture.clock);
    if (kind === "summary")
      await makeCaption(fixture.service, fixture.provider, id);
    fixtures.push({ ...fixture, id, kind });
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const { service, provider, id, kind } of fixtures) {
    let pending: Promise<unknown> | undefined;
    if (kind === "observe") await service.command({ type: "monitor.start" });
    else if (kind === "summary")
      await service.command({ type: "history.summarize" });
    else
      pending = service
        .command(
          kind === "chat"
            ? { type: "conversation.ask", text: "Current?", sourceIds: [id] }
            : {
                type: "automation.plan",
                goal: "Inspect generated demo",
                sourceId: id,
              },
        )
        .catch((error: unknown) => error);
    const request =
      kind === "summary" ? provider.summaries[0]! : provider.requests[0]!;
    const long = kind === "observe" || kind === "summary";
    t.mock.timers.tick(20_001);
    assert.equal(
      request.signal.aborted,
      !long,
      `${kind} deadline at 20 seconds`,
    );
    if (long) {
      t.mock.timers.tick(40_000);
      assert.equal(request.signal.aborted, true);
    }
    if (kind === "summary") provider.finishSummary();
    else provider.finish();
    await pending;
    await settle();
    if (kind === "summary")
      assert.equal(service.snapshot().historySummary!.status, "failed");
    else assert.equal(service.snapshot().observations.length, 0);
    assert.match(service.snapshot().lastError ?? "", /timed out/);
    assert.equal(service.snapshot().pendingPlan, undefined);
    assert.equal(provider.maximum, 1);
  }
});

test("semantic rules need two current distinct observations, produce only observational alerts, and reject old revisions", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await service.command({
    type: "rule.add",
    name: "Entry",
    condition: "A person appears",
    sourceIds: [id],
  });
  clock.advance(1);
  await sendFrame(service, clock, id);
  await service.command({ type: "monitor.start" });
  assert.equal(provider.requests[0]!.input.structured, true);
  provider.finish(semanticReply(service));
  await settle();
  assert.equal(service.snapshot().pipeline.rules[0]!.status, "pending");
  assert.equal(
    service.snapshot().events.filter((event) => event.type === "alert").length,
    0,
  );
  clock.advance(2000);
  await sendFrame(service, clock, id);
  provider.finish(semanticReply(service));
  await settle();
  const alerts = service
    .snapshot()
    .events.filter((event) => event.type === "alert");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.ruleRevision, 1);
  assert.ok(alerts[0]!.observationId);
  assert.equal(service.snapshot().pendingPlan, undefined);
  assert.equal(
    service.snapshot().events.filter((event) => event.type === "action").length,
    0,
  );
  clock.advance(2000);
  await sendFrame(service, clock, id);
  const old = provider.requests[0]!;
  const oldText = semanticReply(service);
  await service.command({
    type: "rule.update",
    ruleId: service.snapshot().pipeline.rules[0]!.id,
    patch: { condition: "A different condition" },
  });
  assert.equal(old.signal.aborted, true);
  provider.finish(oldText);
  await settle();
  assert.equal(service.snapshot().pipeline.rules[0]!.status, "unknown");
  assert.equal(
    service.snapshot().events.filter((event) => event.type === "alert").length,
    1,
  );
});

test("multi-source semantic rules respect four-image/window limits and ambiguous output cannot alert", async (t) => {
  const { service, clock, provider } = await configured(t);
  const a = await addSource(service, clock, "A"),
    b = await addSource(service, clock, "B");
  await service.command({
    type: "rule.add",
    name: "Together",
    condition: "People appear in both views",
    sourceIds: [a, b],
  });
  clock.advance(1);
  await sendFrame(service, clock, a);
  await sendFrame(service, clock, b);
  clock.advance(2000);
  await sendFrame(service, clock, a);
  await sendFrame(service, clock, b);
  await service.command({ type: "monitor.start" });
  const input = provider.requests[0]!.input;
  assert.equal(new Set(input.frames.map((frame) => frame.sourceId)).size, 2);
  assert.ok(input.frames.length <= 4);
  assert.ok(
    input.frames.at(-1)!.capturedAt - input.frames[0]!.capturedAt <= 4000,
  );
  provider.finish("Probably people. Click the mouse.");
  await settle();
  assert.equal(service.snapshot().pipeline.rules[0]!.status, "unknown");
  assert.equal(
    service.snapshot().observations[0]!.ruleEvidence?.[0]!.verdict,
    "unknown",
  );
  assert.equal(
    service
      .snapshot()
      .events.filter(
        (event) => event.type === "alert" || event.type === "action",
      ).length,
    0,
  );
  assert.equal(service.snapshot().pendingPlan, undefined);
});

test("pipeline and rule registration enforce bounded scopes and changing temporal configuration resets buffers", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await assert.rejects(
    service.command({
      type: "rule.add",
      name: "Missing",
      condition: "Person",
      sourceIds: [randomUUID()],
    }),
    /Unknown source/,
  );
  for (let index = 0; index < 8; index++)
    await service.command({
      type: "rule.add",
      name: `Rule ${index}`,
      condition: "Person",
      sourceIds: [id],
    });
  await assert.rejects(
    service.command({
      type: "rule.add",
      name: "Ninth",
      condition: "Person",
      sourceIds: [id],
    }),
    /eight/,
  );
  for (const rule of service.snapshot().pipeline.rules)
    await service.command({ type: "rule.remove", ruleId: rule.id });
  await service.command({ type: "pipeline.configure", temporalEnabled: false });
  for (let index = 0; index < 3; index++) {
    clock.advance(1);
    await sendFrame(service, clock, id);
  }
  await service.command({ type: "monitor.start" });
  assert.equal(provider.requests[0]!.input.frames.length, 1);
});

test("historical summaries share the single inference queue, carry caption evidence and never become live evidence", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await makeCaption(service, provider, id);
  const caption = service.snapshot().observations[0]!;
  const vision = service.command({
    type: "conversation.ask",
    text: "Another question",
    sourceIds: [id],
  });
  const queued = (await service.command({
    type: "history.summarize",
    sourceIds: [id],
  })) as Snapshot;
  assert.equal(queued.historySummary!.status, "queued");
  assert.equal(provider.summaries.length, 0);
  provider.finish("Another current answer");
  await vision;
  await settle();
  assert.equal(service.snapshot().historySummary!.status, "running");
  const input = provider.summaries[0]!.input;
  assert.deepEqual(
    input.captions.map((item) => item.id),
    [caption.id],
  );
  assert.doesNotMatch(JSON.stringify(input), /data:image|dataUrl|frames/);
  const count = service.snapshot().observations.length,
    chat = service.snapshot().chat.length;
  clock.advance(60_000);
  provider.finishSummary("Historical, not the current desktop");
  await settle();
  assert.equal(service.snapshot().historySummary!.status, "completed");
  assert.equal(
    service.snapshot().historySummary!.capturedAt,
    caption.capturedAt,
  );
  assert.equal(service.snapshot().observations.length, count);
  assert.equal(service.snapshot().chat.length, chat);
  assert.equal(service.snapshot().pendingPlan, undefined);
  assert.equal(provider.maximum, 1);
});

test("caption search and summary history are bounded, detached snapshots with explicit source/time provenance", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  for (let index = 0; index < 30; index++)
    await makeCaption(service, provider, id, `Synthetic door ${index} opened`);
  const result = (await service.command({
    type: "history.search",
    query: "door",
    sourceIds: [id],
    limit: 3,
  })) as { matches: { observation: { summary: string } }[] };
  assert.equal(result.matches.length, 3);
  result.matches[0]!.observation.summary = "mutated";
  assert.ok(
    service.snapshot().observations.every((item) => item.summary !== "mutated"),
  );
  await service.command({
    type: "history.summarize",
    sourceIds: [id],
    question: "What happened historically?",
  });
  assert.equal(provider.summaries[0]!.input.captions.length, 25);
  assert.equal(service.snapshot().historySummary!.observationIds.length, 25);
  provider.finishSummary();
  await settle();
  assert.ok(service.snapshot().historySummary!.summary);
});

test("large historical caption batches use a coherent newest complete subset within provider context and provenance limits", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  for (let index = 0; index < 25; index++) {
    clock.advance(1);
    await sendFrame(service, clock, id);
    await makeCaption(
      service,
      provider,
      id,
      `${String(index).padStart(2, "0")} ` + "x".repeat(1997),
    );
  }
  const all = service.snapshot().observations;
  await service.command({ type: "history.summarize" });
  const input = provider.summaries[0]!.input,
    summary = service.snapshot().historySummary!;
  assert.ok(input.captions.length > 0 && input.captions.length < 25);
  assert.ok(JSON.stringify(input.captions).length <= 32_000);
  const selected = all.slice(-input.captions.length);
  assert.deepEqual(
    input.captions.map((caption) => caption.id),
    selected.map((caption) => caption.id),
  );
  assert.deepEqual(
    summary.observationIds,
    selected.map((caption) => caption.id),
  );
  assert.equal(summary.captureStartAt, selected[0]!.captureStartAt);
  assert.equal(summary.capturedAt, selected.at(-1)!.capturedAt);
  assert.deepEqual(summary.sourceIds, [id]);
  provider.finishSummary();
  await settle();
  assert.equal(service.snapshot().historySummary!.status, "completed");
});

test("summary cancellation on source masks, pause, Stop and history clear prevents late restoration", async (t) => {
  for (const revoke of ["mask", "pause", "stop", "clear"] as const) {
    const { service, clock, provider } = await configured(t);
    const id = await addSource(service, clock);
    await makeCaption(service, provider, id);
    await service.command({ type: "history.summarize" });
    const request = provider.summaries[0]!;
    if (revoke === "mask")
      await service.command({
        type: "source.update",
        sourceId: id,
        patch: { masks: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] },
      });
    else
      await service.command({
        type:
          revoke === "pause"
            ? "monitor.pause"
            : revoke === "stop"
              ? "session.stop"
              : "history.clear",
      });
    assert.equal(request.signal.aborted, true);
    provider.finishSummary("Cancelled historical result");
    await settle();
    if (revoke === "clear") {
      assert.equal(service.snapshot().historySummary, undefined);
      assert.equal(service.snapshot().observations.length, 0);
    } else {
      assert.equal(service.snapshot().historySummary!.status, "cancelled");
      assert.equal(service.snapshot().historySummary!.summary, undefined);
    }
  }
});

test("new historical summaries supersede old cancellation-ignoring jobs without overlapping inference", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await makeCaption(service, provider, id);
  await service.command({ type: "history.summarize", question: "Old summary" });
  const old = provider.summaries[0]!;
  await service.command({ type: "history.summarize", question: "New summary" });
  assert.equal(old.signal.aborted, true);
  assert.equal(provider.summaries.length, 1);
  provider.finishSummary("Old result");
  await settle();
  assert.equal(provider.summaries[0]!.input.question, "New summary");
  assert.equal(service.snapshot().historySummary!.summary, undefined);
  provider.finishSummary("New result");
  await settle();
  assert.equal(service.snapshot().historySummary!.summary, "New result");
  assert.equal(provider.maximum, 1);
});

test("temporal buffers and queued image pins share the memory cap instead of accumulating unlimited receipts", async (t) => {
  const { service, clock, provider } = await configured(t);
  const ids: string[] = [];
  const payload = Buffer.alloc(740_000);
  Buffer.from(png.split(",")[1]!, "base64").copy(payload);
  const dataUrl = `data:image/png;base64,${payload.toString("base64")}`;
  const sendLarge = async (id: string) => {
    clock.advance(1);
    const revision = service
      .snapshot()
      .sources.find((item) => item.id === id)!.revision;
    await service.command({
      type: "source.frame",
      frame: { ...image(clock, id, revision), dataUrl },
    });
  };
  for (let count = 0; count < 4; count++) {
    const id = await addSource(service, clock);
    ids.push(id);
    await sendLarge(id);
  }
  const pending: Promise<unknown>[] = [];
  for (let generation = 0; generation < 3; generation++) {
    pending.push(
      service
        .command({
          type: "conversation.ask",
          text: "Hold generated fixture",
          sourceIds: ids,
        })
        .catch((error: unknown) => error),
    );
    if (generation < 2) for (const id of ids) await sendLarge(id);
  }
  let refused = false;
  for (const id of ids) {
    try {
      await sendLarge(id);
    } catch (error) {
      assert.match(String(error), /memory budget/);
      refused = true;
      break;
    }
  }
  assert.equal(refused, true);
  assert.equal(provider.maximum, 1);
  assert.doesNotMatch(JSON.stringify(service.snapshot()), /data:image/);
  await service.command({ type: "session.stop" });
  provider.finish("Cancelled held fixture");
  await Promise.all(pending);
  await settle();
});

test("explicit discovery, selection, challenge probe and resume; tokens never reach snapshots", async (t) => {
  const { service } = await configured(t);
  assert.doesNotMatch(JSON.stringify(service.snapshot()), /never-show-secret/);
  assert.equal(service.snapshot().binding.endpoint, "http://127.0.0.1:1234");
  assert.equal(service.snapshot().busy, false);
  await assert.rejects(
    service.command({ type: "provider.select", modelId: "text" }),
    /image support/,
  );
  await assert.rejects(
    service.command({ type: "monitor.start" }),
    /Start a source/,
  );
  await assert.rejects(
    service.command({
      type: "provider.discover",
      provider: "ollama",
      endpoint: "http://external.invalid",
    }),
    /loopback/,
  );
});

test("latest frame per source and one physical inference; round-robin sources get turns between questions", async (t) => {
  const { service, clock, provider } = await configured(t);
  const a = await addSource(service, clock, "A"),
    b = await addSource(service, clock, "B"),
    c = await addSource(service, clock, "C");
  await service.command({ type: "monitor.start" });
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].input.frames[0].sourceId, a);
  const first = service.command({
    type: "conversation.ask",
    text: "First question",
    sourceIds: [a, b],
  });
  const second = service.command({
    type: "conversation.ask",
    text: "Second question",
    sourceIds: [c],
  });
  provider.finish();
  await settle();
  assert.equal(provider.requests[0].input.mode, "chat");
  assert.equal(provider.requests[0].input.question, "First question");
  provider.finish("Answer 1");
  await first;
  await settle();
  assert.equal(provider.requests[0].input.mode, "observe");
  assert.equal(provider.requests[0].input.frames[0].sourceId, b);
  provider.finish();
  await settle();
  assert.equal(provider.requests[0].input.question, "Second question");
  provider.finish("Answer 2");
  await second;
  await settle();
  assert.equal(provider.requests[0].input.frames[0].sourceId, c);
  provider.finish();
  await settle();
  assert.equal(provider.maximum, 1);
  assert.equal(service.snapshot().observations.length, 5);
  assert.equal(
    service.snapshot().chat.filter((item) => item.role === "assistant").length,
    2,
  );
  clock.advance(2000);
  service.tick();
  assert.equal(provider.requests.length, 0, "same frame is not reanalyzed");
  for (let count = 0; count < 20; count++) {
    clock.advance(1);
    await sendFrame(service, clock, a);
  }
  assert.equal(provider.requests.length, 1);
  assert(service.snapshot().queueSize <= 3);
});

test("model changes pause immediately and do not overlap an old cancellation-ignoring request", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await service.command({ type: "monitor.start" });
  const old = provider.requests[0];
  await service.command({ type: "provider.select", modelId: "other" });
  assert.equal(old.signal.aborted, true);
  assert.equal(service.snapshot().session, "paused");
  assert.equal(service.snapshot().busy, true);
  const probe = service.command({
    type: "provider.probe",
    frame: image(clock),
  });
  assert.equal(service.snapshot().binding.status, "probing");
  assert.equal(provider.requests.length, 1);
  provider.finish("late old observation");
  await probe;
  await settle();
  assert.equal(service.snapshot().binding.modelId, "other");
  assert.equal(service.snapshot().binding.status, "verified");
  assert.equal(service.snapshot().observations.length, 0);
  assert.equal(service.snapshot().session, "paused");
  clock.advance(1);
  await sendFrame(service, clock, id);
  await service.command({ type: "monitor.start" });
  assert.equal(provider.requests[0].input.modelId, "other");
  assert.equal(provider.maximum, 1);
});

test("source revision, global stop, and clearing history invalidate late results", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await service.command({ type: "monitor.start" });
  await service.command({
    type: "source.update",
    sourceId: id,
    patch: { masks: [{ x: 0, y: 0, width: 0.1, height: 0.1 }] },
  });
  assert.equal(provider.requests[0].signal.aborted, true);
  provider.finish("secret under old mask");
  await settle();
  assert.equal(service.snapshot().observations.length, 0);
  clock.advance(1);
  await sendFrame(service, clock, id);
  assert.equal(provider.requests.length, 1);
  await service.command({ type: "history.clear" });
  provider.finish("late cleared history");
  await settle();
  assert.equal(service.snapshot().observations.length, 0);
  assert.equal(service.snapshot().events.length, 0);
  clock.advance(2000);
  await sendFrame(service, clock, id);
  assert.equal(provider.requests.length, 1);
  const stopped = (await service.command({ type: "session.stop" })) as Snapshot;
  assert.equal(stopped.session, "stopped");
  assert(stopped.sources.every((item) => item.status === "stopped"));
  assert.equal(stopped.queueSize, 0);
  provider.finish("late stopped result");
  await settle();
  assert.equal(service.snapshot().observations.length, 0);
  await assert.rejects(sendFrame(service, clock, id), /stopped/);
  await service.command({
    type: "source.update",
    sourceId: id,
    patch: { status: "live" },
  });
  assert.equal(service.snapshot().session, "idle");
  clock.advance(1);
  await sendFrame(service, clock, id);
  assert.equal(
    provider.requests.length,
    0,
    "explicit reconnect previews without silently resuming AI",
  );
});

test("capture freshness uses original capture time plus monotonic age, including wall-clock rollback", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  await service.command({ type: "monitor.start" });
  clock.monotonic += 66_000;
  clock.value -= 100_000;
  provider.finish("stale but arrived now");
  await settle();
  assert.equal(service.snapshot().observations.length, 0);
  assert.match(service.snapshot().lastError ?? "", /stale/);
  clock.value += 166_000;
  await sendFrame(service, clock, id);
  provider.finish("fresh observation");
  await settle();
  assert.equal(service.snapshot().observations[0].status, "current");
  clock.monotonic += 15_001;
  clock.value -= 100_000;
  service.tick();
  assert.equal(service.snapshot().observations[0].status, "stale");
  const source = service.snapshot().sources.find((item) => item.id === id)!;
  await assert.rejects(
    service.command({
      type: "source.frame",
      frame: {
        ...image(clock, id, source.revision),
        capturedAt: clock.wall() - 5001,
      },
    }),
    /stale/,
  );
  await assert.rejects(
    service.command({
      type: "source.frame",
      frame: {
        ...image(clock, id, source.revision),
        capturedAt: clock.wall() + 251,
      },
    }),
    /future/,
  );
});

test("motion-only watch works without a model and requires stability, fresh reset and cooldown", async (t) => {
  const clock = new Clock();
  const service = createService({ clock, autoTick: false });
  t.after(() => service.dispose());
  const id = await addSource(service, clock, "Motion only", false, true);
  await service.command({ type: "monitor.start" });
  const metric = async (value: number, advance = 200) => {
    clock.advance(advance);
    await service.command({
      type: "source.motion",
      sourceId: id,
      sourceRevision: service.snapshot().sources[0].revision,
      capturedAt: clock.wall(),
      value,
    });
  };
  await metric(0.11);
  assert.equal(
    service.snapshot().events.filter((item) => item.type === "motion").length,
    0,
  );
  await metric(0.1);
  assert.equal(
    service.snapshot().events.filter((item) => item.type === "motion").length,
    1,
  );
  await metric(0.03);
  await metric(0.02);
  await metric(0.11);
  await metric(0.11);
  assert.equal(
    service.snapshot().events.filter((item) => item.type === "motion").length,
    1,
  );
  await metric(0.02, 30_000);
  await metric(0.02);
  await metric(0.11);
  await metric(0.11);
  assert.equal(
    service.snapshot().events.filter((item) => item.type === "motion").length,
    2,
  );
  await service.command({ type: "monitor.pause" });
  await metric(0.11);
  await metric(0.11);
  assert.equal(
    service.snapshot().events.filter((item) => item.type === "motion").length,
    2,
  );
});

test("foreground cancellation rejects caller and keeps late replies out of chat; plans are bounded typed proposals", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  const question = service.command({
    type: "conversation.ask",
    text: "What is visible?",
    sourceIds: [id],
  });
  const cancelled = assert.rejects(question, /cancelled|revoked/);
  await service.command({ type: "conversation.cancel" });
  provider.finish("late chat");
  await cancelled;
  await settle();
  assert.equal(
    service.snapshot().chat.filter((item) => item.role === "assistant").length,
    0,
  );
  const planning = service.command({
    type: "automation.plan",
    goal: "Select the input",
    sourceId: id,
  });
  provider.finish(
    '{"steps":[{"type":"click","x":0.25,"y":0.5,"description":"Focus input"},{"type":"type","text":"Synthetic text","description":"Type provided text"}]}',
  );
  const plan = (await planning) as { id: string };
  await settle();
  assert.equal(service.snapshot().pendingPlan?.id, plan.id);
  assert.equal(
    service.snapshot().pendingPlan?.sourceRevision,
    service.snapshot().sources[0].revision,
  );
  assert.equal(service.snapshot().pendingPlan?.steps.length, 2);
  clock.monotonic += 30_001;
  clock.value -= 100_000;
  assert.equal(
    service.snapshot().pendingPlan,
    undefined,
    "clock rollback cannot extend approval window",
  );
  clock.value += 130_002;
  await sendFrame(service, clock, id);
  const invalid = service.command({
    type: "automation.plan",
    goal: "Unsafe action",
    sourceId: id,
  });
  const rejection = assert.rejects(invalid, /invalid typed/);
  provider.finish(
    '{"steps":[{"type":"shell","text":"execute","description":"not allowed"}]}',
  );
  await rejection;
  await settle();
  assert.equal(service.snapshot().pendingPlan, undefined);
});

test("source caps, frame replay, immutable snapshots, and bounded memory history are enforced", async (t) => {
  const { service, clock } = await configured(t);
  const ids = [];
  for (let count = 0; count < 4; count++)
    ids.push(await addSource(service, clock, `Source ${count}`, false, true));
  await assert.rejects(addSource(service, clock), /four sources/);
  const source = service.snapshot().sources[0];
  clock.advance(1);
  const receipt = image(clock, source.id, source.revision);
  await service.command({ type: "source.frame", frame: receipt });
  await assert.rejects(
    service.command({ type: "source.frame", frame: receipt }),
    /Duplicate/,
  );
  const view = service.snapshot();
  view.sources[0].name = "mutated";
  view.binding.modelId = "forged";
  assert.notEqual(service.snapshot().sources[0].name, "mutated");
  assert.equal(service.snapshot().binding.modelId, "vision");
  for (let count = 0; count < 1100; count++)
    await service.command({ type: "monitor.start" });
  assert.equal(service.snapshot().events.length, 1000);
  assert(
    Buffer.byteLength(JSON.stringify(service.snapshot())) < 16 * 1024 * 1024,
  );
  assert.doesNotMatch(JSON.stringify(service.snapshot()), /data:image/);
});

test("a superseding operator goal cancels the old proposal and cannot publish its late result", async (t) => {
  const { service, clock, provider } = await configured(t);
  const id = await addSource(service, clock);
  const old = service.command({
    type: "automation.plan",
    goal: "Old goal",
    sourceId: id,
  });
  const rejection = assert.rejects(old, /cancelled|revoked/);
  const latest = service.command({
    type: "automation.plan",
    goal: "Current goal",
    sourceId: id,
  });
  assert.equal(
    provider.requests.length,
    1,
    "new planning waits for physical slot",
  );
  assert.equal(provider.requests[0].signal.aborted, true);
  provider.finish(
    '{"steps":[{"type":"type","text":"old","description":"Old text"}]}',
  );
  await rejection;
  await settle();
  assert.equal(service.snapshot().pendingPlan, undefined);
  assert.equal(provider.requests[0].input.question, "Current goal");
  provider.finish(
    '{"steps":[{"type":"key","key":"TAB","description":"Move focus"}]}',
  );
  await latest;
  assert.equal(service.snapshot().pendingPlan?.goal, "Current goal");
  assert.equal(provider.maximum, 1);
});

test("a nonrecognizing synthetic probe remains failed and cannot unlock image analysis", async (t) => {
  const clock = new Clock();
  const provider: VisionProvider = {
    discover: async () => [
      { id: "pretend", name: "Pretend", vision: "unknown", loaded: true },
    ],
    analyze: async () => "I cannot see the image.",
  };
  const service = createService({
    clock,
    providerFactory: () => provider,
    autoTick: false,
  });
  t.after(() => service.dispose());
  await service.command({
    type: "provider.discover",
    provider: "lmstudio",
    endpoint: "http://localhost:1234",
  });
  await service.command({ type: "provider.select", modelId: "pretend" });
  await assert.rejects(
    service.command({ type: "provider.probe", frame: image(clock) }),
    /challenge/,
  );
  await settle();
  assert.equal(service.snapshot().binding.status, "failed");
  const id = await addSource(service, clock);
  await assert.rejects(
    service.command({
      type: "conversation.ask",
      text: "What is visible?",
      sourceIds: [id],
    }),
    /test a local vision model/,
  );
});

test("forked service implements typed request/reply and state events, and exits on IPC disconnect", async (t) => {
  const child = fork(
    fileURLToPath(new URL("../apps/service/index.ts", import.meta.url)),
    [],
    {
      execArgv: ["--import", "tsx"],
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  t.after(() => {
    if (!child.killed) child.kill();
  });
  const request = (command: unknown): Promise<Record<string, any>> =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        child.off("message", listener);
        reject(new Error("Service IPC timeout"));
      }, 5000);
      const listener = (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          "id" in message &&
          message.id === id
        ) {
          clearTimeout(timer);
          child.off("message", listener);
          resolve(message as Record<string, any>);
        }
      };
      child.on("message", listener);
      child.send({ id, command });
    });
  const state = await request({ type: "state.get" });
  assert.equal(state.data.session, "idle");
  assert.equal(
    (await request({ type: "arbitrary.shell", command: "untrusted" })).error,
    "Invalid command",
  );
  const update = new Promise<Snapshot>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("State event timeout")),
      5000,
    );
    child.once("message", (message) => {
      clearTimeout(timer);
      const value = message as { type: string; state: Snapshot };
      assert.equal(value.type, "state");
      resolve(value.state);
    });
  });
  const reply = request({
    type: "source.add",
    source: {
      id: randomUUID(),
      name: "Synthetic IPC fixture",
      kind: "demo",
      deviceId: "fixture",
    },
  });
  assert.equal((await update).sources.length, 1);
  assert.equal((await reply).data.sources.length, 1);
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Service did not exit on disconnect")),
      5000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      assert.equal(code, 0);
      resolve();
    });
  });
  child.disconnect();
  await exited;
});
