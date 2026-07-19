# Task 4D report: stateless Streamable HTTP and legacy transport removal

## Current outcome

Task 4D1 and Task 4D2, the dispatcher-native HTTP client, are accepted on
`codex/wp4-wire-kernel-transports`. Task 4D3 is independently approved and
coordinator-verified at exact clean head
`7419c6bd7cb1c2437aa2cc1210a303241e65fcc0`. Task 4D4 is implemented at code
head `fb5fde0`; its only non-passing final gate is the explicitly WP6-owned
client-auth conformance surface recorded below.

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
- Replaced the HTTP server adapter with one modern-only POST transport. It
  validates Origin, optional Host protection, media negotiation, strict
  `McpWire`, protocol/method/name/custom metadata, and generated parameters
  before dispatcher, registry, handler, or subscription effects.
- Extension notifications now receive an immutable request-header snapshot and
  pass the same supported-version and standard-metadata preflight as generated
  methods. A response advertises a request version only after that preflight
  accepts it.
- Ordinary JSON and bounded SSE responses use request-owned Effect scopes.
  Subscriptions acknowledge first on a dedicated POST, retain exact string or
  numeric IDs, filter registry notifications, and close their registry and
  response ownership on cancellation, runtime disposal, or abrupt sockets.
- Subscription output is serialized under one bounded ownership path. Encoding
  failure and interruption fail closed, and concurrent notification failures
  preserve the first failure rather than racing later frames into the stream.
- The optional Effect Platform subpath is now a thin all-method router adapter
  into the same modern handler. Removed the alternate `McpServer` HTTP route,
  raw `ReadableStream` subscription path, and public route-registry bypass.
- `McpClient` now consumes `McpTransport.request` streams directly. Request-
  bound notifications are dispatched in frame order and callers own the
  lifetime of long-running `subscriptions/listen` effects.
- The stdio client exposes only the request-scoped `McpTransport` contract;
  interruption sends exact stdio cancellation and releases correlation.
- Deleted the client protocol and serialization bridges and the legacy HTTP,
  SSE, and WebSocket client transports. Root exports now retain only modern
  stdio and Streamable HTTP transport boundaries.
- Existing Roots, Sampling, Elicitation, and logging compatibility hooks moved
  to the marked `./deprecated` package subpath.
- TypeScript SDK parity is self-contained against frozen pins, with a
  machine-readable exact WP5-WP11 deferral ledger and cumulative WP4 verification.
- Self-hosted discovery now advertises tools, resources, prompts, and
  completions from the live registry, which restores the draft round trip.

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
- `StreamableHttpServerTransport.handle` is the Effect-native Web
  Request/Response boundary and explicitly requires a caller `Scope.Scope`;
  every response scope is forked from that caller-owned scope.
- `StreamableHttpServerTransport.makeScopedHandler` captures the caller's
  Effect scope for adapters whose runtime must own all active response and
  subscription scopes. `toWebHandler` supplies that boundary from its managed
  runtime. None of these surfaces accepts a legacy handler, `modern` flag,
  session state, resume state, GET fallback, or raw controller.
- `EffectPlatform.layer(options)` remains the optional public adapter. It
  requires `HttpRouter.Default`, provides one scoped `McpServer`, registers
  `router.all(options.path, ...)`, and delegates all MCP status, header,
  framing, and cancellation semantics to
  `StreamableHttpServerTransport.makeScopedHandler`.
- `ExtensionNotificationContext.requestHeaders` is a frozen, normalized-
  lowercase read-only record, matching Web `Headers` name normalization.
  Notification hooks run only after generated-parameter and request-metadata
  validation succeeds.
- `McpServer.HttpRouteRegistry`, `McpServer.handleWebRequest`,
  `McpServer.layerHttp`, and the Effect Platform compatibility registry layer
  are removed rather than hidden behind aliases.
- `McpClient.make` accepts `McpTransport<E>` directly; no public compatibility
  wrapper, background run loop, or transport-owned correlation state remains.
- `subscriptionsListen` stays an ordinary caller-owned Effect for WP4. The
  typed higher-level subscription product API remains deferred to WP5.
- `./deprecated` exports exactly `ElicitationHandler`, `RootsProvider`,
  `SamplingHandler`, and `sendLoggingMessage`; those hooks are absent from the
  root entrypoint and marked `@deprecated`.

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
- 4D3 preflight/body-bound REDs: `36c5d2e`, `0417ac6`; GREEN: `9fb2c90`.
- 4D3 dispatcher/header REDs: `fbb3e90`, `4243692`; explicit-undefined helper
  correction: `897b9b3`; GREEN: `c21fddd`, `6508c95`.
- 4D3 bounded ordinary-response RED: `178d948`; default-SSE helper correction:
  `d673946`; GREEN: `21238fb`.
- 4D3 subscription lifecycle RED/GREEN: `1aa47c9` / `9736a0f`.
- 4D3 Effect Platform/legacy-route RED: `1d2d3a4`; modern metadata, shared SSE
  cursor, and isolated runtime-probe corrections: `16bdd60`, `99c2f92`,
  `8813b00`; GREEN: `3fd36dc`; parity source guard: `d3c3f1a`.
