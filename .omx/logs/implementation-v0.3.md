# v0.3 — local video workflows

## Authorization and boundary

The owner authorized VSS integration, then clarified that no VSS server exists and asked to port the skills/pipelines onto the existing computer. The implementation uses OpenAware's masked capture and local LM Studio/Ollama adapters. It does not deploy NVIDIA VSS, copy NVIDIA source/weights/containers, add CUDA/DeepStream/RTSP services, or claim full VSS API compatibility. Original code remains MIT. The [execution plan](../plans/local-video-workflows-v0.3.md) records ownership and verification boundaries; [upstream research](../research/nvidia-vss-3.3.md) distinguishes the announced 3.3, release candidate and published 3.2.1.

## Result

- Bounded chronological samples: up to three masked frames/source within four seconds, a fresh latest input at dispatch, four images/request and existing serialized/memory limits.
- Captions retain source/model/revision identities and capture intervals. Caption search is deterministic local text ranking. Historical summaries use a newest complete caption subset fitting 25 records and 32,000 serialized characters, through the same single-inference queue.
- Eight semantic rules maximum with exact id/revision output validation, two distinct qualifying observations, 30-second cooldown and unknown handling. Alerts never authorize input.
- Video memory fills the former lower empty pane. Connections contains temporal/rule controls. Default fitted side-by-side monitors, extra feed rows, docking, assistant and Operator separation are retained.
- Opt-in `--enable-cli` authenticated loopback control, bounded requests and reserved Stop admission. It cannot select/acquire sources, inject frames, change models/providers, execute native input or run a shell. Stop invokes immediate main-process capture teardown.
- The portable skill and installer script copy only instructions and the bundled CLI. Node.js 24 is required for CLI use. No token descriptor is copied.

## Timing decision and actual inference

Direct synthetic Ollama tests on this computer established one-image recognition of a red square, blue circle and OPENAWARE42 label in 18.053 seconds, with another correct historical-mode observation in 20.03 seconds. The first cold probe hit 20 seconds. A three-image temporal diagnostic hit 60 seconds, and a historical text summary hit 60 seconds. An alternative installed model also hit 20-second probe limits. These observations do not establish useful continuous monitoring, actual desktop/camera interpretation, rule accuracy or sustained throughput.

Consequently background captions and summaries have a separate 60-second deadline. Delayed background captions retain historical provenance up to 65 seconds newest-frame age and cannot qualify semantic alerts above the existing 15-second freshness boundary. Synthetic probes can complete within 20 seconds. Current questions/Operator keep 20-second deadlines and 15-second completion freshness. Slow or reasoning-heavy models can still time out; no cloud fallback or model download was introduced.

## Review and verification

Independent read-only source review ended **approved** after fixing summary context admission and CLI Stop saturation. Temporal/mask/model/source revocation, late cancellation, rule identity, bounded memory and action separation are covered by runtime regressions.

- Strict TypeScript passes; 147 unit/integration tests pass, including 34 scoped runtime/workflow tests and authenticated CLI saturation/Stop tests.
- Production build and unsigned Windows x64 package succeed. Product/file versions are 0.3.0. The installer is 114,923,605 bytes; SHA-256 `f6dcbc084d4e59e587088c30b8463370d47ec6d456f3bf5581f661623c76c972`.
- Read-only extraction confirms installer app.asar and external CLI hashes match the tested unpacked package. The installer itself and its shortcuts have not been executed.
- The skill validates; the installed CLI's help runs under Node. Personal skill installation is local environment setup, not a GitHub release artifact.
- All 10 final packaged Electron workflows pass (1.1 minutes): local UI captions/search/text summaries/rule alerts, bundled authenticated CLI, motion-only watching, native fixture capture and Stop, tray/background lifecycle, docking and four-source layouts. Fixtures contain synthetic sources/mock providers; public assets contain no personal screen/camera images.
- Manual app inspection confirms Overview, Operator, Connections and Event log with the lower Video memory pane and local temporal/rule controls. The current desktop session exposes one "Entire screen" entry; both physical monitors are not claimed verified in this session. No new capture permission was granted. Ollama discovery returned 16 entries, with cloud/text-only choices disabled. The final dashboard remains visible and idle with `--enable-cli`; a real authenticated status call reports 0.3.0 without private connection content.

## Delivery and remaining gates

Public source/tag, exact-commit Windows/Ubuntu CI and matching uploaded installer/checksum need external evidence before release claims. Previous 0.2.4 local layout fixes are included in this source line; no separate 0.2.4 GitHub release is claimed. Real model suitability, cameras, mixed DPI, native action effects, Bionic, sustained performance and sleep/lock remain acceptance gates.
