import { z } from "zod";

export const MAX_SOURCES = 4;
export const MAX_FRAME_BYTES = 1_048_576;
export type ProviderKind = "lmstudio" | "ollama";
export type SourceKind =
  "demo" | "camera" | "virtual_camera" | "monitor" | "window";
export type SessionStatus = "idle" | "monitoring" | "paused" | "stopped";
export interface Mask {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  deviceId: string;
  revision: number;
  status: "live" | "stopped" | "unavailable";
  analysisEnabled: boolean;
  motionEnabled: boolean;
  masks: Mask[];
  lastFrameAt?: number;
  width?: number;
  height?: number;
  fps?: number;
  error?: string;
}
export interface ModelDescriptor {
  id: string;
  name: string;
  vision: "declared" | "unknown" | "unsupported";
  loaded: boolean;
}
export interface Binding {
  provider: ProviderKind;
  endpoint: string;
  modelId: string;
  revision: number;
  status: "unconfigured" | "selected" | "probing" | "verified" | "failed";
  verifiedAt?: number;
  error?: string;
}
export interface Frame {
  id: string;
  sourceId: string;
  sourceRevision: number;
  capturedAt: number;
  width: number;
  height: number;
  dataUrl: string;
  motion?: number;
}
export interface Observation {
  id: string;
  sourceIds: string[];
  sourceNames: string[];
  capturedAt: number;
  completedAt: number;
  modelId: string;
  provider: ProviderKind;
  summary: string;
  status: "current" | "stale";
  durationMs: number;
}
export interface TimelineEvent {
  id: string;
  type: "motion" | "observation" | "system" | "error" | "action";
  sourceId?: string;
  occurredAt: number;
  message: string;
  acknowledged: boolean;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  sourceIds: string[];
  observation?: Observation;
}
export interface AutomationStep {
  type: "click" | "type" | "key";
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  description: string;
}
export interface AutomationPlan {
  id: string;
  sourceId: string;
  sourceRevision: number;
  capturedAt: number;
  createdAt: number;
  expiresAt: number;
  goal: string;
  modelId: string;
  steps: AutomationStep[];
}
export interface ActionResult {
  step: number;
  status: "succeeded" | "cancelled" | "failed" | "unknown";
  message: string;
}
export interface Snapshot {
  version: string;
  session: SessionStatus;
  epoch: number;
  sources: Source[];
  binding: Binding;
  models: ModelDescriptor[];
  observations: Observation[];
  events: TimelineEvent[];
  chat: ChatMessage[];
  busy: boolean;
  queueSize: number;
  lastError?: string;
  pendingPlan?: AutomationPlan;
}
export interface CaptureChoice {
  id: string;
  name: string;
  kind: "monitor" | "window";
  thumbnail: string;
  displayId: string;
}

const mask = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((m) => m.x + m.width <= 1 && m.y + m.height <= 1);
const id = z.string().uuid();
const sourceIds = z
  .array(id)
  .min(1)
  .max(MAX_SOURCES)
  .refine((ids) => new Set(ids).size === ids.length);
const frame = z
  .object({
    id,
    sourceId: id,
    sourceRevision: z.number().int().positive(),
    capturedAt: z.number().finite().positive(),
    width: z.number().int().min(1).max(1024),
    height: z.number().int().min(1).max(1024),
    dataUrl: z
      .string()
      .max(1_398_200)
      .regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/),
    motion: z.number().min(0).max(1).optional(),
  })
  .strict();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state.get") }).strict(),
  z
    .object({
      type: z.literal("source.add"),
      source: z
        .object({
          id,
          name: z.string().trim().min(1).max(80),
          kind: z.enum([
            "demo",
            "camera",
            "virtual_camera",
            "monitor",
            "window",
          ]),
          deviceId: z.string().max(512),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("source.update"),
      sourceId: id,
      patch: z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          status: z.enum(["live", "stopped", "unavailable"]).optional(),
          analysisEnabled: z.boolean().optional(),
          motionEnabled: z.boolean().optional(),
          masks: z.array(mask).max(8).optional(),
          error: z.string().max(300).optional(),
          width: z.number().int().positive().max(16384).optional(),
          height: z.number().int().positive().max(16384).optional(),
          fps: z.number().min(0).max(240).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("source.remove"), sourceId: id }).strict(),
  z.object({ type: z.literal("source.frame"), frame }).strict(),
  z
    .object({
      type: z.literal("source.motion"),
      sourceId: id,
      sourceRevision: z.number().int().positive(),
      capturedAt: z.number().finite().positive(),
      value: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.discover"),
      provider: z.enum(["lmstudio", "ollama"]),
      endpoint: z.string().max(256),
      token: z.string().max(4096).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.select"),
      modelId: z.string().min(1).max(256),
    })
    .strict(),
  z.object({ type: z.literal("provider.probe"), frame }).strict(),
  z.object({ type: z.literal("monitor.start") }).strict(),
  z.object({ type: z.literal("monitor.pause") }).strict(),
  z.object({ type: z.literal("session.stop") }).strict(),
  z
    .object({
      type: z.literal("conversation.ask"),
      text: z.string().trim().min(1).max(4000),
      sourceIds,
    })
    .strict(),
  z.object({ type: z.literal("conversation.cancel") }).strict(),
  z
    .object({
      type: z.literal("automation.plan"),
      goal: z.string().trim().min(1).max(2000),
      sourceId: id,
    })
    .strict(),
  z.object({ type: z.literal("automation.cancel") }).strict(),
  z.object({ type: z.literal("events.ack"), eventId: id }).strict(),
  z.object({ type: z.literal("history.clear") }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export interface DesktopState {
  backgroundMode: boolean;
  windowVisible: boolean;
  trayAvailable: boolean;
  launchMode: "window" | "background";
}
export interface OpenAwareBridge {
  invoke<T = Snapshot>(command: Command): Promise<T>;
  onState(callback: (state: Snapshot) => void): () => void;
  listDesktopSources(): Promise<CaptureChoice[]>;
  selectDesktopSource(id: string): Promise<void>;
  executePlan(planId: string): Promise<ActionResult[]>;
  stopAll(): Promise<void>;
  getDesktopState(): Promise<DesktopState>;
  setBackgroundMode(enabled: boolean): Promise<DesktopState>;
  onDesktopState(callback: (state: DesktopState) => void): () => void;
  quit(): Promise<void>;
}
export const initialSnapshot = (): Snapshot => ({
  version: "0.2.0",
  session: "idle",
  epoch: 1,
  sources: [],
  binding: {
    provider: "lmstudio",
    endpoint: "http://127.0.0.1:1234",
    modelId: "",
    revision: 1,
    status: "unconfigured",
  },
  models: [],
  observations: [],
  events: [],
  chat: [],
  busy: false,
  queueSize: 0,
});
