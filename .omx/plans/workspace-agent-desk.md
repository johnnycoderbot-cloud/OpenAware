# Workspace source controls and agent desk

Baseline: v0.3.2, main `2e852ade74c9011652b644d8401975676fc3e203`. The owner requests a labeled plus button in the Live workspace header and a desk below the feeds, facing them. The desk may split into two seats for agents assigned to separate sources or monitoring roles. Seats must remain empty without a connected agent.

## Requirements and boundaries

- Put `+ Add source` in the header marked by the owner. Retain an obvious labeled entry after sources replace the empty workspace. Make the empty-state prompt actionable. Use existing source permissions and four-source bounds.
- Keep controls in pane headers and the lower area; do not add stacked banners or nested bordered cards. Preserve uncropped previews, two-monitor side-by-side defaults, compact layout and docking.
- Draw an actual desk and empty chairs facing the feeds. A connected seat may show an agent, with truthful ready/watching/paused/error state. Model selection alone must not occupy a chair.
- The first desk uses the existing shared Observer/Operator model roles, with a visible `Shared model` label when split. Observer shows actual enabled monitoring sources; Operator opens the existing target/approval page. The optional independent-provider question remains unanswered; separate bindings and per-seat monitoring scope are not claimed by this visual slice.
- Empty seats show an outline-only agent with a cyan glow and the exact label `Needs agent`. Selected or probing models do not occupy the chair. Use a static glow and support reduced motion.
- Reuse the lower `extra` pane for Desk/Video memory views with header controls. Keep Video memory mounted while hidden to preserve search state. Put Add source in the empty workspace header and the first desktop/source header after selection; avoid adding a new toolbar row.
- Preserve source/mask/model revision provenance, bounded scheduling, Stop, memory-only setup, and separate per-step native action approval. Desk monitoring never creates action authority.

## Ownership and verification

Root owns integration, serial UI verification, durable state, packaging and delivery. `/root/agent_use_requirements` owns only the new desk visual component/styles. `/root/architecture_plan` reviewed connection boundaries and owns the default vertical-fit helper, docking callback and scoped units. `/root/boundary_audit` mapped the layout and owns only README/prototype documentation. Workers must not revert others' changes. Native collaboration workers are used without a detached OMX team.

Verification: header/empty-state Add source opens the picker, remains available with live sources, and enforces the source limit; empty and connected seat rendering matches runtime state; split source assignments and Stop are covered with generated sources and local providers; existing two/four-source docking and compact workflows still pass. Run relevant units, strict TypeScript, packaged Electron/UI checks and independent review. Use synthetic media only in published fixtures.

Record actual source/connection scope, results, limitations and delivery in the companion ledger. No external model, runtime or camera setup is assumed.