- 4D3 review-edge RED: `c20dc23`; the prior 35 server cases remained green,
  eight new runtime cases failed, and the public type fixture failed because
  `ExtensionNotificationContext.requestHeaders` was absent. Bounded test and
  fixture corrections: `e49b40f`, `44b46f9`, `f12f36b`.
- Metadata/version preflight, strict Accept/Host parsing, declared-body bounds,
  and body-reader cancellation GREEN: `57c992a`.
- Effect Platform scope-ownership fixture/source guards: `0799933`, `fd501d6`;
  scoped-handler and eager-option-validation GREEN: `587ac9f`, `81f3989`.
- Queue-filled interruption fixture correction: `e64b222`; subscription
  encoding/interruption GREEN: `89a4921`. Concurrent first-failure RED and
  source guard: `14e0da7`, `190c5e2`; serialized first-failure GREEN:
  `aa827ef`.
- Second 4D3 rereview RED/GREEN pairs: parsed-body raw-size enforcement
  `6f77411` / `c36122b`; early preflight body release `638821d` / `a486d0d`;
  exact raw Web pathname `5055304` / `ac9c519`; outbound known-notification
  validation `7a1805e` / `76dfba6`; caller-owned public `handle` scope
  `dd69a99` / `88213f7`. Notification storage RED `8964cb9` and initial
  no-storage GREEN `b16154d` exposed the active runtime observer; bounded-
  compatibility correction RED/GREEN `83cc154` / `a356e6e` replaced the
  unbounded queue with a 64-entry sliding queue without weakening live
  subscription delivery.
- 4D4 direct-client RED/GREEN: `e76c6d7` / `e782e70`.
- 4D4 stdio request-boundary RED/GREEN: `117b952` / `b54f9da`.
- 4D4 package clean-break RED/GREEN: `d8e0a2a` / `60d9598`.
- 4D4 frozen verification-governance RED/GREEN: `2077acc` / `4fd423b`.
- Final discovery regression RED/GREEN: `2fe99b3` / `fb5fde0`.

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
client suite passes 43/43 runtime cases plus public types; the HTTP server suite
passes 60/60 runtime cases plus public types.

## Verification

Pinned runtime: Node `v22.22.3`, pnpm `10.11.1` via Corepack.

- `pnpm run test:wp4-http-metadata`: pass, runtime 13/13 plus public types.
- `pnpm run test:wp4-http-client`: pass at the review-fix head, runtime 43/43
  plus public types, including the real loopback incremental HTTP fixture.
- `pnpm run test:wp4-http-server`: pass after the seventh 4D3 rereview fix cycle,
  runtime 60/60 plus public types, including the real Node incremental
  subscription and abrupt-socket fixture, the actual Effect Platform router,
  extension-notification preflight, strict authority/Accept parsing, body
  cancellation, scoped runtime disposal, and fail-closed subscription output.
- At the 4D3 candidate, cumulative wire 18/18, dispatcher 20/20, stdio 20/20,
  HTTP metadata 13/13, and HTTP client 43/43 suites plus public types pass.
  WP2 review passes 16/16. Effect foundation policy and 8/8 tests, SDK runtime,
  pinned sources, generated outputs and protocol surfaces, invariants, schema
  fixtures, public type fixtures, unit readiness, integration readiness,
  build, and `git diff --check` also pass.
- `pnpm run check:ts-sdk-parity`: pass against the frozen MCP core and
  TypeScript SDK differential-oracle revisions plus the exact WP5-WP11 ledger, with
  no sibling checkout dependency.
- `pnpm run test:wp4-transports`: pass, 12/12 plus public type fixtures and a
  packed root/deprecated/modern-transport consumer.
- `pnpm run e2e:draft`: pass, 2/2 self-hosted scenarios. Both scenarios also
  pass twice inside final `verify` through `test:e2e` and the explicit gate.
- Final Node 22 `pnpm run verify`: exit 0. Package health includes Task 3A
  28/28, Task 3B 14/14, wire 18/18, dispatcher 26/26, stdio 22/22, cumulative
  HTTP 116/116, transports 12/12, WP2 17/17, build, unit, integration, and
  draft e2e.
- Separate Node 22 `pnpm run conformance:client-auth`: exit 1 with 225 passed,
  12 SEP-837 `application_type` failures, and one SEP-2350 scope-union warning.
  Those are WP6-owned and were not suppressed or implemented in WP4.

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
- 4D3 positive: `HttpServerResponse.fromWeb` preserves the modern handler's
  streaming body, status, and headers through an Effect Platform all-method
  route without a second protocol implementation.
- 4D3 negative: foundation/runtime fixtures still encoded the removed route
  API and pre-4D metadata rules, while the parity checker inferred reference
  roots from the worktree parent and initially could not see the pinned trees.
- 4D3 durable prevention: runtime, public-type, source, parity, and root optional-
  peer guards now forbid a second `McpServer` HTTP route. Temporary sibling
  reference links let isolated worktrees run the semantic parity audit.
- Independent 4D3 review exposed seven Important boundary gaps and one Minor
  negotiation gap spanning notification preflight, response-scope ownership,
  body limits/cancellation, authority parsing, subscription failure handling,
  response-version promotion, and media-range quality handling.
