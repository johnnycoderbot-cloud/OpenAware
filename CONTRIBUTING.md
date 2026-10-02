# Contributing to OpenAware

The repository contains a developer prototype, the full roadmap, and documentation/runtime checks. Describe actual implementation evidence separately from unpassed external and release gates.

1. Read [PLAN.md](PLAN.md), the relevant contract, and the gate for your slice.
2. Claim a single `OA-xxx` GitHub issue and record dependencies. Suggested branch: `feature/oa-xxx-short-description`.
3. Implement only that slice's files/responsibility; adjust to concurrent work without reverting unrelated edits.
4. Use synthetic desktops, recorded license-cleared test media, and mock providers. Do not upload real desktops, camera feeds, API keys, personal model directories, brokerage details, or account balances to issues/CI.
5. Run the slice's explicit verification. A mock test is not live hardware or provider evidence.
6. Open a PR describing concrete behavior, limitations, test commands/results, and affected requirement/contract IDs. Include a reviewable handoff.
7. Review ends in approved, changes requested, or pending with a clear blocker. Passing CI alone does not approve an external integration gate.

## Implementation layout

`apps/desktop` owns main/preload/renderer processes; `apps/service` owns awareness state and orchestration. `packages/contracts`, `packages/core`, `packages/providers`, and `packages/actions` hold shared validation, bounded content, local adapters, and reviewed input. The capture pipeline currently lives in the renderer. Other roadmap packages remain proposed until implemented. Reconcile accepted slice paths with [prototype status](docs/prototype.md).

Dependency versions are pinned with package-lock.json. Do not copy proprietary LM Studio/Bionic internals into this repository. Local-provider tokens currently stay in process memory; OS credential storage is a future gate, not permission to save plaintext credentials.

## Current check

```powershell
python scripts/validate_plan.py
```

The validator checks document links and execution-slice structure/dependencies. The future CI and hardware acceptance matrix is in [testing and release](docs/testing-release.md).
