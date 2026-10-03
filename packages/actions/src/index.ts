import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ActionResult,
  AutomationPlan,
  AutomationStep,
} from "../../contracts/src/index";

export const ALLOWED_KEYS = [
  "ENTER",
  "TAB",
  "ESC",
  "BACKSPACE",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "CTRL+A",
  "CTRL+C",
  "CTRL+V",
  "CTRL+Z",
] as const;
const click = z
  .object({
    type: z.literal("click"),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    description: z.string().min(1).max(300),
  })
  .strict();
const type = z
  .object({
    type: z.literal("type"),
    text: z
      .string()
      .min(1)
      .max(1000)
      .refine(
        (s) => !/[\u0000-\u001f\u007f-\u009f]/u.test(s),
        "Control characters are not allowed",
      ),
    description: z.string().min(1).max(300),
  })
  .strict();
const key = z
  .object({
    type: z.literal("key"),
    key: z.enum(ALLOWED_KEYS),
    description: z.string().min(1).max(300),
  })
  .strict();
export const automationPlanSchema = z
  .object({
    id: z.string().uuid(),
    agentId: z.string().uuid().optional(),
    agentRevision: z.number().int().positive().optional(),
    sourceId: z.string().uuid(),
    sourceRevision: z.number().int().positive(),
    capturedAt: z.number().finite().positive(),
    createdAt: z.number().finite().positive(),
    expiresAt: z.number().finite().positive(),
    goal: z.string().min(1).max(2000),
    modelId: z.string().min(1).max(256),
    steps: z
      .array(z.discriminatedUnion("type", [click, type, key]))
      .min(1)
      .max(8),
  })
  .strict()
  .refine(
    (p) => (p.agentId === undefined) === (p.agentRevision === undefined),
    "Agent identity and revision must be supplied together",
  )
  .refine(
    (p) =>
      p.expiresAt > p.createdAt &&
      p.expiresAt - p.createdAt <= 30_000 &&
      p.capturedAt <= p.createdAt,
    "Invalid plan lifetime",
  );

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  width: number;
  height: number;
}
export function normalizedPoint(
  step: AutomationStep,
  bounds: Rect,
  dipToPhysical: (point: Point) => Point,
): Point | undefined {
  if (step.type !== "click") return undefined;
  click.parse(step);
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 1 ||
    bounds.height < 1
  )
    throw new Error("Invalid display bounds");
  const point = dipToPhysical({
    x: bounds.x + Math.round(step.x! * (bounds.width - 1)),
    y: bounds.y + Math.round(step.y! * (bounds.height - 1)),
  });
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y))
    throw new Error("Invalid physical display point");
  return point;
}
export function planDigest(plan: AutomationPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(automationPlanSchema.parse(plan)))
    .digest("hex");
}

