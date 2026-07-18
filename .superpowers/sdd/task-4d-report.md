# Task 4D report: stateless Streamable HTTP and legacy transport removal

## Current outcome

Task 4D1 and Task 4D2, the dispatcher-native HTTP client, are accepted on
`codex/wp4-wire-kernel-transports`. Task 4D3-4D4 have not started.

- Added exact plain/base64-sentinel value encoding with strict canonical
  base64 and fatal UTF-8 decoding that preserves an initial U+FEFF value.
- Added generated-descriptor-backed standard request metadata for
  `MCP-Protocol-Version`, `Mcp-Method`, and the three generated `Mcp-Name`
  sources.
- Added pure `x-mcp-header` planning for statically reachable property chains,
  including nested objects, case-insensitive tchar uniqueness, primitive type
  restrictions, accessor-safe whole-schema traversal, and fail-closed
  composition/conditional/ref/array paths.
- Added typed client extraction and server validation for string, boolean, and
  safe-integer values. Integer comparison is exact across decimal/exponent
  representations and never depends on floating-point rounding.
- Added an HTTP-only catalog filter that retains ordered valid tools and empty
  plans, excludes invalid definitions, emits exactly one constant-safe
  structured warning per exclusion, and preserves warning-sink failures in the
  Effect error channel. Stdio behavior is unchanged.
- Vendored the exact pinned Streamable HTTP page from MCP core commit
  `26897cc322f356487da89113451bd16b520b9288`; manifest SHA-256 is
  `dd6a6255abab9207007d3aca525e5ee235fd6f66a22c240698831b3cc61d9034`.
- Replaced the modern HTTP client re-export with one scoped request-to-stream
  transport supporting strict JSON terminals, pull-driven bounded SSE,
  long-lived exact-ID subscriptions, abort/release ownership, and one shared
  OAuth challenge retry budget per public request.
- Added an Effect `Ref` tool-plan catalog. Valid generated `tools/list` results
  are filtered at the HTTP boundary, custom headers are injected for known
  `tools/call` plans, and exact `-32020` terminals trigger one hidden first-page
  refresh plus at most one original-ID retry.
- Internal refreshes use descriptor-copied request metadata, a WebCrypto UUID
  namespace plus atomic counter, and never expose refresh frames. Refresh
  failure, invalid/absent targets, and a repeated mismatch retain the original
  mismatch terminal.
- Ordinary SSE validates every known generated notification while retaining
  unknown extension methods. It discards one initial stream BOM, bounds CRLF
  lines by content bytes, and emits terminal frames promptly. A tools-list
  catalog update is staged per request attempt and commits only after clean EOF;
  later failure or caller cancellation discards it.

No remote state was mutated. Task 4D1's review findings were fixed and its
independent rereview was clean before 4D2 began.

## Public API decisions

- The kernel lives at `src/transport/HttpMetadata.ts`, the intended modern
  HTTP transport boundary rather than the package root.
- `standardRequestHeaders` and `validateStandardRequestHeaders` use generated
  request descriptors and return typed `HeaderMismatchError` failures.
- `analyzeToolHeaders` returns an immutable `HttpToolHeaderPlan` or
  `InvalidToolHeaderDefinition` with only tool name and a constant reason.
- `extractToolHeaders` and `validateToolHeaders` share the same plan and exact
  property paths.
- `filterHttpTools` returns an immutable ordered tool array and frozen,
  null-prototype exact-name plan record. Its configurable Effect warning sink
  retains its error and requirements channels.
- `McpTransport<E>` is the modern public request-to-`Stream<ClientFrame, E>`
  boundary. `StreamableHttpClientTransport.make` is modern-only; it owns no
  global correlation queue, sessions, GET/resume state, or direct send/cancel
  surface.
- The client validates generated `tools/list` results before filtering but
  exposes the original plain wire result with only invalid tools removed.
  Warning-sink typed failures and defects are contained at this transport
  boundary without swallowing stream interruption.
