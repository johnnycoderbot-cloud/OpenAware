# Independent agents and video sources

Date: 2026-10-03. Status: implementation authorized. Extends the shipped v0.3.3 prototype; verification is recorded separately in the [handoff](../logs/independent-agents-video.md).

## Accepted outcome

The user requested independent agents after learning that the four-source limit was global. Each agent owns an explicitly selected and synthetically verified local model connection, conversation, monitoring rules and up to four assigned sources. Support up to four agents and a shared library of sixteen selected sources. Capture each physical source once; assignment permits an agent to analyze that source and never grants computer-action authority.

The user also requested local PC videos and web videos including YouTube, Facebook, TikTok, Instagram and X. Offer native file selection, direct HTTP(S) media URLs, and web-page video sources. Web sources render the supplied page in an isolated player window; the user can press Play or sign in. Monitor actual page pixels, with no download/extraction adapter, platform authentication bypass or protected-video guarantee. Explicit local model selection remains separate from opening a network video page. Registered URLs and local paths are represented by opaque main-process media references in source metadata; the link form holds the URL while preparing it.

## Execution slices

| Slice | Owner and files | Required behavior | Verification and exit |
| --- | --- | --- | --- |
| Agents | Backend Architect `/root/independent_agents`; contracts, service engine/composition, agent tests | Compose bounded per-agent engines around a shared capture catalog; four sources per agent, sixteen catalog sources, four agents; independent bindings/queues/state; active-agent legacy aliases; source and agent revision provenance; global Stop invalidates all work | Tests prove concurrent independent inference, assignment bounds, no unassigned pixels, binding switch/removal/Stop cancellation and stale results, role gates, active-agent isolation; strict TS |
| Videos | Senior Developer `/root/video_sources`; main/preload/capture paths, build entry, video/capture tests | Native file picker and explicit direct/page URLs produce opaque registrations; isolated decode/player windows feed bounded capture packets into existing masked sampler; Play/sign-in window control; Range support, no audio, Stop closes all owners/network | Synthetic local file and localhost stream/page playback reach preview and model sampling; validated schemes/redirects/references; late packet and failed/ended stream cleanup; no real personal feed evidence |
| UI | Existing native worker `/root/agent_use_requirements`; renderer App/styles/desk/state and scoped UI tests | Actual independently configured seats, compact add/select/rename/role/remove/assignment controls; Connections/chat/rules use selected agent; per-agent Start/Pause vs global Stop; Add source file/link controls and Open player; preserve flat draggable workspace/feed continuity | Synthetic desktop workflow covers two distinct bindings/assigned sources, independent status/chat, four-assignment and catalog bounds, video picker/player control; empty seats retain glowing Needs agent |
| Integration | Root; release metadata, docs, additional desktop tests/config, native action identity checks after video handoff | Wire all boundaries, preserve CLI read/command restrictions and per-step native approval; truthful capabilities/docs; build/package and public source delivery after review | Existing plus new tests pass; packaged synthetic workflows; planning/hygiene validation; independent review approved; document untested platform login/protected content/model throughput |

## Interface agreement

Add `AgentSnapshot[]` and `activeAgentId` to Snapshot. Each agent has id, name, observer/operator role, revision, sourceIds, session, epoch, binding/models, observations/events/chat, busy/queue, pipeline/history and pending plan. Existing binding/model/chat/pipeline aliases refer to the active agent, while sources is the shared catalog. Commands `agent.add`, `agent.update`, `agent.remove`, `agent.select` manage identity/assignments. Agent-specific existing commands accept optional agentId and pin the resolved identity before asynchronous work. Default Agent 1 is an operator (also able to observe) for legacy action compatibility; other agents start unbound and unassigned. Automatic assignment on add applies only to default Agent 1 while it has room, until its first explicit assignment edit. Switching seats never copies a binding.

Video kinds: `video_file`, `video_url`, `web_video`. Bridge `chooseVideoFile()`, `prepareVideoUrl(url, mode)` and `openVideoSource(sourceId)` return/use sanitized names and opaque `video:<uuid>` device references. Page mode watches a page containing a video, including visible page controls. Its pixels use existing bounded DesktopCaptureFrame transport; analysis applies privacy masks and existing freshness rules. No provider gets a raw URL or file path.

## Boundary checks

- Each engine admits one physical inference at a time; engines can run independently. Choosing the same server/model for multiple seats does not guarantee hardware concurrency or throughput.
- Reassignment, removal, role/model switch and Stop invalidate pending authority before asynchronous cancellation. Late results cannot reappear under another seat or assignment revision.
- Video/page sources cannot become native monitor action targets. Only active operator plans can enter existing native review. Switching agents revokes that plan.
- The dashboard remains sandboxed and network-denied. Untrusted player pages have no OpenAware preload, filesystem/IPC access, capture permission, downloads or arbitrary external scheme navigation.
- Global Stop releases every capture owner and invalidates every agent's inference/plan. Pausing one agent preserves shared previews and other agents' watches.
- Configuration/history/media registrations are memory-only; restart is idle and restores no source, model, platform sign-in or watch.

## Verification map

Run `npm run check`, `npm test`, `npm run build`, scoped synthetic desktop workflows then all desktop workflows. Test file/HTTP Range and page media using generated WebM/HTML only. Validate planning links and public source hygiene. Record actual results, failures/corrections, review verdict and package identity in the handoff. Platform compatibility, protected content, authenticated playback, actual personal videos and sustained multi-model performance remain explicit live gates until exercised.
