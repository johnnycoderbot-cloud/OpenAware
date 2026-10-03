# NVIDIA VSS 3.3 assessment

Verified 2026-10-03. Scope: read-only upstream research and an OpenAware integration recommendation. No VSS installation, deployment, model inference, recording, or OpenAware runtime changes were performed.

## Verdict

VSS is a strong candidate for an optional continuous video-monitoring backend for OpenAware. It combines stream ingestion, VLM captioning, configurable alerts, visual questions, searchable evidence and summaries. This is a closer architectural match to the owner's requested monitoring experience than an accelerator alone. Suitability for desktop text, charts and changing UI must be measured with representative footage; camera/industrial demonstrations do not establish desktop accuracy.

## Version and CLI evidence

NVIDIA announced VSS 3.3 on September 29, 2026. Its article describes composable workflows, headless operation driven by the VSS CLI, and Adaptive Efficient Video Sampling (EVS). EVS prunes unchanged visual patches and batches work around activity; it is optional, runs inside RT-VLM, and does not apply to remote inference endpoints. Reported benchmark gains are specific to the tested hardware/models/scenes, not OpenAware measurements. [Official announcement](https://developer.nvidia.com/blog/lower-the-cost-of-building-and-running-visual-ai-agents-with-nvidia-vss-blueprint-3-3/)

The development branch's release metadata says `3.3.0`, and GitHub has a `v3.3.0rc0` tag. At inspection, GitHub's latest published release and the latest documentation release notes still identify `3.2.1`. Pin an exact upstream revision and matching deployment assets for a spike; do not assume the latest release link supplies the announced 3.3 CLI. [Development metadata](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization/blob/develop/release_metadata.yaml), [release candidate](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization/tree/v3.3.0rc0), [published releases](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization/releases), [release notes](https://docs.nvidia.com/vss/latest/release-notes.html)

The modern `vss` CLI is a lightweight host-side client to an already deployed stack. It emits JSON and typed exit codes. Its first-party groups are configure, vios, search, summarize, vlm, analytics and memory. Media operations register streams and retrieve clips/snapshots; search/summarize/vlm jobs expose run/status/get/list; analytics reads incidents and metrics. Installing the CLI alone does not provide a running monitoring engine. The inspected package requires Python >=3.13 and <3.15. No first-party alerts command group is advertised by its current entry points; alert control uses the dedicated service interfaces. [CLI contract](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization/blob/develop/libs/vss/cli/AGENTS.md), [CLI metadata](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization/blob/develop/libs/vss/cli/pyproject.toml)

## Continuous monitoring evidence

The real-time alert workflow continuously samples video and uses RT-VLM to detect configured events, with persistent rules managed through Alert Bridge. The separate verification workflow combines perception/behavior alerts with VLM verification. [Real-time alerts](https://docs.nvidia.com/vss/latest/agent-workflow-rt-alert.html), [alert verification](https://docs.nvidia.com/vss/latest/agent-workflow-alert-verification.html)

RT-VLM accepts RTSP live streams, manages their lifecycle, and streams completed caption results via SSE or publishes messages through Kafka. It also supports compatible local model checkpoints and remote OpenAI-compatible endpoints. Continuous operation still uses sampled frames and temporal chunks; it does not guarantee interpretation of every display frame. Sampling, chunk duration and inference throughput determine detection delay. Concurrent requests consume resources, and stream deletion may wait for in-flight inference under load. [RT-VLM reference](https://docs.nvidia.com/vss/latest/real-time-vlm.html)

## Proposed OpenAware boundary

1. Retain OpenAware's selected-source capture and live previews. Publish each explicitly selected, masked monitor/camera through a local encoded-video bridge, preserving separate source identities, to RTSP inputs. Browser MediaStreams and virtual webcams require this bridge; they are not automatically VSS network streams.
2. Start with RT-VLM captioning and the real-time alerts path. Consume timestamped captions/incident evidence into the assistant and event log. Add VIOS recording, search and long-video summaries only as separately selected capabilities with explicit retention settings.
3. Treat VSS as a service backend with stream/job lifecycle capabilities, not merely another single-image model endpoint. Keep endpoint/model identity, source revisions, capture epochs, output age and routing permissions on every result. Streaming outputs must not inherit the existing five-second image dispatch contract without a deliberate temporal-evidence contract.
4. Stop all must immediately stop local capture/export and invalidate queued/late results, then request upstream stream/rule cancellation and report its acknowledgement. Upstream deletion latency must not extend local capture authority. Observation remains separate from Operator authorization.
5. Use the CLI for setup/diagnostics and supported job operations; use documented RT-VLM/alert interfaces for the persistent stream session. No shell strings derived from model output. Do not install a second agent harness just to connect a backend.

The full reference stack is Linux/container oriented and requires a supported NVIDIA inference configuration, or supported remote model endpoints where available. OpenAware can remain a Windows client to a separate backend; native Windows support and this computer's capacity were not established by this research. Repository code licensing and NIM/model/container/dependency licenses are distinct. Keep optional upstream dependencies and notices explicit rather than describing the entire stack as MIT. [Repository requirements and license](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization)

## Smallest verification slice

Use two synthetic desktop streams with known UI/text changes and timestamps. Confirm independent identities, streaming outputs, rule detection, actual end-to-end delay, missed/false alerts, small-text fidelity, resource use, reconnect behavior, and local Stop all with delayed upstream cancellation. Compare adaptive EVS enabled/disabled on small text changes before enabling pruning defaults. Verify retention and authentication on the exact deployed services. Only then run an explicitly started dual-monitor acceptance check and add stored-history/search capabilities.

Next action: a bounded VSS adapter/deployment spike after selecting an actual supported backend host and pinned upstream version. Integration remains proposed and unimplemented.

Verification verdict: approved by an independent source reviewer. Local planning validation passed for 41 Markdown files, links/anchors, all 26 slices and requirements; whitespace checks passed. These checks establish a consistent research handoff, not runtime compatibility.
