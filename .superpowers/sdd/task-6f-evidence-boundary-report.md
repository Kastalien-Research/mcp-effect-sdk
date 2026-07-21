# WP6F structurally authoritative authorization evidence report

Date: 2026-07-20
Branch: `codex/wp6-authorization`
Rejected base: `bdd6564d7db6551eccbcb0bed434f394e8d0fd66`
Implementation candidate: `b658d8b`

## Status

Implementation complete for review; **not accepted or sealed**. The required
independent pre-seal architectural review has not run. Full `verify`, official
client-auth conformance, official conformance, and external authorization
conformance remain intentionally deferred until that review returns zero
Critical and zero Important findings.

## Commit lineage

1. `3c2a18b` — `docs: reject WP6F evidence lifecycle candidate`
   - Appends the coordinator rejection of `bdd6564` with the 2 Critical / 1
     Important audit findings, superseding structural contract, expanded
     ownership, and re-review gates.
2. `37a6f02` — `test: require authoritative authorization evidence`
   - Tests-only RED commit. Expands the checked-in matrix from 15 to 21 shared
     lifecycle rows, preserves prior hostile terminal cases as structural
     isolation witnesses, and adds eight semantic settlement paths.
3. `b658d8b` — `fix: make authorization evidence authoritative`
   - Production-only GREEN commit. Replaces live terminal forwarding and exit-
     listener finalization with artifact-first capture, semantic settlement,
     verified pair publication, and one explicit configured exit.

## RED evidence

Production remained unchanged from `bdd6564` plus the coordinator amendment
when the RED suite ran. The authoritative RED command was:

```bash
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm exec node --test test/packaging/wp6-auth-governance.test.mjs
```

Result: exit `1`; 67 tests, 22 passed, 45 failed, 0 cancelled, 0 skipped.
Failures were the intended missing structural behavior:

- shared lifecycle matrix: 0/22 passed (21 rows plus parent); missing artifact
  logs or live terminal-sink coupling caused every row to fail;
- semantic evidence matrix: 0/9 passed (eight rows plus parent): zero/missing,
  warning, and failed checks published evidence `exitCode: 0`; raw child exit
  `2` published evidence `exitCode: 2`; empty/malformed checks left the seeded
  stale readiness file; and the success path lacked artifact-local logs;
- the remaining failures were the repurposed legacy regressions and structural
  source witness, all requiring artifact-first ownership rather than terminal
  callback/listener settlement.

Two diagnostic RED slices confirmed the failure causes without setup noise:

```bash
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm exec node --test --test-reporter=spec --test-name-pattern='authorization output lifecycle matrix is complete and executable' test/packaging/wp6-auth-governance.test.mjs
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm exec node --test --test-reporter=spec --test-name-pattern='authorization evidence is semantically adjudicated before current-pair publication' test/packaging/wp6-auth-governance.test.mjs
```

Results: exit `1`, 0/22 and 0/9 respectively. A prior direct `node --test`
diagnostic was discarded because it omitted pnpm runtime provenance and caused
unrelated existing tests to fail; it was not treated as the TDD RED witness.

## Implementation

The configured authorization runner now has one forward-only owner sequence:

1. create the current run directory and remove the fixed readiness path;
2. resolve the safe target mode and launch the child;
3. consume stdout and stderr through independent streaming redactors until the
   child streams and child process close;
4. atomically publish and re-read complete `stdout.log` and `stderr.log` files;
5. collect checks, validate the evidence schema, normalize child status to
   zero-or-one, and semantically adjudicate the candidate report;
6. atomically publish the readiness/artifact evidence pair, re-read both files,
   require exact byte identity, revalidate both reports, and verify semantic
   agreement; and
7. call `process.exit(configuredExitCode)` exactly once after all authoritative
   synchronous artifacts have settled.

The runner no longer forwards child bytes to `process.stdout` or
`process.stderr`, and it registers no `beforeExit` or `exit` evidence
finalizer. Value-free terminal error containment exists only to keep preload-
installed terminal events non-authoritative during explicit exit.

`settleConformanceEvidenceReport` preserves existing evidence construction for
other runners while adding the authorization runner's build/validate/
adjudicate/publish/re-read contract. It removes both current evidence paths on
publication or verification failure. Empty or malformed check files therefore
exit one with no stale readiness path; missing/zero-check, warning, failed, and
raw-nonzero paths publish a complete byte-identical pair with `exitCode: 1`
when a valid report can be represented.

