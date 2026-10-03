import { z } from "zod";
import { parseUnambiguousJson } from "./json.js";
import type {
  CaptionSearchResult,
  Observation,
  RuleEvidence,
  SemanticRule,
} from "../../contracts/src/index.js";

export const TEMPORAL_FRAME_LIMIT = 3;
export const TEMPORAL_SPAN_MS = 4000;
export const RULE_COOLDOWN_MS = 30_000;

export function temporalWindow<
  T extends {
    frame: {
      id: string;
      sourceId: string;
      sourceRevision: number;
      capturedAt: number;
    };
    epoch: number;
  },
>(previous: T[], latest: T): T[] {
  return [
    ...previous.filter(
      (item) =>
        item.epoch === latest.epoch &&
        item.frame.sourceId === latest.frame.sourceId &&
        item.frame.sourceRevision === latest.frame.sourceRevision &&
        item.frame.id !== latest.frame.id &&
        item.frame.capturedAt < latest.frame.capturedAt &&
        latest.frame.capturedAt - item.frame.capturedAt <= TEMPORAL_SPAN_MS,
    ),
    latest,
  ].slice(-TEMPORAL_FRAME_LIMIT);
}

const semanticOutput = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    rules: z
      .array(
        z
          .object({
            ruleId: z.string().uuid(),
            ruleRevision: z.number().int().positive(),
            verdict: z.enum(["match", "no_match", "unknown"]),
            evidence: z.string().trim().min(1).max(512),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export function parseSemanticObservation(
  text: string,
  rules: Pick<SemanticRule, "id" | "revision">[],
): { summary: string; evidence: RuleEvidence[] } {
  const unknown = () => ({
    summary:
      "Semantic observation unavailable: the model returned ambiguous or invalid evidence.",
    evidence: rules.map((rule): RuleEvidence => ({
      ruleId: rule.id,
      ruleRevision: rule.revision,
      verdict: "unknown",
      evidence: "No valid evidence for this rule revision.",
    })),
  });
  if (text.length > 16_384) return unknown();
  let value: unknown;
  try {
    value = parseUnambiguousJson(text);
  } catch {
    return unknown();
  }
  const parsed = semanticOutput.safeParse(value);
  if (!parsed.success) return unknown();
  const evidence = parsed.data.rules;
  if (
    evidence.length !== rules.length ||
    new Set(evidence.map((item) => item.ruleId)).size !== evidence.length ||
    evidence.some(
      (item) =>
        !rules.some(
          (rule) =>
            rule.id === item.ruleId && rule.revision === item.ruleRevision,
        ),
    )
  )
    return unknown();
  return { summary: parsed.data.summary, evidence };
}

export interface SemanticState {
  qualifying: number;
  clearing: number;
  active: boolean;
  cooldownUntil: number;
  lastObservationId?: string;
  lastInputKey?: string;
  lastQualifyingAt?: number;
  lastEvaluatedAt?: number;
}
export const initialSemanticState = (): SemanticState => ({
  qualifying: 0,
  clearing: 0,
  active: false,
  cooldownUntil: 0,
});
export function evaluateSemantic(
  state: SemanticState,
  verdict: RuleEvidence["verdict"],
  observationId: string,
  inputKey: string,
  monotonic: number,
): { alert: boolean; status: SemanticRule["status"] } {
  if (
    state.lastObservationId === observationId ||
    state.lastInputKey === inputKey
  )
    return {
      alert: false,
      status: state.active
        ? "active"
        : state.qualifying
          ? "pending"
          : "unknown",
    };
  if (
    state.lastEvaluatedAt !== undefined &&
    monotonic - state.lastEvaluatedAt > 15_000
  ) {
    state.qualifying = 0;
    state.clearing = 0;
  }
  state.lastObservationId = observationId;
  state.lastInputKey = inputKey;
  state.lastEvaluatedAt = monotonic;
  if (verdict === "unknown") {
    state.qualifying = 0;
    state.clearing = 0;
    state.lastQualifyingAt = undefined;
    return { alert: false, status: "unknown" };
  }
  if (verdict === "no_match") {
    state.qualifying = 0;
    state.lastQualifyingAt = undefined;
    state.clearing = Math.min(2, state.clearing + 1);
    if (state.active && state.clearing >= 2 && monotonic >= state.cooldownUntil)
      state.active = false;
    return {
      alert: false,
      status: state.active && state.clearing < 2 ? "active" : "clear",
    };
  }
  state.clearing = 0;
  if (
    state.lastQualifyingAt === undefined ||
    monotonic - state.lastQualifyingAt >= 2000
  ) {
    state.qualifying = Math.min(2, state.qualifying + 1);
    state.lastQualifyingAt = monotonic;
  }
  if (
    !state.active &&
    state.qualifying >= 2 &&
    monotonic >= state.cooldownUntil
  ) {
    state.active = true;
    state.cooldownUntil = monotonic + RULE_COOLDOWN_MS;
    state.qualifying = 0;
    return { alert: true, status: "active" };
  }
  return { alert: false, status: state.active ? "active" : "pending" };
}

export interface HistoryScope {
  sourceIds?: string[];
  from?: number;
  to?: number;
}
export function filteredCaptions(
  observations: Observation[],
  scope: HistoryScope,
): Observation[] {
  return observations.filter(
    (item) =>
      (!scope.sourceIds ||
        item.sourceIds.every((id) => scope.sourceIds!.includes(id))) &&
      (scope.from === undefined || item.capturedAt >= scope.from) &&
      (scope.to === undefined ||
        (item.captureStartAt ?? item.capturedAt) <= scope.to),
  );
}
export function searchCaptions(
  observations: Observation[],
  query: string,
  scope: HistoryScope & { limit?: number } = {},
): CaptionSearchResult {
  const normalized = query.trim().toLocaleLowerCase("en-US");
  if (!normalized) return { query: "", matches: [] };
  const terms = [...new Set(normalized.split(/\s+/u).filter(Boolean))];
  const matches = filteredCaptions(observations, scope)
    .map((observation) => {
      const text = observation.summary.toLocaleLowerCase("en-US");
      const matched = terms.filter((term) => text.includes(term));
      return {
        observation,
        score: matched.length + (text.includes(normalized) ? 2 : 0),
      };
    })
    .filter((match) => match.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.observation.capturedAt - a.observation.capturedAt ||
        a.observation.id.localeCompare(b.observation.id),
    )
    .slice(0, Math.min(50, Math.max(1, scope.limit ?? 50)));
  return structuredClone({ query: query.trim(), matches });
}

/** Exact text-only evidence projection shared by admission and dispatch. */
export function summaryCaption(item: Observation) {
  return {
    id: item.id,
    sourceNames: item.sourceNames,
    capturedAt: item.capturedAt,
    captureStartAt: item.captureStartAt,
    summary: item.summary,
  };
}
/** Keep a contiguous newest suffix of complete captions within provider bounds. */
export function selectSummaryCaptions(
  observations: Observation[],
): Observation[] {
  const newest = [...observations]
    .sort(
      (a, b) =>
        a.capturedAt - b.capturedAt ||
        a.completedAt - b.completedAt ||
        a.id.localeCompare(b.id),
    )
    .slice(-25);
  const selected: Observation[] = [];
  for (const item of newest.reverse()) {
    const candidate = [item, ...selected];
    if (JSON.stringify(candidate.map(summaryCaption)).length > 32_000) break;
    selected.unshift(item);
  }
  return selected;
}