- 4D3 durable prevention now includes focused probes for each boundary. The
  production path shares scoped ownership across the web and Effect Platform
  adapters, rejects malformed or zero-quality media ranges, cancels abandoned
  request readers, and serializes subscription failures so the first failure
  remains authoritative.
- 4D4 positive: removing the compatibility protocol made request ownership
  explicit enough that draft e2e immediately exposed inaccurate capability
  discovery.
- 4D4 negative: the extension check depended on a literal assignment marker,
  so an equivalent object initializer initially failed its governance gate.
- 4D4 durable prevention: cumulative package/transport tests, self-contained
  parity, registry-backed discovery coverage, and explicit separate
  package-health and draft/auth evidence commands are enforced.

## Remaining risks and next actions

- Task 4D4 implementation and its first review-fix cycle are complete locally
  and remain pending coordinator exact-head review/acceptance. No remote state
  was mutated.
- WP6 owns the twelve SEP-837 client registration failures and the SEP-2350
  scope-union warning. They remain visible in the separate client-auth evidence;
  WP4 does not claim client-auth conformance or release qualification.
- WP5 still owns the typed high-level subscription product API. WP7-WP11 are
  separately and exactly accounted in the deferred parity ledger.

## Independent 4D4 review-fix cycle

Independent review at exact clean head `57974d3` reported 0 Critical,
7 Important, and 2 Minor findings. Sequential RED/GREEN repair commits are:

- Client subscription envelope and lifetime: `668f64d` / `0355339`.
- Bounded dispatcher ownership and duplicate-safe cancellation:
  `f47c663`, `f298f39` / `07a7cf0`.
- Strict stdio subscription protocol: `37d41b2` / `58b1c85`.
- Stable transport package subpaths: `ac2087b` / `d6ad811`.
- Separate package health from client-auth evidence: `596a977` / `8af4921`.
- Exact WP5-WP11 ledger: `c22ff87` / `38e65bf`.

Review-fix Node 22 evidence: full package-health `verify` exits 0; dispatcher
26/26, stdio 22/22, HTTP 116/116, transports 12/12, and all public types pass.
The separately executed client-auth baseline remains 225 passed, 12 failed,
1 warning, with no expected-failure allowlist or auth implementation in WP4.

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

## Independent review cycle 5: Task 4D3

Initial read-only review at exact candidate
`d641784` reported no Critical findings, seven Important findings, and one
Minor finding:

1. Extension notifications bypassed supported-version and standard-metadata
   preflight, and their hook context did not expose request headers.
2. The Effect Platform adapter's managed runtime did not own active response
   scopes, so disposing the layer could leave a response or subscription alive.
3. A supplied parsed body bypassed the declared `Content-Length` limit.
4. An interrupted or early-rejected raw request could retain its reader; the
   early size-rejection path did not cancel the body.
5. Host validation accepted malformed authorities containing userinfo, paths,
   queries, fragments, backslashes, commas, whitespace, or invalid ports.
6. Subscription encoding failures and publish interruption were swallowed,
   allowing a failed stream to appear healthy or later output to win a race.
7. A response could echo a supported protocol version before the request's
   standard metadata had accepted that version.
8. The media negotiation parser accepted `q=0`, malformed or out-of-range
   quality values, media parameters, and wildcard ranges as satisfying the
   required exact JSON and SSE response types.

Broad RED commit `c20dc23` left the prior 35 server cases green while eight
new runtime cases failed and the public type fixture failed. Bounded test and
fixture corrections `e49b40f`, `44b46f9`, and `f12f36b` isolated declared
body size, response-version fallback, and omitted notification-header inputs
without changing production behavior.

GREEN `57c992a` applies standard/version preflight to extension notifications,
promotes the response version only after acceptance, requires both exact media
types at positive valid quality, validates Host as a strict authority, checks
declared size before parsed/raw bodies, and cancels and releases abandoned raw
readers. Guards `0799933` and `fd501d6` preceded scoped-handler GREEN
`587ac9f`; eager option validation remained locked by `81f3989`.

Subscription fixture correction `e64b222` filled the bounded queue before
testing interruption. GREEN `89a4921` makes encoding failure and publish
interruption fail closed. A separate concurrent-failure RED `14e0da7` and
source guard `190c5e2` proved that racing notification encodes could replace
the first failure; GREEN `aa827ef` serializes that path so the first failure is
retained.

Coordinator verification at exact candidate
`aa827efd0f32c414acc9af4eab99e74706e2ff93` passed HTTP server runtime 43/43
plus public types, HTTP client 43/43 plus public types, HTTP metadata 13/13 plus
public types, wire 18/18, dispatcher 20/20, stdio 20/20, WP2 review 16/16,
Effect foundation policy and runtime, SDK runtime, pinned sources, generated
outputs and generated protocol surfaces, invariants, schema fixtures, public
type fixtures, unit readiness, integration readiness, build, and
`git diff --check`. The semantic parity command reached the pinned reference
checks and reported only the already-recorded 4D4 and later-plan gaps. This
review-fix candidate remains pending independent rereview; no acceptance is
claimed here.

## Independent review cycle 6: Task 4D3

