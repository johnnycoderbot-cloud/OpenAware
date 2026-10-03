# OpenAware contracts

Status: proposed v1 wire and domain contract, not an implemented API. JSON schemas will live in `packages/contracts`; domain types must be generated from, or verified against, those schemas. Related: [architecture](architecture.md), [security](security-privacy.md), [integrations](integrations.md), [roadmap](roadmap.md).

## Common envelope and invariants

All records carry `schemaVersion:1`, an opaque UUID `id`, and UTC ISO-8601 times. Scheduling uses a monotonic clock within one process epoch; wall-clock changes must not make stale frames fresh. Counters/revisions are unsigned increasing integers scoped to their record. IDs, device handles, and paths are never executable strings. Unknown enum values fail validation; additive optional fields are permitted across minor versions. Bounds are part of validation, not UI-only hints.

All observations reference exact source, source revision, capture epoch, frame ID, binding revision, and consent revision. A result is current only if all revisions still match and its age passes the live limit. Consent revocation increments revisions before cancellation; late work cannot restore a grant. Evidence is untrusted content. A source group is an organizational collection; group membership never broadens a member's cloud/action permissions.

| Record | Required fields and validation | Lifecycle/invariant |
|---|---|---|
| `Source` | `id,name,kind,adapterId,deviceRef,revision,captureEpoch,status,permissions,preview,analysis,maskRevision` | Kind: `camera`, `virtual_camera`, `monitor`, `window`, `ip_camera`, `roi`; name <=80 chars; opaque device ref; disabled on import/restart |
| `SourceGroup` | `id,name,memberSourceIds,revision` | Max 16 logical members initial cap; no duplicate IDs; references must resolve; group watches evaluate members independently |
| `Region` | `parentSourceId,parentRevision,normalizedRect,geometryRevision` | x/y/w/h in [0,1], positive dimensions, inside parent; inherit route restrictions; manual reconfirmation after layout change |
| `Frame` | `id,sourceId,sourceRevision,captureEpoch,consentRevision,capturedAt,receivedAt,width,height,format,maskRevision,payloadRef,expiresAt` | `expiresAt` is dispatch expiry (capture +5 s), not forced reclaim of a pinned buffer; <=1 MiB analysis encoded; worker decoded frame <=36 MiB; no raw file path |
| `Observation` | `id,frameRefs,bindingId,bindingRevision,createdAt,summary,evidence,status,trust` | `status`: `current`, `stale`, `rejected`, `unknown`; `trust:untrusted_observation`; summary <=2000 chars; evidence references sources and regions |
| `Rule` | `id,name,sourceIds,revision,kind,condition,enabled,cooldownMs,stability,state,routeGrantId` | `change`, `vision_condition`, `structured_data`; condition schema selected by kind; no arbitrary code; state `unknown/clear/pending/active` |
| `Event` | `id,revision,sequence,sessionEpoch,type,occurredAt,sourceIds,ruleId,severity,observationIds,status,dedupeKey` | Stable ID and per-session sequence; statuses `new/acknowledged/resolved/expired`; acknowledgement does not imply rule clear |
| `ModelBinding` | `id,providerId,endpointId,modelId,revision,capabilities,retentionStatus,status,budget` | Stable model ID; capability values `verified/declared/unknown/unsupported`; status `requested/probing/ready/activating/active/degraded/failed` |
| `ConsentGrant` | `id,subject,scope,purpose,revision,createdAt,expiresAt,revokedAt` | Scope identifies source, provider/endpoint, operation; no wildcard cloud grant default; native user approval provenance |
| `ActionProposal` | `id,revision,operation,target,sourceId,sourceRevision,frameId,frameCapturedAt,preconditions,effects,risk,status,expiresAt,digest` | Typed allowlisted operation; default expires 30 s; input-action frame <=2 s old at execution; proposal != permission |
| `ActionAuthorization` | `proposalId,proposalRevision,digest,nonceHash,sessionEpoch,grantRevision,approvedAt,expiresAt,consumedAt` | Native approval only; atomic single use; token bound to exact proposal, target, and session |
| `ActionResult` | `proposalId,startedAt,completedAt,status,effects,postcondition,correlationId` | `succeeded/failed/cancelled/partial/unknown`; never auto-retry partial or unknown side effects |

