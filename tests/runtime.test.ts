import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createService, type Service } from "../apps/service/engine.js";
import type {
  AnalysisInput,
  VisionProvider,
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
    if (input.mode === "probe") return Promise.resolve(challenge);
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
  clock.monotonic += 16_000;
  clock.value -= 100_000;
  provider.finish("stale but arrived now");
  await settle();
  assert.equal(service.snapshot().observations.length, 0);
  assert.match(service.snapshot().lastError ?? "", /stale/);
  clock.value += 116_000;
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