The next read-only rereview reported six behavioral ownership and validation
findings plus two report corrections. Each behavioral finding received a
focused Node 22 RED before production:

1. `6f77411` proved that a small `parsedBody` bypassed an undeclared 4096-byte
   raw upload with `maxBodyBytes: 512`; `c36122b` meters any available,
   unconsumed raw stream while retaining already-consumed Effect Platform
   parsed-body handling.
2. `638821d` proved Origin, Host, method, content-type, and Accept rejections
   left raw bodies uncancelled; `a486d0d` cancels and unlocks before returning
   the unchanged bodyless response. Exact path rejection joins that cleanup.
3. `5055304` proved `/not-mcp` and `/mcp/` exposed `/mcp`; `ac9c519` enforces
   exact URL pathname matching while accepting `/mcp?...` query URLs.
4. `7a1805e` proved a malformed known `notifications/progress` payload reached
   SSE; `76dfba6` validates every known outbound server notification using the
   generated payload codec and fails stream ownership safely while retaining
   unknown extension notifications.
5. `8964cb9` guarded against unbounded duplicate storage. The initial
   no-storage GREEN `b16154d` exposed an active compatibility observer in
   `check:sdk-runtime`; correction RED `83cc154` and GREEN `a356e6e` retain a
   fixed 64-entry sliding observation queue and unchanged live subscription
   publication. Seventy consecutive publishes completed, all seventy reached
   the live subscriber, and retained storage stayed at sixty-four.
6. `dd69a99` proved caller-scope closure left public `handle` responses alive
   and the type fixture lacked `Scope.Scope`; `88213f7` derives response scopes
   from the caller and removes detached `Scope.make` ownership.

The report now distinguishes caller-scoped `handle` from the captured-scope
`makeScopedHandler` adapter and records that Web `Headers` normalize names to
lowercase. Focused verification is HTTP server runtime 49/49 plus public types,
dispatcher 20/20 plus public types, WP2 review 16/16, build, SDK runtime, and
`git diff --check`. Added production lines contain none of `runSync`,
`runFork`, `Queue.unbounded`, `new ReadableStream`, or `controller`. Task 4D3
still requires independent rereview and coordinator exact-head verification;
no Task 4D3 acceptance is claimed.

## Independent review cycle 7: Task 4D3

Rereview at exact head `b37fcf7bac66cfae03a795e0ba0a85ca653f1f2d`
reported no Critical findings, four Important findings, and no Minor findings:

1. A consumed or locked raw body allowed a supplied `parsedBody` to bypass the
   physical `maxBodyBytes` limit because the original byte count was no longer
   verifiable.
2. A subscription publisher could close its state and then block offering a
   failure into a full bounded output queue. Interrupting that publisher left
   the client hanging after already-emitted acknowledgement and valid frames.
3. The raw-body reader retained arbitrarily many zero-length chunks even though
   they did not advance the byte limit.
4. Raw-read and JSON/SSE response failure paths returned constant-safe public
   responses but discarded the original internal `Cause`, leaving no supervised
   diagnostic path.

Each finding received committed RED evidence before production. `84791e7`
proved that an already-consumed 4,280-byte upload could be accepted through a
small parsed value and that the public options lacked a trusted byte-count
field; `0e665eb` corrected the exact recoverable-ID fixture expectation.
`645cb9f` requires `parsedBodyByteLength` when the raw body is no longer
measurable, validates that trusted count, and still physically meters any
available raw stream.

`ca3bef4` proved that a full normal-frame queue could withhold terminal failure
after publisher interruption; `a15f8f5` corrected the race-valid publisher
exit expectation. `341e033` bounds normal frames with permits and reserves one
queue slot for failure or EOF, retaining FIFO order and valid frames before the
first failure. `af658a8` added the 20,000-empty-chunk regression and a source
guard; `a40b11f` discards empty chunks before retention without weakening byte
accounting.

`093b4d7` added the failure-sink public type RED and exact raw-read `Cause`
identity assertion. `615672f` corrected the test-only SSE injection boundary.
`c80e3bf` adds an opt-in `failureSink` with exact `request_body`,
`json_response`, and `sse_response` Causes. Sink failure is isolated, and public
responses remain constant-safe and contain none of the internal diagnostic.

Exact Node 22.22.3 post-fix verification at
`c80e3bf8f8a9a329d17b18f0d868aaad43552be6` passed:

- HTTP server runtime 53/53 plus public types.
- HTTP client runtime 43/43 plus public types. The first sandboxed run was
  42/43 solely because loopback bind returned `EPERM`; the authorized rerun
  passed all 43.
- HTTP metadata 13/13 plus public types, wire 18/18 plus public types,
  dispatcher 20/20 plus public types, and stdio 20/20 plus public types.
- WP2 review 16/16 and Effect foundation policy plus runtime 8/8.
- SDK runtime, pinned sources, generated outputs, generated protocol surfaces,
  tier protocol features, invariants, schema fixtures (23 round-trips and 9
  negatives), public type fixtures, unit readiness, integration readiness,
  final build, and `git diff --check` all passed.
- Added production lines contain none of `runSync`, `runFork`,
  `Queue.unbounded`, `new ReadableStream`, or `controller`.
