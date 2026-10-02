# Integration evidence and prototype gates

Verified: 2026-10-02. Recheck schemas and license requirements when implementing. Vendor documentation proves a documented interface, not compatibility with our unbuilt application or a specific installed build.

## Evidence levels

- **Documented:** first-party documentation establishes the narrow capability.
- **Community evidence:** an extension author documents usage; test it against supported versions.
- **Proposed:** our own design, with no implemented behavior yet.
- **Gate:** a reproducible experiment must pass before claiming support.

## Integration matrix

| Component | Evidence | Planned role | Boundary/gate |
| --- | --- | --- | --- |
| LM Studio local API | Documented model enumeration, vision flags, images, streamed output | Reference local vision backend | Test actual model, authentication, cancellation, storage, and contention |
| Bionic model picker | Documented local, LM Link remote, and LM Studio cloud choices | User chooses conversation model in existing host | This is not a documented arbitrary OpenAI/OpenRouter picker or API selection-sync feed |
| Bionic skills | Documented standard SKILL.md and optional supporting files | Teach observation workflows and command usage | A skill is guidance, not a background video transport |
| Bionic MCP | Community author documents local stdio setup | Bridge for queries/control of monitoring service | Test image results, authorization, session identity, and notifications |
| Bionic embedded dashboard | Unverified | Optional later presentation | No documented general panel API established by this research |
| OBS Virtual Camera | Documented scene exposed as a webcam | Desktop/virtual desktop presented as a video source | Composite is one camera stream, not independent monitor identities |
| Ollama | Documented image-capable chat API | Optional local provider | Probe chosen model capabilities and performance |
| OpenRouter | Documented multimodal requests via vision models | Optional hosted model routing | Verify model/provider modality and retention settings |
| OpenAI | Documented vision input and Realtime image events | Optional hosted vision/voice adapter | Images are supported; do not infer arbitrary continuous-video ingestion |
| NVIDIA NIM | Documented image/video input for compatible models | Optional self-hosted or hosted inference adapter | Endpoint, model, GPU support, and license vary |

## LM Studio: reuse model discovery

