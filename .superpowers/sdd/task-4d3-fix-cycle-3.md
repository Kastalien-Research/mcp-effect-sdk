# Task 4D3 fix cycle 3

## Review input

The independent rereview of
`b37fcf7bac66cfae03a795e0ba0a85ca653f1f2d` found 0 Critical, 4 Important,
and 0 Minor issues: unverifiable consumed parsed bodies, queue-full failure
delivery, retained empty upload chunks, and discarded transport failure Causes.

## TDD ledger

1. Parsed-body physical bound
   - RED `84791e7`: runtime accepted an already-consumed upload above
     `maxBodyBytes`; the public type fixture rejected the absent trusted-count
     option.
   - Fixture correction `0e665eb`: a recoverable exact request ID must receive
     the typed `-32600` JSON error rather than a bodyless 400.
   - GREEN `645cb9f`: require and validate `parsedBodyByteLength` when raw bytes
     cannot be measured, reject trusted oversize counts, and meter available raw
     bodies regardless of parsed input.
2. Queue-full failure termination
   - RED `ca3bef4`: after acknowledgement and two valid frames, the terminal
     read timed out when the failure publisher was interrupted against a full
     queue.
   - Fixture correction `a15f8f5`: completion may win the abort race; the
     dedicated interruption control continues requiring interruption-only.
   - GREEN `341e033`: normal frames use `maxPendingFrames` permits and the
     bounded queue has one reserved control slot for failure or EOF. Permits are
     released on stream consumption and scope cleanup shuts the queue down.
3. Empty raw chunks
   - RED `af658a8`: a 20,000-empty-chunk upload completed, while the deterministic
     source guard proved every empty chunk was still retained.
   - GREEN `a40b11f`: skip zero-byte chunks before retention.
4. Failure supervision
   - RED `093b4d7`: public types lacked `failureSink`; raw-reader failure had to
     retain exact error identity without exposing its message on the wire.
   - Fixture correction `615672f`: inject the SSE response defect at the public
     subscription boundary and guard the otherwise inaccessible JSON catch.
   - GREEN `c80e3bf`: report exact Effect Causes to an isolated optional sink at
     `request_body`, `json_response`, and `sse_response` stages while preserving
     constant-safe responses.

## Verification

All commands used Node 22.22.3 through:

`env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin corepack pnpm run <script>`

- `test:wp4-http-server`: 53/53 runtime plus public types.
- `test:wp4-http-client`: 43/43 runtime plus public types after an authorized
  rerun for the loopback test; the sandbox-only failure was `listen EPERM`.
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
- `git diff --check` from both the Task 4D3 cycle base and task base: pass.
- Added-production scan for `runSync`, `runFork`, `Queue.unbounded`,
  `new ReadableStream`, and `controller.`: zero hits.
- `check:ts-sdk-parity`: expected exit 1 for previously recorded WP4D4 and
  later-plan gaps only; no WP4D3 transport finding.

## State

Candidate implementation head before this evidence commit:
`c80e3bf8f8a9a329d17b18f0d868aaad43552be6`.

Task 4D3 remains pending fresh independent rereview and coordinator exact-head
verification. No acceptance is claimed, and Task 4D4 has not started.
