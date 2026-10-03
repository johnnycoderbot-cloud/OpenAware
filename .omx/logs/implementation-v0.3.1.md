# 0.3.1 — direct llama.cpp

The owner requested “Llama ppp as well”, interpreted as llama.cpp after optional clarification. The [bounded slice](../plans/llamacpp-provider-v0.3.1.md) adds a local provider beside LM Studio and Ollama; no NVIDIA server or GPU runtime is involved.

The adapter discovers exact IDs from /v1/models and uses /v1/chat/completions for chronological image content or caption-only historical summaries. Explicit architecture input modalities can declare image support; absence stays unknown until the visible synthetic probe. One completed assistant text choice is required; tools, functions, truncation, malformed/empty results and ambiguous choices are rejected. Existing 4 MiB/2 MiB bounds, cancellation, local origins, deadlines, revocation and action authority remain. Connections includes the third provider and local port 8080 default with compact wrapping.

Independent source review ended **approved** for the adapter and final UI. Manual package inspection caught automatic grid placement putting unselected provider descriptions into the checkmark column. Explicit title/description/icon placement fixes this; a 1024-pixel geometry regression now checks all three providers before and after selection. Existing 0.3.0 records remain historical evidence.

## Verification

- Strict TypeScript and all 152 unit/integration tests pass, including 15 provider protocol tests. All 11 final packaged Electron workflows pass (1.2 minutes), including unknown-capability verification, exact model/image requests, scoped current questions, local caption search without inference, text-only history summaries, Stop and the compact provider layout guard. Existing capture, tray/background, CLI and docking fixtures also pass. Sources and providers in these checks are synthetic.
- Production build and unsigned Windows x64 packaging succeed. Product/file versions are 0.3.1. The final installer is 114,925,663 bytes, SHA-256 `2b1d6f7df6f1c671b96764e487e87cd534e1b93883742c59346f2201c9b32399`.
- Read-only extraction matches the final unpacked app.asar (`e21e8d410e2380ac5a57d5e1c5aac74ca12d1958ce645b09bd2d38a11b6e72f4`) and external CLI (`1a9c5c41bbfef0559e883c398b77cbc3a80cf36ed6012794a537f759140187b2`). Installation and shortcuts have not been exercised.
- The personal workflow skill was updated and validates. Both private skill/tool catalogs were fully refreshed after installation, with updated source hashes verified. No credentials or runtime/model download was included.
- Manual inspection of the final production Connections page confirms three compact, readable provider controls and the llama.cpp endpoint default `http://127.0.0.1:8080`. The running app is visible, idle, CLI-enabled and has no source or model binding. A status call through the installed personal CLI reports 0.3.1. No new monitor/camera acquisition or native action was performed.

## Delivery

Exact-commit CI and public package delivery are pending. Initial source commit `e4e27998c6ae45f73808fa6fbb71ef0789aa6920` passed both planning jobs and Ubuntu application checks, but Windows finished 10/11 desktop workflows: the new llama.cpp test passed while an existing visual divider lookup failed after window resizing. That test sampled layout before asynchronous pane geometry settled. A bounded atomic geometry wait preserves its strict alignment and resize/continuity checks; the corrected targeted packaged workflow passes (17.8 seconds), along with strict TypeScript and documentation checks. The production package is unchanged by this test correction. The draft release remains unpublished until corrected exact-commit checks pass. Prior release records remain unchanged. Earlier packages from this slice are superseded by the corrected final layout build.

No process listens on the default port and llama-server/llama were not found on PATH. No runtime or model was installed or downloaded. Actual llama.cpp inference, server caching/logging, model suitability and throughput remain acceptance gates. Synthetic fixtures cannot establish those results.