- `check:ts-sdk-parity` remains expected red only for the already-recorded
  verify wiring, client methods and registration/runtime proof owned by WP4D4
  and later plan work; it reports no WP4D3 transport finding.

This cycle is a candidate for a fresh independent rereview and coordinator
exact-head verification. Task 4D3 is not self-accepted, and Task 4D4 remains
untouched.

## Independent review cycle 8: Task 4D3

Rereview at exact head `f5058acc96c2e79bcce4f4577da2d9349031d841`
reported no Critical findings, three Important findings, and one Minor report
finding:

1. A live post-Response SSE encoding failure placed the constant-safe failure
   marker on the stream but never reported its exact internal `Cause` through
   `failureSink`.
2. Once an upload was known oversized, rejection from `reader.cancel()`
   replaced the authoritative 413 result with generic invalid-body handling.
3. `parsedBody` and `parsedBodyByteLength` were read directly, so accessors
   could run or defect before body ownership and cleanup were established.
4. The current-outcome summary still named the second fix cycle after later
   cycles had been recorded.

Each behavioral finding received a committed Node 22 RED before production:

- `fa3710b`: targeted runtime 0/1. The malformed live generated notification
  terminated the response stream, but the blocking diagnostic sink's entry
  signal timed out because no `sse_response` diagnostic was published.
- `ee04642`: targeted runtime 0/1. A 1,024-byte upload under
  `maxBodyBytes: 16` whose cancellation threw returned 400 instead of 413.
- `6366795`: targeted runtime 0/1. Throwing and nonthrowing accessors on both
  trusted parsed-body fields were each invoked once. Returning accessors
  stalled, throwing accessors rejected the handler, and none of the four cases
  cancelled the raw body.

GREEN `a36d492` reserves and offers the first failure control frame before
reporting `Cause.fail(error)` to the isolated sink. The blocking-sink control
proves client termination is not stranded, sink failure/defect/interruption
remain contained by `reportHttpFailure`, and the closed state prevents a
second report. GREEN `9faa99d` represents an oversized body read separately
from cancellation cleanup, reports an exact cleanup failure internally, and
retains the primary 413 response. GREEN `de7fbd0` accepts trusted parsed inputs
only through own data descriptors; any accessor descriptor is rejected without
invocation and the raw body is cancelled and unlocked.

Exact Node 22.22.3 post-fix verification at
`de7fbd067a50c2e867352259a78cde6f60a3d33c` passed:

- HTTP server runtime 56/56 plus public types. The restricted run was 55/56
  solely because the real loopback fixture returned `listen EPERM`; the
  authorized rerun passed all 56.
- HTTP client 43/43 plus public types; HTTP metadata 13/13 plus public types;
  wire 18/18 plus public types; dispatcher 20/20 plus public types; stdio 20/20
  plus public types.
- WP2 review 16/16; Effect foundation policy and runtime 8/8; SDK runtime;
  pinned sources; generated outputs and protocol surfaces; tier protocol
  features; invariants; schema fixtures (23 round-trips and 9 negatives);
  public type fixtures; unit readiness; integration readiness; and final build.
- `git diff --check` passed from both the cycle and Task 4D3 bases. Added
  production lines contain none of `runSync`, `runFork`, `Queue.unbounded`,
  `new ReadableStream`, or `controller.`.
- `check:ts-sdk-parity` remains expected red only for the unchanged WP4D4 and
  later-plan verify wiring, removed client methods, registration, example, and
  runtime-proof gaps; it reports no WP4D3 transport finding.

This cycle remains a candidate for a new independent rereview and coordinator
exact-head verification. Task 4D3 is not self-accepted, and Task 4D4 remains
untouched.

## Independent review cycle 9: Task 4D3

Rereview at exact head `a5b412bc63498cb97a956199890afb143c255e85`
reported no Critical findings, two Important findings, and no Minor findings:

1. Once an oversized upload was known, cleanup-failure reporting still awaited
   `failureSink`. A sink that entered and then never completed could delay the
   bodyless 413 and handler/runtime disposal indefinitely.
2. `Object.getOwnPropertyDescriptor` was invoked outside a contained reflection
   boundary. A Proxy descriptor trap on either trusted parsed-body field could
   reject the handler before raw-body cancellation and unlock.

Both findings received committed RED evidence before production:

- `3288853`: complete, failed, and defecting sinks preserved the prompt 413,
  but the non-completing control caused handler disposal to time out. Exact
  once-only cleanup Cause delivery, one cancellation, and unlock were retained.
  `fa945d0` strengthened that control to an actual `Effect.never` sink before
  the production change.
- `39798b7`: Proxy descriptor traps for `parsedBody` and
  `parsedBodyByteLength` both rejected the handler and left the raw body
  uncancelled. The ordinary own-data-property control remained green.

GREEN `75e6e57` contains both descriptor reads, treats any reflection failure
as invalid trusted input, returns bodyless HTTP 400, and cancels and unlocks
the raw body without invoking a getter. GREEN `6abca3e` supervises cleanup
diagnostics in the caller-owned response scope behind a one-second bound. The
authoritative 413 returns immediately, handler disposal owns and interrupts an
`Effect.never` diagnostic fiber, and the exact cleanup Cause is offered once.

