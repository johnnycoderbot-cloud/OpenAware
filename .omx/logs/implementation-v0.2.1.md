# v0.2.1 execution ledger

Verdict: approved for the v0.2.1 developer prototype after independent source review, native capture regression, unit tests and packaged workflows. Public delivery is verified separately against the source commit, CI and uploaded asset digests.

The owner reported permission denied for two monitors and an unrecognizable tray square. Native reproduction using only two generated fixture windows confirmed the original permission denial. Electron 44.5.1 sends desktop capture through a media permission with empty mediaTypes. Primary version source: https://raw.githubusercontent.com/electron/electron/v44.5.1/shell/browser/web_contents_permission_helper.cc and https://raw.githubusercontent.com/electron/electron/v44.5.1/shell/common/gin_converters/content_converter.cc.

The first predicate correction let two modern fixture captures run, but independent review and a native legacy getUserMedia probe proved selected A could grant fixture B. Review verdict: changes_requested. This intermediate approach was not packaged, published or opened for the owner. The accepted remediation uses isolated fixed capture documents and denies all desktop requests in the dashboard session. Version-specific permission details do not distinguish the legacy route: https://raw.githubusercontent.com/electron/electron/v44.5.1/shell/browser/electron_permission_manager.cc.

The tray fallback was a solid mint bitmap after an SVG decode failed. A blue transparent OpenAware eye/O raster mark and matching SVG/PNG/ICO have been created. Icon unit tests and independent decoding of all eight ICO entries passed. The integrated production tray test constructed the actual native tray and exercised its installed Show, Stop and Quit callbacks; physical tray mouse clicks were not simulated.

## Reviewable handoffs

| Owner and role                           | Delivered slice                                                                                                                                   | Verdict                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| /root/desktop_capture_owner — worker     | Fixed isolated desktop capture broker/helper, exact selection and bounded fresh frames                                                            | approved after native execution                                              |
| /root/desktop_preview — worker           | Opaque-token preview lifecycle, native geometry, stale-frame and mask authority                                                                   | approved after eight targeted lifecycle tests                                |
| /root/native_capture_regression — worker | Two native generated fixture windows, exact color routing, live legacy denial, background continuity, Stop cleanup and pending-start cancellation | approved in source and packaged application                                  |
| /root/tray_icon — worker                 | Transparent raster tray, blue eye/O branding, SVG/PNG/eight-size ICO                                                                              | approved after size/encoding tests and native tray execution                 |
| /root/permission_review — Code Reviewer  | Permission boundary and in-flight sampling review                                                                                                 | approved after correction and two deferred-motion regressions                |
| /root — default                          | Main IPC, preload/contracts, integration, packaging and delivery                                                                                  | local prototype approved; public source/release checks required for delivery |

Review also caught an in-flight sample race: motion IPC could yield while a new decoded preview changed pixels or native dimensions. The sampler now snapshots reviewed masked pixels before yielding and rechecks sequence/time, native geometry, source revision/status, pipeline identity and freshness before submitting a JPEG. Deferred-motion regressions cover a resized masked desktop and a newer camera frame.

## Verification

| Check                       | Actual result                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| TypeScript                  | strict compilation passed                                                                                   |
| Unit tests                  | 76 passed, none skipped; controlled fixtures only                                                           |
| Production build            | main/preload/service/renderer plus fixed browser capture helper bundled                                     |
| Source Electron workflows   | nine passed in 1.5 minutes                                                                                  |
| Windows package             | x64 NSIS installer generated with matching app icon; installer not installed                                |
| Packaged Electron workflows | nine passed in 1.4 minutes through the actual ASAR app and service                                          |
| Planning validation         | 34 Markdown files, local links/anchors, all 26 slices, acyclic dependencies and requirement coverage passed |

The native Windows regression uses only two newly generated fixture windows with zero-thumbnail native enumeration filtered to their unique titles. It does not mock getDisplayMedia. Both hidden owners contain decoded native video tracks with displaySurface window and no dashboard bridge/Node. Distinct fixture colors prove exact source routing through JPEG canvases. Both timestamps advance while the dashboard is hidden. A direct legacy request is actually attempted while both owners are live and is denied; direct modern and audio desktop requests also deny. Stop destroys the retained native owners, removes previews, freezes receipt counters/timestamps, and cancels an immediately requested new start without late owner creation. No actual model or input effect is used.

Windows installer: `OpenAware Setup 0.2.1.exe`, 114791505 bytes. Authenticode inspection returned `NotSigned`. SHA-256: `d312da42e758d74e18154e30e5256dc726a5e39e5b36f5eb2aa34f3de9b43bd8`. The intended public artifact is the [v0.2.1 developer prerelease](https://github.com/johnnycoderbot-cloud/OpenAware/releases/tag/v0.2.1). GitHub normalizes the filename to `OpenAware.Setup.0.2.1.exe`; its published checksum uses that name. Final delivery verifies public source/tag, application/planning CI and both uploaded asset sizes/digests rather than treating an upload request as proof.

The known v0.2 app instance was stopped before replacing its binary. The rebuilt v0.2.1 app was started in normal visible window mode after packaged checks, with no selected feeds or restored settings. The owner can reconnect both monitors and use the blue tray eye to Show, Stop or Quit.

Personal monitor/camera hardware, mixed DPI, actual models, native input, Bionic, sleep/lock, installation and sustained performance remain unverified by these fixture tests. Screenshots contain only synthetic source/model content. No personal screen, actual camera feed, trade or external message was collected/performed in development.
