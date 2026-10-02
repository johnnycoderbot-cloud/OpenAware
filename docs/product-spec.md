# OpenAware product specification

Status: Draft for implementation planning · Version: 0.1 · Updated: 2026-10-02 · Product owner: PM role (to be assigned).
Engineering/design/account owners below are proposed roles; repository maintainers assign people before development begins.
Related: [UX specification](ux-spec.md), [integration evidence and compatibility gates](integrations.md), [architecture](architecture.md), [delivery phases and slices](roadmap.md).

## Proposed launch paragraph

OpenAware gives people one place to talk with an AI about the desktops and cameras they choose to share. They can follow several live sources, ask what changed, and receive observations with a source name and observation time. Local vision models in LM Studio are the starting point, with a tested bridge to Bionic and optional provider connections planned. Traders can discuss charts and create paper proposals, while camera users can watch defined events. Users keep a visible distinction between previewing, analyzing, and authorizing a computer action.

## Problem and evidence

The user wants continuous visual awareness across their actual computer and cameras, rather than a sequence of manually submitted screenshots. Switching between sources, explaining the same context repeatedly, and checking for changes interrupt their work. Their described workflows include trading, camera observation, conversation, and eventually authorized actions on the computer.
The evidence currently consists of one founder conversation; there are no measured usage baselines, research sample claims, benchmark results, or validated market-size estimates.
The core hypothesis is that shared source context and useful, timely observations reduce manual checking without creating excessive alerts or hidden data sharing.
This repository is the planning foundation. It is not a running app or a claim that Bionic can embed the dashboard.

### Discovery before expanding scope

| Question | Method and owner | Completion horizon | Decision it informs |
| --- | --- | --- | --- |
| Which sources and changes matter? | PM: five consented interviews across desktop, camera, and trading workflows | Before P5 alpha release decision | Priority sources and rule templates |
| Can target computers sustain useful analysis? | Engineering: published capability spike on at least three declared hardware/model configurations | Alpha entry gate | Supported configurations and source budget |
| Do users understand preview versus AI analysis? | Design: five task walkthroughs using the prototype | Before P5 alpha release decision | Status language and pause controls |
| Are observations useful without being noisy? | PM: opted-in pilot logs and interviews; record rule types and stale observations | Two-week alpha pilot | Defaults, cooldowns, and rule scope |

## Goals, metrics, and trade-offs

All numbers below are proposed acceptance/pilot targets, not measured product performance. Baselines are unmeasured.

| Goal | Metric and denominator | Target | Owner and window |
| --- | --- | --- | --- |
| Get to first useful observation | Pilot users completing source + model setup and one grounded answer, divided by users attempting setup | At least 4/5 complete without facilitator intervention | Design, initial pilot |
| Understand sharing state | Participants correctly identify whether selected feeds are previewed, analyzed, or stopped | 5/5 correct in the tested flows | PM, P5 release gate |
| Provide useful observations | Observations rated useful by the pilot user, divided by rated observations | At least 70%; track by rule/source type | PM, first two pilot weeks |
| Keep selected feeds covered | Maximum time since a successful sample for each enabled source | Visible at all times; no source starvation in scheduler tests | Engineering, alpha |
| Stop predictably | Time from Stop acceptance to no new app-owned acquisition or dispatch | At most 1 s in supported test configurations; late provider results discarded | Engineering, release gate |

The first release favors clear evidence, source freshness, and bounded resource usage. Requested sampling frequency can exceed hardware throughput; OpenAware shows achieved cadence and offers a smaller source budget. Observation takes priority over adding broad action automation.

## Personas and primary jobs

| Persona | Job | Useful outcome |
| --- | --- | --- |
| Desktop operator | Follow a build, export, remote session, or several working windows | Know which selected source changed and discuss next steps |
| Camera observer | Watch chosen workbench, room, or equipment feeds | Receive a defined motion/event observation with relevant evidence |
| Trader/researcher | Compare charts, monitor structured conditions, and reason about a paper proposal | Keep a record of the inputs and hypotheses behind a decision |
| Local-model user | Reuse LM Studio model installation and Bionic conversation | Change models without reconnecting every feed |