Exact Node 22.22.3 post-fix verification at
`6abca3e82b434fb61def7dcd1e7c3b82d95edd6d` passed:

- HTTP server runtime 58/58 plus public types; HTTP client 43/43 plus public
  types; HTTP metadata 13/13 plus public types; wire 18/18 plus public types;
  dispatcher 20/20 plus public types; stdio 20/20 plus public types.
- WP2 review 16/16; Effect foundation policy and runtime 8/8; SDK runtime;
  pinned sources; generated outputs and protocol surfaces; tier protocol
  features; invariants; schema fixtures (23 round-trips and 9 negatives);
  public type fixtures; unit readiness; integration readiness; and final build.
- `git diff --check` passed from both the cycle and Task 4D3 bases. Added
  production lines contain none of `runSync`, `runFork`, `Queue.unbounded`,
  `new ReadableStream`, or `controller.`.
- `check:ts-sdk-parity` remains expected red only for the unchanged verify,
  conformance, client API, registration, Everything example, generated server-
  request routing, and runtime-proof gaps; it reports no WP4D3 transport
  finding.

This cycle is a candidate for a fresh independent rereview and coordinator
exact-head verification. Task 4D3 is not self-accepted, and Task 4D4 remains
untouched.

## Independent review cycle 10: Task 4D3

Rereview at exact head `5b613314170d0ce3d27c24abc25c5d19cec03bd1`
reported no Critical findings, one Important finding, and no Minor findings:

1. The direct public pattern
   `Effect.scoped(StreamableHttpServerTransport.handle(...))` could close its
   caller scope immediately after receiving the 413, before the caller-owned
   diagnostic fiber had started. A 200-request probe lost the exact cleanup
   diagnostic in all 200 runs even though the prior managed Web-adapter
   never-sink control remained green.

RED `885b5c3` committed that public Effect-native probe before production. All
200 requests returned a prompt bodyless 413, cancelled and unlocked their raw
bodies, and completed scope disposal, but zero of 200 exact cleanup Causes were
offered to the sink.

GREEN `df2d8e1` adds a caller-owned, bounded acceptance handshake. A child fiber
invokes the sink constructor exactly once, signals acceptance, and only then
runs the returned sink Effect behind the existing one-second timeout and
cause-containment boundary. The request waits only for bounded acceptance, not
sink completion. Caller-scope closure owns and interrupts the child; a throwing
sink constructor and sink failure, defect, interruption, or noncompletion are
contained without changing the authoritative response.

Exact Node 22.22.3 post-fix verification at
`df2d8e12f639a45df03db79b9d32f5039810c198` passed:

- The direct scoped probe accepted 200/200 exact Causes once, retained prompt
  bodyless 413 responses, cancelled and unlocked every body, and completed each
  caller scope without accumulated children. The managed Web-adapter control
  remained green for complete, failed, defecting, interrupted, and never-ending
  sinks; synchronous sink-construction throw was also contained.
- HTTP server runtime 59/59 plus public types; HTTP client 43/43 plus public
  types; HTTP metadata 13/13 plus public types; wire 18/18 plus public types;
  dispatcher 20/20 plus public types; stdio 20/20 plus public types.
- WP2 review 16/16; Effect foundation policy and runtime 8/8; SDK runtime;
  pinned sources; generated outputs and protocol surfaces; tier protocol
  features; invariants; schema fixtures (23 round-trips and 9 negatives);
  public type fixtures; unit readiness; integration readiness; and final build.
- `git diff --check` passed from both the cycle and Task 4D3 bases. Added
  production lines contain none of `runSync`, `runFork`, `Queue.unbounded`,
  `new ReadableStream`, or `controller.`.
- `check:ts-sdk-parity` remains expected red only for the unchanged 17 verify,
  conformance, client API, registration, Everything example, generated server-
  request routing, and runtime-proof gaps; it reports no WP4D3 transport
  finding.

This cycle is a candidate for a fresh independent rereview and coordinator
exact-head verification. Task 4D3 is not self-accepted, and Task 4D4 remains
untouched.

## Independent review cycle 11: Task 4D3

Rereview at exact head `faf0fd9629fd6f88e2b5d3b6de693872f2072e8d`
reported no Critical findings, one Important finding, and no Minor findings:

1. Concurrent caller-scope or managed-adapter closure could interrupt the
   cleanup-report child before it began. The child therefore never signalled
   the acceptance Deferred, and the otherwise-correct 413 handler waited for
   the one-second fallback timeout even though ownership had already closed and
   the sink was no longer required to accept the report.

RED `d1a041e` committed both lifecycle boundaries before production: direct
`Scope.extend(handle(...), scope)` with the scope closed one microtask later,
and `toWebHandler` with handler and disposal started in the same sequence. Both
bodies cancelled and unlocked, both eventual responses were bodyless 413, both
disposals were prompt, and zero duplicate diagnostics appeared, but both
handler promises missed the 150-millisecond prompt bound and settled only after
the approximately one-second timeout.

