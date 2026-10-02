# Security and privacy design

Status: proposed controls and verification gates. This document does not certify an application that has not been implemented. Related: [architecture](architecture.md), [contracts](contracts.md), [integration evidence](integrations.md), [roadmap](roadmap.md).

## Assets and trust boundaries

Protect selected feed pixels, voices when added, provider credentials, camera connection secrets, conversation content, source identity, action authority, model/provider bindings, and permission/audit metadata. The actual computer is an authority boundary, not just another feed. A monitor or camera can show malicious instructions, private credentials, or a misleading scene even when its physical device is trusted.

The trusted decision boundary is native user consent plus the domain permission broker. Screens, OCR, camera scenes, model output, imported rules, remote provider responses, MCP clients, and external tool descriptions are untrusted inputs. A previously approved source does not make its content trustworthy. Pairing an MCP client grants a defined scope; it does not give the client native user approval authority.

| Threat | Entry point | Proposed control | Residual risk and verification |
|---|---|---|---|
| Visual prompt injection | Chart, webpage, email, sign in a camera scene | Mark observations tainted, separate user goal from evidence, provider tools disabled, action broker outside model | Model may repeat or believe malicious content; test scenes requesting credential exfiltration and clicks |
| Accidental secret transmission | Password manager, tokens, private documents | Source-specific crop/masks before inference and bridge image output; explicit cloud destination grant | New windows/layouts can expose secrets; geometry change invalidates masks/regions pending review |
| Renderer compromise | Model text, event labels, imports | Sandboxed renderer, safe text/Markdown, no active HTML, narrow validated IPC, no keys | Electron/dependency defects remain; test injected content and unauthorized IPC senders |
| Unauthorized local client | Webpage requests to loopback, another process | Private IPC default, pairing, scope checks, loopback-only binding, Host/Origin validation, no wildcard CORS | Malware as the same user may read secrets or memory; application cannot isolate a fully compromised host |
| Camera/decoder exploit | Malformed device/IP stream | Restricted worker, decoded size cap, deadline, bounded restart, patched dependencies | Native decoder flaws possible; fuzz boundaries and verify worker privileges |
| Credential theft | Settings, logs, crash dumps, Git repository | Windows-protected key storage, no renderer secrets, redacted logs, exclude dumps/recordings | Admin access and provider-side leakage remain; test exports and error responses |
| Action replay or stale targeting | Delayed approval, reconnect, repeated tool call | Digest, single-use nonce, expiry, source/geometry revisions, atomic execution audit | OS state can change between final check and input; limit operations and require result inspection |
| Covert cloud fallback | Local model failure or missing vision | Route grant intersects source/provider/purpose; fallback disabled | Provider may retain accepted frames; show independent retention status |
| Resource denial | Many feeds, giant frames, hung model, noisy event rules | Admission caps, latest slots, fair scheduler, request deadlines, cooldown/dedup, budget cutoff | Other apps can still contend for GPU; surface observed contention and degraded coverage |

Do not expose a model-generated executable program as an action. Free-form shell, credential entry, live broker orders, messaging, and privileged changes remain absent from the first observation release. Future integrations each need a typed operation set, target validation, purpose-specific consent, and a release gate. Trading observations can be mistaken; chart screenshots are not authenticated market or broker state.

## Permission model

Grants are separate for capture/preview, image analysis, cloud egress, MCP image/summary export, microphone/audio, event notifications, metadata retention, recording/export, action proposals, actual input actions, and future brokerage operations. Defaults are no capture until a source is selected, no cloud until a destination/purpose is approved, no audio until enabled, no recording, and no actions. Source selection cannot bypass Windows capture/device restrictions.

The renderer requests a grant through sender-checked native UI. The service receives a signed/local authenticated consent mutation and increments the grant revision in the same transaction that invalidates queued work. Show a persistent capture indicator and a distinct cloud indicator. Closing a settings panel does not stop approved monitoring; closing the app follows an explicit user preference, with the default to stop rather than silently continue in the tray.

