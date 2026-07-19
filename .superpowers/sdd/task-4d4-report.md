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

## Second independent rereview-fix cycle

Second rereview at exact clean candidate
`a6953f4df38b2b8c11e6e8ec9d692148111f33e5` reported 0 Critical,
3 Important, and 2 Minor findings. The committed chronological repairs are:

- RED `82b454b`, GREEN `eb08891`: require acknowledgement before a
  subscription terminal and validate the generated `SubscriptionsListenResult`
  plus exact numeric/string subscription metadata. A private validator is
  shared with HTTP without a public API change or HTTP behavior change.
- RED `06bfa60`, GREEN `206e144`: route `notifications/cancelled` by normative
  `requestId`, never conflicting subscription `_meta`; generated-invalid
  cancellation fails closed through the existing stdio protocol policy.
- RED `6b93bb7`, GREEN `cd4b512`: emit exactly one remote cancellation for a
  successfully sent owner that fails on local invalid traffic or overflow. The
  abandonment callback runs caught in a scoped fiber after atomic exact-owner
  removal, cannot block or reclassify the primary typed failure, and does not
  recurse. Remote cancellation, valid terminal, close, duplicate rejection,
  and send failure remain non-abandoning.
- Evidence ledger `0464c3c`: refresh the tracked client-auth snapshot to
  alpha.9 with 225 passed, 12 SEP-837 `application_type` failures, and 1
  SEP-2350 scope-union warning. The ignored progress current/next ledger was
  also refreshed without changing its ignore policy.

The restricted exact-head Node 22 `pnpm run verify` attempt exited 1 only on
localhost `EPERM` in cumulative HTTP and both draft E2E gates. The identical
command rerun with ephemeral loopback permission at `0464c3c` exited 0:

- WP3 schema 28/28; protocol 14/14; wire 18/18; dispatcher 30/30; stdio 22/22;
  HTTP metadata 13/13; cumulative HTTP 116/116; transports 12/12; WP2 17/17;
  source refresh 3/3; tier operations 10/10.
- Source, generated, invariant, schema, extension, public-type, build, unit,
  integration, and readiness-accounting gates passed.
- `draft-round-trip` and `tools-call` passed in both the readiness E2E run and
  the explicit draft E2E run.

The separate unsuppressed client-auth baseline remains 225 passed, 12 failed,
and 1 warning. It is deferred WP6 evidence, not package health or a readiness
claim. The only remaining Task 4D4 risk is immutable independent exact-head
rereview and coordinator acceptance; no behavior beyond the reviewed fixes,
no WP5/WP6 feature work, no remote mutation, and no release or Tier claim was
added.
