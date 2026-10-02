# OpenAware testing and release plan

Status: proposed, 2026-10-02. No application tests, capture benchmarks, live model calls, installation checks, or Bionic integration checks have run merely because this plan exists. Foundation-document validation and implementation verification are separate gates.

This plan implements the acceptance map in [roadmap](roadmap.md) and the [slice manifest](../.omx/plans/implementation-slices.json). [Contracts](contracts.md) define messages and states; [security and privacy](security-privacy.md) defines trust and consent; [integrations](integrations.md) separates documented capabilities from experiments.

## Test fixtures and data handling

Use synthetic desktop scenes with source-specific labels, changing clocks, colored regions, chart-like drawings, and known event markers. Use a generated local camera stream and prerecorded synthetic speech. Structured market tests use authored/replay ticks with controlled timestamps. Never upload real personal desktops, identifiable camera recordings, broker accounts, credentials, or private documents into CI or public issue evidence.

Fixture provenance and licensing live next to each fixture. Raw provider results are redacted before publishing. API keys and endpoint credentials are read only in opt-in local execution or a maintainer-reviewed secret-bearing job; fork pull requests never receive secrets or hardware-device access.

Deterministic CI verifies invariants rather than judging open-ended prose. Live-model checks measure whether a chosen model can consume a fixture and produce usable observations; they do not establish universal accuracy or imply it detects every real-world event.

## CI and manual evidence matrix

| Lane | Platform | Input/backend | Required gate | What it establishes |
| --- | --- | --- | --- | --- |
| Foundation documentation | Hosted Linux or Windows | Files only | Current foundation | JSON/schema validity, stable IDs/dependencies, Markdown relative links, MIT metadata, no unfinished placeholder or unsupported claim. |
| Type/unit/contract | Windows, Linux, macOS | Fake clock, synthetic fixtures, provider mocks | Every implementation PR | Schemas, source states, bounded queues, masks, freshness, provider failure parsing, rules, and storage logic. Platform-independent tests pass on all targets. |
| Electron build | Windows, Linux, macOS | No capture devices or provider secrets | Every implementation PR | Compile/package dry run appropriate to host; does not assert shipped macOS/Linux native capture support. |
| Browser/Electron interaction | Windows; Linux renderer where supported | Mock sources/model | Every relevant UI PR | Consent flows, controls, focus, typed conversation, timeline, cancellation, and honest statuses. |
| SQLite lifecycle | All unit targets | Temporary opt-in encrypted databases and fake time | Storage PRs | Migrations, retention, crash/transaction failure, restart without silent capture, bounded writes. |
| MCP protocol | All unit targets | Synthetic image/tool client | Bridge PRs | Tool schemas, authorization, image/text result shape, freshness, denied/unavailable cases, and transport cleanup. |
| Windows native capture | Opt-in local or controlled self-hosted Windows | Actual OBS/camera/monitor adapter | G1, G4m, G5 | Device negotiation, native geometry, session/lock behavior, disconnect, released handles, and observed preview rate. Never claimed by hosted mock jobs. |
| LM Studio live smoke | Opt-in local Windows | Selected model and synthetic image | G0/G2 and before a supported version change | Current endpoint/model support, output parsing, model switching, latency observations. No secrets/personal feeds needed by default. |
| Bionic live smoke | Opt-in local Windows | Synthetic source and local MCP bridge | G0/G3 if bridge ships; otherwise record defer | Real tool discovery, image-content handling or fallback, conversation selection observations, reconnect. |
| Optional cloud provider | Opt-in maintainer job/local run | Synthetic frame, approved API model | Adapter gate | Current API compatibility, bounded cost, error/refusal handling, and identity. Disabled in ordinary CI. |
| Accessibility | Automated Windows renderer + manual Windows | Synthetic sources | Core UI PRs and G5 | Automated rules plus keyboard, screen reader, zoom, focus, notifications, and reduced-motion evidence. |
| Resource/soak | Controlled Windows reference host | Four sources; mock and selected local model | G5 | Resource bound, fairness/freshness distributions, stop/release behavior, and documented hardware limits. |
| Installation/release | Clean Windows VM or machine | Built artifact, synthetic sources | G5 | Install/uninstall, startup, permissions, signature status, checksums/provenance, and stored-data behavior. |

