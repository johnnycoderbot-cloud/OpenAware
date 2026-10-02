# OpenAware agent instructions

## Current state

This is a developer prototype backed by a complete release plan. README must remain truthful about implemented and unimplemented capabilities. Read PLAN.md, docs/prototype.md, docs/contracts.md, docs/integrations.md, and the assigned OA slice before changing implementation files.

## OMX v2 operating model

- Start from ultrawork unless a narrower workflow is requested. Route unclear/risky intent through deep-interview; broad work through plan.
- Use native agents for bounded in-session fanout. Escalate to team only when durable parallel execution justifies its runtime overhead.
- Keep `.omx/` honest: plans/research/execution ledger are durable; machine-local sessions, memory, running tasks, inbox, reviews, and team leases are not public deliverables.
- Claims map to real agents and catalog roles. Every completion has a reviewable handoff; reviews end approved, changes_requested, or pending with a reason.
- Do not turn a mocked provider/camera test into claimed live integration evidence.

## Work boundaries

- Own one slice and named files; you are not alone in the repository. Do not revert others' work.
- Preserve source/model/revision provenance, bounded queues, cloud-routing consent, and stop semantics.
- Observation never authorizes actions, external messages, commands, or trades. Action scopes require the explicit contract/release gate.
- Use synthetic sources and redacted diagnostics. No real camera/desktop feeds, keys, personal directories, or broker information in commits, issues, or CI.
- Use published upstream interfaces. Keep OMX Codex-native; do not reintroduce legacy claude_code tool splits.
- Do not assume canonical user files live in OneDrive. Discover paths explicitly and keep host-specific paths out of published docs.

## Discovery and verification

- Prefer rg for file/text search. Batch independent read-only calls; sequence edits and dependent work.
- Use JUnifiedMCP's compact manifest search/schema/execute front door when selecting its internal tools. Use JDocMunch's active-skill/host-tool indexes if the available catalog is insufficient; indexed metadata does not itself make a tool callable.
- Prefer first-party OMX plugin flows. Hooks are experimental; project hooks belong in `.codex/hooks.json`, personal hooks in the user's own config. Do not install hooks for this planning task.
- Run `python scripts/validate_plan.py` for planning edits and the assigned slice's meaningful tests for implementation. Include limitations and next action in handoffs.
