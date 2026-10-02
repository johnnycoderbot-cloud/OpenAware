# OpenAware v0.2 developer prototype

This build implements a usable desktop application against the full [release roadmap](roadmap.md). Version 0.2 aligns the dashboard with the generated concept and adds background monitoring with tray controls. It does not complete every milestone or establish production support for every Windows device, model, Bionic version, or application.

## Implemented boundary

- Electron desktop with a sandboxed renderer and a narrow, validated preload bridge; supervised awareness service over private process IPC.
- Top navigation, a dominant selected desktop preview, separate camera previews, and a right-side conversation/actions/activity column. Configuration, masks, source scope, evidence age, and Stop remain functional controls; populated screenshots use explicitly synthetic fixtures.
- Up to four explicit synthetic demo, camera, OBS virtual-camera, monitor, or window sources with continuous local previews. Capture starts only after selection; Stop releases owned tracks and invalidates inference.
- Black privacy rectangles on analysis images, separate preview/analysis age, bounded newest-frame scheduling, and memory-only observations/conversation/events.
- Local LM Studio and Ollama model discovery, explicit selection, visible synthetic vision probe, and source-grounded analysis/conversation. Local-only endpoints and ephemeral tokens; no cloud fallback.
- Independent deterministic motion events and acknowledgement.
- Observer and Operator AI roles sharing the selected model. Operator proposes up to eight typed steps; a Windows native review checks each step. Keyboard targets must be on the selected monitor; masked sources, changed displays/windows/screens, stale/expired plans, replay, and Stop revoke input.
- Background mode hides the dashboard without replacing the current renderer or restarting capture. Tray Show, Stop, and Quit remain available; an explicit background preference determines whether closing the window hides it or quits. `--background` and `--headless` start idle with no selected feeds in an interactive Windows desktop session.

The experimental input broker compares unchanged full-monitor thumbnails downsampled to at most 1024 px across native approval, and requires fresh inspection plus stable native window and display identities. It does not compare every physical pixel or certify a model's interpretation. Moving or animated screens may refuse execution. Actual input reports that Windows accepted events; it does not claim the application task succeeded. Stop cannot undo a sent event. Native effects, focus restoration, and mixed-DPI placement remain unverified on real applications.

## Run and configure

1. Install Node.js 24 or later and run `npm ci`, then `npm start` from the repository.
2. Add a synthetic demo to inspect the interface without personal capture, or explicitly choose a real source.
3. Start your local model server: LM Studio normally uses `http://127.0.0.1:1234`; Ollama normally uses `http://127.0.0.1:11434`.
4. In Connections, discover models, select a vision-capable model, and run the displayed synthetic test. Start monitoring only after verified readiness.
5. Scope questions to source chips. Operator planning needs a live selected monitor and verified local model. Native action review is per step; the emergency shortcut is Ctrl+Shift+F12 if available.
6. Click **Background** to continue the configured session with the dashboard hidden. Tray **Show OpenAware** preserves that preference; click **Window mode** to clear it. Tray Stop releases feeds and pending authority; Quit exits. See [background mode](background-mode.md).

Configuration, tokens, and history are memory only. Neither launch flag selects a source, binds a model, starts monitoring, nor restores an earlier session. Native actions continue to require interactive approval for every step.

## Evidence and remaining gates

Source checks exercise strict TypeScript compilation, unit/integration contracts, synthetic Electron workflows, hidden capture and inference continuity, desktop visibility, headless idle startup, close behavior, and Quit. The production tray test inspects the real menu and invokes installed Show/Stop/Quit callbacks; it does not simulate physical tray clicks. Visual fixtures use the actual Electron renderer with synthetic content. Final counts, package checks, and review corrections are recorded in the [v0.2 implementation ledger](../.omx/logs/implementation-v0.2.md).

The earlier [v0.1 ledger](../.omx/logs/implementation-v0.1.md) preserves the first build's accepted checks. Mock model responses and synthetic sources do not prove real model vision, actual camera negotiation, native inputs, mixed-DPI placement, sleep/lock behavior, or sustained performance.

Not implemented in v0.2: Bionic MCP pairing or embedded UI, automatic host model-picker synchronization, cloud providers, voice, IP camera, persisted encrypted setup/history, automatic source restoration, semantic/group rule editors, broker integration, unattended action grants, general shell execution, auto-update, and signed distribution. Background mode depends on an interactive desktop and an available system tray. Chart conversation can describe sampled pixels but exact trading rules require the future structured-data adapter. Implementation issues remain open until their complete gate is evidenced.

## Build artifacts

`npm run package:dir` builds an unpacked application; `npm run package` builds a Windows NSIS installer. The [v0.2.0 developer prerelease](https://github.com/johnnycoderbot-cloud/OpenAware/releases/tag/v0.2.0) provides the unsigned installer and checksum; refer to its ledger for packaged test evidence. The installer itself has not been exercised. The [v0.1.0 prerelease](https://github.com/johnnycoderbot-cloud/OpenAware/releases/tag/v0.1.0) remains historical. Generated `dist`, `release`, recordings, credentials, and local OMX state are excluded from Git. Packaging does not imply signing or Windows release acceptance.
