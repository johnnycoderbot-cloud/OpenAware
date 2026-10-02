# OpenAware v0.1 implementation

Authorized on 2026-10-02: user requested “create it” and added cooperating AI with full computer automation. This supersedes the planning-only task for application implementation. No actual computer inputs, personal capture, trades, or external messages are executed by the development session.

## Deliverable

Build a runnable Windows Electron application: four explicit camera/virtual-camera/monitor/window or synthetic sources; continuous previews; local LM Studio/Ollama discovery and verified vision; bounded background Observer analysis; source-grounded conversation; independent motion events; an Operator that proposes typed tasks and exposes reviewed Windows input execution. Include a Stop control, truthful unimplemented-feature status, tests, source instructions, and a Windows portable build when packaging succeeds.

This is the first functional prototype, not completion of every release gate in the 26-slice plan. Bionic host compatibility, cloud adapters, saved encrypted history, broker orders, voice, signing, and unattended workflows retain their independent gates.

## Slices

| Owner | Files | Acceptance and verification |
| --- | --- | --- |
| Root | root configuration, contracts, build/test orchestration, docs, release evidence | Lockfile; compile; schema validation; desktop smoke with synthetic feeds; artifact and remote verification |
| Backend Architect | apps/service, packages/core, packages/providers, runtime/provider tests | Real local provider serialization; latest-frame fairness; cancellation, freshness/revisions; motion rules and bounded content; mock HTTP and deterministic tests |
| Senior Developer | main/preload, packages/actions, action tests | Sandboxed sender-checked bridge; chosen capture; child supervision; immutable native-reviewed steps; fail-closed target/bounds/expiry/Stop; mocked effect tests |
| Frontend Developer | renderer, UI fixtures | Responsive dashboard; explicit source selection and stream release; masked analysis; separate Observer/Operator flows; synthetic UI/Electron tests |

Native in-session agents own disjoint files and preserve other work. Review each handoff against implemented evidence. Permission and action gates cannot be inferred from generated observations. Source pipelines never start automatically.

## Verify and done

`npm run check`, `npm test`, `npm run build`, `npm run test:desktop`, and `python scripts/validate_plan.py` must pass. Verify actual Electron startup, synthetic source lifecycle, Stop cleanup, and restart behavior. Package a Windows prototype and distinguish mocked providers from a live model/device smoke. Publish reviewed source to the existing repository; keep personal data out of source, issues, and CI. Record unmet external gates rather than reporting them passed.
