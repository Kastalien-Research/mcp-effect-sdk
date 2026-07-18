# Task 4D4 report: direct client integration and legacy transport removal

## Outcome

Task 4D4 is implemented on `codex/wp4-wire-kernel-transports`. The final code
head before this evidence-only report is `fb5fde0`.

- `McpClient.make` consumes request-scoped `McpTransport` directly and
  dispatches request-bound notifications in order.
- `subscriptions/listen` remains caller-owned: interruption releases the
  transport stream, and terminal closure/failure is typed. No WP5 API or
  orphan background fiber was added.
- The stdio client returns only `McpTransport`; interruption preserves exact-ID
  cancellation without exposing protocol queues or direct send/close methods.
- Deleted `McpClientProtocol`, `McpSerialization`, legacy `HttpTransport`,
  `SseClientTransport`, and `WebSocketClientTransport`.
- Root exports retain only modern stdio and Streamable HTTP transport
  boundaries. Existing Roots/Sampling/Elicitation/logging hooks are marked
  deprecated and available only from `mcp-effect-sdk/deprecated`.
- Frozen TypeScript SDK parity is self-contained, with a JSON WP5-WP8 deferral
  ledger. `verify` owns cumulative WP4 transports, draft e2e, and client auth.
- Server discovery advertises registry-backed capabilities, fixing the draft
  e2e regression exposed by the direct client boundary.

## Files changed

The implementation changes 47 files relative to accepted Task 4D3 head
`2e7a9ac`: client/stdio/server sources, exports, examples, parity and verify
scripts, migration/readiness docs, and focused runtime, packaging, governance,
and public type fixtures. Five legacy sources were deleted; `src/deprecated.ts`
and the machine-readable deferral ledger were added.

## TDD commits

- Direct client: RED `e76c6d7`; GREEN `e782e70`.
- Stdio boundary: RED `117b952`; GREEN `b54f9da`.
- Package clean break: RED `d8e0a2a`; GREEN `60d9598`.
- Frozen verification governance: RED `2077acc`; GREEN `4fd423b`.
- Registry-backed discovery: RED `2fe99b3`; GREEN `fb5fde0`.

## Verification

Runtime: Node `v22.22.3`, pnpm `10.11.1`.

- Build and frozen TypeScript SDK parity/deferral ledger: pass.
- WP4 wire 18/18, dispatcher 20/20, stdio 20/20, cumulative HTTP 116/116,
  and cumulative transports/package/governance 11/11, all with public types.
- WP2 review: 17/17, including registry-backed discovery.
- Draft e2e: 2/2 standalone and twice inside final `verify`.
- Unit, integration, generated checks, schema fixtures, extension boundary,
  SDK runtime, source pins, and evidence checks: pass.
- Final `pnpm run verify`: exit 1 only at `conformance:client-auth`. The suite
  reports 225 passed checks, 12 failures because dynamic client registration
  omits required SEP-837 `application_type`, and one SEP-2350 scope-union
  warning. These are WP6-owned and were neither hidden nor implemented here.

No remote state was mutated. No push, pull request, merge, WP5, or release
qualification was attempted.

## Surprises and environment compounding

- Positive: direct transport integration caused e2e to expose stale server
  capability discovery immediately.
- Negative: the extension governance check expects a literal canonical
  assignment marker, so an equivalent initializer initially failed.
- Environment change made: cumulative WP4/package/parity/e2e/auth gates now
  run from `verify`, and discovery has a live-registry regression test.
- Recommended follow-up: WP6 should add `application_type` and scope-union
  behavior through its own RED/GREEN conformance slices; do not suppress the
  current evidence.

## Remaining risks

- Task 4D4 requires coordinator exact-head review and acceptance.
- Full verification remains intentionally non-green until WP6 resolves the
  auth findings. This branch does not claim official conformance, Tier 1,
  release readiness, or completion of WP5-WP8.
