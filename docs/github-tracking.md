# GitHub execution tracking

Repository: [johnnycoderbot-cloud/OpenAware](https://github.com/johnnycoderbot-cloud/OpenAware).

The issues below are planned implementation work, not shipped features. Scope and dependency IDs come from [the slice manifest](../.omx/plans/implementation-slices.json). No milestone has a committed due date.

## Milestones

| Phase | Milestone |
| --- | --- |
| P0 | [P0 — Integration evidence](https://github.com/johnnycoderbot-cloud/OpenAware/milestone/1) |
| P1 | [P1 — Selected live sources](https://github.com/johnnycoderbot-cloud/OpenAware/milestone/2) |
| P2 | [P2 — Bounded local awareness](https://github.com/johnnycoderbot-cloud/OpenAware/milestone/3) |
| P3 | [P3 — Conversation and alerts](https://github.com/johnnycoderbot-cloud/OpenAware/milestone/4) |
| P4 | [P4 — Validated extensions](https://github.com/johnnycoderbot-cloud/OpenAware/milestone/5) |
| P5 | [P5 — Windows alpha evidence](https://github.com/johnnycoderbot-cloud/OpenAware/milestone/6) |
| later | [Later — Providers and authorized actions](https://github.com/johnnycoderbot-cloud/OpenAware/milestone/7) |

## Implementation issues

| Slice | Issue | Phase | Dependencies |
| --- | --- | --- | --- |
| OA-001 | [Verify LM Studio and Bionic integration boundaries](https://github.com/johnnycoderbot-cloud/OpenAware/issues/1) | P0 | None |
| OA-002 | [Create desktop shell and authenticated local service lifecycle](https://github.com/johnnycoderbot-cloud/OpenAware/issues/2) | P1 | OA-001 |
| OA-003 | [Add one camera or OBS virtual-camera live preview](https://github.com/johnnycoderbot-cloud/OpenAware/issues/3) | P1 | OA-002 |
| OA-004 | [Coordinate simultaneous source states and global stop](https://github.com/johnnycoderbot-cloud/OpenAware/issues/4) | P1 | OA-003 |
| OA-005 | [Enforce masks, provider consent, and retention policy before export](https://github.com/johnnycoderbot-cloud/OpenAware/issues/5) | P2 | OA-004 |
| OA-006 | [Implement bounded fair scheduling and freshness accounting](https://github.com/johnnycoderbot-cloud/OpenAware/issues/6) | P2 | OA-004, OA-005 |
| OA-007 | [Use LM Studio model discovery and explicit selection](https://github.com/johnnycoderbot-cloud/OpenAware/issues/7) | P2 | OA-001, OA-002 |
| OA-008 | [Analyze one bounded frame through LM Studio](https://github.com/johnnycoderbot-cloud/OpenAware/issues/8) | P2 | OA-006, OA-007 |
| OA-009 | [Store metadata events and a bounded local timeline](https://github.com/johnnycoderbot-cloud/OpenAware/issues/9) | P3 | OA-008 |
| OA-010 | [Expose read-only observation tools to Bionic](https://github.com/johnnycoderbot-cloud/OpenAware/issues/10) | P3 | OA-001, OA-005, OA-009 |
| OA-011 | [Add watch rules, debounced local alerts, and event acknowledgement](https://github.com/johnnycoderbot-cloud/OpenAware/issues/11) | P3 | OA-009 |
| OA-012 | [Add a grounded conversation panel](https://github.com/johnnycoderbot-cloud/OpenAware/issues/12) | P3 | OA-008, OA-009, OA-011 |
| OA-013 | [Spike voice input/output without weakening stop controls](https://github.com/johnnycoderbot-cloud/OpenAware/issues/13) | P4 | OA-012 |
| OA-014 | [Validate and add a direct-monitor capture adapter](https://github.com/johnnycoderbot-cloud/OpenAware/issues/14) | P4 | OA-004, OA-005, OA-006 |
| OA-015 | [Validate and add an IP-camera stream adapter](https://github.com/johnnycoderbot-cloud/OpenAware/issues/15) | P4 | OA-004, OA-005, OA-006 |
| OA-016 | [Add structured market conditions and paper-only trade proposals](https://github.com/johnnycoderbot-cloud/OpenAware/issues/16) | P4 | OA-009, OA-011, OA-012 |
| OA-017 | [Measure four-source behavior and close accessibility gaps](https://github.com/johnnycoderbot-cloud/OpenAware/issues/17) | P5 | OA-011, OA-012 |
| OA-018 | [Package and release an auditable Windows alpha](https://github.com/johnnycoderbot-cloud/OpenAware/issues/18) | P5 | OA-005, OA-009, OA-011, OA-012, OA-017 |
| OA-019 | [Add a verified Ollama vision adapter](https://github.com/johnnycoderbot-cloud/OpenAware/issues/19) | later | OA-005, OA-006, OA-008 |
| OA-020 | [Add a consented OpenRouter vision adapter](https://github.com/johnnycoderbot-cloud/OpenAware/issues/20) | later | OA-005, OA-006, OA-008 |
| OA-021 | [Add an OpenAI image-vision adapter](https://github.com/johnnycoderbot-cloud/OpenAware/issues/21) | later | OA-005, OA-006, OA-008 |
| OA-022 | [Add one evidenced NVIDIA model deployment adapter](https://github.com/johnnycoderbot-cloud/OpenAware/issues/22) | later | OA-005, OA-006, OA-008 |
| OA-023 | [Build a scoped action proposal and grant broker](https://github.com/johnnycoderbot-cloud/OpenAware/issues/23) | later | OA-005, OA-012, OA-017 |
| OA-024 | [Execute one granted Windows action against a disposable app](https://github.com/johnnycoderbot-cloud/OpenAware/issues/24) | later | OA-023, OA-014 |
| OA-025 | [Model a broker sandbox and paper-order lifecycle](https://github.com/johnnycoderbot-cloud/OpenAware/issues/25) | later | OA-016, OA-023 |
| OA-026 | [Design and separately gate live-order authorization and reconciliation](https://github.com/johnnycoderbot-cloud/OpenAware/issues/26) | later | OA-025, OA-023, OA-018 |

Updates to accepted slice contracts should update both the manifest and the corresponding issue. Use the roadmap as the human-readable entry point.
