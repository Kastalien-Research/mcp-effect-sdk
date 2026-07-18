# Task 4D report: stateless Streamable HTTP and legacy transport removal

## Current outcome

Task 4D1 is accepted and Task 4D2, the dispatcher-native HTTP client, is
implemented on `codex/wp4-wire-kernel-transports`. Task 4D3-4D4 have not
started, and 4D2 remains pending independent review and coordinator acceptance.

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

The focused REDs failed only on the absent intended surface or exact boundary
behavior under test. The HTTP metadata suite passes 13/13 runtime cases plus
public types; the HTTP client suite passes 36/36 runtime cases plus public
types.

## Verification

Pinned runtime: Node `v22.22.3`, pnpm `10.11.1` via Corepack.

- `pnpm run test:wp4-http-metadata`: pass, runtime 13/13 plus public types.
- `pnpm run test:wp4-http-client`: pass, runtime 36/36 plus public types,
  including the real loopback incremental HTTP fixture.
- `pnpm run test:wp4-wire`: pass, runtime 18/18 plus public types.
- `pnpm run test:wp4-dispatcher`: pass, runtime 20/20 plus public types.
- `pnpm run test:wp4-stdio`: pass, runtime 20/20 plus public types.
- `pnpm run test:wp2-review`: pass, 16/16.
- `pnpm run test:wp3-schema`: pass, 28/28.
- `pnpm run test:wp3-protocol`: pass, 14/14.
- `sources:check`, generated, generated-protocol-surface, invariant, schema
  fixture, public type, unit-readiness, integration-readiness, build, and
  `git diff --check`: pass.
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

## Remaining risks and next actions

- The catalog filter is deliberately a transport-boundary hook; Task 4D3 must
  consume it when the modern HTTP server adapter is rewritten.
- Task 4D2 needs independent review with no Critical or Important finding and
  coordinator exact-head verification before Task 4D3 begins.
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

The review findings are fixed, but Task 4D1 remains pending independent
rereview and coordinator acceptance. Task 4D2 has not started.