Masking applies to every outbound route, including MCP image replies, provider requests, evidence exports, and thumbnails if configured private. A mask is fixed to validated geometry or a semantic selector proven by an adapter; it is not an assurance that an arbitrary moving secret will be detected. A user may choose an unmasked preview locally, with clear labeling; outbound derivatives remain masked. Changing crop, resolution, DPI, monitor identity, or layout invalidates affected mask/ROI revisions.

MCP tools can operate only on named already approved sources and watch presets. They cannot enumerate hidden devices, grant themselves cloud routes, select a new endpoint, create an approval token, or keep monitoring after revocation. Treat imported preset names/descriptions as text; reject unknown fields, arbitrary code, and broad grants.

Content delivered to Bionic or another MCP host may be routed to the host's selected local or cloud model and saved in its conversation history. OpenAware cannot revoke or delete those external copies or infer the route from a display name. Image and summary exports therefore need explicit recipient scope and retention/route disclosure. Deny content export for strict local-only sources when the host's route is unverified; status-only tools can still work. This applies to sensitive text summaries as well as image pixels.

## Storage and retention

| Data | Proposed default | Deletion/export rule |
|---|---|---|
| Raw camera/display frames and preview buffers | Memory only; bounded slots and in-flight references | Release on replacement, stop, timeout, process exit; no screenshot files or recording |
| Encoded provider/MCP images | Memory-only request buffers | Release after send/completion/cancellation; external recipient copies remain outside OpenAware |
| Observation text, conversation, rule evidence, event summaries | Memory only, 1000 events or 16 MiB/session; saved summaries opt-in | Opted-in SQLite values encrypted, max 7 days or 100 MiB; prune oldest and disclose history gaps |
| Configuration/source/device metadata | Minimum required persistent configuration, encrypted sensitive values | Delete source erases device reference/secrets; structural IDs/revisions may remain in minimal audit |
| Action/idempotency audit | Persistent minimal content-free IDs/digest/status/time; 7-day audit cap | No target text, prompts, typed secrets, or pixel data; extend explicitly for later broker requirements |
| API/camera credentials | OS-protected credential storage | Delete on disconnect; never included in backups, source exports, logs, screenshots, or command lines |
| Diagnostic logs | Safe IDs, timings, codes; bounded and pruned with metadata | No pixels/OCR/prompts/keys/raw upstream bodies; explicit redacted diagnostic export |

Sensitive database values use authenticated encryption (proposed AES-256-GCM with unique nonces) and an installation key wrapped by Windows DPAPI for the current user. Structural fields remain readable in SQLite; this is not full database encryption. File ACLs restrict access to the owning user. Encryption at rest does not protect against same-user malware, administrator access, a running process compromise, or cloud retention. A whole-database encryption dependency can be evaluated later with packaging/license review.

OpenAware's memory-only promise covers its own frame persistence. It cannot prevent the operating system from paging memory or collecting crash artifacts. Release builds disable pixel-bearing diagnostics and do not upload crash dumps by default. Perfect erasure of GPU/runtime copies is not promised. Document backup behavior and allow redacted metadata deletion without misrepresenting secure physical-disk erasure.

For LM Studio native chat, explicitly send `store:false` and verify server history/cache behavior during the integration spike. Local server log files, inference runtime caches, Bionic conversation history, and other MCP clients are separately owned. OpenRouter/OpenAI/NVIDIA or other cloud destinations have provider-specific retention; grants identify the exact endpoint and show `verified/configured/unknown` retention status without claiming a universal zero-retention policy. See [provider evidence](integrations.md).

## Endpoint and IPC security

Electron main launches the private service with owner-restricted IPC. Never put tokens in process arguments, model prompts, URLs, shell history, renderer storage, or a public settings export. The renderer communicates only through named preload methods; main validates its packaged origin, sender frame, schema, size, and required permission for every method. Arbitrary IPC forwarding is prohibited.