`Frame.payloadRef` points to a process-owned bounded buffer, not a URL accepted from the model. A frame can contain derivatives with exact crop/scale lineage. Preview payloads are separate transport objects and do not enter event JSON. Sanitized images may cross MCP only in a tool response after scope/freshness checks, with a bounded encoded image and MIME type; bridge compatibility is unverified until the prototype gate.

```json
{
  "schemaVersion": 1,
  "id": "f-opaque-example",
  "sourceId": "s-opaque-example",
  "sourceRevision": 4,
  "captureEpoch": 3,
  "consentRevision": 2,
  "capturedAt": "2026-10-02T16:00:00Z",
  "receivedAt": "2026-10-02T16:00:00.025Z",
  "width": 1024,
  "height": 576,
  "format": "image/jpeg",
  "maskRevision": 2,
  "payloadRef": "memory:opaque-buffer-id",
  "expiresAt": "2026-10-02T16:00:05Z"
}
```

The readable example IDs above abbreviate opaque IDs; production schemas require UUIDs. Timestamps are illustrative synthetic values. `expiresAt` prevents new dispatch after 5 s; a dispatched reference remains pinned until completion/cancellation or the 20 s request deadline, and a result older than 15 s is excluded from live evaluation. Reference release also respects any active serializer lease. The payload reference is valid only inside its originating service epoch and cannot be opened as a filesystem path.

## State transitions

| Entity | Allowed transitions | Side effects |
|---|---|---|
| Source | `discovered -> authorized -> starting -> live`; live to `paused/stale/unavailable/error/stopped`; paused to starting | Device identity, mask/geometry/consent changes increment revisions; reconnect increments capture epoch; stale is visibly age-based |
| Watch | `configured -> starting -> active -> degraded`; any running state to `paused/stopped`; failures to `error` | Active requires current source consent and verified required capabilities; restart does not resume automatically |
| Rule | `unknown -> clear/pending`; pending to active only after stability; active to clear after reset stability | Missing, ambiguous, or stale evidence moves evaluation to unknown; cannot clear an active event based on an unreadable frame |
| Binding | `requested -> probing -> ready -> activating -> active`; failures to failed/degraded | Handover cancels previous work; late responses excluded by binding revision |
| Proposal | `proposed -> awaiting_approval -> authorized -> executing -> succeeded/failed/partial/unknown`; pending to rejected/expired/cancelled | Editing target or operation changes digest and invalidates approval; every side-effect start records token consumption |

Vision-condition defaults: two qualifying observations at least 2 s apart to trigger, two clear observations to reset, 30 s cooldown from last trigger, and one active event per rule/source condition. Clear observations may arrive during cooldown; rearm only after cooldown elapsed and the latest fresh evidence remains clear. Stale or missing evidence cannot clear or rearm; a new trigger after rearm needs a new qualifying hold. Track `lastTriggeredAt` and `cooldownUntil` in rule evaluation state. Scheduling does not promise observations every 2 s. Deterministic motion consumes sanitized metrics independently of inference; structured rules define stable thresholds and market timestamps. Do not expose generated numerical confidence as accuracy; omit it until an independently calibrated method exists. `unknown` is first-class. Validate result/evidence against a strict schema and reject unsupported values.

Domain status and dashboard labels are separate: `Source.live` means capture is producing pixels, not successful inference. Display `observing` only when current analysis succeeds; `preview only` when capture is live but analysis is disabled/unsupported; `analysis delayed` when eligible jobs wait; `stale` when frame/result age fails the relevant limit; and explicit device/permission errors for unavailable states. A screen may show live video while its watch is `degraded`. Wire schemas use the enums above; UX labels do not add enum values silently.

## Provider port

```typescript
interface VisionProvider {
  discover(signal: AbortSignal): Promise<ModelDescriptor[]>;
  probe(binding: ModelBinding, syntheticInput: ProbeInput, signal: AbortSignal): Promise<CapabilityReport>;
  analyze(request: AnalysisRequest, signal: AbortSignal): Promise<AnalysisResult>;
  cancel(requestId: string): Promise<{ acknowledged: boolean }>;
}
```