GREEN `b78000d` retains the caller-owned child and acceptance Deferred, and
races ordinary acceptance against the child's stable Effect `Fiber.await`
lifecycle. If ownership interrupts the child before it starts, the exit branch
completes the same Deferred and releases the handler immediately. If the sink
accepts first, the existing exact-once, bounded execution path is unchanged.
No callback observer, detached runtime, or additional scope finalizer is
retained.

Exact Node 22.22.3 post-fix verification at
`b78000d08fd3210b1e4a051a941115566de3a1ae` passed:

- Concurrent direct-scope and Web-adapter closure both completed the handler
  and disposal within the 150-millisecond bound; actual focused runtime was
  about 1 millisecond. Both retained bodyless 413, cancellation, unlock, no
  public leak, and at most one exact diagnostic if acceptance won the race.
- The ordinary public scoped probe still accepted 200/200 exact Causes once.
  Complete, failed, defecting, interrupted, never-ending, and construction-
  throwing sink controls remained prompt and contained.
- HTTP server runtime 60/60 plus public types; HTTP client 43/43 plus public
  types; HTTP metadata 13/13 plus public types; wire 18/18 plus public types;
  dispatcher 20/20 plus public types; stdio 20/20 plus public types.
- WP2 review passed 16/16 in its isolated counted run. An earlier run beside the
  full stdio suite timed out only its stdio subprocess fixture; the dedicated
  stdio suite and isolated WP2 rerun both passed, so that resource-contention
  result is not counted as a semantic failure.
- Effect foundation policy and runtime 8/8; SDK runtime; pinned sources;
  generated outputs and protocol surfaces; tier protocol features; invariants;
  schema fixtures (23 round-trips and 9 negatives); public type fixtures; unit
  readiness; integration readiness; and final build all passed.
- `git diff --check` passed from both the cycle and Task 4D3 bases. Added
  production lines contain none of `runSync`, `runFork`, `Queue.unbounded`,
  `new ReadableStream`, or `controller.`.
- `check:ts-sdk-parity` remains expected red only for the unchanged 17 later-
  plan gaps and reports no WP4D3 transport finding.

This cycle is a candidate for a fresh independent rereview and coordinator
exact-head verification. Task 4D3 is not self-accepted, and Task 4D4 remains
untouched.

## Independent review cycle 12: Task 4D3 final acceptance

Final read-only rereview at exact candidate
`7419c6bd7cb1c2437aa2cc1210a303241e65fcc0` approved both requirements
compliance and code quality with no Critical, Important, or Minor findings.
Independent lifecycle probes covered 300 direct immediate-close races, 100
managed Web-adapter disposal races, 150 acceptance-wins races, and 100 normal
scoped repetitions for each diagnostic-sink outcome. Every response retained
the authoritative bodyless 413, every request body cancelled and unlocked,
diagnostics remained at most once, and no child fiber remained active. Worst
observed settlement was 8 milliseconds.

Coordinator-owned exact-head Node 22.22.3 verification passed HTTP server
runtime 60/60 plus public types, HTTP client 43/43 plus public types, HTTP
metadata 13/13 plus public types, wire 18/18 plus public types, dispatcher
20/20 plus public types, and stdio 20/20 plus public types. WP2 review 16/16,
Effect foundation policy and runtime 8/8, SDK runtime, pinned sources,
generated outputs and protocol surfaces, tier protocol features, invariants,
schema fixtures (23 round-trips and 9 negatives), public type fixtures, unit
readiness, integration readiness, final build, `git diff --check`, prohibited
production-pattern scan, and clean-tree checks also passed. The parity command
continues to report only the recorded Task 4D4 and later-plan gaps.

Task 4D3 is accepted. Task 4D4 remains the next sequential slice and owns the
clean-break client integration, legacy transport removal, verify wiring, and
final Task 4D full-verification gate.

## Independent review cycle 13: Task 4D4 second rereview fixes

Second rereview at exact clean candidate
`a6953f4df38b2b8c11e6e8ec9d692148111f33e5` reported 0 Critical,
3 Important, and 2 Minor findings:

1. Stdio dispatcher subscription success could bypass acknowledgement and the
   generated `SubscriptionsListenResult` plus exact typed subscription ID
   validation already enforced by HTTP.
2. `notifications/cancelled` preferred subscription `_meta` over its normative
   `requestId`, allowing conflicting metadata to cross-cancel another owner;
   generated-invalid cancellation also needed the stdio fail-closed path.
3. Local invalid traffic and owner-buffer overflow removed ownership before
   finalization, suppressing the one required remote cancellation. Local
   abandonment needed to run exactly once outside atomic state mutation without
   blocking or reclassifying the primary typed failure.
4. The ignored recovery ledger's current/next section was stale.
5. The tracked SDK tier evidence still showed the alpha.7 client-auth snapshot
   rather than the observed alpha.9 baseline.

The exact sequential repair evidence is:

- Strict subscription terminal RED `82b454b`; GREEN `eb08891`. A private
  validator now shares generated result and exact numeric/string ID rules with
  HTTP without widening the public API or changing HTTP behavior.
- Normative cancellation ownership RED `06bfa60`; GREEN `206e144`. Valid
  cancellation routes by `requestId` rather than subscription metadata, while
  generated-invalid cancellation returns `InvalidRequest` to the existing
  stdio protocol-close path.
