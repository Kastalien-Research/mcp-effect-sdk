# Task 4D3 fix cycle 7

## Review input

The independent rereview of
`faf0fd9629fd6f88e2b5d3b6de693872f2072e8d` found 0 Critical, 1 Important,
and 0 Minor issues. Concurrent caller ownership closure could interrupt the
cleanup-report child before acceptance, leaving the handler blocked on its
one-second fallback timeout.

## TDD ledger

1. RED `d1a041e`
   - Added direct `Scope.extend(handle(...), scope)` followed by scope closure
     one microtask later, plus the equivalent `toWebHandler` handler/dispose
     race.
   - Both responses eventually remained bodyless HTTP 413; both bodies were
     cancelled and unlocked; both disposals were prompt; and the sink was
     legitimately unentered with no duplicate. Both handler promises still
     missed 150 milliseconds and settled after roughly one second.
2. GREEN `b78000d`
   - Races the acceptance Deferred with the owned child's Effect-level
     `Fiber.await`. Child exit completes the same Deferred when closure wins
     before the sink starts; ordinary acceptance remains exact once.
   - Both concurrent closure cases complete in about 1 millisecond without
     requiring post-closure sink invocation. The ordinary 200-request scoped
     control remains 200/200 exact once, and every sink exit mode remains
     prompt and contained.
   - No callback observer, raw controller, detached runtime, unbounded queue,
     `runFork`, or `runSync` path was added.

## Verification

All counted commands used Node 22.22.3 through:

`env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin corepack pnpm run <script>`

- `test:wp4-http-server`: 60/60 plus public types.
- `test:wp4-http-client`: 43/43 plus public types.
- `test:wp4-http-metadata`: 13/13 plus public types.
- `test:wp4-wire`: 18/18 plus public types.
- `test:wp4-dispatcher`: 20/20 plus public types.
- `test:wp4-stdio`: 20/20 plus public types.
- `test:wp2-review`: isolated counted rerun 16/16. A prior concurrent run
  timed out only its stdio subprocess while the dedicated stdio suite ran;
  both isolated suites passed.
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
`b78000d08fd3210b1e4a051a941115566de3a1ae`.

Task 4D3 remains pending fresh independent rereview and coordinator exact-head
verification. No acceptance is claimed, and Task 4D4 has not started.