- One request-scoped `Ref<boolean>` is shared by the original POST, internal
  refresh, and retry, so OAuth authorization can consume at most one retry
  across the complete recovery flow.

## TDD evidence

- Value/standard metadata RED: `471b1f8`; GREEN: `cb9a29f`.
- Custom schema/extraction/validation RED: `34c1f27`; accessor-safety RED:
  `c40aef7`; GREEN: `9574689`.
- Exact integer comparison RED: `2cb728f`; GREEN: `f117fb6`.
- HTTP catalog filtering RED: `279ab6e`; GREEN: `c0f3ab1`.
- Exact pinned specification snapshot: `b744a7a`.
- First-review BOM/array-accessor RED: `0e8ad78`; GREEN: `5328bbf`.
- 4D2 strict JSON/public boundary RED/GREEN: `f371473`, `6205fe5`.
- URL snapshot RED/GREEN: `166002d`, `26ae2ca`.
- Incremental SSE and subscription REDs: `02bf991`, `f665133`; GREEN:
  `4f91273`.
- Cancellation ownership RED/GREEN: `de6678b`, `d147d69`, `948ccbf`.
- Generated subscription payload audit RED/GREEN: `90aa1a4`, `78d209b`.
- OAuth retry RED/GREEN: `a0d834e`, `a7e22d6`.
- Tool cache/recovery REDs: `9b3c2d2`, `5ec6d85`, `31da353`; GREEN:
  `07b55b8`. Generated-result fixture synchronization: `5087e40`, `8f11260`;
  descriptor-isolation correction: `08db2e5`.
- Unit F recovery audit RED: `7ea75fa`; structured Effect log fixture
  correction: `5081b5d`; first-page replacement, request-local same-tool retry
  plans, and structured default diagnostics GREEN: `8420821`. OAuth redirect
  and cancellation-during-discovery passed under the RED implementation head.
- Independent 4D2 review-fix RED/GREEN pairs: ordinary known-notification
  validation `0dbd4d7` / `dd1ce49`; CRLF boundary `dbb2ef2` / `5dc2869`;
  rejected SSE catalog poisoning `14cad2f` / `41893af`; original mismatch
  retention `8033ffc` / `d866d7c`; one initial SSE BOM `36e4097` / `f20b317`.
- Second-rereview RED/GREEN: prompt terminal plus transactional catalog staging
  `0566c43`, positive clean-EOF control `03633fc`, GREEN `59bbcfc`; first-failure
  retention across a later retry-stream failure `a24baa5` / `796230a`.
- Third-rereview RED/GREEN: strict retry Success post-terminal rejection
  `10085a2` / `6b2554e`.

Exact original 4D2 RED evidence was reconstructed at each detached historical
commit with Node 22; counts exclude public type results unless stated:

- `f371473`: runtime 0/6. All six initial contract tests failed: strict JSON
  terminal mapping, concurrent exact IDs, non-auth error terminals, invalid
  envelopes/content negotiation, JSON bounds/media parameters, and
  bound/caller-header accessor safety. Five reached `transport.request is not
  a function`; the validation case also proved bounds were not rejected. The
  public type fixture separately failed because `McpTransport` and the modern
  error/export surface did not exist.
- `166002d`: runtime 6/7. Only the absolute immutable endpoint/snapshot test
  failed, beginning with the `not a URL` case not returning a typed left.
- `02bf991`: runtime 11/14. The split UTF-8 notification/terminal stream and
  acknowledged subscription/graceful terminal both failed as unsupported
  content type; the subscription-must-use-SSE assertion also observed no left.
- `f665133`: runtime 11/17. The prior three SSE failures remained, plus exact
  terminal metadata/duplicate acknowledgement, stdio-only cancelled
  rejection, and resource-URI selection. The new cases observed either the
  wrong `TransportError` or unsupported SSE instead of their intended exact
  behavior.
