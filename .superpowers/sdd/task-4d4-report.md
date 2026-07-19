# Task 4D4 report: direct client integration and legacy transport removal

## Outcome

Task 4D4 and its first independent review-fix cycle are implemented on
`codex/wp4-wire-kernel-transports`. The code head before this report update is
`38e65bf`; review began from clean exact head `57974d3` with 0 Critical,
7 Important, and 2 Minor findings.

- `subscriptions/listen` now sends the generated `{ notifications }` envelope,
  remains caller-owned, and the catalog example scopes/forks it so later reads
  execute.
- Dispatcher ownership has no production `Queue.unbounded`. Client owners and
  server-failure supervision are bounded; saturation cannot lose a terminal or
  failure, stall an unrelated owner, or leak unowned global notifications.
- Stdio cancellation is armed only after successful request ownership. A
  rejected duplicate ID cannot cancel the valid original request.
- Stdio subscription routing now enforces generated payload codecs, first and
  exact acknowledgement, filter subsets, selected notifications, exact
  progress-token ownership, and exact server cancellation. Invalid traffic
  fails only its owner without closing shared stdio.
- Stable package subpaths `mcp-effect-sdk/transport/stdio` and
  `mcp-effect-sdk/transport/http` publish only modern client/server namespaces;
  deprecated and removed legacy boundaries remain sealed.
- Package-health `verify` is green independently. Official client-auth remains
  a separate, unsuppressed evidence command.
- The deferred ledger now maps exact sequential WP5-WP11 responsibilities:
  core surface, auth, Tasks, two Apps packages, RC qualification, and final
  reconciliation/release.

No WP5 subscription product object, WP6 auth behavior, Tasks, Apps, release,
Tier claim, or remote mutation was added.

## Files changed

The review-fix cycle changes 23 files relative to `57974d3` (798 insertions,
130 deletions): client/dispatcher/stdio sources, two transport entrypoints,
focused runtime and type tests, package exports, verification/parity checkers,
the deferred ledger, and operational docs.

## TDD commits

- Client envelope/lifetime: RED `668f64d`; GREEN `0355339`.
- Bounded exact dispatcher ownership: RED `f47c663`, overflow RED `f298f39`;
  GREEN `07a7cf0`.
- Strict stdio subscription ownership: RED `37d41b2`; GREEN `58b1c85`.
- Stable transport entrypoints: RED `ac2087b`; GREEN `d6ad811`.
- Package-health/auth evidence separation: RED `596a977`; GREEN `8af4921`.
- Exact WP5-WP11 ledger: RED `c22ff87`; GREEN `38e65bf`.

## Verification

Runtime: Node `v22.22.3`, pnpm `10.11.1` via Corepack.

- Final `pnpm run verify`: exit 0.
- WP3 schema 28/28 and protocol 14/14; WP4 wire 18/18, dispatcher
  26/26, stdio 22/22, cumulative HTTP 116/116, and cumulative
  transports/package/governance/client 12/12, with public type fixtures.
- WP2 review 17/17; source/generated/invariant/schema/extension/runtime,
  unit, integration, tier-accounting, and packed-consumer gates pass.
- Draft e2e passes 2/2 through both the readiness suite and the explicit gate.
- Separate `pnpm run conformance:client-auth`: exit 1 with 225 passed,
  12 SEP-837 `application_type` failures, and 1 SEP-2350 scope-union warning.
  Artifact: `.local/conformance/client-auth-2026-07-18T23-59-04-442Z`.

Readiness accounting remains internally consistent and blocked for official
conformance, release, and Tier claims. No remote state was mutated.

## Surprises and environment compounding

- Positive: one bounded per-owner event model preserved terminal ordering and
  made exact-owner overflow failure possible without stalling shared stdio.
- Negative: the unreachable global queue and transport-level finalizer looked
  locally harmless but together hid notifications and let duplicate rejection
  cancel another owner's valid request.
- Environment changes made: focused saturation/duplicate/subscription tests,
  a static no-unbounded guard, packed self-import probes for stable subpaths,
  a strict seven-entry ledger checker, and enforced package-health/auth lane
  separation.
- Recommended follow-up: WP6 should fix `application_type` and scope union in
  its own RED/GREEN slices while retaining the current standalone evidence.

## Remaining risks

- Task 4D4 still requires coordinator exact-head review and acceptance.
- Official draft/core conformance, release provenance, and Tier evidence remain
  future work. Package health does not satisfy those claims.