## Release boundaries

The [roadmap phases and exit gates](roadmap.md#release-phases-and-exit-criteria) govern sequencing and estimates. No independent calendar commitment is introduced here. “Alpha” requirements below form the P1–P3 foundation released only after P5; P4 extensions ship only when their own gate passes.

| Release phase | Gate-based horizon / owner | Included | Exit gate |
| --- | --- | --- | --- |
| Foundation | Current request / PM + maintainer | Specifications, contracts, slices, concept image, public MIT repository | Documents and repository links reviewed |
| P0 evidence | Before source/model implementation / integration engineer | Synthetic LM Studio image inference, Bionic bridge/image test, picker/embedding/push outcomes | G0 records versions, results, limitations, and fallbacks |
| P1 selected sources | After G0 / capture engineer + design | Camera/OBS selection, live previews, four-source synthetic coverage, independent states and global Stop | G1 verifies permission, lifecycle, and no inference from preview alone |
| P2 local awareness | After G1 / engineering | Masks and consent, model selection, bounded local vision, fairness and freshness | G2 verifies policy revocation, isolation, queue limits, and opt-in inference |
| P3 assistant | After G2 / engineering + PM | Timeline, verified read-only Bionic tools, motion/semantic rules, typed grounded conversation | G3 verifies retention, provenance, stale suppression, and stand-alone fallbacks |
| P4 extensions | After individual dependencies / extension owners | Validated monitor/IP adapters, voice, structured market conditions, paper proposals | Each G4 gate passes separately or feature is visibly deferred |
| P5 Windows alpha | After core G0–G3 and selected extension gates / release engineer + PM | Tested core plus only validated P4 capabilities | G5 verifies reference-host measurements, accessibility, installation, and feature matrix |
| Later decisions | Reassess from pilot evidence / maintainer | Narrowly scoped computer actions, optional cloud adapters, broader provider support | Named owner, demand evidence, contract and capability verification |

OBS can supply desktops as a virtual camera in alpha. A composite OBS scene is one OpenAware source; regions are not independent sources unless an adapter explicitly provides separate streams. Multiple virtual cameras depend on what the OS/device setup actually exposes. Text legibility and source count must be tested.
Existing model installation belongs to LM Studio. Our stand-alone dashboard needs an explicit selector for the model used by background analysis. Reusing Bionic's selected model is a compatibility goal; automatic picker synchronization remains unverified. See [integrations](integrations.md).
Alpha excludes live brokerage execution, automatic external messaging, unattended computer control, mandatory cloud upload, guaranteed event capture, and interpretation of every video frame.

## Product requirements and acceptance

Requirement IDs are stable references for issues, contracts, and release tests. “Given/when/then” checks below describe observable behavior.

| ID | Requirement / release | Acceptance condition |
| --- | --- | --- |
| OA-SRC-001 | Explicit source selection / alpha | Given discovered devices, selecting one adds a named source only after access succeeds; denied access shows a recoverable error and no fake live tile. |
| OA-SRC-002 | Simultaneous sources / alpha | Given four supported test sources, all selected previews remain visible and all enabled sources receive scheduler turns; a blocked source cannot block others. |
| OA-SRC-003 | Source identity / alpha | Every frame-derived answer/event includes stable source ID, display name, sampled timestamp, and capture generation; source renaming cannot misattribute older evidence. |
| OA-SRC-004 | Continuous preview / alpha | Preview renders independently of inference; a slow model changes analysis freshness, not the live preview label. Proposed camera request: 1280×720 at 15 fps; actual negotiated values are displayed. |
| OA-SRC-005 | Separate source adapters / P4 | Direct monitors/windows and IP cameras appear only after adapter validation; a removed window/device produces a stopped/disconnected state with retry rather than silently selecting another source. |
| OA-AI-001 | Bounded scheduling / alpha | A source becomes eligible every 2 s by default; latest pending frame replaces its predecessor, with one local inference request in flight and bounded memory. A fair turn test proves no starvation. |
| OA-AI-002 | Freshness / alpha | Frame age is measured from original acquisition/capture time: dispatch requires age <=5 s; a completed observation requires age <=15 s. Delayed response arrival never resets evidence age. Each source exposes preview and analysis age; expired evidence is unknown/stale and cannot appear current. |
| OA-AI-003 | Vision capability / alpha | A model must have verified image capability and pass a user-initiated image probe before vision monitoring can start; metadata alone cannot prove working image/tool support. |
| OA-AI-004 | Context isolation / alpha | A response refers only to explicitly attached sources/evidence; source A observations cannot be reported as source B. Every result remains tied to its source and session generation. |
| OA-AI-005 | Fair multi-source analysis / alpha | A four-source deterministic test with a slow fake provider serves every eligible source within four completed source turns; failed requests release their slot. |
| OA-AI-006 | Provider failure / alpha | Timeout, malformed reply, unloaded model, and unsupported image errors retain previews and show recovery actions; no silent switch to a cloud model occurs. |
| OA-CHAT-001 | Grounded questions / alpha | Given selected sources, submitting “what changed?” displays the used source names/times and distinguishes an observation from a model inference; unavailable evidence is reported explicitly. |
| OA-CHAT-002 | Question priority / alpha | A foreground question takes the next available bounded request slot; continuous question traffic still permits a background source turn after at most one question turn. |
| OA-CHAT-003 | Conversation privacy / alpha | A source scope chip identifies which sources a question will use before sending; adding a new feed does not silently add it to an existing question. |
| OA-MOD-001 | LM Studio selection / alpha | Refresh lists actual available models with provider, ID, capability status, and loaded/available state. Selecting an incompatible/unloaded model gives an explanatory gate and explicit load/retry action. |
| OA-MOD-002 | Model change / alpha | Switching model pauses dispatch, discards old-generation replies, probes the new selection, and requires explicit resume; source preview connections remain visible. |
| OA-MOD-003 | Bionic model reuse / P3 | A published compatibility test identifies picker/manual-selection behavior; bridge responses label the model actually used. No claim of synchronization precedes that test. |
| OA-MOD-004 | Optional provider routing / later | Saving a cloud profile does not start upload. Before first use, users see provider, model, source scope, and analysis destination; unsupported providers/models cannot receive frames. |
| OA-CTL-001 | Start / alpha | Starting vision analysis requires a permitted source and verified vision model. An explicitly selected motion-only watch requires source consent and a validated local change detector, and can run without a model. The interface names the running mode and never reports AI analysis before usable evidence exists. |
| OA-CTL-002 | Pause analysis / alpha | Pause stops new background model requests and rule evaluation, cancels/discards their in-flight results where supported, and keeps previews visible with “AI paused” status. An explicitly sent one-time question does not resume background work. |
| OA-CTL-003 | Stop all / alpha | Stop releases app-owned sources, stops background loops, cancels pending work, discards late results, and clears ephemeral frames. Repeated Stop is safe; restart needs a user action. |
| OA-CTL-004 | Crash/reconnect / alpha | Restart after crash, permission loss, or computer wake returns to a non-analyzing state; feeds are not automatically sent to a provider. |
| OA-ALT-001 | Deterministic motion alerts / alpha | A configurable motion rule specifies source, region, sensitivity, hold time, and cooldown; a fixture test covers sustained motion, noise, disconnect, and rearming. |
| OA-ALT-002 | Semantic observations / P3 | A semantic rule specifies its plain-language condition and evidence limits; outputs are labeled model observations with sample time. Unknown/missing evidence never counts as a satisfied condition. |
| OA-ALT-003 | Alert lifecycle / alpha | A rule triggers after its hold condition; duplicates coalesce by rule + source + active condition. Cooldown defaults to 30 s from the last trigger. Rearm only once cooldown elapsed and latest fresh evidence is clear; semantic reset requires two clear samples, which may arrive during cooldown. Stale/missing evidence cannot clear or rearm a rule. |
| OA-ALT-004 | Rule suspension / alpha | Disabling, deleting, pausing, or stopping a rule prevents new alerts. “No motion detected” is never substituted for an unavailable feed. |
| OA-ALT-005 | Alert history / alpha | Every event records rule/source/model if applicable, sampled and event timestamps, evidence type, status, and expiry. Users can acknowledge/delete/filter/export records without restarting monitoring. |
| OA-TRD-001 | Chart discussion / alpha | A chart question includes source/time and visibly states if labels are unreadable; the app cannot invent a ticker, price, or timestamp from unavailable evidence. |
| OA-TRD-002 | Numeric trading alerts / P4 | Exact threshold rules require a structured market-data adapter, declared symbol/venue/session, timestamp, freshness policy, and unit. Image-only rules cannot be configured as exact price-crossing rules. |
| OA-TRD-003 | Paper proposals / P4 | A proposal records symbol, direction, entry assumption, invalidation, size assumption, evidence/time, and hypothetical costs; users edit it before saving. No broker order is sent. |
| OA-TRD-004 | Gated live-order lifecycle / later | A separately validated broker adapter requires explicit account/order approval, declared limits and fresh structured data; duplicate/replayed requests create at most one order. Uncertain acknowledgements require broker reconciliation before retry, with cancel/partial-fill outcomes recorded. |
| OA-ACT-001 | Permission boundary / later | Observation and chat never imply computer-action permission. Enabling an action grants only the named target, steps, duration, and effects displayed for approval. |
| OA-ACT-002 | Authorized action execution / later | Executor checks target identity and fresh state before each material step; changed target, stale evidence, revoked permission, or Stop halts execution with a partial-result record. |
| OA-ACT-003 | Effects and audit / later | Every action shows requested versus performed steps and affected target; external messages, commands, and account transactions require their own explicit grants. No action is added through inferred intent. |
| OA-DAT-001 | Default retention / alpha | Frames remain in bounded memory only; recording/thumbnail persistence is off. Observations/events/conversation are memory-only with a proposed session cap of 1,000 events or 16 MiB, whichever comes first. Structural source/model/rule/settings configuration persists; later minimal action/idempotency audits are separate. |
| OA-DAT-002 | Opt-in persistence / alpha | Enabling saved history states local location and content; encrypted history has a proposed cap of seven days or 100 MiB, whichever comes first, with clear/export controls. Frame evidence needs a separate image-retention choice. |
| OA-DAT-003 | Secret handling / alpha | API secrets are stored in OS credential storage, never exported or included in diagnostic bundles; test redaction covers URLs, headers, and error payloads. |
| OA-DAT-004 | Local/cloud distinction / later | “Local” applies only when frames and prompts stay on the declared local endpoint; cloud profiles show their destination and provider retention is described as provider-controlled. |
| OA-DAT-005 | Masking and scope / P2 | Configured excluded regions are masked before inference, bridge image delivery, or recording; revoking a source/destination grant invalidates pending exports. Fixtures prove excluded pixels never leave the policy boundary. |
| OA-ACC-001 | Accessible controls / alpha | Source selection, model selection, chat, alerts, pause, and Stop work by keyboard; focus, labels, contrast, screen-reader status, and reduced motion satisfy the UX acceptance checklist. |

## Rules, conversation, and evidence

A deterministic motion alert reports a measured region change; it does not identify intent or objects. A semantic alert reports the selected model's interpretation of sampled evidence and can miss brief events. Structured market rules evaluate explicit data fields; they do not infer precise prices from chart pixels.
Each alert contains: rule ID/version, source ID, observation kind, sampled time, evaluated time, first/last event time, freshness, detail, acknowledgement state, and expiry under the selected retention policy. Model confidence is omitted unless a defined calibrated method exists; a generated percentage is not treated as accuracy.
Proposed rule defaults: source-specific scope, two qualifying samples for semantic hold, 30 s cooldown, in-app notifications only. Motion hold uses measured time and configured sensitivity, rather than assuming camera fps. Sound and OS notifications are opt-in.
Pause/Stop invalidate pending generations immediately; already transmitted cloud input cannot be recalled. OpenAware requests cancellation where supported and never publishes a late result as a current observation.
Conversation may compare several feeds, but results must preserve separate evidence provenance. A model lacking image support cannot become a fallback for visual questions. Text-only questions can still run when monitoring is paused if the user explicitly sends them.
Persistent setup/configuration stores references and policy, not source images or conversation content. LM Studio frame analysis requests use `store: false`; Bionic and optional providers have their own history policies outside OpenAware. Minimal action/idempotency audit records are introduced only with the later action capability and contain no retained visual evidence by default.
Cloud connections are optional future profiles. Selecting one displays which feeds will be sent and the budget policy. Proposed adapter budget: configured maximum dispatch rate and daily spend cap where cost metadata is available; otherwise show usage counts and require a request cap.

## Source and model state contract

| Domain | States | Meaning and recoverability |
| --- | --- | --- |
| Source connection | configured → permission_pending → connecting → previewing; paused/stopped/error/disconnected | “Previewing” means fresh acquisition; retry never chooses an alternate device silently. |
| Source analysis | disabled / waiting / sampling / analyzing / fresh / stale / error | Connection and analysis badges are independent; queued/in-flight work does not prove a current answer. |
| Model | unselected / checking / ready / unavailable / incompatible / busy / failed | Ready follows a successful vision probe; unload/change invalidates readiness until rechecked. |
| Session | idle / starting / observing / analysis_paused / degraded / stopping / stopped | Degraded lists affected sources/provider; Stop is always available. |
| Rule | draft / enabled / holding / triggered / cooldown / suspended / error | Unknown source freshness suspends evaluation; acknowledgement does not change rule configuration. |

## Launch, dependencies, and open decisions

| Dependency / decision | Owner | Gate / horizon | Failure response |
| --- | --- | --- | --- |
| LM Studio model API and actual image compatibility | Engineering | Capability spike | Keep explicit selection and publish supported model/configuration matrix |
| Bionic image/tool bridge and picker behavior | Integration maintainer | G0 evidence and G3 bridge | Keep stand-alone dashboard operational; expose only verified bridge features |
| Windows source/device and capture behavior | Platform engineer | Spike and before adapter release | Publish adapter limitation; offer working camera/OBS path |
| Hardware source budget and model cadence | Engineering | Before alpha pilot | Reduce default budget or resolution and document observed throughput |
| Structured market-data vendor, rights, rate limits, timestamp semantics | Maintainer + PM | Before exact trading rules | Keep chart discussion only until a data contract is verified |
| Distribution/signing/updater choice | Maintainer | Before external binary release | Document install steps and package provenance; no hidden updater |
| UI naming/branding and contributor roles | PM + maintainer | Before P5 public alpha | Keep working name and assign support/triage ownership |

P1–P3 validation uses declared synthetic/device fixtures and volunteer feeds with explicit consent. P5 alpha then enrolls five users with written support instructions and recoverable stop controls. Broader rollout begins only after integration evidence, history deletion, source isolation, secret redaction, and Stop tests pass.
Roll back a release or disable the affected feature when sources are misattributed, sharing continues after Stop, secrets enter logs, or actions exceed their grant. The maintainer owns the incident record and release communication; no automatic message sending is authorized by this plan.
Review usefulness and setup completion after two pilot weeks; review adoption and alert noise 30 days after the first external alpha. A missed target changes scope/defaults before adding more adapters.

## Change control and unresolved assumptions

Every proposed addition gets an issue naming the user problem, owner, metric, dependency, and release. The maintainer marks it accept/defer/reject and records the scope effect. Source counts above four, embedded Bionic UI, always-on voice, cloud autoswitching, and broker execution require distinct decisions.
Open assumptions: four feeds are useful on target hardware; two-second eligibility is sufficient for target workflows; LM Studio image input and Bionic tool image presentation can coexist with the chosen model; OBS sources remain legible at negotiated resolutions. These are spike/pilot questions, not settled capability claims.
