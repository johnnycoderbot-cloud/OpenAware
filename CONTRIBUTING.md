# Contributing to OpenAware

The repository currently contains a plan and documentation checks. Do not announce runtime capabilities before evidence exists.

1. Read [PLAN.md](PLAN.md), the relevant contract, and the gate for your slice.
2. Claim a single `OA-xxx` GitHub issue and record dependencies. Suggested branch: `feature/oa-xxx-short-description`.
3. Implement only that slice's files/responsibility; adjust to concurrent work without reverting unrelated edits.
4. Use synthetic desktops, recorded license-cleared test media, and mock providers. Do not upload real desktops, camera feeds, API keys, personal model directories, brokerage details, or account balances to issues/CI.
5. Run the slice's explicit verification. A mock test is not live hardware or provider evidence.
6. Open a PR describing concrete behavior, limitations, test commands/results, and affected requirement/contract IDs. Include a reviewable handoff.
7. Review ends in approved, changes requested, or pending with a clear blocker. Passing CI alone does not approve an external integration gate.

## Planned layout

`apps/desktop`, `apps/service`, `packages/contracts`, `packages/core`, `packages/providers`, `packages/capture`, `packages/rules`, `packages/storage`, `packages/mcp`, and `packages/actions` are proposed implementation areas. They do not exist yet. Exact paths in an accepted slice should be reconciled with the architecture before creating files.

Dependency versions will be pinned at implementation time with a lockfile and license inventory. Do not copy proprietary LM Studio/Bionic internals into this repository. Credentials belong in the runtime OS credential store, not configuration examples or commits.

## Current check

```powershell
python scripts/validate_plan.py
```

The validator checks document links and execution-slice structure/dependencies. The future CI and hardware acceptance matrix is in [testing and release](docs/testing-release.md).