## Files changed

- `.superpowers/sdd/task-6-preflight.md`
- `.superpowers/sdd/task-6f-output-lifecycle-matrix.md`
- `test/fixtures/wp6-authorization-output-lifecycle.mjs`
- `test/packaging/wp6-auth-governance.test.mjs`
- `scripts/run-conformance-authorization.mjs`
- `scripts/readiness-evidence.mjs`
- `scripts/check-conformance-evidence.mjs`
- `.superpowers/sdd/task-6f-evidence-boundary-report.md`

No SDK source, public authorization API, dependency, lockfile, generated
source, workflow, remote, issue, release, Tier, WP7+, Tasks, Apps, Visual
Effect, MCP IDE, or language-service file changed.

## GREEN verification

Focused governance, Node 22:

```bash
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm exec node --test test/packaging/wp6-auth-governance.test.mjs
```

Result: exit `0`; 67/67 passed, including 21/21 lifecycle rows and 8/8
semantic evidence rows; 0 failures, cancellations, skips, or todos.

Focused governance, Node 24:

```bash
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v24.15.0/bin:$PATH corepack pnpm exec node --test test/packaging/wp6-auth-governance.test.mjs
```

Result: exit `0`; 67/67 passed, including 21/21 lifecycle rows and 8/8
semantic evidence rows; 0 failures, cancellations, skips, or todos.

Structural evidence governance, both runtimes:

```bash
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm run check:conformance-evidence
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v24.15.0/bin:$PATH corepack pnpm run check:conformance-evidence
```

Result: both exit `0` with `Conformance evidence check passed.`

Cumulative WP6, Node 22:

```bash
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm run test:wp6
```

Result: exit `0`; client 90/90, protected-resource 19/19, HTTP 23/23,
all three authorization typechecks passed, and package 74/74. All builds and
all five composed WP6 aliases passed.

Cumulative WP6, Node 24:

```bash
env CI=true PATH=/Users/b.c.nims/.nvm/versions/node/v24.15.0/bin:$PATH corepack pnpm run test:wp6
```

Result: exit `0`; client 90/90, protected-resource 19/19, HTTP 23/23,
all three authorization typechecks passed, and package 74/74. All builds and
all five composed WP6 aliases passed.

Not run by instruction: full `verify`, official client-auth, official
conformance, external authorization conformance, and any remote/release/Tier
operation.

## Self-review

- Confirmed there is no configured-path `beforeExit`/`exit` listener, no live
  child-output forwarding, and no result derived from terminal sink health.
- Confirmed both child streams and child close are awaited before log
  publication; logs are written with temporary siblings, renamed, and re-read.
- Confirmed raw child nonzero statuses are normalized to one before report
  construction and semantic failures revise a valid report to `exitCode: 1`
  before publication.
- Confirmed both evidence files are re-read byte-for-byte, parsed, contract-
  validated, and checked for configured-result agreement before exit zero.
- Confirmed publication/verification failure removes the current evidence pair
  and the runner's initial clear prevents an earlier readiness file surviving
  malformed current output.
- Confirmed the existing `writeConformanceEvidenceReport` behavior used by
  other conformance lanes remains intact except for a factored path helper.
- Confirmed the diff touches only the authorized runner/evidence/governance
  boundary and its coordinator/test artifacts.

## Surprises and environment compounding

Positive: removing terminal forwarding made all 21 historical listener/callback
traps structurally irrelevant while retaining complete redacted output for
audit. The expanded matrix and reusable fixture make that property executable
instead of prose-only.

Negative: invoking the focused test directly with Node omits the pnpm user-agent
provenance required by existing evidence tests, producing unrelated failures.
The exact pinned-pnpm commands above avoid that false RED. A small future
focused-governance package alias would make the correct invocation harder to
miss; it was not added because package-script changes are outside this bounded
repair.

## Remaining concerns and review gates

- Captured logs are held in memory until stream close. This is bounded by the
  external harness's practical output today but should be revisited with a
  redacting temporary-file stream if authorized targets can emit very large
  output.
- An independent reviewer must audit the artifact-first boundary and return
  zero Critical and zero Important findings before WP6F can be accepted or
  sealed.
- Only after that approval should the deferred full `verify` and official
  client-auth/conformance gates be run. External authorization still requires
  a separately approved real target.