`GET /api/v1/models` returns model keys, loaded instances, and capabilities such as `vision` and tool-use training. It can populate an OpenAware binding selector from installed models without downloading another copy. A discovered or loaded model is not proof it is the model chosen in a particular Bionic session. Preserve separate `conversation_model` and `observation_model` identities. [Model discovery](https://lmstudio.ai/docs/developer/rest/list)

The native API accepts a specific model key and image data URLs at `POST /api/v1/chat`. Send `store: false` for frame-analysis requests: the documented default is `true`. Configure bounded output, deadlines, explicit model binding, and no attached MCP integrations in observation-only inference. Store a request/response provenance envelope in OpenAware rather than an unbounded vendor conversation. [Chat API](https://lmstudio.ai/docs/developer/rest/chat)

The TypeScript SDK also supports images from paths or base64 with JPEG, PNG, and WebP. File-format support does not imply video decoding or continuous monitoring is handled by LM Studio. [Image input](https://lmstudio.ai/docs/typescript/llm-prediction/image-input)

Prototype G-LM: start a local server with its documented authentication; enumerate models; reject a text-only model; submit a synthetic image; confirm model-instance attribution; cancel an oversized request; exercise a loaded model switch and server restart. Inspect local server history to validate the intended storage configuration. Verify coexistence with Bionic without auto-unloading its model.

## Bionic: conversation host and extension bridge

Bionic is a separate application from classic LM Studio. Its session picker selects local, LM Link remote, or LM Studio Secure Cloud models and explicitly asks users to consider image and tool support. Do not apply classic LM Studio plugin-hook docs to Bionic without testing. [Bionic introduction](https://lmstudio.ai/docs/bionic), [Bionic models](https://lmstudio.ai/docs/bionic/models)

Bionic supports reusable skills installed through Settings > Skills, including compatible skills from other apps. A skill may explain how to use OpenAware tools; it cannot itself guarantee continuous monitoring while no turn is running. [Skills](https://lmstudio.ai/docs/bionic/agent/skills)

A published community image-processing extension provides instructions for Bionic Settings > MCP > Add custom MCP with a local `node` command. This is primary author evidence of the integration mechanism, not first-party assurance that all MCP image results or notifications behave identically. [Community MCP setup](https://lmstudio.ai/ceveyne/process-image/files/README_MCP.md)

Prototype G-BIONIC must record Bionic/LM Studio versions, OS, selected model, bridge version, and results for:

1. Install a harmless local stdio tool and confirm tool enumeration.
2. Query a synthetic source and a timestamped observation.
3. Return an image using supported transport; confirm the chosen vision model actually interprets it rather than repeating a text description.
4. Reject forged control scopes, invalid source IDs, and a revoked pairing.
5. Test whether source events can wake a Bionic conversation. If not, use dashboard/OS notifications and query-on-demand; no fake proactive Bionic messages.
6. Determine whether a supported API exposes the session model selection. If not, show an explicit binding in OpenAware and explain any mismatch.
7. Investigate embedded UI only through published interfaces; keep the dashboard separate if no supported surface exists.

Fallback: OpenAware displays live feeds and alerts; Bionic queries structured observations through a skill/CLI tool. A text-only Bionic model can consume observations from a separately bound vision model, with provenance shown. It must not claim it personally saw the image.

Bionic is also a downstream data boundary. Sending an image or text summary to its MCP client may expose it to the host's current model/provider and saved conversation. An OpenAware local-model setting does not constrain Bionic's later route. Pairing grants status access first; source-specific content export needs a separate grant naming route/retention status. Strict local-only sources deny content export to a host with an unverified route. The spike must verify these paths; an image rendering successfully is not proof of local-only processing.

## Feed sources and actual desktops

OBS Virtual Camera can expose its program output, preview, scene, or source as webcam input. It provides the requested camera-like desktop view. The user configures which desktop/window/virtual-desktop scene OBS shows. [OBS guide](https://obsproject.com/kb/virtual-camera-guide)

One OBS composition containing two monitors counts as one parent source. User-defined regions of interest may become child observation regions, with parent/region provenance; they are not secretly new physical devices. Independent monitor feeds require a native capture adapter or separate valid source transport.

Camera enumeration/device selection requires operating-system and Electron permission handling. Direct desktop capture must validate multi-monitor coordinates, scaling, pointer rendering, permission revocation, source reordering, sleep/lock, disconnected monitors, protected windows, and recursive self-capture. IP-camera decoding runs in an isolated worker; RTSP credentials are secret refs, never URL text in logs. These adapters are design proposals until the capture spike passes.

Prototype G-CAPTURE compares Electron/native capture options on Windows. Choose the smallest supported implementation based on measurable CPU, memory, latency, packaging, and permission behavior. A VR application named Virtual Desktop is not automatically a supported protocol; it may be observed through a compatible displayed window or virtual-camera source.

## Optional provider adapters

**Ollama:** REST chat accepts base64 images in a message `images` array for vision models. Keep the adapter model-specific; text-only models cannot analyze a picture. [Ollama vision](https://docs.ollama.com/capabilities/vision)

**OpenRouter:** multimodal messages use image content parts and supported vision models. Modality, rates, provider policy, and error behavior must be checked for the actual selected route. Configure an allowed provider/model route, not silent cloud fallback. [Official multimodal documentation source](https://github.com/OpenRouterTeam/docs/blob/main/guides/overview/multimodal/overview.mdx)

**OpenAI:** the Realtime documentation establishes image input in user-message events; vision through the API is independent of a consumer ChatGPT camera-sharing interface. The bridge submits bounded image parts and manages response turns. Voice needs separate audio permission, interruption, and session-lifecycle handling. Do not expose API keys in a renderer or assume a ChatGPT subscription authenticates API requests. [Realtime image input](https://developers.openai.com/api/docs/guides/realtime-conversations), [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)

**NVIDIA:** compatible NIM models support image, audio, or video inputs through documented model backends. Native video on one model does not imply every NVIDIA endpoint supports video, and self-hosting requirements differ from hosted catalog endpoints. Start with the standard image-request adapter, then add model-specific video capabilities only after a test. [NIM multimodal inputs](https://docs.nvidia.com/nim/large-language-models/latest/advanced-use-cases/multimodal-input.html)

No pricing or latency figures are frozen in this plan. Use reported usage where available; show estimated versus final usage; reserve cost before dispatch; do not retry automatically in a way that bypasses a user budget. Provider terms/retention are separate from OpenAware's local recording policy.

## Trading and computer-action integrations

The initial trading workflow watches selected chart regions, explains visible context, and evaluates exact thresholds only from an explicitly configured timestamped market-data source. A brokerage API, market-data entitlement, or chart scraping permission is not established by the app mockup. Provider selection and data licensing are gates. Paper proposals use synthetic fixtures before integration. Live execution requires a dedicated broker adapter, account permissions, idempotency, order reconciliation, and a separate release gate.

Computer-control APIs run in a separate action worker with target-window identity and explicit approval. Model image comprehension does not confer control permissions. A browser automation protocol is not evidence of native Windows input access. No hidden Bionic app patch, unsupported internal IPC, or reverse-engineered selector path is part of the baseline.

## Upstream licenses and packaging

OpenAware original code/docs: MIT. LM Studio/Bionic remain separately licensed products; reference APIs rather than bundling proprietary applications. OBS, native media decoders, SDKs, speech components, and model weights require a release license inventory. Prefer an external OBS installation for the alpha. Do not redistribute model weights or embed media binaries before verifying their specific licenses. [LM Studio application terms](https://lmstudio.ai/app-terms)

Electron's security guidance supports the proposed isolated renderer, sandbox, narrow preload bridge, and explicit permission handlers. This is a design requirement, not proof of a secure unbuilt app. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
