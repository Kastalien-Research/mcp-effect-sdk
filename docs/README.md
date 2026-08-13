# Documentation

Everything directly at `docs/` describes the SDK as shipped — read it to _use_
the SDK. Everything under [`docs/internal/`](internal/) describes how the SDK
gets built — read it to _contribute_.

## Using the SDK

| Document                                                         | Covers                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`usage.md`](usage.md)                                           | Building clients and servers, transports, authorization, errors, and limitations. |
| [`migration-2026-07-28.md`](migration-2026-07-28.md)             | Migrating from MCP `2025-11-25` to the released `2026-07-28` protocol.            |
| [`feature-coverage.md`](feature-coverage.md)                     | API, documentation, example, and test coverage for the final supported surface.   |
| [`extensions.md`](extensions.md)                                 | Extension opt-in policy and experimental boundaries.                              |
| [`observability.md`](observability.md)                           | Effect spans, DevTools setup, runtime ownership, privacy, and troubleshooting.    |
| [`sdk-generator-workflow.md`](sdk-generator-workflow.md)         | Generating protocol code from exact final sources.                                |
| [`sdk-readiness-requirements.md`](sdk-readiness-requirements.md) | Evidence required for each readiness claim.                                       |
| [`examples/`](examples/)                                         | Notes on runnable programs in [`examples/`](../examples/).                        |
| [`agent-evidence/`](agent-evidence/README.md)                    | Agent-in-the-loop affordance evaluation.                                          |
| [`conformance/`](conformance/)                                   | Conformance, source provenance, and Tier self-assessment evidence.                |
| [`../DEPENDENCY_POLICY.md`](../DEPENDENCY_POLICY.md)             | Published dependency and MCP-source update policy.                                |
| [`../VERSIONING.md`](../VERSIONING.md)                           | Public compatibility and stable-release evidence policy.                          |
| [`../MAINTENANCE.md`](../MAINTENANCE.md)                         | Manual triage, exact SLA clocks, and separate history/scorecard policy.           |
| [`../ROADMAP.md`](../ROADMAP.md)                                 | Concrete finalization, release, and Tier self-assessment milestones.              |
| [`maintenance/`](maintenance/)                                   | Rolling official audit and all-history operational ledger.                        |

## Contributing to the SDK

| Document                                                                                   | Covers                                                                                                                           |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`internal/acceptance-gates/`](internal/acceptance-gates/)                                 | Phase gates that must pass before work continues between sections.                                                               |
| [`internal/plans/`](internal/plans/)                                                       | Work-package plans, including the [`2025-11-25` dual-version support checklist](internal/plans/support-2025-11-25-checklist.md). |
| [`internal/prompts/`](internal/prompts/)                                                   | Agent handoff prompts.                                                                                                           |
| [`internal/brainstorms/`](internal/brainstorms/)                                           | Exploratory notes, not decisions.                                                                                                |
| [`internal/verification/`](internal/verification/)                                         | Verification write-ups for completed work packages.                                                                              |
| [`internal/superpowers/`](internal/superpowers/)                                           | Tooling-assisted lane plans.                                                                                                     |
| [`internal/phase-6-conformance-evidence.md`](internal/phase-6-conformance-evidence.md)     | Phase 6 evidence record.                                                                                                         |
| [`internal/phase-7-extension-opt-in-gates.md`](internal/phase-7-extension-opt-in-gates.md) | Phase 7 gate record.                                                                                                             |

Start with [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the build, test, and
review workflow.
