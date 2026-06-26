# SDK Readiness Requirements

This document defines the global readiness requirements for `mcp-effect-sdk`.
The executable registry lives in `scripts/check-sdk-readiness-requirements.mjs`.
The checker computes status, evidence, claim verdicts, and blocking reasons from
repo files, reference files, and evidence artifacts. Handwritten status in docs
is never proof.

The checker passing means readiness accounting is truthful and internally
consistent. It does not mean the SDK is ready.

## Target Claims

| Claim | Meaning |
| --- | --- |
| `repo-health done` | Package-local generation, invariants, build, task, extension, conformance-evidence, and historical cleanup gates are wired and internally consistent. |
| `MCP Tier 1` | The SDK satisfies the MCP SEP-1730 Tier 1 definition: full protocol support, maintenance commitments, stable release/versioning, comprehensive docs/examples, and published dependency update policy. |
| `artifact-goal done` | The standalone SDK artifact is usable by agent-users, not only protocol-valid. |
| `release-ready` | The package has release provenance, package metadata, docs, examples, and publish evidence needed for a release claim. |

## Requirement Schema

The canonical computed requirements table has these columns:

| Column | Meaning |
| --- | --- |
| `ID` | Stable global requirement ID. |
| `category` | One of the allowed categories below. |
| `evidenceKind` | One of the evidence kinds below. |
| `source` | Requirement source path or reference path. Evidence reports may fill current evidence, but do not replace source. |
| `requirement` | Requirement text. |
| `proof required` | Evidence needed for a `pass` status. |
| `current evidence` | Checker-computed evidence summary. |
| `status` | Checker-computed status. |
| `blocking/deferred/not-applicable` | Disposition used by claim sufficiency. |
| `owner path(s)` | Repo paths that own the requirement or evidence. |
| `validation command(s)` | Commands that validate or refresh the evidence. |

Allowed categories:

- `software/protocol correctness`
- `agent-user effectiveness`

Allowed statuses:

- `pass`
- `partial`
- `fail`
- `unknown`
- `not-applicable`

Allowed dispositions:

- `blocking`
- `deferred`
- `not-applicable`

Allowed evidence kinds:

- `inventory`
- `static-interface`
- `command-result`
- `conformance-result`
- `unit-test-result`
- `integration-test-result`
- `e2e-result`
- `release-provenance`
- `agent-eval-result`
- `documentation-coverage`

Stable ID prefixes:

- `GR-CONF-*`
- `GR-TSPAR-*`
- `GR-API-*`
- `GR-DOC-*`
- `GR-TEST-*`
- `GR-TIER-*`
- `GR-REL-*`
- `GR-USE-*`
- `GR-EFFECT-*`
- `GR-AGENT-*`

## Source Inventory

Primary package sources:

- `README.md`
- `ROADMAP.md`
- `package.json`
- `scripts/verify.mjs`
- `docs/acceptance-gates/sdk-generator.md`
- `docs/conformance/sdk-tier-evidence.md`
- `docs/conformance/versioning-policy.md`
- `docs/conformance/dependency-update-policy.md`
- `docs/extensions.md`
- `src/generated/mcp/**`
- `src/examples/everything-server.ts`

Reference-only sources:

- `src/generated/mcp/2026-07-28/schema.json`
- `src/generated/mcp/2026-07-28/schema.ts.txt`
- `../conformance/**`
- `../tsc-sdk-reference/**`

The TypeScript SDK checkout is reference provenance only. Every TypeScript
reference row must cite exact paths such as `../tsc-sdk-reference/docs/server.md` or
`../tsc-sdk-reference/packages/server/package.json`. A local sibling checkout
must not be used as package runtime proof, package dependency proof, or release
readiness proof.

## Sufficiency Rules

The checker computes claim verdicts from claim-owned requirement sets. Rows do
not define claim meaning and must not attach themselves to claims.

- If any blocking row required by a claim definition is not `pass`, that claim
  is blocked.
- `inventory` rows organize source/provenance information only. They must not
  participate in readiness claim sufficiency.
- `MCP Tier 1` is the MCP SEP-1730 Tier 1 contract. It is blocked unless every
  required Tier 1 dimension has passing evidence:
  - all conformance tests pass
  - new protocol features are implemented before the spec release window
  - issue triage within two business days is evidenced
  - security and critical bug resolution within seven days is evidenced
  - stable release and SDK versioning are documented and evidenced
  - comprehensive documentation with examples for all features is evidenced
  - published dependency update policy is evidenced
- `artifact-goal done` is blocked by both software/protocol rows and
  agent-user effectiveness rows.
- `release-ready` is blocked by release provenance, package metadata, docs,
  examples, and publish-tooling rows.
- `repo-health done` can pass while higher readiness claims remain blocked.
- Evidence reports can fill `current evidence`, but cannot replace the
  requirement source they observe.
- Package/readiness proof must not depend on sibling local checkouts except as
  non-runtime provenance.
