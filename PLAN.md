# OpenAware complete planning index

Baseline date: 2026-10-02. Scope: public open-source planning repository, before application implementation.

## Build outcome

Create a Windows-first AI companion that follows selected live desktops and cameras simultaneously, holds conversations grounded in timestamped observations, monitors conditions, and offers separately authorized computer actions. Integrate with LM Studio/Bionic while keeping the observation engine useful independently. Design the architecture to accept other local/cloud vision providers.

## Read in this order

1. [Product specification](docs/product-spec.md): what people can do and release boundaries.
2. [UX specification](docs/ux-spec.md): exactly how they configure, see, pause, and control it.
3. [Integration evidence and prototype gates](docs/integrations.md): vendor facts and unknowns.
4. [Architecture](docs/architecture.md): how the processes and data paths fit together.
5. [Data and API contracts](docs/contracts.md): identifiers, revisions, state machines, and tool boundaries.
6. [Security/privacy](docs/security-privacy.md): what crosses each boundary and how permissions work.
7. [Decision register](docs/decisions.md): open questions and the experiment that resolves each.
8. [Roadmap](docs/roadmap.md) and [machine-readable slices](.omx/plans/implementation-slices.json): implementation prompts, dependencies, verification, and exit conditions.
9. [Testing/release](docs/testing-release.md): what constitutes evidence of a working release.

## Planning versus implementation

These documents are detailed implementation instructions, not a claim that every future choice can be settled before testing. Any external-interface uncertainty is a gate with a test and fallback. Estimates are planning ranges, not commitments. Model speed, hardware requirements, simultaneous-source capacity, native capture language, and provider cost are measured by spikes before becoming supported configurations.

The foundation's [requirements](.omx/plans/foundation-requirements.md), [execution plan](.omx/plans/foundation.md), [verification map](.omx/plans/foundation-verification.md), and [research summary](.omx/research/summary.md) are durable OMX artifacts. Read the [execution ledger](.omx/logs/execution-ledger.md) for the completed planning handoff. Local running session state is excluded from Git.

## Public tracking

The GitHub issues mirror implementation slices by stable `OA-xxx` identifiers. Dependency IDs are meaningful even before remote issue numbers are assigned. [GitHub tracking map](docs/github-tracking.md) records the final issue links and release milestones.

## First executable increment

The initial increment is a synthetic live feed, one timestamped frame sent to an explicitly bound LM Studio vision model, and one observation shown in a dashboard. Follow it with the Bionic compatibility gate and multi-source benchmark; do not start with unattended trading or broadly privileged computer control.
