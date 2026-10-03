# Direct llama.cpp provider — 0.3.1

The owner's “Llama ppp as well” is interpreted as llama.cpp while optional clarification remains open. Add a third local provider alongside LM Studio and Ollama. This is a bounded adapter slice, with no server installation, model-management requests, downloads or new CLI/action authority.

## Ownership

- Root: packages/providers/src/index.ts, tests/providers.test.ts, package version, documentation, integration verification and delivery.
- lower_feed_ui: packages/contracts/src/index.ts, apps/desktop/renderer/App.tsx and styles.css, tests/ui.spec.ts; provider kind `llamacpp`, label `llama.cpp`, default origin `http://127.0.0.1:8080`.
- architecture_plan: independent source review after freeze; no edits.

## Adapter

Use GET /v1/models and POST /v1/chat/completions per [upstream server docs](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). Discovery reports unknown image capability unless explicit architecture metadata identifies input modalities. Model-name guessing cannot grant vision capability. The existing synthetic vision test gates monitoring.

Images use OpenAI-style content parts with image_url data URLs, explicit selected model, stream false, bounded tokens and temperature. Structured observe/plan requests use JSON response format. Historical summaries send caption text only. No tool definitions or tool execution. Require one completed assistant text choice with finish_reason stop; reject tools, legacy function calls, truncated/empty/malformed results. Keep local origins, redirect rejection, 4 MiB request/2 MiB response caps, generic errors and cancellation. Observe/summary retain 60-second deadlines; chat/probe/Operator retain 20 seconds and existing freshness bounds.

## Verification

Strict TypeScript; full unit suite with provider protocol/bounds/failure/cancellation regressions; one third-provider Electron workflow plus existing required desktop checks; compact Connections inspection; production package payload/hash verification. Actual llama.cpp inference is a separate acceptance gate unless an already installed local server and compatible model are discovered. Current default port has no listener and llama-server/llama are absent from PATH. Existing live OpenAware session is idle and model-unconfigured.

Record final source review, CI and release evidence in the implementation ledger. Preserve prior release records and documented performance limits. No source change can expand action authority.