`AnalysisRequest` includes request ID, session epoch, binding/consent revisions, <=4 fresh frame references, bounded question/rule context, output schema, deadline, and route budget reservation. Default background dispatch has one frame; explicit multi-source questions may batch up to four. Bundling cannot override per-source cloud grants. The adapter serializes sanitized pixels, sets vendor retention controls where supported, and never executes model tool calls. `AnalysisResult` records exact model, external request ID when available, usage/price availability, received time, parser status, and source/frame lineage.

Budget admission occurs before dispatch. Reserve conservative usage, reconcile actual reported usage afterward, and track unknown usage without treating it as zero. Disable new requests if the cap cannot be safely enforced. Text-only, unavailable model, payload overflow, and unknown image capability produce explicit errors. No provider change or model substitution occurs inside `analyze`.

## Proposed REST and desktop IPC

The service is private by default. The desktop uses a named, typed preload bridge to supervised IPC. An optional loopback REST bridge exposes the same use cases to local clients after pairing; it binds numeric loopback addresses only. Native Electron approval remains outside REST/MCP. No endpoint accepts arbitrary URLs, OS paths, scripts, or raw privileged IPC names.

| Use case | Proposed REST | Typed desktop IPC | Permission |
|---|---|---|---|
| Health/version | `GET /v1/health` | `health.get` | Paired read scope; unauthenticated transport probe reveals no source names |
| Sources/status | `GET /v1/sources`, `GET /v1/sources/:id` | `sources.list`, `sources.status` | Status scope; sanitized user-chosen labels; no device paths/window text |
| Candidate enumeration | No external route | `sources.discover` | Native user source picker; no implicit capture |
| Grant/revoke source | No external route | `sources.grant`, `sources.revoke` | Native user initiation; OS permission separately required |
| Latest sanitized evidence | `POST /v1/observations/latest` | `observations.latest` | Read image scope on named sources; <=4; freshness checked |
| Watch lifecycle | `POST /v1/watches`, `POST /v1/watches/:id/pause`, `POST /v1/watches/:id/stop` | `watches.create/pause/stop` | Named preset and already granted source/route scope |
| Events | `GET /v1/events?after=cursor&limit=50`, `POST /v1/events/:id/ack` | `events.list`, `events.ack` | Status-only view default; source-scoped summary export grant for content; limit <=100 |
| Bindings | `GET /v1/bindings` | `bindings.list` | Read scope; changing provider/model only through user settings |
| Conversation | `POST /v1/questions` | `conversation.ask` | Selected source read and route grant; deadline and request cap |
| Action proposal | `POST /v1/action-proposals` | `actions.propose` | Propose scope; approval must still occur in native UI |
| Approve/reject | No external route | `actions.review` | Sender-checked native user UI; cannot mint approval from model text |
| Stop all | `POST /v1/session/stop` | `session.stop` | Paired stop scope; physical tray/hotkey remains independent |

POST commands require `Idempotency-Key` and request ID; cache outcomes for 24 h or the current session's memory cap, except secrets. Persist only minimal content-free mutation/action digests and statuses needed for replay safety; do not persist question text or images by default. An identical key with a different command digest returns `CONFLICT`. If a prior outcome was evicted, return `IDEMPOTENCY_OUTCOME_EXPIRED` and require explicit reconciliation; never quietly rerun a potentially completed mutation. Commands also carry `expectedRevision` for existing records. Request body <=2 MiB; image responses <=4 MiB total serialized bytes, including base64 and JSON overhead. Four images individually below the 1 MiB compressed cap may still exceed that aggregate: preflight serialization, lower per-image size within an explicit quality bound, or reject the batch. Never truncate an image or silently omit a selected source. Asynchronous questions return a cancellable job ID; idle HTTP timeout is 30 s.