- `de6678b`: the intended cancellation probe was 0/1: closing the stream did
  not abort fetch/cancel/release the reader. The escalated full replay was
  19/20; an unprivileged replay also had an unrelated loopback `EPERM`, which
  is excluded. `a257084` temporarily removed those unchanged probes for the
  subscription audit; `d147d69` restored them unchanged before `948ccbf`.
- `90aa1a4`: runtime 17/19. Ordinary subscription-only methods without
  metadata were emitted, and malformed generated acknowledgement filters
  produced `TransportError` instead of `InvalidRequest`.
- `a0d834e`: OAuth-focused runtime 0/2 (full 22/24). The success path failed
  with `HTTP authorization failed`; the retry-boundary case made one endpoint
  call instead of two.
- `9b3c2d2`: recovery-focused runtime 0/2 (full 24/26). The cache/refresh path
  failed at `HTTP POST failed`, and the missing-target case made one request
  instead of the expected original plus hidden refresh.
- `5ec6d85`: recovery-focused runtime 0/6 (full 24/30): the prior two plus
  known-empty refresh/single retry, invalid-or-failed refresh preservation,
  concurrent unique IDs/descriptor copying, and shared OAuth budget all failed.
- `31da353`: warning-focused runtime 0/1. Invalid tools remained visible
  (`["valid", "invalid"]`) instead of filtering to `["valid"]` when the sink
  failed or defected.
- `7ea75fa`: Unit F full runtime 33/36. Exactly structured default warnings,
  first-page replacement, and request-local same-tool retry plans failed;
  OAuth redirect and cancellation-during-discovery passed unchanged.

Fixture-only commits were not claimed as behavioral REDs: `08db2e5` isolated
descriptor mutation from retry encoding; `5087e40` emitted the required
generated `ListToolsResult` fields; `8f11260` made list SSE terminals valid
under the generated codec; and `5081b5d` matched Effect Logger's message-array
representation.

The HTTP metadata suite passes 13/13 runtime cases plus public types; the HTTP
client suite passes 43/43 runtime cases plus public types.

## Verification

Pinned runtime: Node `v22.22.3`, pnpm `10.11.1` via Corepack.

- `pnpm run test:wp4-http-metadata`: pass, runtime 13/13 plus public types.
- `pnpm run test:wp4-http-client`: pass at the review-fix head, runtime 43/43
  plus public types, including the real loopback incremental HTTP fixture.
- Earlier during 4D2, before the independent review-fix commits, cumulative
  wire 18/18, dispatcher 20/20, and stdio 20/20 suites plus public types
  passed. Source, generated, generated-protocol-surface, invariant, schema
  fixture, public type, unit-readiness, and integration-readiness checks also
  passed at that earlier 4D2 head.
- WP2 16/16, Task 3A 28/28, and Task 3B 14/14 are accepted prior-work evidence
  inherited from the accepted 4D1 base; they were not rerun at a 4D2 head.
- Full `pnpm run verify`, draft E2E, Task 3A/3B, and WP2 were not rerun at this
  intermediate 4D2 slice; they remain required at the final Task 4D head.

## Surprises and environment compounding

- Positive: the generated HTTP descriptors were already precise enough to
  eliminate a second hand-maintained method/name table.
- Negative: ordinary `Number` comparison rounded non-integer decimal headers
  onto safe body integers, including values near the safe-integer boundary.
- Independent review also exposed two platform-boundary traps: the default
  `TextDecoder` strips a leading BOM, and `for...of` executes array getters.
- Durable positive change: the exact normative transport page is now an
  ordinary offline source snapshot with a pinned manifest hash.
- Durable negative prevention: focused tests lock strict sentinel decoding,
  accessor-safe whole-schema scanning, exact decimal/exponent integer
  comparison, immutable filtering, and safe warning diagnostics.
- 4D2 positive: the request-to-stream boundary let SSE notification ordering,
  hidden refresh consumption, and original-ID retry compose without a global
  queue or correlation map.
- 4D2 negative: existing HTTP client fixtures abbreviated generated
  `ListToolsResult` by omitting required `cacheScope` and `ttlMs`; strict
  transport validation surfaced that drift immediately.
