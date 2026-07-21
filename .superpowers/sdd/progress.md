# Persistent execution progress

Goal: `019f6e6a-4888-7d32-915d-2747d6b05578`

Authoritative execution prompt: `docs/prompts/2026-07-16-implement-mcp-draft-tier1-goal-mode.md`

Implementation plan: `docs/plans/2026-07-16-feat-align-mcp-draft-tier1-plan.md`

Detailed evidence ledgers remain authoritative for commit identities, review
packages, verification commands, and gate outcomes.

## Accepted local work packages

- WP1-WP5: accepted locally; see `.superpowers/sdd/task-3a-report.md` through
  `.superpowers/sdd/task-5-report.md`.
- WP6A: accepted locally; authorization source/provenance pinning.
- WP6B: accepted locally; Effect-native authorization boundaries.
- WP6C: accepted locally; discovery, credential, issuer, and scope behavior.
- WP6D: accepted locally at `4772ba713157a5d7c854a9ee445f4bf481aacfc7`;
  transaction/token core. Independent final review: APPROVE, 0 Critical / 0
  Important / 0 Minor. See `.superpowers/sdd/task-6-report.md`.

Local acceptance is not official MCP conformance, release qualification,
publication, or Working Group Tier qualification.

## Current work package

- WP6E: accepted locally at `6b60f8e95d07167781681c19addddac3140d4d82`
  after final independent APPROVE, 0 Critical / 0 Important / 0 Minor.
- WP6 runtime prerequisite: accepted locally at
  `5cd6c3e73d50d20deeade7379e6e58ed9a09db88` after sealed independent
  APPROVE, 0 Critical / 0 Important / 0 Minor. This accepts the public
  `AuthorizationClient` constructor/Layer and explicit HTTPS-default,
  loopback-HTTP-only fixture policy only.
- WP6F output-lifecycle experiment is not a Tier requirement. Commit `ebbf6ec`
  was reverted by `059406a`, and `2527494` keeps the historical lifecycle-heavy
  test outside the authoritative WP6 package gate while retaining core auth
  governance coverage.
- Scope: Streamable HTTP authorization integration only.
- Required RED groups: focused client HTTP authorization tests plus protected
  resource HTTP/runtime/type tests.
- Required GREEN: Effect-native authorization client service integration,
  strict 401 versus 403 Bearer challenge behavior, cumulative scopes,
  independent authorization and HeaderMismatch recovery budgets, cancellation
  propagation, verified-token server boundary, token-free principal, exact
  challenge responses, and restricted already-verified embedding hook.
- No dependency, lockfile, generated protocol/schema, package/script,
  external authorization-server, remote, issue, release, or Tier mutation is
  authorized in this slice. A coordinator-approved compile-only migration at
  two active example call sites is recorded in the WP6 preflight; WP6F still
  owns public authorization examples and governance.
- Accepted prerequisite Node 22 and Node 24 corrected direct WP6 matrix:
  131/131 on each; all three WP6 type fixtures pass on each. Full
  `pnpm run verify` exits 0 on both implementer lanes and on the fresh Node 22
  reviewer lane with loopback permission. These are package-health gates only.

## Remaining sequence

- Core Phase B: repair every locally actionable complete-inventory failure,
  then perform one bounded independent review and the full Node 22/24 core gate.
- WP7: Tasks.
- WP8: Apps server/View.
- WP9: Apps Host/preview.
- WP10: release-candidate qualification.
- WP11: final reconciliation, approval-gated release, and Tier disposition.

## Persistent blockers and approval gates

- Official draft-targeted MCP conformance remains separate from local package
  health and self-hosted draft E2E.
- External authorization-server integration remains opt-in and must not be
  inferred from local mocks or client-auth conformance.
- PR #27 disposition requires user approval after the approved behavior is
  ported and re-proved.
- Merge, issue closure/reclassification, publication/release, and Tier claims
  require their prescribed approvals and evidence.

## Complete official core inventory burn-down

- Fresh Node 22 baseline: server 40/40 scenarios, 74 passed checks, 24 failed,
  5 warnings at `.local/conformance/all-2026-07-21T01-33-14-803Z`; client 32/32
  scenarios, 434 passed, 1 failed, 2 informational skips at
  `.local/conformance/client-all-2026-07-21T01-33-41-828Z`.
- MRTR accepted locally at `e4f43eb`. Independent Node 22 verification: focused
  MRTR package 27/27; all 14 official SEP-2322 scenarios 21/21 checks with zero
  failures or warnings.
- Fresh complete server inventory after MRTR:
  `.local/conformance/all-2026-07-21T01-52-14-652Z` — 40/40 scenarios,
  94 passed checks, 14 failed, 3 warnings. The exact reduction is all ten MRTR
  failures and both MRTR warnings.
- Stateless diagnostic fixtures accepted locally at `bb45892`. Independent
  Node 22 verification: official `server-stateless` is 27/30 passed with only
  the three pinned contradictions and zero warnings.
- Fresh complete server inventory after stateless fixtures:
  `.local/conformance/all-2026-07-21T01-59-39-956Z` — 40/40 scenarios,
  98 passed checks, 11 failed, 1 warning. JSON response mode also exposed one
  pre-existing empty-argument failure in the first listed tool during standard
  header validation; it maps to the existing HTTP-header cluster.
- Remaining locally actionable server inventory: 8 failures and 1 warning.
  Externally blocked pinned server contradictions remain 3 failures; the pinned
  client contradiction remains 1 failure; client informational skips remain 2.
