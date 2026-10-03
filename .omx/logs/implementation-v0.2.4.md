# v0.2.4 execution ledger

Status: local implementation, independent source review, packaging and manual acceptance complete. Public delivery requires the exact-commit gates below. Overview no longer includes Computer actions; Operator remains in navigation. Default monitor heights fit their video proportions above a movable/resizable empty New pane. Added monitor rows grow into the lower area; the extra leaf retains the unused remainder. Assistant/activity remain in the 75%/25% sidebar. The four-source cap is unchanged.

The owner confirmed **empty pane for future content**: direct leaf `extra`, title **New pane**, blank body and standard move/resize controls. No future content tools are built. It uses the unused remainder below fitted feeds rather than replacing a slot in a feed row. Fit sizing accounts for the 40 px header and separate 32 px footer outside the uncropped video; the product cap remains four total sources.

Root owns composition/version, ignored state/reviews and serial verification/delivery; bounded workers own fit logic, affected tests and documentation. Final independent source review is approved. Stable keyed media parents survive docking/resizing. Manual movement or resizing freezes the fitted geometry until Reset, membership changes or returning to Overview.

## Verification

- Strict TypeScript and production build pass. All 115 unit/integration tests pass, including 39 scoped docking/workspace checks and a 2→3→4-monitor growth regression.
- Three final packaged Windows x64 workflows pass in 37.3 seconds: the synthetic desktop/model-scope/Stop test and both visual workspace workflows. They verify fitted aspect, adjacent 40 px headers and 32 px external footers, lower-pane growth, direct leaves, Operator navigation, compact containment, movement/reset/focus, both resize axes, unchanged media identities and advancing frames. The vertical resize fixture creates available room before asking a pane at its minimum to shrink.
- Rendered verification exposed global 36 px icon minima overflowing the 32 px source footer. Scoped 26 px footer icons and inset keyboard focus outlines fix the overflow; adjacency assertions retain their original tolerance.
- Root inspected the generated 1440 × 960 and 1024 × 720 synthetic assets. No personal monitor frames are saved in public assets. Planning validation passes for 40 Markdown files, local links/anchors and 26 acyclic slices.
- Executable/installer product versions are 0.2.4 / 0.2.4.0. The unsigned installer is 114,795,747 bytes with SHA-256 `633e884c8af45c5bad2bebe81b840cc421c40eada54b49f4e38e2257056255eb`.
- Read-only extraction verifies the installer app.asar payload matches the tested unpacked app. Installation and shortcut behavior are not exercised by this check.

## Manual app acceptance

Root reopened the final packaged application and selected Screen 1 and Screen 2 through its ordinary Add source interface. Both real previews report LIVE, 640 × 360 at 15 fps and Preview 0s ago. They appear side by side at video height with New pane below and no large vertical letterbox bands. Operator is reachable from navigation; returning to Overview restores the fitted default and keeps both feeds live. The app is left open in Overview. Personal screenshots were not saved into public assets.

These observations establish local preview/layout behavior, not real model inference or native computer input effects. No Axelera Metis adapter is included.

## Delivery boundary

Final acceptance requires matching public source/tag, successful Windows/Ubuntu application and planning CI at that exact commit, and uploaded installer/checksum digests matching local files. Private session state records external results after publication. Real model vision, cameras, native input effects, mixed DPI, Bionic, sustained performance and sleep/lock behavior remain outside this layout release's evidence.

## Subsequent delivery

The layout changes in this local 0.2.4 slice were subsequently delivered inside the public [0.3.0 prerelease](https://github.com/johnnycoderbot-cloud/OpenAware/releases/tag/v0.3.0). No separate 0.2.4 release was created. The owner later authorized replacing the lower empty pane with Video memory; current acceptance and uploaded artifact evidence are in the [0.3 ledger](implementation-v0.3.md). Earlier pending-delivery statements above describe the original connectivity failure.
