# OpenAware foundation requirements

Date: 2026-10-02. Status: planning. Repository: public; code/documentation license: MIT.

## User intent

Create an open-source live AI companion that sees a user's actual desktops and cameras, reasons about simultaneous feeds, supports trading workflows, converses with the user, and can perform explicitly requested actions on the actual computer. Start with Windows. Integrate with LM Studio/Bionic and reuse model selection and locally installed vision models. Preserve optional OpenAI, OpenRouter, Ollama, and NVIDIA backends.

This request authorizes a detailed plan and public GitHub repository. It does not request implementation of the entire application, connection to personal feeds, credentials, brokerage accounts, or live trade execution.

## Current deliverable

A reviewable repository containing product behavior, user journeys, architecture, contracts, integration evidence, risk/decision register, development slices, validation/release strategy, contributor guidance, and a truthful concept image. GitHub issues should mirror the execution slices. There is no working application yet.

## Proposed first release boundary

- Observe multiple selected sources through live previews, sampled model analysis, and source-specific alerts.
- Support OBS virtual camera and ordinary cameras first; monitor/direct-window and IP camera adapters follow a validated capture spike.
- Support LM Studio local vision inference as the reference backend; connect Bionic with an extension bridge after compatibility testing.
- Keep a stand-alone dashboard operational independently of Bionic; do not promise an embedded Bionic panel or automatic synchronization with its model picker.
- Trading observation, chart discussion, structured market-data alerts, and paper-trade proposals; live broker execution is a later gated capability.
- Computer actions are a separate, explicitly enabled permission. Observation does not authorize clicking, typing, commands, trading, or sending messages.
- The application presents continuous live video, but model analysis uses bounded frames and scheduling. No claim of interpreting every frame or detecting every event.

## Decision authority

The planning team may choose a working architecture, repository layout, proposed defaults, and test targets. Hardware-specific model choice, broker integration, source count, latency promises, cloud spending, and Bionic transport details remain explicit gates. Defaults can be revised without changing the core user intent.

## Current acceptance

1. Every feature has scope, state/error behavior, permissions, and measurable completion criteria.
2. Every development slice names likely files, dependencies, verification, and an exit condition.
3. Documented vendor capabilities are cited; untested assumptions are labeled.
4. Simultaneous sources, model selection, stop behavior, retention, alerts, and actions have explicit contracts.
5. Repository links and metadata validate; no credentials, machine-specific private files, or real feeds are published.
6. GitHub repository is created and pushed; remote verification confirms the planning artifacts.
