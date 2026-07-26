# Documentation

Everything directly at `docs/` describes the SDK as shipped — read it to _use_
the SDK. Everything under [`docs/internal/`](internal/) describes how the SDK
gets built — read it to _contribute_.

## Using the SDK

| Document                                                                             | Covers                                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [`usage.md`](usage.md)                                                               | Building clients and servers, transports, authorization, errors, and current limitations. |
| [`draft-2026-07-28-migration.md`](draft-2026-07-28-migration.md)                     | What changed in the `2026-07-28` stateless draft and what is still in flight.             |
| [`extensions.md`](extensions.md)                                                     | The extension opt-in policy and the supported extension surface.                          |
| [`sdk-generator-workflow.md`](sdk-generator-workflow.md)                             | How generated protocol code is produced from the pinned schema.                           |
| [`sdk-readiness-requirements.md`](sdk-readiness-requirements.md)                     | The readiness bar, and what evidence each requirement needs.                              |
| [`examples/`](examples/)                                                             | Notes on the runnable programs in [`examples/`](../examples/).                            |
| [`agent-evidence/`](agent-evidence/README.md)                                        | Agent-in-the-loop eval results for the affordance surface.                                |
| [`conformance/`](conformance/)                                                       | Conformance evidence, scenario coverage, and reconciliation against upstream.             |
| [`conformance/dependency-update-policy.md`](conformance/dependency-update-policy.md) | How dependencies, the pinned conformance harness, and vendored snapshots are updated.     |
| [`maintenance/`](maintenance/)                                                       | Operational policy: SLA ledger, P0 escalation, dependency updates.                        |

## Contributing to the SDK

| Document                                                                                   | Covers                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`internal/acceptance-gates/`](internal/acceptance-gates/)                                 | Phase gates that must pass before work continues between sections. |
| [`internal/plans/`](internal/plans/)                                                       | Work-package plans.                                                |
| [`internal/prompts/`](internal/prompts/)                                                   | Agent handoff prompts.                                             |
| [`internal/brainstorms/`](internal/brainstorms/)                                           | Exploratory notes, not decisions.                                  |
| [`internal/verification/`](internal/verification/)                                         | Verification write-ups for completed work packages.                |
| [`internal/superpowers/`](internal/superpowers/)                                           | Tooling-assisted lane plans.                                       |
| [`internal/phase-6-conformance-evidence.md`](internal/phase-6-conformance-evidence.md)     | Phase 6 evidence record.                                           |
| [`internal/phase-7-extension-opt-in-gates.md`](internal/phase-7-extension-opt-in-gates.md) | Phase 7 gate record.                                               |

Start with [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the build, test, and
review workflow.