Configure stable, supported Node/Electron/toolchain versions only after their current support and package compatibility are verified during implementation. Record exact versions in the lockfile, CI, benchmark, and integration evidence. No service startup or persistent background capture is needed to validate this planning repository.

## Acceptance evidence by phase

| Gate | Required evidence | Must fail or defer when |
| --- | --- | --- |
| G0 | Versioned LM Studio discovery/vision and Bionic discovery/image experiment; unsupported picker/embedding/push results recorded. | A capability is assumed from generic MCP/vision marketing or an unavailable private API. A standalone fallback must remain; unavailable Bionic is explicitly deferred and does not block the standalone alpha. |
| G1 | Source consent, camera/OBS preview, independent four-source states, failure isolation, immediate new-work block on stop, released media handles. | A stopped source restarts silently, one source blocks all previews, or the app cannot show permission/device failure. |
| G2 | Masks before all egress, provider/source permission enforcement, explicit model identity, queue invariants, stale flags, timeout/cancel/parse cases, local fixture vision check. | Unmasked frame leakage, starvation, unbounded queue, stale result labeled current, or old-model result delivery. |
| G3 | Retention/migration evidence, image/text MCP behavior, denied source errors, local alert replay/debounce, source-attributed conversation, Bionic-off fallback. | Observation tools can execute or enable capture, stale/unknown data fires fresh rules, or Bionic-specific unsupported behavior is required. |
| G4v/G4m/G4i/G4t | Independent voice/monitor/IP camera/trading evidence and documented transport/model/provider licenses. | Unsupported devices, secret logs, uncertain live voice mechanism, stale numeric data, or any live-order route in paper-only release. |
| G5 | Reference benchmark, core accessibility evidence, clean install/uninstall, secret/fixture/license/SBOM review, artifact identity and security maintenance plan. | Critical stop/privacy failures, unresolved blocking accessibility barriers, missing license redistribution rights, or misleading release claims. |

A deferred extension is a valid spike outcome only when the shipped user interface and release notes clearly expose its unavailability. A failed privacy or stop gate cannot be waived by declaring the feature experimental.

## Multi-source scheduling, resource, and freshness tests

The reference scenario is four active sources requesting 1280x720 at 15 fps for preview, eligibility every 2 seconds, one local inference in flight, and one newest pending frame per source. Display actual negotiated values. Dispatch rejects frames older than 5 seconds; completed semantic evidence becomes unknown/stale above 15 seconds from original capture/acquisition time, never response arrival. Keep capture/preview rate, analysis eligibility, inference throughput, and observation freshness as separate measurements.

| Scenario | Deterministic assertion | Native/reference measurement |
| --- | --- | --- |
| Four sources, slow model | At each dispatch, choose fairly among eligible sources; no continuous-change source starves the others. | Per-source analysis interval and wait-time distribution including median/p95/max. |
| Continuous foreground questions | At most one question turn precedes an eligible background-source turn; foreground takes the next free slot. | Question responsiveness and background observation age under mixed load. |
| Four sources, one high-change stream | Each source mailbox has at most one pending frame; superseded counts increase instead of queue length. | Memory and CPU plateau during 30-minute soak. |
| No visual changes | Heartbeat/freshness rules still run according to contract; inactivity is never mistaken for failure. | Compute saved by change detection; newest successful observation age. |
| One source disconnects | Others remain eligible; disconnected source receives an unavailable state and no fake current frame. | Preview continuity of surviving sources; reconnect behavior. |
| Stop during inference | New work is blocked synchronously by a session generation; late response cannot publish or alert. | Time from stop input to tracks/handles/socket/process release. |
| Permission/mask changed mid-request | Old-policy publication is rejected; new frame processing cannot bypass latest policy. | Confirm no unmasked sample enters logs, temp files, or bridge output. |
| Model A switched to B | A result is dropped after rebinding; UI identifies current B and interrupted inference. | Load/unload delay, memory peak, and change recovery. |
| Provider timeout/rate limit | Retries and queues have ceilings; unknown status replaces invented observation. | Network retry timing and continued preview responsiveness. |
| Suspend/resume/session lock | Locked/unavailable source state; no replay of obsolete frames as fresh; explicit restart policy applied. | Native capture behavior on available reference host. |
| DB/notification failure | Capture/preview remains responsive; failures and lost/delayed events are surfaced. | Write queue and notification-delivery delay under controlled failure. |

