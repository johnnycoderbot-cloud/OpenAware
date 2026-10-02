import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  commandSchema,
  initialSnapshot,
  MAX_SOURCES,
} from "../../packages/contracts/src/index.js";
import type {
  AutomationPlan,
  Command,
  Frame,
  Observation,
  Snapshot,
  Source,
  TimelineEvent,
} from "../../packages/contracts/src/index.js";
import {
  initialMotion,
  parsePlan,
  updateMotion,
  validateImage,
} from "../../packages/core/src/index.js";
import type { MotionState } from "../../packages/core/src/index.js";
import {
  createProvider,
  localEndpoint,
} from "../../packages/providers/src/index.js";
import type {
  ProviderConfig,
  VisionProvider,
} from "../../packages/providers/src/index.js";

interface ReceivedFrame {
  frame: Frame;
  mono: number;
  age: number;
  epoch: number;
}
interface Job {
  kind: "observe" | "probe" | "chat" | "plan";
  frames: ReceivedFrame[];
  question: string;
  epoch: number;
  bindingRevision: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
export interface ServiceOptions {
  onState?: (state: Snapshot) => void;
  /** Dependency injection is private to tests, never a desktop command. */
  providerFactory?: (config: ProviderConfig) => VisionProvider;
  clock?: { wall: () => number; mono: () => number };
  autoTick?: boolean;
}
export interface Service {
  command(command: Command): Promise<unknown>;
  snapshot(): Snapshot;
  dispose(): void;
  tick(): void;
}

const MAX_EVENTS = 1000,
  MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const DISPATCH_AGE = 5000,
  COMPLETION_AGE = 15000,
  ANALYSIS_INTERVAL = 2000;
const observePrompt =
  "Describe what is visible now, including important changes, readable text, and uncertainty. Keep the observation under 2000 characters. Do not make trading decisions or perform actions.";
const probePrompt =
  "This is a synthetic image capability test. Describe the main geometric shapes and their colors, and transcribe the visible uppercase label. Do not guess if it is unreadable.";

export function createService(options: ServiceOptions = {}): Service {
  const clock = options.clock ?? {
    wall: Date.now,
    mono: () => performance.now(),
  };
  const factory = options.providerFactory ?? createProvider;
  const state = initialSnapshot();
  const frames = new Map<string, ReceivedFrame>();
  const seenFrames = new Map<string, string[]>();
  const motions = new Map<string, MotionState>();
  const observationAges = new Map<string, { mono: number; age: number }>();
  const eligibility = new Map<string, number>();
  const dispatched = new Map<string, string>();
  let planExpiresMono = 0;
  let provider: VisionProvider | undefined;
  let token: string | undefined;
  let disposed = false;
  let active: { job: Job; controller: AbortController } | undefined;
  let discovery: AbortController | undefined;
  let foreground: Job[] = [];
  let previousForeground = false;
  let nextSource = 0;
  let emission: ReturnType<typeof setTimeout> | undefined;
  let lastEmit = -Infinity;

  function source(id: string): Source {
    const result = state.sources.find((item) => item.id === id);
    if (!result) throw new Error("Unknown source");
    return result;
  }
  function imageReceipt(frame: Frame): ReceivedFrame {
    validateImage(frame);
    const age = clock.wall() - frame.capturedAt;
    if (age < -250 || age > DISPATCH_AGE)
      throw new Error("Frame is stale or has a future capture time");
    return {
      frame: structuredClone(frame),
      mono: clock.mono(),
      age: Math.max(0, age),
      epoch: state.epoch,
    };
  }
  function frameAge(receipt: ReceivedFrame): number {
    return receipt.age + Math.max(0, clock.mono() - receipt.mono);
  }
  function current(
    receipt: ReceivedFrame,
    limit: number,
    requireAnalysis = true,
  ): boolean {
    const item = state.sources.find(
      (item) => item.id === receipt.frame.sourceId,
    );
    return (
      receipt.epoch === state.epoch &&
      frameAge(receipt) <= limit &&
      !!item &&
      item.revision === receipt.frame.sourceRevision &&
      item.status === "live" &&
      (!requireAnalysis || item.analysisEnabled)
    );
  }
  function updateAges() {
    for (const observation of state.observations) {
      const age = observationAges.get(observation.id);
      observation.status =
        age && age.age + Math.max(0, clock.mono() - age.mono) <= COMPLETION_AGE
          ? "current"
          : "stale";
    }
    if (
      state.pendingPlan &&
      (clock.mono() >= planExpiresMono ||
        clock.wall() >= state.pendingPlan.expiresAt ||
        !state.sources.some(
          (item) =>
            item.id === state.pendingPlan?.sourceId &&
            item.revision === state.pendingPlan?.sourceRevision &&
            item.status === "live" &&
            item.analysisEnabled,
        ))
    )
      state.pendingPlan = undefined;
  }
  function snapshot(): Snapshot {
    updateAges();
    state.busy = !!active;
    state.queueSize =
      foreground.length +
      Array.from(frames.values()).filter(
        (frame) =>
          state.session === "monitoring" &&
          current(frame, DISPATCH_AGE) &&
          frame.frame.id !== dispatched.get(frame.frame.sourceId) &&
          clock.mono() >= (eligibility.get(frame.frame.sourceId) ?? 0),
      ).length;
    return structuredClone(state);
  }
  function emit(force = false) {
    if (disposed || !options.onState) return;
    const send = () => {
      emission = undefined;
      lastEmit = clock.mono();
      options.onState?.(snapshot());
    };
    if (force || clock.mono() - lastEmit >= 100) {
      if (emission) clearTimeout(emission);
      send();
    } else if (!emission) {
      emission = setTimeout(send, 100);
      emission.unref?.();
    }
  }
  function trimHistory() {
    state.events = state.events.slice(-MAX_EVENTS);
    state.observations = state.observations.slice(-100);
    state.chat = state.chat.slice(-100);
    while (
      Buffer.byteLength(
        JSON.stringify({
          events: state.events,
          observations: state.observations,
          chat: state.chat,
        }),
      ) > MAX_HISTORY_BYTES
    ) {
      if (state.events.length) state.events.shift();
      else if (state.observations.length) state.observations.shift();
      else if (state.chat.length) state.chat.shift();
      else break;
    }
    const ids = new Set(state.observations.map((item) => item.id));
    for (const id of observationAges.keys())
      if (!ids.has(id)) observationAges.delete(id);
  }
  function event(
    type: TimelineEvent["type"],
    message: string,
    sourceId?: string,
  ) {
    state.events.push({
      id: randomUUID(),
      type,
      message: message.slice(0, 500),
      occurredAt: clock.wall(),
      acknowledged: false,
      ...(sourceId ? { sourceId } : {}),
    });
    trimHistory();
  }
  function rejectQueued(predicate: (job: Job) => boolean, message: string) {
    foreground = foreground.filter((job) => {
      if (!predicate(job)) return true;
      job.reject(new Error(message));
      return false;
    });
  }
  function invalidate(message: string, clear = true) {
    state.epoch++;
    if (clear) frames.clear();
    state.pendingPlan = undefined;
    active?.controller.abort();
    rejectQueued(() => true, message);
    for (const item of state.observations) item.status = "stale";
    observationAges.clear();
    eligibility.clear();
    dispatched.clear();
    motions.clear();
    previousForeground = false;
  }
  function requireVerified() {
    if (!provider || state.binding.status !== "verified")
      throw new Error("Select and test a local vision model first");
  }
  function selectedFrames(ids: string[]): ReceivedFrame[] {
    return ids.map((id) => {
      const item = source(id);
      const receipt = frames.get(id);
      if (
        !item.analysisEnabled ||
        item.status !== "live" ||
        !receipt ||
        !current(receipt, DISPATCH_AGE)
      )
        throw new Error("Selected source needs a fresh analysis-enabled frame");
      return receipt;
    });
  }
  function enqueue(
    kind: Job["kind"],
    receipts: ReceivedFrame[],
    question: string,
  ): Promise<unknown> {
    if (foreground.length >= 4)
      throw new Error("Foreground request queue is full");
    return new Promise((resolve, reject) => {
      foreground.push({
        kind,
        frames: receipts,
        question,
        epoch: state.epoch,
        bindingRevision: state.binding.revision,
        resolve,
        reject,
      });
      pump();
      emit();
    });
  }
  function background(): Job | undefined {
    if (
      state.session !== "monitoring" ||
      !provider ||
      state.binding.status !== "verified" ||
      !state.sources.length
    )
      return;
    for (let count = 0; count < state.sources.length; count++) {
      const index = (nextSource + count) % state.sources.length;
      const item = state.sources[index];
      const receipt = frames.get(item.id);
      if (
        !receipt ||
        !current(receipt, DISPATCH_AGE) ||
        receipt.frame.id === dispatched.get(item.id) ||
        clock.mono() < (eligibility.get(item.id) ?? 0)
      )
        continue;
      nextSource = (index + 1) % state.sources.length;
      eligibility.set(item.id, clock.mono() + ANALYSIS_INTERVAL);
      // Retain the latest receipt for explicit questions, but observe it only once in the background.
      dispatched.set(item.id, receipt.frame.id);
      return {
        kind: "observe",
        frames: [receipt],
        question: observePrompt,
        epoch: state.epoch,
        bindingRevision: state.binding.revision,
        resolve: () => {},
        reject: () => {},
      };
    }
  }
  function jobCurrent(job: Job, limit: number): boolean {
    return (
      !disposed &&
      job.epoch === state.epoch &&
      job.bindingRevision === state.binding.revision &&
      (job.kind === "probe"
        ? job.frames.every((frame) => frameAge(frame) <= limit)
        : job.frames.every((frame) => current(frame, limit)))
    );
  }
  function pump() {
    if (disposed || active || !provider) return;
    let job: Job | undefined;
    // At most one foreground job ahead of an eligible background turn.
    if (previousForeground) job = background();
    if (!job && foreground.length) job = foreground.shift();
    if (!job) job = background();
    if (!job) return;
    if (!jobCurrent(job, DISPATCH_AGE)) {
      job.reject(new Error("Queued evidence became stale or was revoked"));
      queueMicrotask(pump);
      return;
    }
    previousForeground = job.kind !== "observe";
    const controller = new AbortController();
    const run = { job, controller };
    active = run;
    const selectedProvider = provider;
    const binding = { ...state.binding };
    const started = clock.mono();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20_000);
    deadline.unref?.();
    emit(true);
    void selectedProvider
      .analyze(
        {
          modelId: binding.modelId,
          frames: job.frames.map((item) => item.frame),
          question: job.question,
          mode: job.kind === "observe" ? "observe" : job.kind,
        },
        controller.signal,
      )
      .then((text) => {
        if (controller.signal.aborted || !jobCurrent(job!, COMPLETION_AGE))
          throw new Error("Completed evidence became stale or was revoked");
        if (job!.kind === "probe") {
          if (
            !/\bred\b/i.test(text) ||
            !/\bblue\b/i.test(text) ||
            !/42/.test(text)
          )
            throw new Error(
              "Vision challenge was not recognized; inspect the synthetic probe response and retry",
            );
          state.binding.status = "verified";
          state.binding.verifiedAt = clock.wall();
          state.binding.error = undefined;
          event(
            "system",
            `Synthetic local vision probe passed. Resume monitoring explicitly. Response: ${text.slice(0, 400)}`,
          );
          job!.resolve(snapshot());
        } else if (job!.kind === "plan") {
          const steps = parsePlan(text);
          const receipt = job!.frames[0];
          const plan: AutomationPlan = {
            id: randomUUID(),
            sourceId: receipt.frame.sourceId,
            sourceRevision: receipt.frame.sourceRevision,
            capturedAt: receipt.frame.capturedAt,
            createdAt: clock.wall(),
            expiresAt: clock.wall() + 30_000,
            goal: job!.question,
            modelId: binding.modelId,
            steps,
          };
          state.pendingPlan = plan;
          planExpiresMono = clock.mono() + 30_000;
          event(
            "system",
            "Automation proposal ready for native review. No actions were performed.",
            plan.sourceId,
          );
          job!.resolve(structuredClone(plan));
        } else {
          const observation: Observation = {
            id: randomUUID(),
            sourceIds: job!.frames.map((item) => item.frame.sourceId),
            sourceNames: job!.frames.map(
              (item) => source(item.frame.sourceId).name,
            ),
            capturedAt: Math.min(
              ...job!.frames.map((item) => item.frame.capturedAt),
            ),
            completedAt: clock.wall(),
            modelId: binding.modelId,
            provider: binding.provider,
            summary: text.slice(0, 2000),
            status: "current",
            durationMs: Math.round(clock.mono() - started),
          };
          state.observations.push(observation);
          observationAges.set(observation.id, {
            mono: clock.mono(),
            age: Math.max(...job!.frames.map(frameAge)),
          });
          if (job!.kind === "chat")
            state.chat.push({
              id: randomUUID(),
              role: "assistant",
              text: text.slice(0, 8000),
              at: clock.wall(),
              sourceIds: observation.sourceIds,
              observation,
            });
          event(
            "observation",
            observation.summary,
            observation.sourceIds.length === 1
              ? observation.sourceIds[0]
              : undefined,
          );
          trimHistory();
          job!.resolve(structuredClone(observation));
        }
        state.lastError = undefined;
      })
      .catch((error) => {
        const message = timedOut
          ? "Provider request timed out"
          : safeError(error);
        // Old responses may reject their caller, but must never restore state/history after revocation.
        if (
          (!controller.signal.aborted || timedOut) &&
          job!.epoch === state.epoch &&
          job!.bindingRevision === state.binding.revision &&
          !disposed
        ) {
          state.lastError = message;
          if (job!.kind === "probe") {
            state.binding.status = "failed";
            state.binding.error = message;
          }
          event("error", message);
        }
        job!.reject(new Error(message));
      })
      .finally(() => {
        clearTimeout(deadline);
        if (active === run) active = undefined;
        emit(true);
        pump();
      });
  }
  function safeError(error: unknown): string {
    if (!(error instanceof Error)) return "Operation failed";
    const message = error.message;
    // Parser details can contain untrusted model output; never surface them to snapshots/logs.
    if (message.startsWith("[") || message.includes('"expected"'))
      return "Model returned an invalid typed automation plan";
    const allowed = [
      "Provider ",
      "Selected image batch ",
      "Completed evidence ",
      "Vision challenge ",
      "Model must ",
      "Automation plan ",
    ];
    return allowed.some((prefix) => message.startsWith(prefix))
      ? message.slice(0, 300)
      : "Model operation failed; check local provider and selected model";
  }
  function motion(item: Source, value: number, capturedAt: number) {
    if (
      state.session !== "monitoring" ||
      !item.motionEnabled ||
      item.status !== "live"
    )
      return;
    const age = clock.wall() - capturedAt;
    if (age < -250 || age > 1000)
      throw new Error("Motion sample is stale or has a future capture time");
    const metric = motions.get(item.id) ?? initialMotion();
    motions.set(item.id, metric);
    if (updateMotion(metric, value, capturedAt, clock.mono()))
      event(
        "motion",
        "Visual change detected (two qualifying samples).",
        item.id,
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
      case "source.add": {
        if (state.sources.length >= MAX_SOURCES)
          throw new Error("Maximum four sources");
        if (state.sources.some((item) => item.id === command.source.id))
          throw new Error("Source already exists");
        state.sources.push({
          ...command.source,
          revision: 1,
          status: "stopped",
          analysisEnabled: true,
          motionEnabled: false,
          masks: [],
        });
        event(
          "system",
          "Source added. Capture requires an explicit live start.",
          command.source.id,
        );
        break;
      }
      case "source.update": {
        const item = source(command.sourceId);
        if (state.session === "stopped" && command.patch.status === "live")
          state.session = "idle";
        const changed = Object.entries(command.patch).some(
          ([key, value]) =>
            JSON.stringify(item[key as keyof Source]) !== JSON.stringify(value),
        );
        if (changed) {
          item.revision++;
          Object.assign(item, command.patch);
          frames.delete(item.id);
          motions.delete(item.id);
          eligibility.delete(item.id);
          dispatched.delete(item.id);
          seenFrames.delete(item.id);
          if (state.pendingPlan?.sourceId === item.id)
            state.pendingPlan = undefined;
          if (
            active?.job.frames.some((frame) => frame.frame.sourceId === item.id)
          )
            active.controller.abort();
          rejectQueued(
            (job) =>
              job.frames.some((frame) => frame.frame.sourceId === item.id),
            "Source was changed or revoked",
          );
          for (const observation of state.observations.filter((item) =>
            item.sourceIds.includes(command.sourceId),
          ))
            observationAges.delete(observation.id);
        }
        break;
      }
      case "source.remove": {
        const item = source(command.sourceId);
        item.revision++;
        frames.delete(item.id);
        motions.delete(item.id);
        eligibility.delete(item.id);
        dispatched.delete(item.id);
        seenFrames.delete(item.id);
        if (
          active?.job.frames.some((frame) => frame.frame.sourceId === item.id)
        )
          active.controller.abort();
        rejectQueued(
          (job) => job.frames.some((frame) => frame.frame.sourceId === item.id),
          "Source was removed",
        );
        if (state.pendingPlan?.sourceId === item.id)
          state.pendingPlan = undefined;
        for (const observation of state.observations.filter((item) =>
          item.sourceIds.includes(command.sourceId),
        ))
          observationAges.delete(observation.id);
        state.sources = state.sources.filter(
          (item) => item.id !== command.sourceId,
        );
        break;
      }
      case "source.frame": {
        if (state.session === "stopped") throw new Error("Session is stopped");
        const item = source(command.frame.sourceId);
        if (
          item.status !== "live" ||
          item.revision !== command.frame.sourceRevision
        )
          throw new Error("Source is not live or revision changed");
        const seen = seenFrames.get(item.id) ?? [];
        if (seen.includes(command.frame.id)) throw new Error("Duplicate frame");
        const receipt = imageReceipt(command.frame);
        const latest = frames.get(item.id);
        if (latest && command.frame.capturedAt <= latest.frame.capturedAt)
          throw new Error("Frame capture order changed");
        seen.push(command.frame.id);
        seenFrames.set(item.id, seen.slice(-64));
        frames.set(item.id, receipt);
        item.lastFrameAt = command.frame.capturedAt;
        if (command.frame.motion !== undefined)
          motion(item, command.frame.motion, command.frame.capturedAt);
        pump();
        emit();
        return { accepted: true };
      }
      case "source.motion": {
        const item = source(command.sourceId);
        if (item.revision !== command.sourceRevision || item.status !== "live")
          throw new Error("Source is not live or revision changed");
        motion(item, command.value, command.capturedAt);
        emit();
        return { accepted: true };
      }
      case "provider.discover": {
        const endpoint = localEndpoint(command.endpoint);
        if (command.token && /[\r\n]/.test(command.token))
          throw new Error("Invalid provider credential");
        state.session = "paused";
        invalidate("Provider changed");
        discovery?.abort();
        discovery = new AbortController();
        const controller = discovery;
        const deadline = setTimeout(() => controller.abort(), 20_000);
        deadline.unref?.();
        token = command.token;
        provider = factory({ provider: command.provider, endpoint, token });
        state.binding = {
          provider: command.provider,
          endpoint,
          modelId: "",
          revision: state.binding.revision + 1,
          status: "unconfigured",
        };
        state.models = [];
        const revision = state.binding.revision;
        emit(true);
        try {
          const models = await provider.discover(controller.signal);
          if (
            disposed ||
            controller.signal.aborted ||
            state.binding.revision !== revision
          )
            throw new Error("Provider discovery cancelled");
          state.models = models;
          state.lastError = undefined;
          event(
            "system",
            `Discovered ${models.length} local models. Select and test one.`,
          );
          return snapshot();
        } catch (error) {
          if (
            !controller.signal.aborted &&
            state.binding.revision === revision &&
            !disposed
          ) {
            state.lastError = safeError(error);
            event("error", state.lastError);
          }
          throw new Error(safeError(error));
        } finally {
          clearTimeout(deadline);
          if (discovery === controller) discovery = undefined;
          emit(true);
        }
      }
      case "provider.select": {
        const model = state.models.find(
          (model) => model.id === command.modelId,
        );
        if (!provider || !model) throw new Error("Choose a discovered model");
        if (model.vision === "unsupported")
          throw new Error("Selected model does not declare image support");
        state.session = "paused";
        invalidate("Model changed");
        state.binding = {
          ...state.binding,
          modelId: model.id,
          revision: state.binding.revision + 1,
          status: "selected",
          verifiedAt: undefined,
          error: undefined,
        };
        event(
          "system",
          "Model selected. Test the synthetic image, then resume explicitly.",
        );
        break;
      }
      case "provider.probe": {
        if (
          !provider ||
          !state.binding.modelId ||
          !["selected", "failed", "verified"].includes(state.binding.status)
        )
          throw new Error("Select a model before testing");
        const receipt = imageReceipt(command.frame);
        state.session = "paused";
        invalidate("Vision probe started");
        receipt.epoch = state.epoch;
        state.binding.status = "probing";
        state.binding.error = undefined;
        return enqueue("probe", [receipt], probePrompt);
      }
      case "monitor.start": {
        if (
          !state.sources.some(
            (item) =>
              item.status === "live" &&
              (item.motionEnabled || item.analysisEnabled),
          )
        )
          throw new Error(
            "Start a source and enable an analysis or motion watch",
          );
        if (
          state.sources.some(
            (item) => item.status === "live" && item.analysisEnabled,
          )
        )
          requireVerified();
        state.session = "monitoring";
        state.lastError = undefined;
        event(
          "system",
          "Monitoring resumed. Preview and AI analysis are separate.",
        );
        pump();
        break;
      }
      case "monitor.pause": {
        state.session = "paused";
        invalidate("Monitoring paused");
        event("system", "Monitoring paused; live preview may continue.");
        break;
      }
      case "session.stop": {
        state.session = "stopped";
        invalidate("Session stopped");
        discovery?.abort();
        for (const item of state.sources) {
          item.status = "stopped";
          item.revision++;
          item.lastFrameAt = undefined;
        }
        event(
          "system",
          "Stopped: no new analysis or automation dispatch. Capture teardown is owned by the desktop.",
        );
        emit(true);
        return snapshot();
      }
      case "conversation.ask": {
        requireVerified();
        if (state.session === "stopped") throw new Error("Session is stopped");
        const receipts = selectedFrames(command.sourceIds);
        if (
          Math.max(...receipts.map((item) => item.frame.capturedAt)) -
            Math.min(...receipts.map((item) => item.frame.capturedAt)) >
          5000
        )
          throw new Error("Selected sources exceed evidence time skew");
        state.chat.push({
          id: randomUUID(),
          role: "user",
          text: command.text,
          at: clock.wall(),
          sourceIds: command.sourceIds,
        });
        trimHistory();
        return enqueue("chat", receipts, command.text);
      }
      case "conversation.cancel": {
        rejectQueued((job) => job.kind === "chat", "Conversation cancelled");
        if (active?.job.kind === "chat") active.controller.abort();
        break;
      }
      case "automation.plan": {
        requireVerified();
        if (state.session === "stopped") throw new Error("Session is stopped");
        const item = source(command.sourceId);
        if (
          item.kind !== "monitor" &&
          item.kind !== "window" &&
          item.kind !== "demo"
        )
          throw new Error(
            "Automation needs a selected desktop or synthetic demo source",
          );
        const receipts = selectedFrames([item.id]);
        state.pendingPlan = undefined;
        rejectQueued(
          (job) => job.kind === "plan",
          "Automation proposal was superseded",
        );
        if (active?.job.kind === "plan") active.controller.abort();
        return enqueue("plan", receipts, command.goal);
      }
      case "automation.cancel": {
        state.pendingPlan = undefined;
        rejectQueued(
          (job) => job.kind === "plan",
          "Automation planning cancelled",
        );
        if (active?.job.kind === "plan") active.controller.abort();
        break;
      }
      case "events.ack": {
        const item = state.events.find((item) => item.id === command.eventId);
        if (!item) throw new Error("Unknown event");
        item.acknowledged = true;
        break;
      }
      case "history.clear": {
        // Prevent an already running reply from repopulating content that was explicitly cleared.
        invalidate("History cleared");
        state.events = [];
        state.observations = [];
        state.chat = [];
        state.lastError = undefined;
        break;
      }
    }
    emit(true);
    return snapshot();
  }
  function tick() {
    if (!disposed) {
      const old = state.observations.map((item) => item.status).join();
      const hadPlan = !!state.pendingPlan;
      updateAges();
      if (
        old !== state.observations.map((item) => item.status).join() ||
        hadPlan !== !!state.pendingPlan
      )
        emit();
      pump();
    }
  }
  const interval =
    options.autoTick === false ? undefined : setInterval(tick, 250);
  interval?.unref?.();
  return {
    command,
    snapshot,
    tick,
    dispose() {
      if (disposed) return;
      invalidate("Service disposed");
      discovery?.abort();
      disposed = true;
      token = undefined;
      provider = undefined;
      frames.clear();
      seenFrames.clear();
      motions.clear();
      observationAges.clear();
      state.chat = [];
      state.events = [];
      state.observations = [];
      state.pendingPlan = undefined;
      if (interval) clearInterval(interval);
      if (emission) clearTimeout(emission);
    },
  };
}
