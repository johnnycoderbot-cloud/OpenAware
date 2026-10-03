# v0.2.3 execution ledger

Status: accepted local developer prototype. The owner requests two monitors side by side by default, then extends the slice to one clean workspace with movable/resizable panes and no nested boxes or wasted status/Layout rows. Each source and tool is now a direct leaf in one dashboard. Compact headers contain the arrangement menu, source state and model picker; common source controls share the navigation row. Two monitors default side by side; three/four feeds use at most two columns, with cameras below desktops. Reset, source membership changes and returning to Overview rebuild the default layout. An unframed workspace scroller honors pane minima after arbitrary docking.

Root owns component integration/version/delivery; workers own CSS, the pure tree plus units, and generated visual regression. Independent frozen source/documentation review is approved. Capture authority, provider behavior and the four-source limit are unchanged. User screen previews are private; tests and public screenshots use generated sources only.

## Implementation and review

The default tree keeps exact source IDs, avoids split/leaf collisions, and groups desktops and cameras into at most two columns. React renders every pane under one stable board; geometry changes keep media parents mounted. Reset and source membership changes rebuild the same default without reconnecting existing captures. Compact windows use vertical tree order; larger custom arrangements honor pane minima with one unframed scroll viewport. Focus feed scrolls and focuses its existing pane.

Source settings use a compact popover; the assistant has a conventional history and composer with an inline Sources control. Common source controls and global Reset share the fixed navigation row. No empty camera container, nested feed board, Layout row or evidence/status strip consumes workspace space. Frame timing, source state, mask review, Stop and source/model provenance remain available.

Rendered review found the implicit grid column could clip the assistant model/Arrange controls and composer at 1024 pixels. Explicit shrinkable pane/composer tracks and reserved assistant-header columns correct this. The visual regression now verifies full control bounds inside the pane and viewport, rather than relying solely on center-point hit tests. Service-backed checkbox tests wait for the asynchronous state update after a click.

## Verification

- Strict TypeScript and production build pass; formatting and whitespace checks pass.
- All 104 unit/integration tests pass, including 13 default-workspace tree tests.
- Both final source visual workflows pass in 13.8 seconds. They check one board/direct source leaves, two-monitor and four-monitor defaults, settings/source scope, Reset/navigation, movement and both resize axes, compact control containment, scrolling/Focus and retained media identities with advancing frames. Root visually inspected the regenerated 1024-pixel fixture.
- Planning validation passes: 38 Markdown files, local links/anchors, 26 acyclic slices and requirement coverage.
- Source hygiene passes for 100 tracked paths: detected credentials/private user paths and generated/private session state are excluded.
- All 10 final packaged Windows x64 workflows pass in 1.7 minutes: background/headless/close, desktop, two exact generated native windows, production tray callbacks, motion, scoped synthetic chat and both workspace workflows. Executable file/product versions are 0.2.3 / 0.2.3.0. The installer is 114,795,489 bytes and is not signed.

The installer SHA-256 is `4b4c86e0ca0b806e23b0dda4b2d34f6c398d7262a661f5b0baaf0a25c9e257e5`; SHA256SUMS.txt names the normalized upload asset OpenAware.Setup.0.2.3.exe.

Read-only extraction verifies that the installer's app.asar payload has the same SHA-256 as the tested unpacked application. This does not exercise installation or shortcuts.

## Manual app acceptance

Root reopened the final packaged application and used its actual interface to select both local monitors through Add source. Both previews report LIVE, 640 × 360 at 15 fps and Preview 0s ago. They appear side by side automatically, after navigating through every page and after global Reset. No real screen image was saved into public assets.

Overview shows the direct source panes and compact assistant. Operator lists both live monitors and keeps planning disabled without a selected target/verified model. Connections shows the local provider forms; switching to Ollama updates the endpoint to port 11434, while the vision test remains disabled without a model. Event log shows both source events; Acknowledge changes one to Reviewed and reduces its badge. Root left Overview open with both previews LIVE. These are UI/control observations, not successful real model inference or native action execution.

## Delivery boundary

The final release requires matching public source/tag, successful Windows/Ubuntu application and planning CI at that exact commit, and uploaded installer/checksum digests matching local files. Private session state records the final evidence after publication. The installer itself is not exercised by unpacked executable checks. Generated fixture results do not prove real model vision, camera negotiation, native input effects, mixed DPI, Bionic, lock/sleep or sustained hardware performance.