Proposed alpha acceptance targets require calibration in OA-017:

- Blocking new work/export on stop is immediate in the application contract. Proposed reference acceptance: UI acknowledgement and app-owned acquisition cessation within 1 second, owned resource teardown within 2 seconds. Measure each boundary separately; misses block the affected gate pending correction/defer, not hidden percentile averaging. A stopped watch may leave a shared source running for another authorized watch; global stop ends all app-owned acquisition.
- No frame mailbox exceeds one pending frame per source. One local inference remains the default even under overload.
- At most one analysis result for a source/session/model version becomes current; stale or late results never overwrite newer state.
- Publish per-source observation ages without a universal latency SLA. A freshness threshold is configured per rule/workflow; slow inference produces stale/unknown status.
- In a 30-minute four-source run, record app/service/decoder RSS, GPU utilization/memory where observable, CPU, active handles, queue size, dropped frames, provider latency, preview rate, analysis rate, event count, and total cloud cost if applicable.
- Establish a reference memory/CPU budget from measurements before release; do not invent a hardware-independent maximum. Compare beginning/middle/end windows and rerun unexplained upward growth.
- The reference host report records OS/build, capture adapter/device mix, negotiated resolution, CPU, GPU/VRAM class, RAM, model ID/quantization, LM Studio/Bionic versions, configuration, and unsupported cases. Redact machine names, private endpoint URLs, and unrelated personal paths.

A synthetic CI fairness test proves scheduler logic, not native 720p throughput or model speed. A native benchmark proves the documented host scenario, not every Windows configuration.

## Privacy and permission negative tests

1. Preview-only start causes zero provider requests and zero frame persistence.
2. A denied source, denied destination, expired session credential, or unapproved frame mask change cannot produce an outbound image.
3. MCP images and summaries, event thumbnails, inference, recording if later added, and exports share the policy gateway. Images and summaries require separate route/retention grants; strict-local sources reject unknown/nonlocal Bionic host routes. Aggregate image export size is capped at 4 MiB including base64/JSON, with allocation/decoding bounded before processing.
4. A camera URL with credentials cannot appear in logs, export, stack traces, or analytics.
5. Provider secrets stay outside the renderer, repository, issue evidence, crash reports, and installers.
6. Global stop invalidates pending frame exports, observations, chat frame requests, rule actions, and later action proposals.
7. Startup restores settings inactive; source capture and microphone do not resume silently.
8. Mock adapters verify no request reaches cloud when cloud consent is off. Destination changes require new consent.
9. Raw-frame/image retention is off by default. Observations/events/conversation are memory-only with a proposed 1,000-event/16 MiB cap; structural configuration persists separately. Opt-in encrypted local history uses a proposed seven-day/100 MiB cap and OS-protected key. Test quota, expiry, clear/delete/export, memory cleanup, and temporary-file handling with fake time; history consent never enables frame retention.
10. In the observation alpha, bridge/UI API schemas expose no arbitrary shell, clicking, keyboard, broker orders, or messaging route.
11. A model switch pauses dispatch, invalidates old results, probes the replacement, and requires explicit resume. Pause permits only an explicitly sent one-time question; it cannot silently resume background requests/rules.
12. LM Studio mock requests assert store:false on the evidenced API path; request flags do not establish an external server's retention behavior.
13. OBS composites remain one parent source; ROIs preserve source/frame/geometry lineage. Scene/crop/DPI changes invalidate masks/evidence. Group any/all/ordered replay uses maximum 5-second skew and unknown outcomes for missing/stale required members; repeated regions never count as independent evidence.
14. Motion fixtures prove sustained-motion hold behavior, noise suppression, source region/sensitivity, default 30-second cooldown, observed-clear rearming, disabled/deleted/paused suppression, and unavailable-feed unknown status.

Testing destructive permission boundaries happens only against a disposable synthetic test app/data set. Actual computer-action and broker-order tests belong to future gates.

## Trading-specific validation

A screenshot can support qualitative chart discussion. Numerical alerts depend on a structured market record with source, symbol, venue, currency/units, timestamp, session, and freshness status.

