# OpenAware v0.2 concept fidelity and background mode

Authorized follow-up: user reported that the current application looks different from the generated preview, requested comparison, and selected background monitoring with tray controls. Scope includes correcting the dashboard composition and adding that background lifecycle. Public MIT source and prototype distribution remain authorized.

## Deliverable and boundaries

Match the generated concept's top navigation, dominant selected desktop feed, camera strip and right-side assistant/actions/events using implemented features. Keep source identities, masks, ages, Stop and real configuration behavior. Startup remains empty; screenshots are clearly synthetic. Do not imitate unavailable cloud, trading, voice or Bionic controls.

Background mode hides the dashboard while retaining the current selected capture and awareness session. Tray Show, Stop and Quit remain usable. Explicit background mode changes window-close behavior to hiding; normal window mode closes the app. `--headless` and `--background` launch tray mode without automatically selecting personal sources. This is an interactive Windows desktop process, not a Windows service or unattended action grant. No new HTTP server, persisted credentials, automatic source restoration or native approval bypass is part of this slice.

## Ownership and interface

| Native owner and role | Owned files | Handoff |
| --- | --- | --- |
| /root/ui_review_v011 — UI Designer | renderer App.tsx and styles.css | Concept comparison; implementation; viewport and synthetic UI checks |
| /root/background_desktop — Senior Developer | main/index.ts, main/background.ts, preload/index.ts, tests/background.test.ts | Trusted bridge, tray/window lifecycle, shutdown and focused unit checks |
| /root/background_tests — API Tester | tests/background.spec.ts | Real Electron hidden capture continuity, Show, close and Quit tests using synthetic data |
| /root — default | contracts, test/build configuration, existing test adaptation, docs and delivery | Integration, cross-review, packaged workflow, public release verification |

New narrow bridge methods: `getDesktopState()`, `setBackgroundMode(enabled:boolean)`, `onDesktopState(callback)`, and `quit()`. `DesktopState` has `backgroundMode:boolean`, `windowVisible:boolean`, `trayAvailable:boolean`, and `launchMode:"window"|"background"`. These do not change observation or action authority. Test-mode hidden windows exercise lifecycle without registering an actual tray or global shortcut.

Workers preserve other edits. No personal screen/camera or native input effect is exercised in development. The generated concept is visual guidance; it does not establish shipped capabilities or seeded startup data.

## Verification and completion

Require strict typecheck, appropriate unit and Electron regressions, production build, screenshots at 1440x960 and 1024x720 without full-page framing, Windows prototype packaging and packaged workflow. Existing provider, Stop, mask and action boundaries must remain intact. Quit must close the window and child service; background capture must continue while hidden. Inspect the public commit, CI, release asset and checksum before handoff. Record actual results and remaining native/model gates in a durable execution ledger; mark each review approved or changes_requested.
