# OpenAware v0.1 developer prototype

This first build implements a usable desktop application against the full [release roadmap](roadmap.md). It does not complete every milestone or establish production support for every Windows device, model, Bionic version, or application.

## Implemented boundary

- Electron desktop with a sandboxed renderer and a narrow, validated preload bridge; supervised awareness service over private process IPC.
- Up to four explicit synthetic demo, camera, OBS virtual-camera, monitor, or window sources with continuous local previews. Capture starts only after selection; Stop releases owned tracks and invalidates inference.
- Black privacy rectangles on analysis images, separate preview/analysis age, bounded newest-frame scheduling, and memory-only observations/conversation/events.
- Local LM Studio and Ollama model discovery, explicit selection, visible synthetic vision probe, and source-grounded analysis/conversation. Local-only endpoints and ephemeral tokens; no cloud fallback.
- Independent deterministic motion events and acknowledgement.
- Observer and Operator AI roles sharing the selected model. Operator proposes up to eight typed steps; a Windows native review checks each step. Keyboard targets must be on the selected monitor; masked sources, changed displays/windows/screens, stale/expired plans, replay, and Stop revoke input.

The experimental input broker compares unchanged full-monitor thumbnails downsampled to at most 1024 px across native approval, and requires fresh inspection plus stable native window and display identities. It does not compare every physical pixel or certify a model's interpretation. Moving or animated screens may refuse execution. Actual input reports that Windows accepted events; it does not claim the application task succeeded. Stop cannot undo a sent event. Native effects, focus restoration, and mixed-DPI placement remain unverified on real applications.

## Run and configure

1. Install Node.js 24 or later and run `npm ci`, then `npm start` from the repository.
2. Add a synthetic demo to inspect the interface without personal capture, or explicitly choose a real source.
3. Start your local model server: LM Studio normally uses `http://127.0.0.1:1234`; Ollama normally uses `http://127.0.0.1:11434`.
4. In Connections, discover models, select a vision-capable model, and run the displayed synthetic test. Start monitoring only after verified readiness.
5. Scope questions to source chips. Operator planning needs a live selected monitor and verified local model. Native action review is per step; the emergency shortcut is Ctrl+Shift+F12 if available.

## Evidence and remaining gates

Accepted local checks: TypeScript compilation, 54 unit/integration tests, three Electron UI workflows, the packaged executable's synthetic workflow, production build, Windows NSIS packaging, and planning validation. Detailed results and review corrections are in [the implementation ledger](../.omx/logs/implementation-v0.1.md). Mock model responses and synthetic sources do not prove real model vision, actual camera negotiation, native inputs, mixed-DPI placement, or sustained performance.

Not implemented in v0.1: Bionic MCP pairing or embedded UI, automatic host model-picker synchronization, cloud providers, voice, IP camera, persisted encrypted setup/history, semantic/group rule editors, broker integration, unattended action grants, general shell execution, auto-update, and signed distribution. Chart conversation can describe sampled pixels but exact trading rules require the future structured-data adapter. All implementation issues remain open until their complete gate is evidenced.

## Build artifacts

`npm run package:dir` builds an unpacked application; `npm run package` builds a Windows NSIS installer. The [v0.1.0 developer prerelease](https://github.com/johnnycoderbot-cloud/OpenAware/releases/tag/v0.1.0) provides the installer and checksum. It is unsigned; its packaged executable was smoke-tested without installing it. Generated `dist`, `release`, recordings, credentials, and local OMX state are excluded from Git. Packaging does not imply signing or Windows release acceptance.
