# Foundation research summary

Verified on 2026-10-02. Read [integration evidence](../../docs/integrations.md) for primary links and reproducible gates.

## Established interfaces

- LM Studio native API lists available/loaded models, vision capabilities, and accepts model-bound image input. Analysis requests should set store:false because the documented chat default stores history.
- Bionic has its own model picker and standard skills. Bionic is a separate app from classic LM Studio.
- A community Bionic extension author documents local stdio MCP configuration; image delivery, push wakeup, model sync, and an embedded dashboard are still test gates.
- OBS exposes a configured scene/source as a webcam. A composite stream is one source with optional explicitly defined analysis regions.
- Ollama, OpenRouter, OpenAI, and compatible NVIDIA models expose documented vision interfaces. They do not all provide the same native live-video or voice transport.

## Design implications

Own continuous preview/capture in OpenAware and bound model analysis independently. Do not promise observation of every frame. Preserve explicit observation-model identity instead of guessing the Bionic picker. Keep a stand-alone dashboard as a reliable fallback. Cloud routing, local metadata persistence, provider retention, and computer actions are separate permissions/policies.

## Remaining experiments

Hardware/model capacity; Windows capture lifecycle; Bionic image/notification/model-selection transport; structured market-data source; IP decoder selection/license; voice stack; Windows action broker; signing/update support. Every experiment has a gate and fallback in the decision register.
