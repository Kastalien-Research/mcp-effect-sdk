# Task 4B report: SDK-owned dispatcher and request-scoped streams

## Outcome

Task 4B is implemented and review-fixed through implementation head
`985f230` on
`codex/wp4-wire-kernel-transports`.

- Added the transport-neutral `McpDispatcher` root namespace using stable
  Effect 3 `Stream`, `Queue`, `Ref`, `Deferred`, scoped fibers, and exact
  `McpWire.JsonRpcId` keys.
- Client request streams emit ordered request-bound notifications followed by
  one success/error value; close and send failures use the typed error channel.
- Client cancellation is exact-ID and local-first: the active stream fails with
  `RequestCancelledError` before the outbound cancellation notification is
  attempted or settles, including when that notification ultimately fails.
- Server requests validate generated request payloads before handlers, run in
  request-owned fibers with `McpRequestContext`, and validate known client
  notification payloads before cancellation side effects.
- Server ownership now has explicit running, terminal-writing, and cancelling
  phases. Terminal sends retain ownership through settlement; checked failures,
  defects, and interruptions are published as `ServerDispatchFailure` values
  with their original local `Cause` after ID cleanup. Failure publication uses
  a constant diagnostic and never reads or stringifies hostile error values.
- Running cancellation signals and interrupts the handler without a synthetic
  JSON-RPC terminal, retaining ownership until interruption cleanup completes.
- Integrated exact-ID correlation into `McpClient` and `McpClientProtocol`, and
  added a thin `McpServer.makeDispatcher` adapter that captures the existing
  registry and reuses `clientForParams` for request metadata.
- Preserved valid legacy JSON-RPC error `data` and converted client send defects
  to `TransportError` without swallowing interruption.

Task 4C still owns stdio framing/process lifecycle. Task 4D still owns HTTP,
SSE, headers/origin/retry, and legacy transport removal. No remote state was
mutated.

## Public API decisions

- `McpDispatcher.makeClientDispatcher({ send })` returns a scoped
  `ClientDispatcher` with `request`, `accept`, `cancel`, `close`, and a
  separate global notification queue.
- `ClientFrame` has `Notification`, `Success`, and `Error` variants. JSON-RPC
  success/error terminals are stream values; only protocol/transport/closure
  failures use the stream error channel.
- `McpDispatcher.makeServerDispatcher({ send, handle })` owns exact active IDs,
  generated payload validation, handler fibers, cancellation, and terminal
  arbitration. Its `failures` dequeue exposes supervised terminal-send failure
  data without putting Effect `Cause` values on the wire.
- `McpRequestContext` carries the validated request, exact ID, protocol/client
  metadata, principal, annotations, Effect-native cancellation, and the
  request notification sink.
- `McpServer.makeDispatcher({ send })` is the minimum registry adapter; existing
  HTTP and stdio loops remain unchanged for Tasks 4C/4D.

## TDD evidence

- Initial RED: `b3161b8`; runtime 0/11 and missing public namespace/type fixture.
- Generated metadata correction: `36e40c9`; valid server fixtures now include
  required `_meta`, with missing `_meta` explicitly rejected.
- Deterministic boundary synchronization: `0ed3963`.
- Compatibility RED: `6cc4dd9`; exactly send-defect, error-data, and missing
  server-adapter failures.
- Generated Tool fixture correction: `37f8403`.
- Main GREEN: `788213c`.
- Metadata/cancellation RED: `cf1ddd6`; exactly trace-context loss and malformed
  known-cancellation validation failures.
- Final GREEN: `1944c21`.
- Review-cycle adversarial RED: `ad3ccfb`; runtime 12/19 with seven intended
  ownership/cancellation/failure-channel failures and four missing public type
  surfaces.
- Deterministic review fixture correction: `cf263bf`.
- Review-cycle GREEN: `ab2c49f`.
- Review-cycle 2 RED: `d005bb0`; runtime 18/20 with exactly blocked local-first
  cancellation and hostile-accessor failure-publication regressions.
- Review-cycle 2 GREEN: `985f230`.

## Verification

Pinned runtime: Node `v22.22.3`, pnpm `10.11.1` via Corepack.

- `pnpm run test:wp4-dispatcher`: pass, runtime 20/20 and public type fixture.
- `pnpm run verify` in the restricted sandbox: all gates before E2E passed;
  E2E could not bind `127.0.0.1` (`EPERM`).
- Identical escalated `pnpm run verify`: exit 0. Draft E2E scenarios
  `draft-round-trip` and `tools-call` both passed.
- The full gate also passed Task 4A 18/18, Task 3A 28/28, Task 3B 14/14, WP2
  16/16, source/generated/invariant/build/schema/type/unit/integration checks.
- `git diff --check`: pass. Worktree clean after this report commit.

The readiness compiler still truthfully reports unrelated release,
documentation, conformance-artifact, and agent-evaluation blockers; Task 4B
does not claim those gates.

## Review handoff

Task 4B requires independent read-only review with no Critical or Important
finding, followed by a coordinator full-gate rerun at the exact approved head.