Responses use `{schemaVersion:1,requestId,data}` or `{schemaVersion:1,requestId,error:{code,message,retryable,details}}`. `details` contains safe field names, IDs, and expected/actual revisions, never pixels, keys, prompts, device URLs, or raw upstream bodies. Status: 400 validation, 401 unpaired, 403 scope denied, 404 unknown ID, 409 revision/idempotency conflict, 413 size, 422 capability, 429 budget/rate, 503 unavailable, 504 deadline. Transport-auth failures are distinct from a successful tool response containing a domain error.

| Error code | Required behavior |
|---|---|
| `VALIDATION_ERROR`, `UNSUPPORTED_VERSION` | Reject before allocation or adapter invocation |
| `UNAUTHENTICATED`, `PERMISSION_DENIED`, `CONSENT_REVOKED` | No capture, dispatch, or action; update relevant UI |
| `SOURCE_UNAVAILABLE`, `SOURCE_REVISION_CHANGED`, `FRAME_STALE` | Mark source/evidence state; acquire fresh evidence only within existing consent |
| `MODEL_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`, `CAPABILITY_UNKNOWN` | Keep preview; disable affected analysis until explicit resolution |
| `BUDGET_EXCEEDED`, `RATE_LIMITED`, `BUFFER_LIMIT` | Count drops, preserve fairness, show delay reason; never switch provider |
| `PROVIDER_TIMEOUT`, `CANCELLED`, `PROVIDER_ERROR` | Release local request references; record whether remote cancellation is acknowledged |
| `APPROVAL_REQUIRED`, `APPROVAL_EXPIRED`, `APPROVAL_REPLAYED`, `TARGET_CHANGED` | Do not execute; obtain a new proposal/evidence and native review |
| `IDEMPOTENCY_OUTCOME_EXPIRED`, `CURSOR_EXPIRED` | Return explicit gap/reconciliation requirement; do not infer safe mutation replay |
| `ACTION_OUTCOME_UNKNOWN` | Freeze retries and show inspection required; cancellation cannot establish rollback |

## MCP tools and Bionic bridge

