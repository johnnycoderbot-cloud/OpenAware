# OpenAware v0.2.1 desktop capture and recognizable tray icon

The owner selected two monitors and both connections returned permission denied. Background then hid the window behind an unrecognizable mint square. Fix both issues and deliver the rebuilt application.

## Scope and ownership

| Owner and role                           | Responsibility                                                             | Reviewable handoff                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| /root — default                          | Main IPC, contracts, preload, build, lifecycle, documentation and delivery | Source/package checks, exact source/token ownership and updated app opened                      |
| /root/desktop_capture_owner — worker     | Isolated capture broker and fixed helper document                          | Per-source one-shot selection, bounded decoded preview, Stop/replacement cleanup                |
| /root/desktop_preview — worker           | Renderer preview delivery and lifecycle unit tests                         | Original timestamps, masks and stale-token rejection                                            |
| /root/native_capture_regression — worker | Native two-window regression                                               | Only generated fixtures captured; denial of direct/legacy requests, advancing previews and Stop |
| /root/tray_icon — worker                 | Transparent raster tray and matching app assets                            | Small-size visual check and PNG/ICO decoding tests                                              |
| /root/permission_review — Code Reviewer  | Independent source boundary review                                         | approved or changes_requested with evidence                                                     |

## Capture boundary

Electron v44.5.1 reports desktop requests as media with empty mediaTypes. The initial compatibility predicate fixed modern capture but native regression proved a legacy getUserMedia desktop ID could bypass the selected source while that dashboard lease existed. That approach was rejected and must never be delivered.

Create one fixed hidden capture WebContents per explicitly selected registered source. Each has a nonpersistent isolated session, no preload, Node, IPC, navigation or network role. Its one-shot selection is tied to the exact source, native frame and disposable owner. Main invokes only fixed start/drain code and forwards validated bounded JPEG frames with original decoded timestamp and an opaque capture token. Dashboard desktop permission always denies; camera video retains the explicit native dialog. Renderer accepts only its current token and preserves normalized privacy masking. Stop invalidates pending main starts synchronously and destroys helpers; old token results cannot affect replacements.

## Icon

Replace unsupported SVG decode and solid-square fallback with a transparent blue eye/O raster icon at Windows tray DPI sizes. Keep a clear OpenAware tooltip and matching PNG/SVG/ICO branding for the app and installer.

## Completion

Reproduce the original denial and rejected legacy bypass with two controlled generated fixture windows. Verify native capture through the isolated helpers, advancing canvases, foreground/background switching, unselected/direct/legacy denial, pending Stop and track-owner destruction. Do not capture personal screens or cameras, contact real models, or perform native input during tests. Run typecheck, meaningful units, source/packaged Electron workflows and production packaging. Publish v0.2.1 with public CI and matching installer checksums; restart the known app instance so the owner can reconnect both monitors. Physical monitor/DPI behavior remains for the owner's retry. Record evidence and close OMX state honestly.