- Future local phases must cite global requirement IDs before implementation.
- Affordance-changing phases must update or explicitly preserve relevant
  `GR-AGENT-*` rows.

## Evidence Rules

A check function must either perform the proof described by `proof required`,
consume a machine-readable artifact produced by that proof, or return
`unknown`, `partial`, or `fail`.

Only these count as result evidence:

- The command ran in the readiness checker and exited successfully.
- A machine-readable report produced by the command says it passed, and the
  readiness checker validates the report schema.

Everything else is inventory. File presence, source-code shape, function names,
package script names, harness presence, citations, and Markdown saying `pass`
are inventory facts only. Inventory organizes what must be proven; it is not
the proof.

Machine-readable reports must include:

- `evidenceKind`
- `timestamp`
- `command`
- `exitCode`
- `requirementIds` containing the relevant global requirement ID
- `summary`
- for test, conformance, E2E, and agent evidence: `suite`, `case`,
  `scenario`, `cases`, or `scenarios`

If any required field is absent, the row must not return `pass`.

## Requirement Groups

Software/protocol correctness includes:

- MCP conformance
- schema validity
- transport and session behavior
- tool, resource, and prompt registration
- error handling
- package install and build
- public API
- unit tests for runtime kernels and public API behavior
- integration tests for client, server, transport, and session flows
- end-to-end tests or conformance-backed real MCP interactions
- release readiness
- TypeScript SDK reference inventory for package structure, metadata, docs,
  examples, tests, conformance, release tooling, exports, and experimental
  boundaries
- Effect-native/upstream boundary

Agent-user effectiveness includes:

- affordance discovery
- salient tool, resource, and prompt names/descriptions
- useful result payloads
- ambiguity and noise control
- practical resource and prompt visibility
- representative task completion

Standalone readiness must not depend on upstream Effect acceptance. Effect
extensions remain opt-in and excluded from core conformance.

## Agent Detail Schema

Every `GR-AGENT-*` row requires a companion detail entry keyed by ID with these
fields:

| Field | Meaning |
| --- | --- |
| `task evaluated` | Representative user task evaluated through MCP affordances. |
| `target agent/model or agent class` | Agent class or model family under evaluation. |
| `expected MCP affordances` | Tools, resources, prompts, descriptions, and results expected to matter. |
| `success criteria` | Observable success threshold. |
| `failure modes tested` | Ambiguity, noise, missing affordance, retry, and bad selection modes covered. |
| `evidence artifact required` | Artifact that must exist before the row can pass. |

Required evidence types include golden transcripts, agent-in-the-loop evals,
salience audits of tool/resource/prompt surfaces, adversarial task evals, and
observability showing offered, selected, ignored, retried, and failed
affordances.

Script-based checks cannot replace normal unit, integration, and end-to-end
tests. Normal tests and conformance runs cannot satisfy `GR-AGENT-*` rows by
themselves.

## Seeded Requirement Inventory

This inventory is mirrored in the script-owned registry. The checker owns the
computed `current evidence`, `status`, and claim verdicts.

Generated readiness evidence lives in `.local/readiness-evidence` by default and
may be redirected with `MCP_READINESS_EVIDENCE_DIR`. These JSON files are local
or CI artifact state, not hand-authored source-of-truth documentation.