Optional REST/HTTP-MCP binds `127.0.0.1` (and separately validated `::1` if enabled), never `0.0.0.0`. Pairing requires a native confirmation and a random scoped client credential; credentials rotate/revoke and are protected at rest. Check authentication even on read endpoints carrying metadata. Reject unexpected Host/Origin, disallow wildcard CORS, enforce rate/body/connection limits, and use nonces/idempotency plus token binding for mutations. Pairing sessions are not approved merely because a request originated on localhost.

Cloud endpoints require HTTPS and an explicit allowlist entry. Local HTTP inference requires numeric loopback or a separately approved LAN endpoint with its own transport security warning and credential scope. No arbitrary URL fetch from a model or camera scene is allowed. IP camera adapters are deferred until URL validation, redirects, DNS rebinding, private-network access policy, decoder isolation, and credential handling are tested.

Model and provider responses are parsed through bounded schemas. Safe plain-text rendering is the default; links require user interaction and scheme validation. No returned HTML, JavaScript, shell command, Markdown image URL, or file link executes automatically. An observation mentioning a tool or endpoint cannot invoke it.

## Stop, cancel, and recovery

Provide always-visible stop, tray stop, and a user-configured global emergency hotkey. Model calls are never the only way to stop. The local stop command synchronously increments `sessionEpoch` and disables dispatch/action authorization before awaiting adapters. Clear pending slots and proposals, cancel watches and provider jobs, stop audio/capture workers, revoke ephemeral action tokens, and release buffer references.

The stop state blocks new dispatch/action starts immediately; target UI acknowledgement and no-new-acquisition within 1 s, with worker device/resource teardown within 2 s, then termination of unresponsive children. These are unmeasured test targets. Show whether capture stopped, remote cancellation was acknowledged, and any action's outcome is unknown. Stop-all is idempotent after partial failure. Resuming requires explicit user action with current source/binding capabilities and new session authorization.

Stopping a watch pauses/stops that watch's analysis and rule evaluation; it may leave a selected source preview or another watch running. Pausing a source stops that source's capture and invalidates its frame jobs. Stop-all stops every OpenAware source and action pipeline. The UI must name these scopes instead of implying that a paused rule has turned off a camera.

Provider cancellation is best effort: a request already transmitted may finish remotely, consume budget, or remain in provider logs. Reject late responses against the old epoch; do not repopulate conversation or trigger alerts/actions. A computer action already delivered to the OS cannot be recalled by cancelling its promise. A sent message, click, file save, or future broker order may have lasting effects; show `partial` or `unknown` and avoid automatic retry.

On sleep, crash, lock/secure-desktop transition, or device identity change, invalidate relevant action/source epochs, fail closed for new input actions, and mark missing feeds unavailable. The default on restart is stopped. Crash recovery never replays input actions or reuses approval tokens. A captured black/protected surface is not permission to bypass system protections.

## Required security validation before release

- Synthetic visual injection asks the assistant to expose secrets, route to a new cloud provider, press a key, and approve its own action; no capability changes or side effects occur.
- Permission revocation races queued/in-flight inference, model handover, MCP replies, and action execution; old revisions are rejected and buffers release.
- Pairing, hostile Origin/Host, expired credentials, unauthorized IPC sender, oversized image/schema, malicious links, and replayed command/approval each fail safely.
- Masks are checked across preview/export/MCP/provider routes and invalidate on geometry changes; no private test feed is committed or uploaded.
- Stop kills a hung capture worker, blocks new dispatch immediately, reports remote cancellation uncertainty, and never executes a queued action after resume.
- Same-user/admin limits, provider retention, action uncertainty, source gaps, and measured coverage are honestly represented in the UI and release documentation.

Security release acceptance is separate from functional acceptance. Use synthetic test sources and allowlisted nonprivate fixtures. Dependency updates, Windows worker privileges, package integrity/signing, installer update channels, migrations, diagnostic exports, and license notices require a recorded review in the release checklist; none is certified by this plan alone.
