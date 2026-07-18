# Task 4D3 fix cycle 4

## Review input

The independent rereview of
`f5058acc96c2e79bcce4f4577da2d9349031d841` found 0 Critical, 3 Important,
and 1 Minor issue: live SSE failures bypassed the diagnostic sink, cancellation
cleanup could replace a known 413, trusted parsed-body accessors were invoked,
and the report header named a stale fix-cycle count.

## TDD ledger

1. Live SSE failure supervision
   - RED `fa3710b`: the response stream failed as expected, but the sink-entry
     signal timed out. No live `sse_response` diagnostic was delivered.
   - GREEN `a36d492`: offer the reserved failure control frame first, then
     report the original encoding `InternalError` as an exact Effect `Cause`.
     The blocking sink proves stream termination is independent of diagnostic
     completion; closed-state serialization guarantees a single report.
2. Oversize result precedence
   - RED `ee04642`: a 1,024-byte chunk with `maxBodyBytes: 16` and a throwing
     underlying `cancel()` returned HTTP 400 rather than 413.
   - GREEN `9faa99d`: body-read results carry cancellation cleanup failure
     separately. The cleanup Cause is supervised through `request_body`, while
     the public response remains bodyless HTTP 413.
3. Trusted parsed-body descriptors
   - RED `6366795`: throwing and returning accessors on `parsedBody` and
     `parsedBodyByteLength` were all invoked. Returning accessors stalled,
     throwing accessors rejected, and no raw body was cancelled.
   - GREEN `de7fbd0`: inspect own property descriptors and accept only data
     descriptors. Accessors are rejected without invocation; the raw body is
     cancelled and unlocked; ordinary own data properties retain their prior
     behavior and public types remain unchanged.

## Verification

All commands used Node 22.22.3 through:

`env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin corepack pnpm run <script>`

- `test:wp4-http-server`: 56/56 plus public types after the authorized
  loopback rerun; the restricted-only failure was `listen EPERM`.
- `test:wp4-http-client`: 43/43 plus public types.
- `test:wp4-http-metadata`: 13/13 plus public types.
- `test:wp4-wire`: 18/18 plus public types.
- `test:wp4-dispatcher`: 20/20 plus public types.
- `test:wp4-stdio`: 20/20 plus public types.
- `test:wp2-review`: 16/16.
- `check:effect-foundation` and `test:effect-foundation`: pass, 8/8.
- `check:sdk-runtime`, `sources:check`, `check:generated`,
  `check:generated-protocol-surfaces`, `check:tier-protocol-features`,
  `check:invariants`, `check:schema-fixtures`, `check:type-fixtures`,
  `test:unit`, `test:integration`, and `build`: pass.
- `git diff --check` from the cycle and Task 4D3 bases: pass.
- Added-production scan for `runSync`, `runFork`, `Queue.unbounded`,
  `new ReadableStream`, and `controller.`: zero hits.
- `check:ts-sdk-parity`: expected exit 1 only for unchanged WP4D4 and
  later-plan gaps; no WP4D3 transport finding.

## State

Candidate implementation head before this evidence commit:
`de7fbd067a50c2e867352259a78cde6f60a3d33c`.

Task 4D3 remains pending fresh independent rereview and coordinator exact-head
verification. No acceptance is claimed, and Task 4D4 has not started.
