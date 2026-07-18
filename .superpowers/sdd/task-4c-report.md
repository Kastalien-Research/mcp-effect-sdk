# Task 4C report: modern stdio framing and process lifecycle

## Outcome

Task 4C is implemented through implementation head `3ee3e1a` on
`codex/wp4-wire-kernel-transports`.

- Replaced legacy string/readline/NDJSON paths with one Effect-native byte
  framing kernel. It preserves split UTF-8 and exact IDs, accepts LF/CRLF,
  enforces the byte limit before unbounded accumulation, and fails closed for
  blank, malformed, batch, invalid UTF-8, oversized, and unterminated input.
- Added a scoped serialized writer that emits exactly one JSON-RPC object plus
  LF per write and rejects post-close sends.
- Replaced the legacy client constructor with a dispatcher-native scoped stdio
  client. Requests, notifications, exact-ID cancellation, first-close cause,
  spawn/exit diagnostics, and stderr separation are typed. The narrow
  `makeCompatibilityProtocol` bridge is explicit and does not own framing or
  request IDs.
- Client scope cleanup is bounded and interruptible: stdin close and SIGTERM
  are followed by bounded SIGKILL escalation, with no orphaned stubborn child.
- Added `StdioServerTransport.run`, backed by `McpServer.makeDispatcher`, and a
  compatibility layer with an honest `never` acquisition error. Later runner
  failures are supervised through a safe stderr-only stage diagnostic.
- Transport-owned subscription acknowledgement/lifetime is separated from
  dispatcher-owned request terminal/cancellation state.
- Removed the duplicate active `McpServer` stdio loop, `StdioServerIO`, and
  `layerStdio` surface.
- Process stdin/stdout/stderr bridges use bounded suspend queues with Node
  pause/resume backpressure, so the framing limit is not defeated upstream.
- Generated registry results are schema-encoded and then strictly normalized:
  only object properties whose encoded value is exactly `undefined` are
  omitted. Invalid arrays, non-finite numbers, functions, symbols, cycles,
  accessors, and custom prototypes become exact-ID `InternalError` terminals
  without killing the transport. HTTP uses the same typed result boundary.

Task 4D still owns stateless Streamable HTTP, SSE/header/origin/retry behavior,
and remaining legacy transport removal. No remote state was mutated.

## Public API decisions

- `StdioTransport.decode(chunks, { maxLineBytes? })` returns a stream of strict
  `McpWire.JsonRpcMessage` values with typed `StdioTransportError` failures.
- `StdioTransport.makeWriter({ write, close? })` returns a scoped serialized
  `StdioWriter`.
- `StdioClientTransport.make(options)` returns dispatcher-native `request`,
  `notifications`, `sendNotification`, `cancel`, and `closed` capabilities.
- `StdioClientTransport.makeCompatibilityProtocol(options)` is the only legacy
  high-level client bridge.
- `StdioServerTransport.run(options?)` is the authoritative typed runner.
  `layer(options)` supplies a registry and supervises the background runner,
  reporting only a constant safe stage line to its configurable `stderrSink`.

## TDD evidence

- Kernel RED/GREEN: `6e8ee27`, fixture correction `040c2ea`, and `166778b`.
  The kernel-only commit intentionally removed the obsolete client re-export
  before the client implementation commit and was therefore a transient
  non-building intermediate checkpoint.
- Client RED/GREEN: `6618e94`, deterministic fixture synchronization
  `ab2631e`, and `5f17bd9`.
- Server RED/GREEN: `97caddd`, type consumer migration `8d689d3`, and
  `c51624a`.
- Layer hardening RED/GREEN: `18916d4` and `12cd261`.
- Safe stage diagnostic RED/GREEN: `372a9d9` and `041fe23`.
- Real registered-result RED and strict normalization RED/GREEN: `1fa9ccd`,
  `4aaba6a`, and `d66604d`.
- Client upstream queue bound RED/GREEN: `98cdd5b` and `3ee3e1a`.

## Verification

Pinned runtime: Node `v22.22.3`, pnpm `10.11.1` via Corepack.

- `pnpm run test:wp4-stdio`: pass, runtime 16/16 and public type fixture.
- Full WP2 regression suite: pass, 16/16.
- `pnpm run verify` in the restricted sandbox: all gates before E2E passed;
  E2E could not bind `127.0.0.1` (`EPERM`).
- Identical escalated `pnpm run verify`: exit 0. Draft E2E scenarios
  `draft-round-trip` and `tools-call` both passed.
- The full gate also passed Task 4A 18/18, Task 4B 20/20, Task 3A 28/28,
  Task 3B 14/14, source/generated/invariant/build/schema/type/unit/integration
  checks.
- `git diff --check`: pass.

The readiness compiler still truthfully reports unrelated release,
documentation, conformance-artifact, and agent-evaluation blockers; Task 4C
does not claim those gates.

## Surprises and environment compounding

- Positive: the strict wire encoder exposed schema-class optional properties
  that JSON stringification would silently erase; the shared typed result
  boundary now protects both stdio and HTTP.
- Negative: Effect scope finalizers are uninterruptible by default, so bounded
  `awaitExit` calls still hung until the waits were explicitly interruptible.
- Durable positive change: `test:wp4-stdio` is part of `verify` and covers real
  process lifecycle, strict result normalization, source guards, and public
  types.
- Durable negative prevention: the suite locks bounded event queues,
  SIGTERM-to-SIGKILL escalation, no legacy framing/event bridges, and no
  duplicate server stdio loop.

## Remaining risks and review handoff

- The compatibility client bridge remains only for the high-level legacy
  client and is scheduled for Task 4D removal/reconciliation.
- `layer` can supervise and report a later runner failure but cannot expose it
  as a Layer acquisition error after the registry has been acquired; callers
  needing typed failure ownership should use `run`.
- Task 4C requires independent read-only review with no Critical or Important
  finding, followed by a coordinator full-gate rerun at the exact approved
  head.