| ID | category | evidenceKind | source | requirement | proof required | owner path(s) | validation command(s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GR-CONF-001 | software/protocol correctness | conformance-result | `docs/conformance/sdk-tier-evidence.md` | MCP Tier 1 requires draft-targeted MCP conformance evidence. | Passing `@modelcontextprotocol/conformance@0.2.x` run for MCP `2026-07-28`, or an exact upstream/tool blocker artifact. | `.local/readiness-evidence/conformance.json`, `docs/conformance/sdk-tier-evidence.md` | `pnpm run conformance:run` |
| GR-CONF-002 | software/protocol correctness | inventory | `docs/conformance/sdk-tier-evidence.md` | Public docs must not overclaim Tier 1 or production readiness. | Inventory scan confirms public docs avoid blocked readiness claims. | `README.md`, `docs/conformance/sdk-tier-evidence.md` | `pnpm run check:sdk-readiness` |
| GR-API-001 | software/protocol correctness | command-result | `ROADMAP.md` | Public protocol surfaces are generated or generated-backed. | Generated protocol/schema check commands run and pass. | `src/generated/mcp/**`, `scripts/check-generated-protocol-surfaces.mjs` | `pnpm run check:generated`, `pnpm run check:generated-protocol-surfaces` |
| GR-TEST-001 | software/protocol correctness | inventory | `package.json` | Package verification includes all current package-local readiness gates. | Inventory scan confirms `verify` wires every package-local gate. | `package.json`, `scripts/verify.mjs` | `pnpm run verify` |
| GR-TEST-002 | software/protocol correctness | unit-test-result | `ROADMAP.md` | SDK readiness requires normal unit tests, not only checker scripts. | Machine-readable unit test report maps passing suite/cases to this ID. | `.local/readiness-evidence/unit-tests.json` | `pnpm run test:unit` |
| GR-TEST-003 | software/protocol correctness | integration-test-result | `ROADMAP.md` | SDK readiness requires integration tests for client/server/transport/session behavior. | Machine-readable integration test report maps passing suite/cases to this ID. | `.local/readiness-evidence/integration-tests.json` | `pnpm run test:integration` |
| GR-TEST-004 | software/protocol correctness | e2e-result | `docs/conformance/sdk-tier-evidence.md` | SDK readiness requires end-to-end MCP interaction coverage. | Machine-readable E2E or conformance-backed report maps passing scenarios to this ID. | `.local/readiness-evidence/e2e.json` | `pnpm run test:e2e` |
| GR-TIER-001 | software/protocol correctness | static-interface | `../modelcontextprotocol/seps/1730-sdks-tiering-system.md` | MCP Tier 1 requires new protocol features before the new spec version release. | Machine-readable protocol-feature freshness evidence maps current protocol support and removed/replaced/extension-gated draft concepts to this ID. | `.local/readiness-evidence/tier-protocol-features.json`, `src/generated/mcp/**`, `scripts/check-tier-protocol-features.mjs` | `pnpm run check:tier-protocol-features` |
| GR-TIER-002 | software/protocol correctness | release-provenance | `../modelcontextprotocol/seps/1730-sdks-tiering-system.md` | MCP Tier 1 requires issue triage within two business days and security/critical bug resolution within seven days. | Machine-readable maintenance evidence maps issue and critical bug response data to this ID. | `.local/readiness-evidence/tier-maintenance.json` | `pnpm run check:sdk-readiness` |
| GR-REL-001 | software/protocol correctness | release-provenance | `docs/conformance/versioning-policy.md` | Release-ready requires stable release provenance beyond package metadata. | Machine-readable release provenance report maps the release audit to this ID. | `.local/readiness-evidence/release-provenance.json`, `package.json` | `pnpm run check:sdk-readiness` |
| GR-DOC-001 | software/protocol correctness | documentation-coverage | `ROADMAP.md` | User-facing docs must be sufficient before artifact readiness. | Machine-readable documentation coverage report maps passing coverage to this ID. | `.local/readiness-evidence/documentation-coverage.json` | `pnpm run check:sdk-readiness` |
| GR-DOC-002 | software/protocol correctness | documentation-coverage | `../modelcontextprotocol/seps/1730-sdks-tiering-system.md` | MCP Tier 1 requires a published dependency update policy. | Published dependency update policy evidence maps to this ID. | `docs/conformance/dependency-update-policy.md`, `.local/readiness-evidence/documentation-coverage.json` | `pnpm run check:sdk-readiness` |
| GR-TSPAR-001 | software/protocol correctness | inventory | `../tsc-sdk-reference/docs/server.md` | TypeScript server docs reference source is inventoried from an exact path. | Exact reference path is cited as non-runtime provenance. | `../tsc-sdk-reference/docs/server.md`, `README.md` | `pnpm run check:sdk-readiness` |
| GR-TSPAR-002 | software/protocol correctness | inventory | `../tsc-sdk-reference/packages/server/package.json` | TypeScript server package reference source is inventoried from an exact path. | Exact reference path is cited as non-runtime provenance. | `../tsc-sdk-reference/packages/server/package.json`, `package.json` | `pnpm run check:sdk-readiness` |
| GR-EFFECT-001 | software/protocol correctness | command-result | `docs/extensions.md` | Standalone readiness does not depend on upstream Effect acceptance. | `pnpm run check:extensions` runs and passes. | `docs/extensions.md`, `docs/conformance/sdk-tier-evidence.md` | `pnpm run check:extensions` |
| GR-AGENT-001 | agent-user effectiveness | agent-eval-result | `docs/sdk-readiness-requirements.md` | Tool/resource/prompt affordances are discoverable and salient for agents. | Machine-readable agent eval report maps passing salience scenarios to this ID. | `docs/agent-evidence/salience-audit.json` | `pnpm run check:sdk-readiness` |
| GR-AGENT-002 | agent-user effectiveness | agent-eval-result | `docs/sdk-readiness-requirements.md` | Representative tasks complete through MCP affordances, not only direct API calls. | Machine-readable agent eval report maps passing task scenarios to this ID. | `docs/agent-evidence/golden-transcripts.json` | `pnpm run check:sdk-readiness` |
| GR-AGENT-003 | agent-user effectiveness | agent-eval-result | `docs/sdk-readiness-requirements.md` | Affordance observability shows offered, selected, ignored, retried, and failed paths. | Machine-readable agent eval report maps passing observability scenarios to this ID. | `docs/agent-evidence/affordance-observability.json` | `pnpm run check:sdk-readiness` |

## Current Expected Verdicts

At this snapshot, `repo-health done` is expected to pass, while `MCP Tier 1`,
`artifact-goal done`, and `release-ready` are expected to be blocked. The
checker must fail if docs or registry data claim those blocked targets as ready
while their blocking rows remain non-pass.
