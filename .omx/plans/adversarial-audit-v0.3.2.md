# OpenAware adversarial audit

The owner asks to find bugs and try to break the application. Baseline is public v0.3.1, main `69de3121f6881c0ba1a90303c2b0ff21e88c738e`. This is a systematic bounded audit and repair campaign; no finite run can establish that every possible bug is absent.

## Lanes and ownership

| Lane | Owner | Scope | Verification |
| --- | --- | --- | --- |
| Interface | /root | renderer App, capture and layout; UI adversarial fixtures and config | All four pages, invalid/long input, source churn, layout, model switching and recovery; serial Electron checks |
| Runtime | /root/agent_use_requirements | service engine/index, core and matching runtime/workflow units | Deterministic scheduling, Stop/cancel, revocation, temporal memory, rules and history races |
| Desktop | /root/architecture_plan | main except local-api, preload, isolated capture, actions and matching units | Synthetic capture/lifecycle, crash/Stop/restart, validated input and native authority boundaries |
| Boundary | /root/boundary_audit | providers, local-api, CLI, contracts and matching units | Malformed/oversized/cancelled responses, authentication, loopback/redirect restrictions, schema and CLI errors |

Agents are real in-session workers. No detached OMX team or tmux process is claimed. Root owns session/task/review artifacts, Git, builds, app launches and integration. Workers may run scoped units only; production files have exclusive ownership and cross-boundary changes require coordination.

## Campaign

1. Inspect baseline and record page/lifecycle coverage. Use generated sources and bounded local mocks to provoke errors, saturation, stale results, invalid input and rapid navigation.
2. Each finding needs expected/actual behavior, a repeatable reproduction, severity and a failing regression before repair. Distinguish implementation defects, documented limits and unverified hardware behavior.
3. Fix confirmed issues with small changes; preserve source consent, masks, Stop, current evidence freshness and per-step native review. No new cloud provider, model/runtime download, unattended input or third-party attack.
4. Cross-review changed boundaries. Run strict TypeScript, full units, serial relevant Electron workflows, production build/package inspection and manual page checks. Additional tests follow new failures or changes.
5. Record final findings, verification and remaining coverage in the audit ledger. Publish a corrected developer package if production fixes are found; verify exact source CI/tag/assets and keep local state honest.

Real monitor/camera permission requests and security/privacy dialogs stay with the user. This run does not execute trades, shell commands via native input or actions in unrelated applications. Simulated protocol/OS callbacks cannot establish actual hardware/model performance.