The proposed tool names below are OpenAware's own API, not claims about built-in Bionic tools. Each client pairs to status-only scopes first; image and summary export are separate grants identifying the recipient's route/retention status. Strict local-only sources deny content export to an unverified host route. JSON schemas distinguish model-visible data from user instruction. Use tool error responses for domain failures and protocol errors for malformed calls. Native client image rendering must be tested. [MCP tool specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

| Tool | Inputs | Output and constraint |
|---|---|---|
| `openaware_list_sources` | optional group ID | Granted sources/status/revisions only; never enumerate undisclosed devices |
| `openaware_source_status` | source ID | Capture age, analysis interval, capabilities, delay/error reason |
| `openaware_observe_latest` | source IDs <=4, purpose, maxAgeMs <=5000 | Sanitized bounded image content plus frame lineage; read scope required |
| `openaware_start_watch` | preset ID, source IDs, expected source revisions | Watch ID; only configured rules/approved routes; cannot create consent |
| `openaware_pause_watch` | watch ID, expected revision | Analysis/rules paused; preview state reported separately |
| `openaware_stop_watch` | watch ID, expected revision | Watch stopped and queued work invalidated; source capture may serve other authorized watches |
| `openaware_list_events` | cursor, limit <=100 | Deduplicable event status and next cursor; source-scoped summary-export grant needed for text evidence; default no images |
| `openaware_ack_event` | event ID, expected revision | Acknowledgement metadata; no action or rule reset |
| `openaware_model_status` | optional binding ID | Explicit OpenAware binding/capabilities/retention; not Bionic picker state |
| `openaware_propose_action` | allowlisted operation, target, evidence refs | Proposal ID and `APPROVAL_REQUIRED`; unavailable before action release gate |
| `openaware_stop_all` | optional reason <=200 chars | New dispatch blocked; local/remote cancellation state |

For stdio integration, the host-spawned MCP process connects to the private service through owner-restricted IPC, not a bearer token in command-line arguments. Optional HTTP MCP requires pairing and transport-specific security validation. A skill teaches source names, freshness checks, event polling, and proposal workflow; it is not an authorization mechanism. Background event delivery starts with dashboard/tray notifications and client polling. Unsolicited conversational wakeups require a host-supported mechanism verified in the Bionic prototype.

## Event delivery and source groups

Desktop subscriptions use validated `source.status`, `preview.health`, `observation.created`, `watch.status`, `event.created/updated`, `binding.status`, `budget.status`, `action.status`, and `session.stopped` events. Envelope: `{schemaVersion,eventId,sequence,sessionEpoch,type,occurredAt,entityId,revision,payload}`. Delivery is at least once; consumers deduplicate by event ID and revision. Reconnect with a cursor; an expired cursor returns `CURSOR_EXPIRED` plus a snapshot token. Default content history is memory-only (1000 events or 16 MiB/session); optional saved summaries retain 7 days or 100 MiB. A snapshot names history gaps; opted-in metadata can rebuild event lists, never lost video.

Groups provide simultaneous visibility and per-source independent evaluation. A multi-source rule declares whether it needs `any`, `all`, or an ordered relation; it also declares a maximum evidence time skew (default 5 s). Missing or stale members make `all` unknown, not false. Events preserve each member's capture time. Exclude repeated regions of the same parent from independent-observation counts. Structured market data also identifies its provider, instrument, exchange timestamp, and freshness threshold.

## Action authorization and replay protection

An action is an immutable proposal with target identity, operation, expected geometry/DPI/window identity, source revision, fresh frame lineage, user goal, predicted effects, and expiry. A model cannot approve its own proposal. Native review displays exactly what will be sent, typed, clicked, or changed; credentials never appear in logs. Initial action support is a limited allowlist with no arbitrary shell and no live broker operation.

Immediately before executing, the broker verifies active session, enabled action capability, live user grant, exact proposal digest, unexpired single-use authorization, unchanged source/geometry/window, and <=2 s action evidence. If approval took too long or the target changed, require fresh evidence and a revised proposal instead of silently reinterpreting the user's approval. Atomically consume the nonce and record `executing` before invoking the worker. Replayed requests return the recorded result; they cannot start a second execution.

The action spike must test ordinary human approval latency. A candidate contract may separate immutable approved intent/target/operation from a fresh execution-time inspection record, allowing reinspection only when it proves the exact approved target, operation, parameters, and effects unchanged. This revision is not accepted automatically: define its digest/evidence linkage and review it before implementation. Until that gate passes, expired evidence blocks execution and requires a new proposal. Repeated approval loops are a failed usability gate, not a reason to bypass freshness or replay checks.

Abort is checked before every discrete step. Multi-step actions need an explicit step list and bounded effects; each high-impact step gets its own approval boundary. A worker crash after an input event yields `unknown` unless postcondition inspection proves a result. `stop` prevents future steps but cannot undo an already sent click, message, saved file, shell effect, or broker order. Rollback is a separately proposed operation when possible, never a promised property.

## Implemented prototype v0.4.0

The schemas above describe the target v1 design. The current private desktop command contract is implemented in `packages/contracts/src/index.ts`: a sixteen-source catalog, four agents and up to four distinct assigned source IDs per agent. `Snapshot.agents` exposes separate engine state; `activeAgentId` selects the legacy binding/models/chat/pipeline/history aliases. Agent management uses `agent.add`, `agent.update`, `agent.remove` and `agent.select`; scoped model/watch/conversation/history/rule commands accept an optional agentId pinned before asynchronous work.

Production observations, events, chats, plans and historical summaries carry agentId/agentRevision provenance. Source capture uses global revisions and opaque references; assignment/role/source/model changes and Stop invalidate relevant jobs before cancellation. The strict action-plan digest includes the paired agent identity/revision. Native review checks the active operator's assignment, pending plan, binding and source lineage; switching agents revokes a plan, and cleanup remains pinned to its originating agent.

Additional source kinds `video_file`, `video_url` and `web_video` carry `video:<uuid>` device references. Native file selection and explicit URL registration remain desktop-only methods; the service and local CLI cannot turn arbitrary paths/URLs into source grants. Direct/page video frames use the existing bounded DesktopCaptureFrame transport and masked analysis pipeline. The [current handoff](../.omx/logs/independent-agents-video.md) distinguishes tested fixture behavior from live platform/hardware compatibility.
