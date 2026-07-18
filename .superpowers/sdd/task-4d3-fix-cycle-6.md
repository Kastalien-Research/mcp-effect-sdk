# Task 4D3 fix cycle 6

## Review input

The independent rereview of
`5b613314170d0ce3d27c24abc25c5d19cec03bd1` found 0 Critical, 1 Important,
and 0 Minor issues. Direct `Effect.scoped(handle(...))` caller-scope closure
could interrupt the cleanup diagnostic fiber before the sink accepted the
exact Cause; the reviewer reproduced the loss 200/200 times.

## TDD ledger

1. RED `885b5c3`
   - Added the public Effect-native scoped-handle pattern with an oversized raw
     body, throwing cancellation, and a sink that records entry and then never
     completes.
   - All 200 responses were prompt bodyless HTTP 413, all bodies were cancelled
     and unlocked, and all scopes disposed, but exact cleanup diagnostics were
     accepted 0/200 times.
2. GREEN `df2d8e1`
   - The caller-owned diagnostic child invokes the sink constructor once and
     acknowledges that acceptance through a Deferred before the response may
     complete. Only the start/acceptance handshake is awaited; sink completion
     remains isolated behind a one-second bound.
   - The same probe accepts 200/200 exact Causes exactly once. Caller-scope
     closure owns and interrupts every child, so repetition does not accumulate
     diagnostic fibers.
   - Sink-construction throw, failure, defect, interruption, and noncompletion
     are contained. The managed Web adapter's never-sink disposal control stays
     green. No detached runtime, unbounded queue, `runFork`, or `runSync` path
     was added.

## Verification

All counted commands used Node 22.22.3 through:

`env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin corepack pnpm run <script>`

- `test:wp4-http-server`: 59/59 plus public types.
- `test:wp4-http-client`: 43/43 plus public types.
- `test:wp4-http-metadata`: 13/13 plus public types.
- `test:wp4-wire`: 18/18 plus public types.
- `test:wp4-dispatcher`: 20/20 plus public types.
- `test:wp4-stdio`: 20/20 plus public types.
- `test:wp2-review`: 16/16.
- `check:effect-foundation` and `test:effect-foundation`: pass, 8/8.
- `check:sdk-runtime`, `sources:check`, `check:generated`,
  `check:generated-protocol-surfaces`, `check:tier-protocol-features`,
  `check:invariants`, `check:schema-fixtures` (23 round-trips and 9 negative
  cases), `check:type-fixtures`, `test:unit`, `test:integration`, and `build`:
  pass.
- `git diff --check` from the cycle and Task 4D3 bases: pass.
- Added-production scan for `runSync`, `runFork`, `Queue.unbounded`,
  `new ReadableStream`, and `controller.`: zero hits.
- `check:ts-sdk-parity`: expected exit 1 only for the unchanged 17 WP4D4 and
  later-plan gaps; no WP4D3 transport finding.

## State

Candidate implementation head before this evidence commit:
`df2d8e12f639a45df03db79b9d32f5039810c198`.

Task 4D3 remains pending fresh independent rereview and coordinator exact-head
verification. No acceptance is claimed, and Task 4D4 has not started.
