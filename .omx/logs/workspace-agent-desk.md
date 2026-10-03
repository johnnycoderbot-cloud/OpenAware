# Workspace source controls and agent desk

Implementation follows the [plan](../plans/workspace-agent-desk.md). The first desk visualizes the existing Observer and Operator roles sharing the selected model. An optional question about independent provider connections was unanswered, so this scope was stated before implementation. Separate bindings and per-seat monitoring scopes are not implemented.

The labeled `+ Add source` button occupies the Live workspace header and then the first desktop/source header. The empty prompt opens the same existing source picker. The lower pane defaults to an illustrated desk with one empty chair and an outline-only cyan agent labeled `Needs agent`. Split desk adds the existing Operator role and shows `Shared model`. A verified binding and desktop bridge are both required to fill a seat; selection, probing or a failed binding cannot do so. Observer follows analysis-enabled sources and actual monitoring/paused state. Operator opens its existing approval page. Switching Desk/Video memory preserves the mounted memory component and its in-view search/filter state.

Root owns integration and serial UI/package delivery. The native collaboration worker `/root/agent_use_requirements` produced and polished the standalone desk visual; `/root/architecture_plan` reviewed connection boundaries and implemented default vertical fit; `/root/boundary_audit` updated README/prototype documentation and independently reviewed final integration. No detached OMX team or independent seat runtimes are claimed.

## Local verification

- Strict TypeScript and all 201 unit/integration tests passed. The 27 scoped workspace layout tests include the larger desk, portrait sources, sidebar proportions and invalid dimensions.
- The desktop workflow passes empty/selected/verified seats, clickable source entries, real monitoring, pause and Stop against a synthetic provider. Its post-probe assertion was corrected to the actual paused session; readiness is not active watching.
- All three connection/chat/memory/rule UI workflows pass with generated images and mock providers.
- Independent source review approved the connection/layout boundary after correcting the compact Add source status rule's CSS specificity.
- The first visual run exposed squeezed default feed rows when reserving the larger desk height. Default-only vertical growth preserves fitted rows and the desk while leaving custom/compact behavior under user control. Independent review caught a scrollbar-width feedback loop; a stable gutter fixes it. Final review is approved.
- All 14 final packaged Windows workflows passed (1.7 minutes). This includes both live-source/docking workflows, minimum-width source and desk headers, split-seat controls, memory search/filter preservation and accessibility hiding, live capture continuity, and geometry settling at the scrollbar threshold minus one/exact/plus one pixel across 20 animation frames.
- The v0.3.3 synthetic desktop, multisource, compact and empty-desk crop assets were regenerated and visually inspected. Native inspection of the reopened actual app confirmed the labeled header source control and single glowing empty seat. Both split seats were verified in packaged fixtures. The app is left visibly running; further UI input stopped when user activity was detected.

## Package and delivery

The unsigned Windows x64 installer is 114,939,432 bytes with SHA-256 `dac853234cb6e70b9d5295c61edd61309559620e1740db9fb4212803c42a2163`. Extracted `app.asar` matches the tested unpacked application at `81980b6215094d10f6ab0b994d97cf0b8fb8501f34b0460b4ec0da10d30fc391`. The extracted/bundled CLI matches the existing installed workflow CLI at `3912267f27188c947d1ea75a9953d237c6960bc2382e9ed0415d572005d42b1b`; no personal skill/plugin/tool snapshot changed. Installer execution was not tested. Existing local Desktop and Start-menu shortcut targets were checked and still point at the updated unpacked application.

Source/CI/tag/assets public delivery remains pending. Planning validation passes all 51 Markdown files, 26 slices and requirement coverage. Local source hygiene and final delivery evidence will be recorded here.

Published fixtures use synthetic media only. This slice does not establish real monitor/camera acceptance, independent agent connections, native action effects, provider reachability after verification, or sustained model throughput.