- 4D2 durable prevention: the shared response fixture now emits the generated
  result shape, and focused tests lock non-failing warning sinks, descriptor
  metadata copying, shared OAuth budget, known-empty plans, concurrent internal
  IDs, public first-page replacement versus cursor-page merge, request-local
  same-tool retry plans, OAuth redirect/cancellation, and fail-closed recovery.
- Independent 4D2 review exposed five behavioral boundary gaps: generated
  ordinary notifications were not validated, CRLF counted its terminator,
  terminal side effects preceded EOF validation, retry mismatch replaced the
  first failure, and the SSE stream prefix lacked one-time BOM handling.
- Durable prevention now includes focused probes for each exact gap. Terminal
  delivery remains immediate and pull-driven; only the bounded decoded
  tools-list catalog is staged until the parser observes clean EOF.

## Remaining risks and next actions

- The catalog filter is deliberately a transport-boundary hook; Task 4D3 must
  consume it when the modern HTTP server adapter is rewritten.
- Task 4D2 is independently approved and coordinator-accepted. Task 4D3 is the
  next sequential slice.
- The legacy HTTP server/SSE/WebSocket/session paths remain until Tasks
  4D3-4D4. Examples temporarily import the explicit legacy `HttpTransport` so
  the build stays green; Task 4D4 owns that deletion debt and McpClient
  integration.

## Independent review cycle 1

Independent review at exact head `e8a3e66` reported no Critical finding and
two Important findings:

1. The shared fatal UTF-8 `TextDecoder` used its default BOM handling, so a
   leading U+FEFF did not round-trip and both standard and custom validation
   could false-mismatch.
2. Schema-array `for...of` traversal invoked indexed accessors. Nonthrowing
   accessors were evaluated and throwing accessors escaped the typed analyzer,
   allowing one malformed tool to block filtering of later valid tools.

RED commit `0e8ad78` added leading-BOM encode/decode plus standard/custom
validation cases and both nonthrowing and throwing array-index accessor cases.
The exact focused result was build and public types green, runtime 10/13: BOM
decode lost U+FEFF, standard validation returned `HeaderMismatchError`, and the
nonthrowing array getter was invoked and produced the wrong typed reason.

GREEN commit `5328bbf` sets `ignoreBOM: true` on the fatal decoder and traverses
schema arrays only through own property descriptors, rejecting accessors
without invocation and retaining cycle detection. Post-fix verification:

- `pnpm run test:wp4-http-metadata`: 13/13 plus public types.
- `pnpm run sources:check`: pass.
- Task 4A: 18/18; Task 4B: 20/20; Task 4C: 20/20.
- Task 3A: 28/28; Task 3B: 14/14; WP2: 16/16.
- Generated, generated-protocol-surface, invariant, schema fixture, public
  type, unit-readiness, integration-readiness, build, and `git diff --check`:
  pass.

Task 4D1 subsequently passed independent rereview and coordinator verification
at `aabab94`; it was accepted before Task 4D2 started.

## Independent review cycle 2: Task 4D2

Independent review at exact head `8f4aab8` reported no Critical findings and
six Important findings. Five were behavioral and one required precise evidence
and stale-report correction. Each behavioral finding received a separate RED
before production:

1. `0dbd4d7`: targeted runtime 0/1. A malformed known
   `notifications/progress` payload was emitted, so the assertion expecting an
   `InvalidRequest` left value observed `false`; the unknown extension control
   remained part of the same probe. `dd1ce49` validates known generated
   notifications and leaves unknown methods extensible.
2. `dbb2ef2`: targeted runtime 0/1. A `data:` line whose content was exactly
   `maxLineBytes` failed with `TransportError: SSE line exceeds maxLineBytes`
   solely because its CRLF terminator CR was counted. `5dc2869` permits only
   that possible terminator byte while still rejecting one content byte over.
