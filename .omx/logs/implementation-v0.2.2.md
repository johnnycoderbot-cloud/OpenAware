# v0.2.2 execution ledger

Status: accepted local developer prototype. The owner requests a readable video feed at the bottom after connecting two monitors, draggable panes side to side and up/down, then a conventional chat box without redundant captions and toggle bars. The owner explicitly chose all main panes, including live feeds and assistant.

The UI worker owns App composition, CSS and the synthetic visual regression; scoped test workers own split-tree and compact-control/native-capture coverage. Root owns integration, version, verification, packaging and delivery. Independent review approved the source and generated UI artifacts. The owner-provided live-screen screenshot remains private; only generated fixture content appears in public screenshots.

## Implemented behavior

All five main panes and individual desktop/camera feeds support edge docking and divider resizing. Keyboard Move controls and focused divider arrow keys provide equivalent placement/resizing. Compact windows stack the main panes in tree order. Reset restores main and nested feed layouts without reconnecting sources.

The React layout uses stable keyed media parents and a local split tree, with no new dependency. Complete-tree minimum width/height and local scrolling keep mixed layouts usable. New camera sources honor the selected columns/stack preset while retaining existing leaf identities and ratios. Computer actions starts with a compact allocation.

The assistant uses a message history and compact composer. Sources chooses the explicit question scope; per-feed Settings holds analysis, motion and privacy controls. Repeated headings, welcome slogans, suggestion boxes, captions and toggle bars are removed. Connection, live/freshness state, mask review, actual errors, Stop, cancellation and native action approval remain functional. Sources menus fit the minimum assistant height; Escape restores menu-trigger focus.

Source capacity remains four total. Layout, setup and history remain session memory. Capture/main/preload/runtime authority code is unchanged from v0.2.1; the contracts change only updates the displayed version.

## Review and corrections

Independent source and generated-artifact review is approved. Initial review and rendered checks found duplicate split IDs, inadequate mixed-tree height/width, compact ordering, missing keyboard relocation, a camera Reset height race and inherited feed-panel clipping. These were corrected before packaging.

Renderer resize tests now wait for actual settled pane geometry. Native Focus continuity uses stable source IDs and requires advancing sampled frames plus native captured timestamps, sequence and receipt counts. Its diagnostic timeout accommodates the two-second service sample cadence; exact fixture routing, direct desktop denial and Stop assertions remain intact. The corrected targeted native workflow passed in 9.3 seconds.

Synthetic visual tests show their generated window without activation so hidden-window rendering cadence does not stall Playwright stability checks. Test-only Chromium/API throttling settings do not change the production launch. The final two visual workflows passed in 7.7 seconds under the original 45-second test limit.

## Verification evidence

- Strict TypeScript, production build, formatting and whitespace checks pass.
- All 91 unit/integration tests pass, including 15 split-layout invariants.
- Source desktop workflows: nine passed in the full run; the corrected native workflow passed its targeted rerun on the same production bundle.
- Planning validation passes: 36 Markdown files, local links/anchors, 26 slices, acyclic dependencies and requirement coverage.
- Source hygiene checks 96 tracked paths for private/generated state, private user paths and detected credential patterns.
- All 10 packaged Windows x64 workflows pass in 1.6 minutes: background monitoring, headless launch, normal close, desktop, native capture, tray controls, motion, scoped chat and two layout/visual workflows. Release executable metadata is 0.2.2 / 0.2.2.0. The NSIS installer is 114,795,419 bytes and is not signed.

The installer SHA-256 is `73e015a0f9e3ace5e82bf35275493975a0973fa8bfba3368aa09942022faa724`; SHA256SUMS.txt names the normalized upload asset OpenAware.Setup.0.2.2.exe. The installer itself is not exercised by the unpacked executable workflow checks.

## Delivery boundary

Publication requires matching public source/tag, successful application/planning CI at that exact commit, and uploaded installer/checksum digests matching local files. The final local verification record stores that evidence after publication. The [v0.2.2 release](https://github.com/johnnycoderbot-cloud/OpenAware/releases/tag/v0.2.2) and its metadata identify the delivered commit and assets.

UI images and model workflows use synthetic fixtures. Native acquisition uses only two generated windows, never personal desktop content. Owner attachments are not public assets. Personal monitor/camera hardware, mixed DPI, actual model performance, native input effects, Bionic, installation, sleep/lock and sustained monitoring retain their documented acceptance gates. The blue tray icon and isolated capture correction from v0.2.1 remain in this build.
