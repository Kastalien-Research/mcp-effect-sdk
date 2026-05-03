# Phase 6 Work Item: Conformance Evidence And Example Server

This is the Phase 0 grounding artifact for Phase 6 of
`docs/acceptance-gates/sdk-generator.md`.

## Scope

Implement Phase 6: turn SEP-1730 SDK tier requirements into reproducible
package evidence, backed by conformance scenario mapping and an
Everything-style server implemented with this SDK.

This phase also owns the cleanup needed to make conformance evidence credible:
remove or archive the historical `mcp/**` tree, add CI for package and
conformance gates, and make the package-manager boundary between this pnpm
package and the npm-based `../conformance` checkout explicit.

Out of scope:

- Phase 7 extension opt-in gates.
- New task-runtime semantics beyond defects discovered while wiring
  conformance evidence.
- Upstream `effect-smol` integration or SEP submission work.
- Tier 2 or Tier 1 README claims before evidence exists.

## Acceptance Criteria

| ID | Criterion | Required evidence |
| --- | --- | --- |
| AC-6.1 | The package includes an Everything-style example server for conformance testing. | `src/examples/everything-server.ts`, package script to run the built server, and docs naming the server URL/transport. |
| AC-6.2 | Conformance scenarios are mapped to SDK features. | Reproducible scenario map derived from `../conformance/src/scenarios/**` and SDK feature surfaces. |
| AC-6.3 | The package exposes a generated or reproducible SDK tier evidence report. | Scripted evidence output that records conformance coverage, docs/release/versioning policy signals, dependency update policy signals, and tier blockers. |
| AC-6.4 | Tier 2 and Tier 1 claims are backed by conformance results, docs, release/versioning policy, and dependency update policy. | Evidence report links every Tier 2/Tier 1 requirement to pass/fail/unsupported data; README claims match that report. |
| AC-6.5 | The README does not claim a tier that is not evidenced. | README tier language is either absent or explicitly lower than/equal to the evidence report. |
| AC-6.6 | The historical `mcp/**` tree is removed or archived after surviving behavior is accounted for. | Active package source and tests use `src/**`; docs explain that historical code is no longer an active source of truth. |
| AC-6.7 | CI runs the package verification and conformance evidence gates. | Workflow files run `pnpm run verify`, evidence checks, and conformance commands with pinned setup actions. |
| AC-6.8 | The pnpm package boundary and npm conformance boundary are scripted, documented, and not intermingled. | Package scripts and docs show where pnpm is used, where npm is used, and which directory owns each lockfile. |
| AC-6.9 | Server lifecycle commands start, check, use, and stop the Everything-style server predictably. | Scripts or documented commands cover start, readiness probing, conformance execution, and cleanup of the server process. |

Exit rule: do not publish Tier 2 or Tier 1 claims based on roadmap intent.

## Source Paths

Read these first:

1. `docs/acceptance-gates/sdk-generator.md`
2. `docs/sdk-generator-workflow.md`
3. `../modelcontextprotocol/seps/1730-sdks-tiering-system.md`
4. `../conformance/README.md`
5. `../conformance/SDK_INTEGRATION.md`
6. `../conformance/src/scenarios/**`
7. `../conformance/src/tier-check/**`
8. `../conformance/examples/servers/typescript/everything-server.ts`
9. `mcp/**`
10. `src/McpServer.ts`
11. `src/McpClient.ts`
12. `src/McpTasks.ts`
13. `src/McpSchema.ts`
14. `src/generated/mcp/McpProtocol.generated.ts`
15. `README.md`
16. `ROADMAP.md`
17. `package.json`

## Expected Files

Expected new files:

- `src/examples/everything-server.ts`
- `scripts/check-conformance-evidence.mjs`
- `scripts/check-historical-mcp-cleanup.mjs`
- `docs/conformance/scenario-map.md`
- `docs/conformance/sdk-tier-evidence.md`
- `docs/conformance/historical-mcp-reconciliation.md`
- `docs/conformance/dependency-update-policy.md`
- `docs/conformance/versioning-policy.md`
- `scripts/run-conformance-server.mjs`
- `scripts/run-conformance-suite.mjs`
- `.github/workflows/verify.yml`

Expected changed files:

- `package.json`
- `scripts/verify.mjs`
- `README.md`
- `ROADMAP.md`, only if current-state or remaining-work text would otherwise
  drift.
- `docs/acceptance-gates/sdk-generator.md`, if Phase 8 is collapsed into this
  Phase 6 cleanup decision.

Do not edit:

- `src/generated/mcp/**`, unless Phase 6 exposes a real generator input gap.
- `../conformance/**`, unless the conformance harness itself is proven wrong
  and the fix is explicitly scoped.

## Dynamic Validation Commands

Current baseline gate:

```bash
pnpm run verify
```

Phase 6 should add these package-local commands:

```bash
pnpm run check:conformance-evidence
pnpm run check:historical-mcp
pnpm run conformance:server
pnpm run conformance:run
```

Expected implementation-level validation after the server and evidence scripts
exist:

```bash
pnpm run build
node scripts/check-conformance-evidence.mjs
node scripts/check-historical-mcp-cleanup.mjs
node scripts/run-conformance-server.mjs
node scripts/run-conformance-suite.mjs
```

## Executable Acceptance Contract

Phase 6 is complete only when the criteria below are enforced by package-local
scripts and CI. Documentation alone is not enough.

### Package Scripts

`package.json` must expose:

- `check:conformance-evidence`: runs `node scripts/check-conformance-evidence.mjs`.
- `check:historical-mcp`: runs `node scripts/check-historical-mcp-cleanup.mjs`.
- `conformance:server`: builds the package and starts the Everything-style
  server for manual conformance runs.
- `conformance:run`: builds the package, starts the server, waits for
  readiness, runs the conformance server suite, and stops the server.
- `verify`: includes `check:conformance-evidence` and `check:historical-mcp`
  after the existing build and generated checks. It should not run the full
  conformance suite by default unless that suite is cheap and stable locally.

### Script-Level Checks

| Criterion | Enforced by | Required failure conditions |
| --- | --- | --- |
| AC-6.1 | `pnpm run build`; `pnpm run conformance:server`; `scripts/check-conformance-evidence.mjs` | Fail if `src/examples/everything-server.ts` is missing, excluded from `tsconfig.json`, not emitted under `dist/examples/`, or not referenced by a package script. |
| AC-6.2 | `scripts/check-conformance-evidence.mjs` | Fail if `docs/conformance/scenario-map.md` is missing, omits active scenario files under `../conformance/src/scenarios/server/**`, or maps scenarios only to prose without SDK feature/status fields. |
| AC-6.3 | `scripts/check-conformance-evidence.mjs` | Fail if `docs/conformance/sdk-tier-evidence.md` is missing, lacks a reproducible command, lacks a timestamp/source input section, or omits conformance coverage and tier blockers. |
| AC-6.4 | `scripts/check-conformance-evidence.mjs`; `pnpm run conformance:run` | Fail if Tier 2 or Tier 1 is claimed without recorded conformance result paths, release/versioning policy, dependency update policy, and roadmap evidence. Runtime pass/fail percentages remain dynamically validated by `conformance:run`. |
| AC-6.5 | `scripts/check-conformance-evidence.mjs` | Fail if `README.md` claims Tier 2, Tier 1, full conformance, or production readiness above the current evidence report. |
| AC-6.6 | `scripts/check-historical-mcp-cleanup.mjs`; `scripts/check-invariants.mjs` | Fail if a top-level `mcp/` directory remains, if active package code imports `mcp/**`, if package scripts reference `mcp/**`, or if `docs/conformance/historical-mcp-reconciliation.md` is missing. |
| AC-6.7 | `scripts/check-conformance-evidence.mjs`; GitHub Actions | Fail if `.github/workflows/verify.yml` is missing, omits `pnpm run verify`, omits the conformance evidence checks, or uses unpinned third-party actions. |
| AC-6.8 | `scripts/check-conformance-evidence.mjs`; `scripts/run-conformance-suite.mjs` | Fail if package scripts run `npm` in this package root, if conformance scripts run `pnpm` in `../conformance`, or if docs omit which lockfile owns each install. |
| AC-6.9 | `scripts/run-conformance-suite.mjs` | Fail if the server is not started by the script, readiness is not checked before conformance starts, the server process is not cleaned up on failure, or the conformance URL is not printed. |

