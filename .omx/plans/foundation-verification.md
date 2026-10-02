# OpenAware foundation verification map

Date: 2026-10-02. This record distinguishes the current documentation/repository deliverable from future application tests.

## Current foundation checks

| Check | Method | Result/evidence |
| --- | --- | --- |
| Slice JSON parses and required fields exist | Parse implementation-slices.json; require id/title/phase/depends_on/files/acceptance/verification/estimate/gate/requirement_ids/deliverable/work_units | Passed: 26 slices, 18 initial and 8 later; all required fields present and nonempty except valid empty root dependencies. |
| Stable slice IDs/dependencies | Assert unique contiguous OA-001..OA-026, valid dependency targets, no self-dependency, acyclic graph | Passed: exact contiguous IDs, valid targets, no self edges, acyclic dependency traversal. |
| Product requirement coverage | Extract stable IDs from docs/product-spec.md; compare with every slice requirement_ids and top-level requirement_coverage | Passed: all 40 current stable product IDs covered; no unknown IDs; top-level coverage matches slice arrays. This is planned coverage, not implementation verification. |
| Document links | Resolve delivery-plan Markdown relative file targets; verify existing files, no absolute personal-path links | Passed: 47 relative links/anchors across the four delivery-owned Markdown documents resolve. Proposed implementation file paths are separately checked as relative paths without parent traversal. |
| Cross-document defaults | Read product/contracts/architecture/roadmap/testing and check source scheduling, freshness, model identity, retention, and effects boundaries | Passed: Product Manager and Software Architect final read-only reviews approved; alert reset, motion-only startup, freshness, switching, Bionic grants, storage, and dependencies aligned. |
| Application status truthfulness | README/PLAN/product/roadmap/testing show planning-only state; no native/live/app result claimed | Passed coordinator review: runnable app explicitly absent; future native/provider tests clearly not run. |
| License/public/private-data hygiene | MIT LICENSE, public metadata, scan tracked diff for secrets/private data, review generated concept visual | Passed local review: MIT present, image synthetic and labeled, no detected credential patterns or personal-machine paths in public text; local OMX sessions/state excluded. |
| Public GitHub publication | Verify remote URL/default branch/head, visibility/license, pushed files, issues/links | Passed coordinator verification: public MIT repository on main; initial local/remote head match; 32 tracked files; 26 open slice issues with matching bodies and linked dependencies; 7 milestones with no committed dates; private vulnerability reporting enabled. |
| Remote planning CI | Inspect both matrix jobs for initial published commit | Passed Windows and Ubuntu on `4f5f474a706b9e00897add99e651c30d5f6c7f7f`: [Actions evidence](https://github.com/johnnycoderbot-cloud/OpenAware/actions/runs/37071383100). This is documentation/dependency validation, not application acceptance. |

## Completed foundation evidence

Local structural validator ran on 2026-10-02 in the planning repository using Python standard-library JSON/regex/path checks and exited 0. Result: status pass; 26 slices (18 initial/8 later); 40 requirements; acyclic dependencies; four Markdown documents; 47 relative links/anchors.

After cross-review corrections, the repository validator `python scripts/validate_plan.py` exited 0 on 2026-10-02: “PASS: 25 Markdown files, required artifacts, local links/anchors, 26 slices, acyclic dependencies, and requirement coverage.” It explicitly does not test runtime capture, providers, Bionic compatibility, or performance. This broader check covers other contributors' current artifacts in addition to the delivery-owned files.

1. All canonical documents exist and link correctly: passed.
2. Local structural validation passes with exact requirement/slice counts: passed, 26 slices and 40 requirements.
3. Cross-document review resolves findings: approved by both final reviewers; unverified capabilities have gates/fallbacks.
4. Initial public repository commit/push and GitHub issues are remotely verified: passed.
5. Coordinator accepts the planning handoff and closes local task/review state upon final push verification. Future implementation issues remain open.

## Future application verification map

| Backlog | Required proof | Current state |
| --- | --- | --- |
| OA-001 | Actual LM Studio/Bionic synthetic vision/tool discovery, image delivery, picker/embedding/push compatibility evidence | Not run. Primary documentation is capability research, not host acceptance. |
| OA-002..OA-004 | Shell/local trust lifecycle, permission flow, actual camera/OBS preview, four-source states, pause/stop, released handles | Not implemented or run. |
| OA-005..OA-008 | Masks/consent before egress, model probe/switch, scheduler fairness/priority, freshness, bounded queues, local fixture inference | Not implemented or run. |
| OA-009..OA-012 | Memory/opt-in encrypted content history with structural configuration separate, MCP image/summary route grants, motion/semantic rules, local notifications, attributed conversation | Not implemented or run; unavailable Bionic bridge may explicitly defer without blocking standalone alpha. |
| OA-013..OA-016 | Independent voice, direct-monitor, IP-camera, structured data/paper proposal spike gates | Not implemented or run; each can defer with an honest fallback. |
| OA-017..OA-018 | Native reference benchmark, stop/resource tests, keyboard/screen reader, clean install, release notices/SBOM/signature/update checks | Not implemented or run. |
| OA-019..OA-022 | Exact optional-provider capability/consent/budget/conformance and synthetic opt-in live smoke | Later; no credentials or frames connected. |
| OA-023..OA-024 | Grant broker negative tests, disposable Windows target, state rechecks, stop and partial-effect audit | Later; no action authorization from observation. |
| OA-025..OA-026 | Sandbox order state/idempotency/reconciliation; separate real-account authorization and independent review for live effects | Later; live execution disabled under current task. |

Implementation test detail is in [testing and release](../../docs/testing-release.md). Phase exit criteria and coverage are in [roadmap](../../docs/roadmap.md). The machine-readable backlog is [implementation-slices.json](implementation-slices.json).

## Delivery-planner handoff boundary

Delivery planner owns only docs/roadmap.md, docs/testing-release.md, .omx/plans/foundation.md, .omx/plans/foundation-verification.md, and .omx/plans/implementation-slices.json. It does not commit, push, create remote issues, alter other agents' files, run the application, or claim remote publication verification.

Risks needing explicit review: model/API support changes, Bionic extension limits, media/session geometry, overlapping model load/GPU capacity, open-ended model accuracy, dependency/model/codec licensing, privacy/stop races, native accessibility, Windows signing availability, and future action/broker authorization. These risks have gates and fallbacks; they are not implied implementation approvals.
