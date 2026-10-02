# OpenAware UX and interaction specification

Status: Draft · Updated: 2026-10-02 · Owner: Design lead (to be assigned).
Related: [product requirements](product-spec.md), [integration evidence](integrations.md), [architecture](architecture.md).
This is a stand-alone desktop-dashboard design. Native embedding in Bionic is not established.
Availability follows [roadmap P0–P5 gates](roadmap.md#release-phases-and-exit-criteria); unavailable P4/later features are absent or clearly disabled rather than implied by the concept design.

## Layout and information hierarchy

The main view contains a persistent session bar, a source grid, a conversation panel, and an events drawer. Source identity and age are never hidden by the layout. Trading is a workspace configuration, not a different permission regime.
At desktop widths of at least 1280 px, the source grid takes approximately two-thirds of available content and conversation one-third. Below 960 px, conversation becomes a tab; Stop and session status remain visible. These are proposed design breakpoints.
The session bar shows session state, selected provider/model, active source count, last observation, Start/Pause analysis/Resume, and Stop all. “Local” or a named cloud destination appears beside the model.
Each source tile shows name, kind, connection status, live preview, analysis status, last sampled time/age, latest observation summary, and a menu for focus, rename, disable analysis, rules, and disconnect.
The events drawer shows unresolved events first, with filters for source, rule kind, time, and acknowledged state. A historical event retains the source name at the time of observation as well as its stable ID.
The model indicator opens selection. A separate Sources button opens device/source setup. Settings group Connections, Monitoring, History, Notifications, and Accessibility; no implementation jargon is needed in primary task flows.

## First-run journey

1. Explain the three visible states in one short panel: live preview, AI analysis, and stopped. Display “No feeds connected” initially.
2. Choose a source type: camera or virtual camera in alpha; direct monitor/window and IP camera types appear only when their adapter is available.
3. Show actual discovered devices with refresh and access guidance. Request camera permission when the user connects a device.
4. Name the source and verify the preview. An OBS feed includes setup guidance and a reminder that a composite scene is one source.
5. Connect LM Studio: show configured local endpoint, test connection, and present installed/available model entries. Use actual capability metadata plus the image probe result.
6. Select the model. If loading is necessary, show the model's current state and an explicit load action when supported; otherwise link to loading guidance for LM Studio.
7. Run a user-initiated sample question with source/time labels. Show actual elapsed time; do not turn that first response into a universal latency promise.
8. Offer Start analysis with displayed source scope, destination, requested cadence, and default retention. Preview alone never starts inference.
9. Keep Add source and Ask a question visible after setup. Do not require rule creation or account signup for local observation.

## Main journeys and acceptance

| Journey | Interaction | Success / requirement reference |
| --- | --- | --- |
| Follow several screens/cameras | Add supported feeds, select analysis, Start | All enabled sources expose freshness; one source failing leaves others usable. OA-SRC-002, OA-AI-005 |
| Ask about a source | Focus tile → question scope chip → type question → send | Answer displays the evidence source/time and whether a newer frame was acquired. OA-CHAT-001 |
| Compare sources | Select two or more source chips → send comparative question | Response sections identify each source; unavailable sources show missing evidence. OA-AI-004 |
| Watch a camera change | Tile menu → Add motion rule → region and threshold preview → enable | Test mode shows detected region change; event contains rule/source/time. OA-ALT-001 |
| Watch a semantic event | Choose semantic rule → plain condition → evidence limits → test → enable | Model observations are labeled; unresolved evidence becomes unknown. OA-ALT-002 |
| Watch an exact price condition | Add structured data source → symbol/venue/unit/session → threshold → test | Stale data suspends evaluation; chart-only source cannot provide exact crossing rule. OA-TRD-002 |
| Prepare a paper idea | Ask for proposal → inspect assumptions → edit → Save paper proposal | Saved record is hypothetical, has evidence/time, and includes no broker action. OA-TRD-003 |
| Change model | Model indicator → choose → probe → Resume | No old-model result is accepted after the switch; actual new model is labeled. OA-MOD-002 |
| Use Bionic | Connect verified bridge → list scoped sources → ask/receive observations | Bionic receives only selected source data and reports actual model provenance. OA-MOD-003 |
| Halt monitoring | Stop all | Acquisition, dispatch, pending evaluation, and app-owned streams end; tiles become stopped. OA-CTL-003 |

## Control meanings

| Control | Effect | Visible language |
| --- | --- | --- |
| Connect source | Starts selected source preview only | “Preview live · AI off” |
| Start analysis | Starts selected model analysis and enabled rules | “Analyzing selected sources” with freshness per source |
| Pause analysis | Stops new background model dispatch and all active rule evaluation; previews remain connected | “AI paused · previews still live” |
| Resume analysis | Rechecks model/source readiness and begins new-generation analysis | “Resuming…” then actual per-source states |
| Disable analysis on source | Excludes that source from analysis/rules; preview remains | “Preview live · excluded from AI” |
| Disconnect source | Stops that source acquisition and clears its pending frames | “Disconnected” |
| Stop all | Stops all app-owned sources/analysis/rules and clears ephemeral frames | “Stopped · no active feeds” |

Stop is one click, requires no confirmation, is keyboard reachable, and remains available during errors/modals. A Stop acknowledgement reports whether source teardown completed; a teardown error is visible and retried, rather than falsely reporting success.
Pause does not hide that previews remain live. Frame-derived questions while paused require explicit Send and display “Use a fresh frame” or “Use last observation”; a fresh-frame send is a one-time request, not monitoring resume. Rules remain suspended.
After Stop, fresh visual questions require explicit reconnect of the relevant source. Historical text observations remain available under the chosen history setting; they are labeled historical.
Deleting a source does not delete its retained history unless the user chooses that operation. Stop clears current acquisition, not separately opted-in stored records.

## Source setup and focus

Source setup shows source kind, actual device/adapter ID, display name, negotiated resolution/fps, analysis toggle, optional region, priority, and connection status. Displaying a tile never proves the model is receiving it.
Source policy includes excluded regions and allowed destinations; a mask preview lets the user inspect the actual masked analysis image before enabling export. Revocation blocks pending exports immediately.
Default maximum selected sources is four for alpha. The UI explains that this is the supported pilot budget; limits are configurable only when the tested configuration permits them. Resource overload offers a concrete reduction in resolution, cadence, or active sources.
Selecting a tile enlarges its preview and focuses conversation scope. It does not disable other sources. Multi-source chips remain explicit; changing tile focus does not rewrite an unsent question's source chips.
Choosing a region changes analysis framing and stores region coordinates against the source generation/resolution. A resolution or window geometry change invalidates the region and asks for recalibration before its rule resumes.
The tile displays preview frame age and AI sample age separately. A moving preview with old AI evidence shows “Live preview · last AI sample 14 s ago” rather than a generic green live badge.
Unknown/replaced devices cannot inherit a prior device's permission, region, or source name silently.

Start vision analysis requires a verified image-capable model. Motion-only monitoring can start with a ready deterministic detector and no model; setup makes that path explicit. Pause monitoring suspends rule evaluation and background inference while previews continue. Pausing or disconnecting an individual capture source also stops acquisition from that source.

## Model selection and connections

The local model picker groups by provider, with name, model ID, installed/available versus loaded state, verified vision status, and current selection. Text-only or unverified models remain discoverable but cannot start visual analysis.
Model test gives meaningful steps: connecting, checking capability, sending selected sample, awaiting response, ready/error. Sample data scope is visible before the test.
Requesting a model change immediately pauses dispatch and cancels the old generation while previews continue. The old binding is retained only as rollback configuration. A successful probe makes the new binding ready; a failed probe offers the previous binding. Either outcome requires explicit Resume before monitoring restarts, and late results from the old generation are discarded.
LM Studio remains responsible for downloads and model management. OpenAware supplies refresh/load guidance; downloaded models are not duplicated into OpenAware storage.
For Bionic, the bridge setup displays supported compatibility versions and how model selection is mapped in that tested combination. Manual selection is an acceptable first integration; unsupported synchronization is never shown as active.
Optional cloud profile setup records provider, endpoint, model ID, secret credential entry, supported capabilities, routing scope, and request/budget limits. Credentials are masked and cannot be recovered from export.
Before first cloud analysis, the UI names the destination and selected sources. The provider never changes automatically following a local timeout. Switching to cloud starts a new analysis generation and requires explicit resume.

Bionic pairing initially grants status access. Exporting a source image or sensitive text summary requires a separate recipient/content grant showing Bionic's verified or unknown model route and conversation retention. Strict local-only sources cannot export content to a host with an unverified route; the UI explains why and keeps status queries available. Selecting a local OpenAware observation model does not prove Bionic's conversation also runs locally.
“Local” labels describe the actual data path. Remote LAN endpoints identify their host; provider-side storage cannot be represented as OpenAware's local retention setting.

## Alert editor and event history

Every rule has name, kind, source/region, condition, hold behavior, cooldown, notification preferences, and enabled state. Kind is chosen before condition so available fields match how the signal is obtained.
Motion rules show sensitivity and a visual test overlay. Semantic rules show the selected condition plus “Evaluated from sampled frames; brief events may be missed.” Exact market rules show field, comparison, unit, symbol, venue, session, and data-age limit.
Test rule runs against disclosed sample/fixture evidence and displays evaluated true/false/unknown. Testing does not enable continuous monitoring. A rule cannot be saved enabled if required input or model capability is missing.
Proposed defaults: 30 s cooldown, in-app event only, no sound/OS notification, source-specific scope. Semantic hold defaults to two qualifying samples; all configurable values display their units.
An active condition produces one event with updated last-seen time; clearing and rearming are separate from acknowledging. Acknowledging means “I saw this,” not “the condition ended.”

Semantic trigger needs two qualifying samples at least 2 s apart; reset needs two clear samples. The 30 s cooldown runs from the last trigger. Clearing may occur during cooldown, but rearm requires cooldown expiry plus the latest fresh state clear. Missing or stale evidence never clears or rearms. Deterministic motion uses its own measured sample timing, independently of model latency.
An event card shows condition summary, source, evidence kind, sample time, event time, freshness, model if applicable, occurrence count, and acknowledgement. Stored thumbnails appear only when the separate image-retention choice is enabled.
Filters and export preserve timezones and source IDs. Display uses the user's timezone; exports include explicit offsets and raw timestamps. Empty history explains whether none occurred or persistence is off.
History settings distinguish saved setup from saved content: source/model/rule/settings configuration persists, while observations/events/conversation are memory-only by default, capped at 1,000 events or 16 MiB per session. Opt-in saved history shows its local location, encryption, and seven-day/100-MiB cap; deleting content does not silently delete setup. Images require a separate retention choice.
The history panel identifies LM Studio/Bionic/provider history as separate policies; deleting OpenAware history does not claim to delete those records. LM Studio frame requests disable server-side conversation storage with `store: false`.
Deleting selected history names the count/content to remove. Clear all offers a reviewable confirmation because it removes retained records; Stop never depends on that confirmation.

## Conversation and actual-computer actions

The composer includes provider/model, source chips, text input, Send, and a cancel control for its pending request. Questions waiting for a busy model have a visible queue position/status; new Send does not create an unbounded backlog.
Responses place a brief answer first, then source/time evidence and relevant limitations. A label such as “Observed in Camera 1 at 14:03:12” distinguishes capture time from response time.
An ambiguous source reference asks for a source or offers the current explicit scope. The app does not invent access to an unconnected monitor or Bionic tool.
Voice is a later capability with visible microphone state, transcript, push-to-talk option, and mute. “Listening” never means source analysis is enabled.
Later computer-action requests open a proposal panel showing actual target, requested steps, expected effects, expiry, and Stop behavior. Approval grants the displayed scope; merely asking for advice or enabling observation grants no action rights.
Partial completion is reported step by step. Changes to target identity, permission, or relevant current state halt with a recoverable explanation. Executed commands or sent messages cannot be disguised as draft suggestions.
Trading proposals remain visibly paper records. A live account/order flow would need a separate future product decision, integration contract, and explicit transaction authorization.

## Error and empty states

| Situation | Display and recovery |
| --- | --- |
| No sources | “Connect a camera or virtual camera” plus supported adapter options; Start disabled with reason |
| Camera access denied | Named source, permission guidance, Retry; other sources continue |
| Device disconnected / window closed | Frozen preview replaced with disconnected overlay and last-frame timestamp; reconnect does not swap source identity |
| LM Studio unavailable | Local endpoint connection error, Test connection, load/start guidance; previews continue with AI off |
| Model unloaded / incompatible | Actual model state and specific recovery; visual analysis blocked until successful probe |
| Model timeout / rate limit | Last successful sample age, retry/backoff time, cancel; no implicit cloud fallback |
| Too much work queued | “Analysis slower than requested” with achieved cadence and suggested source/cadence adjustments |
| Malformed model response | No alert treated as true; show parse/retry error with redacted diagnostics |
| Structured market data stale | Rule “Suspended · data stale,” last timestamp, reconnect action; no false price-cross event |
| Stop teardown failure | Prominent remaining source/process state and Retry stop; keep dispatch disabled |
| Bridge unavailable | Bionic disconnected badge; dashboard observation stays available under its own session controls |
| Persistent storage full | Stop further persistence, preserve preview/analysis, show export/clear/change-retention options |

## Accessibility and acceptance checklist

- All main journeys run without a pointer; tab order follows session bar → source tiles → conversation → events. Visible focus is never obscured by an overlay.
- Stop has an accessible name and shortcut shown in settings; it remains reachable while connecting, waiting for inference, or viewing a dialog. Shortcuts must avoid unmodifiable platform conflicts.
- Status uses text and icon as well as color. Source and model labels, select controls, timestamps, and icon buttons have screen-reader names.
- Announce meaningful state/error transitions through a polite live region; alert severity escalation can use an assertive region. Do not announce every frame or elapsed second.
- Use at least WCAG AA contrast targets: 4.5:1 for normal text and 3:1 for large text and meaningful controls; verify implementation with automated checks plus keyboard/screen-reader walkthroughs.
- Support 200% zoom/reflow without losing Stop, source identity, or composer. Preview content can scroll/enlarge independently where its meaning requires two dimensions.
- Reduced-motion preferences disable decorative animation; no flashing event borders. Sound notifications always have a visual equivalent.
- Model/time/source provenance remains available in a text view when preview pixels are inaccessible. Caption/transcript requirements apply when later voice is enabled.
- Test with one supported Windows screen reader and record its name/version and results; an automated pass alone is insufficient release evidence.

## UX verification map

Use deterministic fixture streams for timing/state tests and opt-in actual device tests for permission/teardown behavior. A scripted provider delivers slow, failed, stale, out-of-order, and wrong-generation responses.
Required walkthroughs: denied device → recovery; four-source fair monitoring; question while model busy; model switch during inference; pause then one-time question; Stop with late reply; reconnect after wake; stale rule input; history off/on/delete; cloud routing display; Bionic unavailable fallback.
Record start state, user action, visible state, observed acquisition/dispatch effect, result provenance, and any failure. Release acceptance refers to [product requirement IDs](product-spec.md#product-requirements-and-acceptance); concept images do not count as functional evidence.
