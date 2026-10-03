# Local video workflows — v0.3

Owner authorization: integrate NVIDIA VSS, subsequently clarified that there is no VSS server and the desired route is porting skills/pipelines onto the existing computer. This PC has Intel graphics; Ollama is running with local vision models. Implement portable workflows using OpenAware's existing masked capture and local providers. Do not deploy NVIDIA GPU services, add RTSP/recording dependencies, copy upstream binaries/models, or claim an NVIDIA VSS deployment.

## Accepted boundary

Continuous selected-source previews remain unchanged. Background reasoning can consume up to three chronological masked frames per source spanning at most four seconds, with the latest input within five seconds at dispatch. One-shot questions and Operator input authority remain separate. Captions retain source/model/revision identity and capture interval. Search is caption-text search over bounded session memory; summaries are explicitly historical. These are sampled local pipelines, not native continuous-video understanding. No raw recordings, remote models, cloud fallback, trading or new computer-action privileges.

Background captions and historical summaries have 60-second deadlines. Chat, synthetic probes and Operator have 20-second deadlines; current chat/Operator evidence must complete within 15 seconds of capture. Delayed background captions can remain historical up to 65 seconds of newest-frame age. Semantic evidence older than 15 seconds is unknown and cannot alert. No VSS server or copied NVIDIA implementation is included.

## Slice 1 — runtime and contracts

Owner: agent_use_requirements (default role). Files: packages/contracts/src/index.ts, apps/service/engine.ts, new packages/core/src/video-workflows.ts if useful, tests/video-workflows.test.ts and tests/runtime.test.ts. Preserve existing workers' edits.

- Snapshot gains a pipeline state with temporalEnabled default true and semantic rules, plus optional asynchronous historySummary. Observation gains optional captureStartAt/frameCount/rule evidence; new alert events are observational.
- Commands: pipeline.configure {temporalEnabled}; rule.add {name,condition,sourceIds}; rule.update {ruleId,patch:{name?,condition?,sourceIds?,enabled?}}; rule.remove {ruleId}; history.search {query,sourceIds?,from?,to?,limit?}; history.summarize {sourceIds?,from?,to?,question?}. Validated bounds: max eight rules, condition 512/name 80 characters, one-to-four unique registered sources, search query 512 characters/limit 50, summary question 500 characters and up to 25 selected caption records.
- Temporal buffers retain at most three masked frames/source, include their memory in accounting, clear on revocation, and never weaken current-question/Operator freshness. Keep the provider four-image/request-byte limits.
- Semantic rule output is strictly validated JSON keyed by exact rule id/revision. Ambiguous/malformed/stale results are unknown, not alerts. Require two distinct qualifying observations and a 30-second cooldown; resets on rule/source/model/mask/pause/stop changes. Old inference cannot evaluate new rule definitions.
- Caption search uses deterministic text ranking and source/time filters. Summary is an asynchronous bounded text-only provider job using the existing single-inference scheduling/cancellation. Shared admission selects the newest contiguous suffix of complete captions fitting 25 records and 32,000 serialized characters; no caption is truncated. It returns source/time/observation evidence and is never current visual evidence. All history stays within current memory caps.
- Root owns provider summarize implementation with optional VisionProvider.summarize({modelId,question,captions},signal), where captions include id/source names/time interval/summary; use a shared exported TextSummaryInput contract in packages/providers/src/index.ts. No raw images in historical summary requests.

Verify scoped units: temporal ordering/bounds/stall/revision; two-frame rule stability/cooldown/unknown; search filters/limits; summary queue/cancellation/history clear; alerts never authorize actions. Exit: strict contracts and runtime tests pass, typed handoff lists remaining gates.

## Slice 2 — workspace presentation

Owner: lower_feed_ui (worker). Files: apps/desktop/renderer/App.tsx, styles.css; relevant tests/ui.spec.ts and visual.spec.ts. Contracts depend on slice 1; do not change runtime/contracts/provider/main files.

- Populate the existing lower extra pane as Video memory with a compact search field, source/time scope, chronological caption rows and historical summary action/result. Preserve default monitor fitting and extra-row behavior; avoid nested cards and redundant descriptions.
- Add compact semantic rule management and temporal monitoring setting within Connections (or compact inline menu), with source selection and clear rule states. Retain local model selection and explicit Start watching; no new backend required.
- Show actual analyzed window/age and alert events without claiming every preview frame is understood. Reuse assistant and event log; no Computer actions pane.
- Verify source continuity/layout and all four pages. No real camera/screen data in saved artifacts.

## Slice 3 — provider, CLI and skill facade

Owner: root. Files: packages/providers/src/index.ts, new apps/desktop/main/local-api.ts, apps/desktop/main/index.ts, new apps/cli/index.ts, scripts/build.mjs, new skills/openaware-video-workflows/SKILL.md and documentation/tests.

- Add bounded text-only summarization for LM Studio/Ollama; keep local endpoints, route metadata checks, tool-call rejection, request/response bounds, cancellation and secret redaction. Avoid calling /api/show for models already declared remote during discovery; a remote model cannot block discovery of local choices or be selected as a fallback.
- CLI enabled explicitly by --enable-cli. Main binds 127.0.0.1 on an ephemeral port and writes a private userData connection descriptor with random bearer token. Reject Origin, incorrect Host, missing/wrong auth, oversized bodies and unsupported commands; cap concurrency and request time. Reserve two parsing slots above eight ordinary calls for Stop admission. No CORS, source/frame injection, model selection, provider changes, automation, native input or shell routes. Stop uses immediate main-process capture teardown. Scope changes revoke pending action authority. Malformed connection/response JSON produces generic errors without echoing private content.
- Bundle dist/cli.cjs. Command groups: status, sources, watch start/pause/stop, ask, captions search/summary, rules list/add/update/remove. JSON output supports agent use; never print token or private endpoint data. Skills use these exact commands and existing capture/model grants.
- Original implementation remains MIT. Document VSS inspiration and separate NVIDIA deployment boundary; no upstream code/models/assets are bundled.

Verify provider/API/CLI units and an actual local control roundtrip. Perform a synthetic local Ollama vision/summary acceptance check without unloading another app's model. Package 0.3.0, inspect generated UI and real app, and run meaningful full checks once final code is frozen. Public source/release claims require actual GitHub evidence. Earlier v0.2.4 layout fixes are included in this source line; no separate v0.2.4 GitHub release is claimed.

## Completion evidence

The [v0.3 implementation ledger](../logs/implementation-v0.3.md) records the completed source review, strict TypeScript, 147 passing unit/integration tests, production build and locally inspected unsigned Windows package. The bundled CLI and portable skill are present; the skill installer script copies only instructions and the CLI, never a token descriptor. All 10 final packaged desktop workflows and four manual page inspections pass. Public source/tag, Windows/Ubuntu release-commit CI and uploaded installer/checksum evidence are recorded in that ledger.

The current local model correctly recognized synthetic single-image content in about 18–20 seconds. Three-image temporal inference and a historical summary each reached 60 seconds. These results establish limited synthetic recognition and measured latency, not useful continuous monitoring or alert accuracy. Public source/tag, Windows/Ubuntu release-commit CI and uploaded installer/checksum digests are verified. Personal monitor/camera capture, mixed DPI, native effects, Bionic and sustained performance retain their separate acceptance gates.