Replay tests include symbol ambiguity, venue mismatch, currency conversion assumptions, delayed/out-of-order ticks, duplicate ticks, missing prices, zero/negative/NaN values where invalid, decimal precision, split-adjusted vs raw values where supported, timezone/session boundaries, price gaps, provider disconnect, and stale data. Threshold evaluation records the exact input and rule version.

Paper proposals are conspicuously labeled in UI, notification, export, and ledger. Simulation assumptions (price source, spread/slippage/fees if modeled, fill timing, and unsupported market behavior) are explicit. No return/profit promise or model accuracy number is inferred from synthetic tests. The alpha has no live broker credentials or order endpoint.

## Later adapter, action, and broker gates

The [later backlog OA-019 to OA-026](roadmap.md#oa-019) is excluded from the initial work-unit budget. Each implementation estimate remains TBD after the prerequisite spike. Ordinary CI uses synthetic/mock data; provider calls, OS effects, and live accounts need separate controlled lanes.

| Slice | Conformance and negative coverage | External/native acceptance boundary |
| --- | --- | --- |
| OA-019 Ollama | Model discovery/probe, image request, stream/JSON normalization, timeout, cancel/late result, model unload, no cloud fallback. | Opt-in synthetic request to a selected local model; record server/model version and license. |
| OA-020 OpenRouter | Route/model identity, source consent, secret redaction, spend ceiling, 429/refusal/timeout, unauthorized destination and route change rejection. | Opt-in synthetic paid request after selected route/privacy/cost consent; no personal frames. |
| OA-021 OpenAI | Official image API fixture, chosen model identity, source/provider consent, refusal/error parsing, spend budget, context limits, late-result rejection. | Opt-in synthetic image check; do not infer realtime video or voice support from an image adapter. |
| OA-022 NVIDIA | Exact deployment/model capabilities, auth, local/cloud identity, unsupported modality, timeout, redaction, consent/budget, license/hardware gate. | Opt-in chosen deployment probe; no generic brand-level support claim. |
| OA-023 Grant broker | Explicit user approval only; forged model/MCP/feed approval denied; edited/stale/expired/wrong-target grant denied; approval latency, 30-second proposal expiry, <=2-second reinspection evidence, unchanged target/operation, effect categories and revocation audited. | Dry-run only. No actual OS or account effect exists in the proposal slice. |
| OA-024 Windows worker | Allowlisted action, target identity and fresh-state recheck, grant scope/expiry, focus/geometry change, duplicate dispatch, partial result, cooperative stop. | Disposable test app only until action-specific user grants; no arbitrary shell/messages/trading. |
| OA-025 Broker sandbox | Exact units/decimals, immutable reviewed order, environment isolation, duplicate client IDs, timeout/ambiguous acknowledgment, partial fills, reject/cancel races, position reconciliation. | Selected official sandbox/replay only; reject production endpoint and credentials. |
| OA-026 Live order | Default off, approved account/instrument/quantity/limits/expiry, stale-data rejection, replay/idempotency, uncertain-outcome reconciliation, stop/cancel distinctions, audited effects. | Starts with design and mock review. Real connectivity/order requires separate explicit authorization, domain/security/broker review, supported controlled acceptance, and a separate release approval. |

Broker API execution/reconciliation does not depend on the native Windows input worker; it depends on the scoped grant broker and verified broker sandbox lifecycle. It must never use visual clicks to bypass the explicit order contract.

The action worker cannot assume Stop reverses a completed click, message, command, or fill. Stop blocks new work and records the actual partial result; compensating actions require their own scope and grant. Live order cancellation/flattening is separately authorized and confirmed from broker state. A timeout never proves an order failed, and blind retry is prohibited.

No later adapter should broaden consent, recording, execution, model downloads, or budgets simply because its profile was saved. Add regression tests to the shared policy gateway, not separate vendor-specific bypasses.

## Accessibility and usable error states

Automated checks cover semantic labels, accessible names, basic contrast, duplicate IDs, and common ARIA misuse. They cannot replace manual testing.

Manual release evidence covers keyboard-only add/start/pause/stop source, model selection, privacy masks/settings, rule creation, event acknowledge/snooze, conversation, modal escape/focus return, and emergency stop. Test screen-reader descriptions for live/paused/stale/error status without continuously announcing every video frame. Alerts must be visible text as well as optional sound. Verify 200% zoom, scalable source grid, Windows high contrast where supported, color-independent status, reduced motion, and tab order.

Capture errors, model unavailable, rejected consent, stale observation, notification failure, and paper-only status have actionable plain-language copy. Stop remains reachable while another panel/dialog is open. Core workflow accessibility barriers block G5; any minor accepted gap is recorded with owner and next patch.

## Licenses, supply chain, and artifacts

OpenAware code and documentation use MIT. That does not relicense third-party packages, OBS, LM Studio/Bionic, external APIs, codecs, or model weights.

Before packaging, generate an SBOM and third-party notices from the actual dependency lockfile. Check direct/transitive licenses, native binaries, capture/codec modules, speech libraries/models, font/icons/fixture assets, and the right to redistribute every bundled component. Avoid bundling OBS, LM Studio/Bionic, or model weights by default; integrations use separately installed software. Include only fixtures whose provenance is recorded.

CI/release workflows pin third-party actions to reviewed immutable revisions, give minimal repository permissions, and keep signing/cloud credentials out of pull-request jobs. Verify dependency provenance where supported, check lockfile changes, and retain build metadata. Do not publish generated artifacts containing personal feeds, secrets, private endpoints, or development-machine paths.

## Release checklist

1. Select a version and shipped adapter/model compatibility matrix; include tested app/API versions and deferred gates.
2. Require all applicable G0-G5 acceptance evidence or explicit Bionic/extension defer outcomes; standalone alpha never requires an unavailable bridge and resolve blocking correctness, privacy, stop, and accessibility findings.
3. Build from a reviewed tagged commit and locked dependencies; preserve build logs, SBOM, notices, provenance, and SHA-256 checksums.
4. Review installer contents, permissions, data locations, source restart policy, telemetry defaults, and uninstall behavior.
5. Run a clean Windows installation using synthetic feeds; verify launch, explicit source consent, preview, model binding, stop, restart inactive, and uninstall.
6. Protect signing credentials in a maintainer-only environment. If a verified Windows signing identity is available, sign and timestamp the installer and validate its publisher/signature.
7. If signing is unavailable, publish only a clearly labeled unsigned experimental alpha. Document operating-system warnings accurately; do not claim a verified publisher or advise disabling protections.
8. Publish release notes with known limitations, achieved reference measurements, tested versions, supported transports, installation instructions, privacy controls, and rollback/data compatibility.
9. Verify published downloads against checksums/provenance and confirm links. Repository creation/push is a planning milestone, not completion of this release checklist.

## Updates, security patches, and support

The initial alpha uses manual versioned downloads unless an update channel separately passes validation. Automatic updates require artifact signature verification, authenticated metadata, integrity/provenance checks, downgrade/replay protection, interrupted download/install recovery, schema/data migration compatibility, and a documented rollback policy. Never silently install models, change cloud destinations, resume sources, or alter permissions during update.

Document a private vulnerability reporting route in SECURITY.md before a runnable release; enable the repository's private vulnerability reporting if available. Do not solicit private feeds/credentials in public issues. Publish supported versions and a maintainer contact/process with best-effort response expectations rather than an unsupported SLA.

Triage security reports by exploitable impact. Stop/privacy/credential leakage regressions freeze affected releases. Prepare a focused patch with synthetic regression evidence, update Electron/Node/native dependencies when needed, rebuild notices/SBOM/signatures/checksums, and publish advisories and upgrade guidance. Keep exploit details restricted until the coordinated fix is available where appropriate. If no maintainer can deliver safe updates, mark the affected release unsupported rather than implying ongoing support.

Compatibility changes in LM Studio/Bionic/providers rerun the opt-in synthetic smoke lane and update the matrix. Unsupported vendor versions should produce a visible error/fallback, never an invisible behavioral change.

## Review handoff template

Each implemented slice submits:

- Stable OA ID, commit/PR, owned files, and the exact supported deliverable.
- Acceptance criteria with pass/fail/defer outcomes and commands/manual steps.
- Redacted synthetic/native/live evidence with environment and versions.
- Measured limits and unsupported cases; no personal feeds or keys.
- Test gaps and remaining risks with an owner.
- Requested gate decision: approve, changes required, or defer with fallback.

The reviewer records one outcome and explains any remaining gap. A completed issue without verification evidence does not satisfy a phase exit.
