# Task 4D3 independent-rereview fix cycle 2

## Status and boundary

- Worktree: `/private/tmp/mcp-effect-sdk-wp4`
- Branch: `codex/wp4-wire-kernel-transports`
- Required starting head: `152bda8d953a550f9641b1520fa2044626c9deb2`
- Production candidate before this report-only checkpoint: `a356e6e`
- Runtime for every RED/GREEN command: Node `v22.22.3` from
  `/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin`
- No push, PR mutation, merge, release, external-state mutation, WP4D4 work, or
  acceptance claim was made.

Task 4D3 remains pending independent rereview and coordinator exact-head
verification. This report records implementation evidence only.

## Outcome

The second rereview findings are implemented:

1. A supplied `parsedBody` no longer bypasses `maxBodyBytes` when an available
   raw request body lacks `Content-Length`. The raw stream is metered, and an
   over-limit body is cancelled and unlocked before HTTP 413.
2. Path, Origin, Host, method, request media type, and Accept preflight
   rejections cancel and unlock any unconsumed raw body while retaining their
   previous bodyless status and headers.
3. The raw Web handler serves only an exact configured URL pathname. `/mcp`
   and `/mcp?...` are accepted for `path: "/mcp"`; `/not-mcp` and `/mcp/` are
   bodyless 404 responses.
4. Known outbound server notifications are decoded with
   `SERVER_NOTIFICATION_PAYLOAD_CODEC_BY_METHOD` before SSE serialization.
   Malformed known payloads fail the stream and ownership safely; unknown
   extension notification methods remain supported.
5. `McpServer.notificationsQueue` is a fixed-capacity, nonblocking 64-entry
   sliding compatibility observer instead of an unbounded server-lifetime
   queue. Live subscription publication is unchanged and is not limited by
   that observation capacity.
6. Public Effect-native `handle` now requires `Scope.Scope` and forks response
   ownership from the caller. `makeScopedHandler`, `toWebHandler`, and Effect
   Platform retain their managed caller-derived lifecycle.
7. The Task 4D report now distinguishes `handle` from `makeScopedHandler` scope
   ownership and correctly records that Web `Headers` normalize header names
   to lowercase.

## RED and GREEN evidence

Every command below used:

```text
PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/usr/local/bin:/usr/bin:/bin
```

### Raw body accounting with parsed input

- RED `6f77411` (`test(http): bound raw uploads with parsed bodies`)
- Command:
  `corepack pnpm run build && node --test --test-name-pattern="parsed bodies cannot bypass maxBodyBytes" test/http/wp4-http-server.test.mjs`
- RED result: runtime 0/1. The handler returned HTTP 200 instead of 413 for a
  4096-byte undeclared raw stream with `maxBodyBytes: 512` and a small valid
  `parsedBody`.
- GREEN `c36122b` (`fix(http): meter raw bodies alongside parsed input`)
- GREEN result: build passed and targeted runtime 1/1 passed; cancellation was
  exactly once and the raw body was unlocked.

### Early preflight body release

- RED `638821d` (`test(http): release bodies on preflight rejection`)
- Command:
  `corepack pnpm run build && node --test --test-name-pattern="early preflight rejections cancel" test/http/wp4-http-server.test.mjs`
- RED result: runtime 0/1. Origin, Host, method, content-type, and Accept cases
  retained their expected responses but all observed zero cancellations.
- GREEN `a486d0d` (`fix(http): release rejected request bodies`)
- GREEN result: build passed and targeted runtime 1/1 passed; all five cases
  cancelled once, unlocked, and retained exact bodyless status/header behavior.

### Exact raw Web pathname

- RED `5055304` (`test(http): require exact raw Web pathname`)
- Command:
  `corepack pnpm run build && node --test --test-name-pattern="raw Web routing matches" test/http/wp4-http-server.test.mjs`
- RED result: runtime 0/1. Both `/not-mcp` and `/mcp/` returned the complete
  discovery response with HTTP 200 and consumed their request bodies.
- GREEN `ac9c519` (`fix(http): enforce exact Web request pathname`)
- GREEN result: build passed and targeted runtime 1/1 passed. Both mismatches
  became bodyless 404 with cleanup; `/mcp?trace=exact-path` remained HTTP 200.

### Outbound generated notification validation

- RED `7a1805e` (`test(http): reject malformed outbound notifications`)
- Command:
  `corepack pnpm run build && node --test --test-name-pattern="outbound SSE validates known" test/http/wp4-http-server.test.mjs`
- RED result: runtime 0/1. A generated `notifications/progress` payload missing
  `progressToken` resolved as an emitted SSE frame instead of rejecting.
- GREEN `76dfba6` (`fix(http): validate outbound server notifications`)
- GREEN commands covered the new case plus the existing ordered ordinary SSE
  and subscription encoding-failure cases.
- GREEN result: runtime 3/3 passed. The malformed known frame failed with the
  safe stream error; valid known and unknown extension frames still serialized.

### Server notification storage and publication

- RED `8964cb9` (`test(server): forbid duplicate notification queue`)
- Command:
  `corepack pnpm run build && node --test --test-name-pattern="server notifications use live subscriptions" test/http/wp4-http-server.test.mjs`
- RED result: runtime 0/1 because `notificationsQueue` and
  `Queue.unbounded<ServerNotification>` remained. The live subscription and
  post-close controls already behaved correctly.