3. `14cad2f`: targeted runtime 0/1. After a duplicate-terminal `tools/list`
   SSE stream was rejected, the later call saw no old header (`null` instead
   of `"us"`), proving the rejected terminal had poisoned the catalog.
   `41893af` retained one pending terminal frame until EOF, without buffering
   preceding notifications. Independent rereview cycle 3 superseded this with
   prompt terminal delivery plus transactional catalog staging.
4. `8033ffc`: targeted runtime 0/1. The final terminal contained retry data
   `{ source: "retry", attempt: 2 }` and message `retry mismatch`, rather than
   the original mismatch data/message. `d866d7c` maps only a second exact
   `-32020` terminal back to the original frame and performs no second refresh.
5. `36e4097`: targeted runtime 0/1. A split initial UTF-8 BOM caused
   `TransportError: SSE response ended before its terminal response`.
   `f20b317` discards exactly one stream-initial BOM across arbitrary chunks;
   the later-BOM negative control remains rejected. The HTTP metadata decoder
   continues preserving U+FEFF values.

Post-fix focused verification at that cycle was HTTP client runtime 40/40 plus
public types and HTTP metadata runtime 13/13 plus public types.

## Independent review cycle 3: Task 4D2

Rereview at exact head `ab8080b` reported no Critical findings and two
Important findings:

1. `0566c43`: targeted runtime 0/1. A valid tools-list SSE terminal on an open
   stream was withheld for 100 milliseconds, so the timeout result was left
   rather than the expected right terminal. `03633fc` added the positive
   clean-EOF commit control before production. `59bbcfc` emits the terminal
   immediately, stages only the catalog result per request attempt, commits it
   after parser-confirmed clean EOF, and discards it on typed failure or caller
   cancellation. The existing duplicate-terminal poison control remains green.
2. `a24baa5`: targeted runtime 0/1. A retry SSE emitted its mismatch and then a
   duplicate terminal; the request failed with `InvalidRequest: SSE response
   contains data after its terminal response` instead of retaining the original
   mismatch terminal. `796230a` maps any retry Error terminal to the original,
   converts a typed retry-stream failure to the original only when no terminal
   was already emitted, and uses `Stream.catchAll` so interruption and defects
   remain untouched. Only a retry Success displaces the original failure.

Post-fix verification is HTTP client runtime 42/42 plus public types and HTTP
metadata runtime 13/13 plus public types. Task 4D2 remains pending a new
independent review and coordinator acceptance.

## Independent review cycle 4: Task 4D2

Rereview at exact head `dee8f1a` reported no Critical findings and one
Important finding:

1. `10085a2`: with
   `PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"`, the exact targeted
   command `corepack pnpm run build && node --test --test-name-pattern="retry stream failure after Success preserves the strict SSE rejection" test/http/wp4-http-client.test.mjs`
   was witnessed RED at runtime 0/1. A retry SSE emitted a valid Success and
   then a duplicate Success; the request incorrectly completed as a clean
   right value, so the assertion requiring `Either.isLeft(result) === true`
   observed `false`. `6b2554e` replaces the retry terminal boolean with the
   tri-state `none | original | success`: typed failure after Success is
   rethrown, typed failure after the already-emitted original is suppressed,
   and typed failure before a terminal emits the original mismatch. It retains
   `Stream.catchAll`, so interruption and defects remain untouched.

Focused Node 22 verification after `6b2554e` passed both retry post-terminal
cases, runtime 2/2. Full Node 22 verification passed HTTP client runtime 43/43
plus public types and HTTP metadata runtime 13/13 plus public types.

Final read-only rereview at exact candidate
`38f6f19295af41e26dcbef24ee4996ac4cc0934b` reported no Critical, Important,
or Minor findings. The reviewer independently probed the pre-terminal typed
failure, post-Success typed failure, mapped-Error failure, defect, and
interruption paths. Coordinator exact-head verification also passed wire
18/18, dispatcher 20/20, stdio 20/20, pinned sources, generated and protocol
surfaces, invariants, schema fixtures, public type fixtures, unit readiness,
integration readiness, diff-check, and clean-tree checks. Task 4D2 is accepted.
