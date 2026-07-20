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
- WP6F implementation candidate is sealed at
  `497e71318b8b24f6edfbd79e8edefb43fb7352dd` / tree
  `9e309398fafb8b44b8a9d6dc6d58ee7929215b7c` and awaits fresh independent
  review. Node 22 and Node 24 cumulative WP6 are 147/147 plus all three type
  fixtures; full loopback-permitted `verify` exits 0 on both. Official pinned
  client-auth exits 0 on both with 14 scenarios, zero failures, and zero
  conformance warnings.
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

- WP6F: immutable independent review and coordinator acceptance.
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
