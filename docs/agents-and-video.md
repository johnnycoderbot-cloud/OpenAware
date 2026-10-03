# Independent agents and video sources

Version 0.4.0 development work is tracked in the [implementation handoff](../.omx/logs/independent-agents-video.md). This page describes the accepted behavior; final verification is recorded there.

## Capacity and connections

The source library holds up to sixteen selected feeds. Each of up to four agents can be assigned zero to four feeds. Assigning a feed to two agents uses one capture pipeline and separate model inference. Agents can use different local endpoints and models, or deliberately select the same endpoint/model. Each agent owns its verification state, conversation, temporal captions, semantic rules, historical summaries and bounded work queue. One inference runs at a time per agent; different agents can dispatch independently. Actual server/model hardware may serialize requests or run out of capacity, so the limits describe app admission rather than measured model throughput.

The desk starts with Agent 1, an operator that can observe and propose computer actions. New agents start without a model or assignments. Seats show the glowing **Needs agent** outline until their own selected model passes the synthetic vision test. Selecting a seat changes the assistant, Connections, rules and memory to that agent. It never copies another seat's model or history. Adding sources assigns them to Agent 1 while it has room, until its first explicit Feeds edit; after that, assign new feeds explicitly. Additional agents always use explicit assignments.

An observer can monitor and converse. An operator can also propose a plan for an assigned desktop source. Only the active operator can submit a plan to the native per-step review, and switching agents cancels that authority. Video files and web-player pages are never native input targets. A seat, model response or alert cannot approve actions.

Pausing one agent cancels its analysis while shared previews and other agents continue. **Stop all**, tray Stop and the emergency shortcut release every source and invalidate every agent's pending work. Removal or reassignment invalidates old source/agent provenance before dispatching new work. Configuration, provider tokens, captions, media registrations and web-player sign-ins are memory-only; restarting restores an idle session.

## Video files and direct links

Use **Add source** to choose a video file through the native picker. Decoding occurs in an isolated source owner, with no audio input or audio analysis. The default label uses the basename, while the source record stores an opaque device reference rather than a filesystem path. Only formats supported by the bundled Chromium decoder are expected to play; an extension alone is not proof of codec support.

Direct video mode accepts explicit HTTP(S) media URLs. It streams the selected resource through an authorized opaque media route with Range support, allowing preview and masked sampling without requiring the remote server to enable canvas CORS. The link form holds the entered URL while preparing it; registered URLs and query credentials are omitted from source/frame metadata, model request envelopes and error text. Visible captured page text can contain addresses. Credentials in URL authority, filesystem schemes and arbitrary privileged routes are rejected. No automatic credentials, downloader or platform-specific extractor is provided.

Frames enter the same freshness, privacy-mask and source-revision checks as monitor/camera frames. The preview displays playback continuously; AI analyzes bounded image samples and does not establish comprehension of every video frame. Captions use wall-clock capture time, not a searchable media-time index. Stop releases playback and network activity; reopening requires a new capture connection.

## YouTube, Facebook, TikTok, Instagram, X and other video pages

Web-page mode opens the supplied HTTP(S) link in a separate sandboxed player window. **Open player** lets the user press Play, select controls or sign in. OpenAware captures the rendered page containing the video, including visible controls and surrounding content. It does not extract a site's raw video URL, download media, reuse a browser's existing login or bypass protected playback. A site may require a visible player, sign-in, consent, compatible codecs or supported browser authentication. These platform-specific flows remain live acceptance gates until tested.

Player pages have no OpenAware preload, Node access, source acquisition permission, arbitrary external protocol launch or download bridge. Playback pages can contact the site's network resources; model requests still use only the explicitly configured local endpoint. Opening a network player and connecting a local model are separate operations.

If an embedded player is refused by a site, select its browser window as an ordinary **Window** source. That follows the visible tab in the chosen browser window; a dedicated browser extension for independently capturing existing background tabs remains outside this release.

## Verification boundary

Tests use generated videos, localhost media servers and synthetic page content. Successful fixture playback establishes decoding, capture, routing, masking and lifecycle behavior, not compatibility with every public platform, personal video, authenticated account, protected video or hardware configuration. See the handoff for actual counts, review verdicts and package evidence.
