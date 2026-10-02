# Decision and uncertainty register

Date: 2026-10-02. Accepted here means a planning baseline, not implemented behavior.

## Baseline choices

| ID | Choice | Reason | Revisit when |
| --- | --- | --- | --- |
| D-001 | Public OpenAware repository, MIT original code/docs | Explicit owner choice; reusable open-source project | License inventory finds incompatible dependencies |
| D-002 | Windows first | User's actual environment; reduce first-release capture matrix | Windows release gates pass |
| D-003 | Proposed Electron + React + TypeScript dashboard, Node control service | Reuse media APIs, typed contracts, testable shared logic | Capture/packaging spike measures unacceptable overhead |
| D-004 | LM Studio local vision as reference adapter | Reuse installed models and model discovery | Hardware benchmark/model availability findings |
| D-005 | Bionic bridge plus independent dashboard | Host conversation while retaining reliable monitoring lifecycle | Published native embedding surface is verified |
| D-006 | One local inference in flight by default | Avoid contention with Bionic and bounded memory | Adapter benchmark supports bounded parallelism |
| D-007 | Per-source latest eligible frame, no growing FIFO backlog | Keep observations fresh under slow inference | Temporal-window reasoning feature is added |
| D-008 | Four-source target, 720p previews, two-second analysis eligibility | Concrete initial test fixture; not capacity or latency guarantees | Measured hardware profile and user quality preferences |
| D-009 | Frames/audio memory-only by default; separate retention policy for metadata | Limit accidental recording; keep observable provenance | User explicitly enables bounded recording/history |
| D-010 | Observation-only alpha; trading paper workflows before live orders | Validate awareness and data integrity before irreversible side effects | Separate live-order adapter release gate passes |
| D-011 | Computer actions are optional explicit scopes | Preserve real-computer use while keeping observation independent | Tested action broker with revocation/replay protection |
| D-012 | Cloud inference is opt-in by source and provider | Local model failure must not silently export visual data | Explicit approved route changes |
| D-013 | No consumer ChatGPT login bridge | Use documented model APIs and credential boundaries | Supported published interface changes |

## Prototype gates

| Gate | Question | Experiment/evidence required | Owner role | Safe fallback |
| --- | --- | --- | --- | --- |
| G-LM | Can the selected vision model sustain useful monitoring? | Synthetic image, model listing, version/auth, store:false, cancellation, contention, timed multi-source benchmark | Integrations engineer | Preview-only plus explicit degraded analysis |
| G-BIONIC | Does custom MCP deliver images and scopes correctly? | Install stdio tool; verify image understanding; revoke pairing; test model binding and proactive events | Integrations engineer | Skill/CLI queries and stand-alone notifications |
| G-CAPTURE | Which Windows source implementation is reliable? | OBS + camera + monitor test, scaling/lock/disconnect/permissions, cost of multiple feeds | Capture engineer | OBS/camera adapters with documented limits |
| G-MODELSYNC | Can a supported API reveal Bionic's session model? | Interface/version evidence and switching/restart test | Integrations engineer | Explicit observation-model binding and mismatch label |
| G-EMBED | Can our live panel be hosted inside Bionic? | Published panel API and supported rendering/permission contract | UI engineer | Separate companion window |
| G-PUSH | Can alerts wake a Bionic session without a user turn? | Supported event protocol and notification lifecycle test | Integrations engineer | Dashboard and OS notification only |
| G-IPCAM | Can IP cameras be decoded and isolated safely? | RTSP/network outage/corrupt stream fixtures, local-only destination policy, decoder license review | Media engineer | Local webcam-only alpha |
| G-VOICE | Which offline STT/TTS stack is usable and distributable? | Licenses, hardware benchmarks, microphone revoke/stop/interruption, no silent upload | Audio engineer | Typed conversation; Bionic's own voice input |
| G-MARKET | What structured market data is permitted and current? | Selected vendor entitlement, timestamp/session semantics, replay fixtures and stale-data test | Trading integration engineer | Qualitative chart discussion and synthetic paper fixtures |
| G-BROKER | How are live orders authorized and reconciled? | Sandbox broker, scoped account, duplicate-order prevention, reconnect reconciliation, review | Trading integration engineer + reviewer | Paper proposals only |
| G-ACTIONS | Can Windows actions be bounded and revoked reliably? | Target identity, display scaling, fresh UI, no UAC/lock bypass, one-use approvals, stop races | Windows engineer + reviewer | Suggestions without execution |
| G-RELEASE | Can Windows binaries be reproducibly packaged and updated? | Clean VM install, dependency inventory/SBOM, signing choice, update rollback, uninstall cleanup | Release engineer | Source-only experimental release with explicit limitations |

## Unspecified inputs

No particular GPU/VRAM, model, cameras, broker, market-data vendor, notification service, or fixed maximum feed count has been supplied. These are configuration or compatibility questions to resolve during corresponding slices; they do not block planning. Actual feeds, keys, and accounts are not connected as part of this repository foundation.

## Change control

Record any change to an accepted contract/default with the reason, affected requirement IDs and slices, test impact, and migration behavior. Major user-facing scope changes require owner direction. Routine implementation choices remain the executing engineer's responsibility. Reopen a gate when upstream version changes invalidate its recorded test.