### CI Contract

`.github/workflows/verify.yml` must run at least:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run verify
pnpm run conformance:run
```

If CI builds the sibling `../conformance` checkout from this repository layout,
it must do so in that directory with npm:

```bash
npm --prefix ../conformance ci
npm --prefix ../conformance run build
```

Any GitHub Actions used by CI must be pinned to full commit SHAs with version
comments.

### Historical `mcp/**` Cleanup Contract

The default decision is deletion, not archival. Archival is allowed only if the
Phase 6 implementation explains why deletion would lose evidence that is not
captured in `docs/conformance/historical-mcp-reconciliation.md`.

`docs/conformance/historical-mcp-reconciliation.md` must list:

- historical test files reviewed
- behavior ported into active checks or conformance evidence
- behavior intentionally dropped
- replacement active files or scripts for each kept behavior

After cleanup, active source-of-truth references to `mcp/**` are limited to
historical explanation in docs. Active package source, scripts, tests, and
exports must not depend on it.

### Local Compute Boundary

Local default validation should stay lightweight:

- `pnpm run verify` proves static/package correctness and evidence wiring.
- `pnpm run conformance:run` is explicit because it starts a server and runs the
  conformance harness.
- Broader or slower conformance suites should be separate opt-in scripts or CI
  jobs, not hidden inside the default local gate.

Expected conformance harness validation, run from `../conformance` after the
example server is listening:

```bash
npm run build
node dist/index.js server --url http://localhost:3000/mcp --suite active
node dist/index.js tier-check \
  --repo Kastalien-Research/mcp-effect-sdk \
  --conformance-server-url http://localhost:3000/mcp
```

If the conformance package is not built locally, use its documented equivalent:

```bash
npx @modelcontextprotocol/conformance server \
  --url http://localhost:3000/mcp \
  --suite active
```

## Static Validation Report

| Phase 0 ID | Verdict | Evidence |
| --- | --- | --- |
| AC-0.1 | PASS | This work item names exactly Phase 6. |
| AC-0.2 | PASS | Source paths above cite the acceptance gate, workflow, SEP-1730, conformance harness, package source, and package docs. |
| AC-0.3 | PASS | Expected generated/reproducible evidence, handwritten example server, scripts, docs, and package metadata are listed. |
| AC-0.4 | PASS | Runtime conformance and tier-check commands are named above. |

Static limitations:

- This document does not prove that conformance scenarios pass.
- This document does not prove Tier 2 or Tier 1 eligibility.
- This document does not prove the example server is reachable over the final
  transport until the server exists and the conformance command runs.

Readiness verdict: ready to implement Phase 6 on `phase-6-conformance-evidence`.

## Server Lifecycle Commands

Server lifecycle commands are the repeatable commands that manage the
Everything-style example server around conformance runs:

1. Build the SDK and example server.
2. Start the server on a known host and port.
3. Wait until the server is ready, or fail with a clear timeout.
4. Run conformance against the server URL.
5. Stop the server process even when conformance fails.

Without these commands, each conformance run depends on ad hoc terminal state:
one shell starts a long-running server, another shell runs tests, and cleanup is
manual. That is fragile locally and unusable in CI. Phase 6 should replace that
with package scripts.

## Remaining SDK Work

After Phase 6, the projected SDK work is:

1. Phase 7: extension opt-in gates. Keep extension support disabled by default,
   require explicit opt-in, document supported extensions, isolate experimental
   code from generated core protocol code, and ensure extension-only behavior is
   not counted as core conformance.
2. Release hardening not already covered by Phase 6: final package metadata,
   release notes, and any external publication checklist.
3. Optional upstream work: identify which pieces should move toward
   `effect-smol`, without making standalone SDK readiness depend on upstream
   acceptance.

## Process Risks

Known absences that can cause trouble later:

- No retained per-phase acceptance reports for Phases 1-5. `pnpm run verify` is
  the executable gate, but historical decision evidence is thin.
- Package metadata is skeletal, which blocks honest Tier 2/Tier 1 evidence even
  if protocol behavior improves.
- CI and conformance can hammer local machines if the scripts default to broad
  suites. Phase 6 should keep local commands targeted and leave heavier suites
  to explicit CI or opt-in commands.
