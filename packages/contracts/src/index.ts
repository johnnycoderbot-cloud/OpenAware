import { z } from "zod";
import packageMetadata from "../../../package.json" with { type: "json" };

export const MAX_SOURCES = 16;
export const MAX_AGENT_SOURCES = 4;
export const MAX_AGENTS = 4;
export const DEFAULT_AGENT_ID = "00000000-0000-4000-8000-000000000001";
export const MAX_FRAME_BYTES = 1_048_576;
export const MAX_SEMANTIC_RULES = 8;
export type ProviderKind = "lmstudio" | "ollama" | "llamacpp";
export type SourceKind =
  | "demo"
  | "camera"
  | "virtual_camera"
  | "monitor"
  | "window"
  | "video_file"
  | "video_url"
  | "web_video";
export type AgentRole = "observer" | "operator";
export interface AgentProvenance {
  agentId?: string;
  agentRevision?: number;
}
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
export interface Observation extends AgentProvenance {
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
  captureStartAt?: number;
  frameCount?: number;
  sourceRevisions?: number[];
  bindingRevision?: number;
  epoch?: number;
  ruleEvidence?: RuleEvidence[];
}
export interface RuleEvidence {
  ruleId: string;
  ruleRevision: number;
  verdict: "match" | "no_match" | "unknown";
  evidence: string;
}
export interface SemanticRule {
  id: string;
  name: string;
  condition: string;
  sourceIds: string[];
  enabled: boolean;
  revision: number;
  status: "unknown" | "clear" | "pending" | "active";
  lastEvaluatedAt?: number;
  lastTriggeredAt?: number;
  cooldownUntil?: number;
}
export interface PipelineState {
  temporalEnabled: boolean;
  rules: SemanticRule[];
}
export interface CaptionSearchResult {
  query: string;
  matches: { observation: Observation; score: number }[];
}
export interface HistorySummary extends AgentProvenance {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  question: string;
  requestedAt: number;
  completedAt?: number;
  summary?: string;
  error?: string;
  observationIds: string[];
  sourceIds: string[];
  sourceNames: string[];
  captureStartAt: number;
  capturedAt: number;
  modelId: string;
  provider: ProviderKind;
  bindingRevision: number;
  epoch: number;
}
export interface TimelineEvent extends AgentProvenance {
  id: string;
  type: "motion" | "observation" | "alert" | "system" | "error" | "action";
  sourceId?: string;
  occurredAt: number;
  message: string;
  acknowledged: boolean;
  ruleId?: string;
  ruleRevision?: number;
  observationId?: string;
}
export interface ChatMessage extends AgentProvenance {
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
export interface AutomationPlan extends AgentProvenance {
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
  agents: AgentSnapshot[];
  activeAgentId: string;
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
  pipeline: PipelineState;
  historySummary?: HistorySummary;
}
export type AgentSnapshot = Omit<
  Snapshot,
  "version" | "sources" | "agents" | "activeAgentId"
> & {
  id: string;
  name: string;
  role: AgentRole;
  revision: number;
  sourceIds: string[];
};
export interface VideoSourceSelection {
  kind: "video_file" | "video_url" | "web_video";
  deviceId: string;
  name: string;
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
  .max(MAX_AGENT_SOURCES)
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
      type: z.literal("agent.add"),
      name: z.string().trim().min(1).max(80),
      role: z.enum(["observer", "operator"]),
    })
    .strict(),
  z.object({ type: z.literal("agent.select"), agentId: id }).strict(),
  z.object({ type: z.literal("agent.remove"), agentId: id }).strict(),
  z
    .object({
      type: z.literal("agent.update"),
      agentId: id,
      patch: z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          role: z.enum(["observer", "operator"]).optional(),
          sourceIds: z
            .array(id)
            .max(MAX_AGENT_SOURCES)
            .refine((ids) => new Set(ids).size === ids.length)
            .optional(),
        })
        .strict()
        .refine((patch) => Object.keys(patch).length > 0),
    })
    .strict(),
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
            "video_file",
            "video_url",
            "web_video",
          ]),
          deviceId: z.string().max(512),
        })
        .strict()
        .refine(
          (source) =>
            !["video_file", "video_url", "web_video"].includes(source.kind) ||
            /^video:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              source.deviceId,
            ),
        ),
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
      agentId: id.optional(),
      provider: z.enum(["lmstudio", "ollama", "llamacpp"]),
      endpoint: z.string().max(256),
      token: z.string().max(4096).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.select"),
      agentId: id.optional(),
      modelId: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.probe"),
      agentId: id.optional(),
      frame,
    })
    .strict(),
  z
    .object({ type: z.literal("monitor.start"), agentId: id.optional() })
    .strict(),
  z
    .object({ type: z.literal("monitor.pause"), agentId: id.optional() })
    .strict(),
  z.object({ type: z.literal("session.stop") }).strict(),
  z
    .object({
      type: z.literal("conversation.ask"),
      agentId: id.optional(),
      text: z.string().trim().min(1).max(4000),
      sourceIds,
    })
    .strict(),
  z
    .object({ type: z.literal("conversation.cancel"), agentId: id.optional() })
    .strict(),
  z
    .object({
      type: z.literal("automation.plan"),
      agentId: id.optional(),
      goal: z.string().trim().min(1).max(2000),
      sourceId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("automation.cancel"),
      agentId: id.optional(),
      planId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("events.ack"),
      agentId: id.optional(),
      eventId: id,
    })
    .strict(),
  z
    .object({ type: z.literal("history.clear"), agentId: id.optional() })
    .strict(),
  z
    .object({
      type: z.literal("pipeline.configure"),
      agentId: id.optional(),
      temporalEnabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rule.add"),
      agentId: id.optional(),
      name: z.string().trim().min(1).max(80),
      condition: z.string().trim().min(1).max(512),
      sourceIds,
    })
    .strict(),
  z
    .object({
      type: z.literal("rule.update"),
      agentId: id.optional(),
      ruleId: id,
      patch: z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          condition: z.string().trim().min(1).max(512).optional(),
          sourceIds: sourceIds.optional(),
          enabled: z.boolean().optional(),
        })
        .strict()
        .refine((patch) => Object.keys(patch).length > 0),
    })
    .strict(),
  z
    .object({
      type: z.literal("rule.remove"),
      agentId: id.optional(),
      ruleId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("history.search"),
      agentId: id.optional(),
      query: z.string().trim().min(1).max(512),
      sourceIds: sourceIds.optional(),
      from: z.number().finite().nonnegative().optional(),
      to: z.number().finite().nonnegative().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict()
    .refine(
      (scope) =>
        scope.from === undefined ||
        scope.to === undefined ||
        scope.from <= scope.to,
    ),
  z
    .object({
      type: z.literal("history.summarize"),
      agentId: id.optional(),
      sourceIds: sourceIds.optional(),
      from: z.number().finite().nonnegative().optional(),
      to: z.number().finite().nonnegative().optional(),
      question: z.string().trim().min(1).max(500).optional(),
    })
    .strict()
    .refine(
      (scope) =>
        scope.from === undefined ||
        scope.to === undefined ||
        scope.from <= scope.to,
    ),
]);
export type Command = z.infer<typeof commandSchema>;
export interface DesktopState {
  backgroundMode: boolean;
  windowVisible: boolean;
  trayAvailable: boolean;
  launchMode: "window" | "background";
}
export interface DesktopCaptureFrame {
  sourceId: string;
  captureId: string;
  deviceId: string;
  dataUrl: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
  capturedAt: number;
  sequence: number;
  fps?: number;
}
export interface DesktopCaptureError {
  sourceId: string;
  captureId: string;
  message: string;
}
export interface OpenAwareBridge {
  invoke<T = Snapshot>(command: Command): Promise<T>;
  onState(callback: (state: Snapshot) => void): () => void;
  listDesktopSources(): Promise<CaptureChoice[]>;
  chooseVideoFile(): Promise<VideoSourceSelection | undefined>;
  prepareVideoUrl(
    url: string,
    mode: "direct" | "page",
  ): Promise<VideoSourceSelection>;
  openVideoSource(sourceId: string): Promise<void>;
  selectDesktopSource(id: string): Promise<void>;
  startDesktopCapture(sourceId: string, captureId: string): Promise<void>;
  stopDesktopCapture(sourceId: string, captureId: string): Promise<void>;
  onDesktopFrame(callback: (frame: DesktopCaptureFrame) => void): () => void;
  onDesktopError(callback: (error: DesktopCaptureError) => void): () => void;
  executePlan(planId: string): Promise<ActionResult[]>;
  stopAll(): Promise<void>;
  getDesktopState(): Promise<DesktopState>;
  setBackgroundMode(enabled: boolean): Promise<DesktopState>;
  onDesktopState(callback: (state: DesktopState) => void): () => void;
  quit(): Promise<void>;
}
export const initialSnapshot = (): Snapshot => {
  const state: Snapshot = {
    agents: [],
    activeAgentId: DEFAULT_AGENT_ID,
    version: packageMetadata.version,
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
    pipeline: { temporalEnabled: true, rules: [] },
    busy: false,
    queueSize: 0,
  };
  const {
    version: _version,
    sources: _sources,
    agents: _agents,
    activeAgentId: _activeAgentId,
    ...aliases
  } = state;
  state.agents = [
    {
      ...aliases,
      id: DEFAULT_AGENT_ID,
      name: "Agent 1",
      role: "operator",
      revision: 1,
      sourceIds: [],
    },
  ];
  return state;
};