- Initial GREEN `b16154d` (`fix(server): remove undrained notification queue`)
  removed duplicate storage and passed the focused runtime and migrated WP2
  subscription probe.
- Cumulative RED: `corepack pnpm run check:sdk-runtime` defected at the active
  compatibility observation because `server.notificationsQueue` was absent.
- Correction RED `83cc154` (`test(server): retain bounded notification observation`)
  required a 64-entry observer and preserved the live delivery stress control.
- Correction GREEN `a356e6e` (`fix(server): bound notification observation queue`)
  uses `Queue.sliding<ServerNotification>(64)`.
- GREEN result: build passed; targeted runtime 1/1 passed; 70/70 publications
  reached the live subscriber, a post-close publication did not, retained
  queue size was 64, and unchanged `check:sdk-runtime` passed.

### Caller-owned public handle scope

- RED `dd69a99` (`test(http): require caller-owned handle scope`)
- Commands:
  `corepack pnpm run build && node --test --test-name-pattern="Effect-native handle derives" test/http/wp4-http-server.test.mjs`, then
  `node scripts/check-wp4-http-server-types.mjs`.
- RED result: runtime 0/1 because closing the caller scope produced `Timeout`
  instead of `Done`; the type fixture failed because `handle` did not require
  `Scope.Scope`.
- GREEN `88213f7` (`fix(http): derive handle ownership from caller scope`)
- GREEN result: build passed, runtime 1/1 passed, and the public HTTP server
  type fixture passed. The source guard found no `Scope.make` in the transport.

## Focused verification before report checkpoint

All commands used the pinned Node 22 path above.

- `corepack pnpm run test:wp4-http-server`: pass, runtime 49/49 plus public
  types. The first sandboxed attempt was 48/49 solely because loopback bind
  failed with `listen EPERM 127.0.0.1`; the required rerun with loopback
  permission passed the real Node bridge.
- `corepack pnpm run test:wp4-dispatcher`: pass, runtime 20/20 plus public types.
- `corepack pnpm run test:wp2-review`: pass, runtime 16/16.
- `corepack pnpm run build`: pass.
- `corepack pnpm run check:sdk-runtime`: pass.
- `git diff --check`: pass.
- Added-production-line scan from the required base through `a356e6e`: no added
  `runSync`, `runFork`, `Queue.unbounded`, `new ReadableStream`, or
  `controller` match.

## Files changed

- `src/transport/StreamableHttpServerTransport.ts`
  - raw/parsed body metering and preflight release
  - exact pathname routing
  - generated outbound notification validation and safe stream failure
  - caller-derived public `handle` scope
- `src/McpServer.ts`
  - bounded sliding notification observation queue
  - unchanged live subscription fan-out and interruption behavior
- `test/http/wp4-http-server.test.mjs`
  - six focused runtime regressions, source guards, and controls
- `test/types/wp4-http-server/wp4-http-server.ts`
  - public `handle` caller-scope requirement
- `test/foundation/wp2-review-regressions.test.mjs`
  - list-change observation through a live subscription rather than draining
    historical registration backlog
- `.superpowers/sdd/task-4d-report.md`
  - narrow ownership/header corrections, evidence, and rereview checkpoint
- `.superpowers/sdd/task-4d3-fix-cycle-2.md`
  - this durable report

## Self-review

- Body cleanup runs only on paths that return before raw-body decoding; decoded
  requests retain the existing body ownership path.
- Parsed bodies remain usable when a platform has already consumed or locked
  the raw body. An available raw body is always metered before trusting the
  parsed representation.
- Path matching uses only `new URL(request.url).pathname`, so query strings do
  not change routing and trailing slash behavior is intentionally exact.
- Known notification validation reuses the generated codec table. The decoded
  value is used for validation only; serialization retains the original plain
  wire value so generated class prototypes do not cross the safe wire encoder.
- Stream failure is serialized under the existing response lock. The first
  malformed-frame failure closes state and ownership before any terminal retry
  can write.
- The sliding observer cannot backpressure publication. Live subscriptions
  receive every publish independently of observer retention.
- The public `handle` validates options eagerly but performs scope forking only
  inside the caller's Effect scope.

## Surprises and environment compounding

- Positive: the generated server-notification codec table was directly reusable
  at the outbound server boundary and preserved the extension escape hatch.
- Negative: the focused notification guard initially missed that the SDK
  runtime checker treated `notificationsQueue` as a public observation surface.
- Durable positive change: source and runtime guards now cover generated
  outbound validation, exact path behavior, preflight cleanup, and caller-owned
  public handle scopes.
- Durable negative prevention: the queue guard stress-publishes beyond capacity
  while verifying complete live delivery, making unbounded retention and
  subscription weakening independently visible.

## Remaining concerns and next actions

- The capacity `64` is a compatibility retention bound, not a delivery bound;
  consumers that treat the queue as a complete historical log can observe old
  entries sliding out. Active subscriptions remain authoritative for delivery.
- Full `pnpm run verify`, draft E2E, Task 3A/3B, and Task 4D4 were not run or
  started in this cycle.
- Task 4D3 must receive a fresh independent read-only rereview and coordinator
  exact-head verification. No Task 4D3 or WP4 acceptance is claimed.