/** Fresh, native evidence. The UI and model cannot manufacture this object. */
export interface Inspection {
  acquiredAt: number;
  agentId?: string;
  agentRevision?: number;
  sourceId: string;
  sourceRevision: number;
  planDigest: string;
  modelId: string;
  epoch: number;
  displayId: string;
  geometry: string;
  contentDigest: string;
  targetWindow: string;
  targetTitle: string;
  point?: Point;
  bounds: Rect;
}
export interface ActionDependencies {
  now(): number;
  monotonicNow?(): number;
  /** Must reject masks, removed devices, stopped sessions, and changed authoritative plans. */
  inspect(
    plan: AutomationPlan,
    step: AutomationStep,
    signal: AbortSignal,
  ): Promise<Inspection>;
  approve(
    plan: AutomationPlan,
    step: AutomationStep,
    index: number,
    inspection: Inspection,
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Native runner must recheck target window and deadline immediately before SendInput. */
  effect(
    step: AutomationStep,
    inspection: Inspection,
    deadline: number,
    signal: AbortSignal,
  ): Promise<void>;
}
interface Grant {
  nonce: string;
  digest: string;
  index: number;
  generation: number;
  expiresAt: number;
  consumed: boolean;
}
export class ActionBroker {
  private generation = 0;
  private busy = false;
  private executed = new Set<string>();
  private controller?: AbortController;
  private monotonicDeadline = 0;
  constructor(private dependencies: ActionDependencies) {}
  revoke(): void {
    this.generation += 1;
    this.controller?.abort(new Error("Actions revoked by Stop"));
  }
  private async cancellable<T>(
    pending: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Actions revoked by Stop"),
        );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      return await Promise.race([pending, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  private assertLive(plan: AutomationPlan, generation: number): void {
    if (generation !== this.generation || this.controller?.signal.aborted)
      throw new Error("Actions revoked by Stop");
    if (
      this.dependencies.now() >= plan.expiresAt ||
      plan.createdAt > this.dependencies.now()
    )
      throw new Error("Plan expired; request a new plan");
    if (
      (this.dependencies.monotonicNow?.() ?? performance.now()) >=
      this.monotonicDeadline
    )
      throw new Error("Plan elapsed lifetime expired; request a new plan");
  }
  private consume(
    grant: Grant,
    digest: string,
    index: number,
    generation: number,
  ): void {
    if (
      grant.consumed ||
      grant.digest !== digest ||
      grant.index !== index ||
      grant.generation !== generation ||
      this.dependencies.now() >= grant.expiresAt
    )
      throw new Error("Approval expired or already used");
    grant.consumed = true;
  }
  async execute(input: AutomationPlan): Promise<ActionResult[]> {
    const plan = automationPlanSchema.parse(input) as AutomationPlan;
    if (this.busy) throw new Error("An action review is already in progress");
    if (this.executed.has(plan.id))
      throw new Error("Plan has already been reviewed; request a new plan");
    if (this.executed.size >= 1000)
      throw new Error(
        "Action review limit reached; restart OpenAware to clear the session",
      );
    const digest = planDigest(plan);
    const generation = this.generation;
    this.monotonicDeadline =
      (this.dependencies.monotonicNow?.() ?? performance.now()) +
      Math.min(30_000, plan.expiresAt - this.dependencies.now());
    this.executed.add(plan.id);
    this.busy = true;
    const controller = (this.controller = new AbortController());
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error("Plan elapsed lifetime expired; request a new plan"),
        ),
      Math.max(1, Math.min(30_000, plan.expiresAt - this.dependencies.now())),
    );
    const results: ActionResult[] = [];
    try {
      for (const [index, step] of plan.steps.entries()) {
        let effectStarted = false;
        try {
          this.assertLive(plan, generation);
          const before = await this.cancellable(
            this.dependencies.inspect(plan, step, this.controller.signal),
            controller.signal,
          );
          this.assertLive(plan, generation);
          if (
            before.sourceId !== plan.sourceId ||
            before.sourceRevision !== plan.sourceRevision ||
            before.planDigest !== digest ||
            before.agentId !== plan.agentId ||
            before.agentRevision !== plan.agentRevision ||
            before.modelId !== plan.modelId
          )
            throw new Error("Inspection authority changed");
          if (
            this.dependencies.now() - before.acquiredAt > 2000 ||
            before.acquiredAt > this.dependencies.now()
          )
            throw new Error("Inspection is stale");
          if (
            !(await this.cancellable(
              this.dependencies.approve(
                plan,
                step,
                index,
                before,
                this.controller.signal,
              ),
              controller.signal,
            ))
          ) {
            results.push({
              step: index,
              status: "cancelled",
              message: "Native review declined; remaining operations cancelled",
            });
            break;
          }
          this.assertLive(plan, generation);
          const grant: Grant = {
            nonce: randomUUID(),
            digest,
            index,
            generation,
            expiresAt: Math.min(plan.expiresAt, this.dependencies.now() + 2000),
            consumed: false,
          };
          const after = await this.cancellable(
            this.dependencies.inspect(plan, step, this.controller.signal),
            controller.signal,
          );
          this.assertLive(plan, generation);
          if (
            after.sourceId !== before.sourceId ||
            after.planDigest !== digest ||
            after.agentId !== before.agentId ||
            after.agentRevision !== before.agentRevision ||
            after.modelId !== before.modelId ||
            after.sourceRevision !== plan.sourceRevision ||
            after.sourceRevision !== before.sourceRevision ||
            after.epoch !== before.epoch ||
            after.displayId !== before.displayId ||
            after.geometry !== before.geometry ||
            after.contentDigest !== before.contentDigest ||
            after.targetWindow !== before.targetWindow ||
            after.targetTitle !== before.targetTitle
          )
            throw new Error("Target changed during review; request a new plan");
          if (
            this.dependencies.now() - after.acquiredAt > 2000 ||
            after.acquiredAt > this.dependencies.now()
          )
            throw new Error("Inspection is stale");
          this.consume(grant, digest, index, generation);
          effectStarted = true;
          await this.cancellable(
            this.dependencies.effect(
              step,
              after,
              Math.min(grant.expiresAt, after.acquiredAt + 2000),
              this.controller.signal,
            ),
            controller.signal,
          );
          results.push({
            step: index,
            status: "succeeded",
            message:
              "Approved operation sent to Windows; application outcome is not verified",
          });
        } catch (error) {
          results.push({
            step: index,
            status: effectStarted ? "unknown" : "failed",
            message: error instanceof Error ? error.message : "Action failed",
          });
          break;
        }
      }
      return results;
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
      this.busy = false;
    }
  }
}