- Exact local abandonment RED `6b93bb7`; GREEN `cd4b512`. Exact-owner removal
  wins once; the primary failure is published first; a caught scoped callback
  may re-enter dispatcher state, block, or fail without recursion, delay, or
  error reclassification. Remote cancellation, valid terminal, close,
  duplicate rejection, and send failure do not echo abandonment.
- Evidence ledger commit `0464c3c` records the current alpha.9 client-auth
  snapshot: 225 passed, 12 SEP-837 `application_type` failures, and 1 SEP-2350
  scope-union warning. The ignored progress ledger was refreshed in place and
  remains intentionally ignored.

The first exact-head Node 22 `pnpm run verify` attempt exited 1 only because the
restricted sandbox denied ephemeral `127.0.0.1` listeners with `EPERM`; the
affected gates were cumulative HTTP and both draft E2E invocations. The same
exact command at tracked head `0464c3c`, rerun with loopback permission, exited
0:

- WP3 schema 28/28 and protocol 14/14; wire 18/18; dispatcher 30/30; stdio
  22/22; HTTP metadata 13/13; cumulative HTTP 116/116; transports 12/12; WP2
  review 17/17; source refresh 3/3; tier operations 10/10.
- Pinned sources, generation, protocol surfaces, invariants, schema fixtures,
  extensions, public types, build, unit, integration, and readiness accounting
  passed. `draft-round-trip` and `tools-call` passed through both `test:e2e` and
  the explicit `e2e:draft` gate.
- The separate unsuppressed client-auth baseline remains 225 passed, 12 failed,
  and 1 warning; it is not part of package health and is not a WP4 readiness or
  release claim.

The tracked worktree and `git diff --check` were clean at `0464c3c`. The only
remaining Task 4D4 risk is immutable independent exact-head rereview and
coordinator acceptance. No behavior beyond the three reviewed fixes, no
WP5/WP6 feature work, no suppression, no remote mutation, and no release or
Tier claim was added.

## Independent review cycle 14: Task 4D4 final-review fix

Final rereview at exact clean report head
`61e3503657235bb047ff62aa2ff0b8d83743ea8b` reported 0 Critical,
1 Important, and 0 Minor findings. The remaining gap was that a validated
`notifications/cancelled` frame still accepted the public `accept` hint as an
ownership override. With active numeric owner `1`, string owner `"1"`, and
normative `params.requestId: 1`, `{ ownerId: "1" }` could cancel the string
owner instead of the numeric owner.

RED `098f865` commits the exact mixed-ID public-hint probe. At the RED head the
numeric owner remained pending for the 100-millisecond bound because the
string owner was selected. GREEN `f0f4250` makes validated cancellation derive
ownership solely from `params.requestId`; public transport hints remain
unchanged for all other notification methods.

Node 22.22.3 verification at `f0f4250` passed:

- Focused normative-metadata, public-hint, and generated-invalid cancellation
  probes: 3/3.
- Cumulative dispatcher runtime: 31/31 plus the public dispatcher type fixture.
- Cumulative stdio runtime: 22/22 plus the public stdio type fixture.
- Build passed before both cumulative suites. No HTTP, auth, WP5/WP6, remote,
  suppression, release, or Tier behavior changed.

The only remaining Task 4D4 risk is immutable independent exact-head rereview
and coordinator acceptance. The separate alpha.9 client-auth baseline remains
225 passed, 12 failed, and 1 warning; it is unchanged deferred evidence.

## Independent review cycle 15: Task 4D4 and WP4 acceptance

Fresh immutable rereview at exact clean candidate
`404972db1699f0fae11024c7645f267f7f589ebd` approved Task 4D4 with 0
Critical, 0 Important, and 1 Minor finding. The reviewer confirmed that valid
`notifications/cancelled` ownership now derives only from normative
`params.requestId`, including the mixed numeric/string conflicting-hint case,
and that all earlier transport, subscription, bounded-ownership, package,
parity, and verification-boundary repairs remain sound.

The sole Minor finding was stale legacy-transport wording in the intentionally
ignored recovery ledger. Its current-risk section was corrected in place to
name only the separate WP6 client-auth baseline and later official
conformance/release/Tier gates; no tracked implementation changed.

Coordinator-owned exact-head Node 22 `pnpm run verify` at `404972d`, run with
ephemeral loopback permission, exited 0. Cumulative results include WP3 schema
28/28 and protocol 14/14; wire 18/18; dispatcher 31/31; stdio 22/22; HTTP
metadata 13/13; HTTP 116/116; transports 12/12; WP2 17/17; source refresh 3/3;
tier operations 10/10; build, generated, invariant, schema, extension, type,
unit, and integration gates; and `draft-round-trip` plus `tools-call` passing
in both draft E2E invocations. `git diff --check` and the tracked clean-tree
check pass.

Task 4D4 and WP4 are accepted at `404972d`. The separate alpha.9 client-auth
baseline remains 225 passed, 12 SEP-837 failures, and 1 SEP-2350 warning for
WP6. Official core conformance, release readiness, and Tier designation remain
later evidence claims; this acceptance does not establish them.
