# Migration: MCP `2025-11-25` → `2026-07-28` stateless draft

This SDK is being migrated to the new MCP "stateless draft" protocol,
`2026-07-28` (`LATEST_PROTOCOL_VERSION`). This is a **clean break**: the SDK
targets the draft only and does not retain `2025-11-25` lifecycle support.

The draft is a substantial architectural redesign, not an incremental revision.
The authoritative inputs are the pinned vendored raw schema artifacts under
`sources/vendor/mcp-core/` plus the regenerated protocol facts in
`src/generated/mcp/2026-07-28/McpProtocol.generated.ts` and revisioned Effect
codecs in `src/generated/mcp/2026-07-28/McpSchema.generated.ts`. The generator
structurally parses the TypeScript declarations and cross-checks active message
metadata against JSON Schema. Where rendered MCP docs lag the raw schema, the
raw schema wins. Run `pnpm run generate:mcp` to refresh both artifacts,
`pnpm run check:generated` for deterministic drift, and
`pnpm run test:wp3-protocol` for parity and fail-closed mutation coverage.

## What changed in the protocol

| Area | `2025-11-25` | `2026-07-28` draft |
|---|---|---|
| Lifecycle | `initialize` → `notifications/initialized` handshake, negotiated capabilities | No handshake. Every request carries `_meta` (`io.modelcontextprotocol/protocolVersion`, `…/clientInfo`, `…/clientCapabilities`). |
| Discovery | none | `server/discover` (mandatory) returns supported versions, capabilities, server info, instructions |
| Sessions | `Mcp-Session-Id` minted by Streamable HTTP | Removed. State expressed via explicit handles in payloads. GET/DELETE → `405`. |
| Server→client requests | `roots/list`, `sampling/createMessage`, `elicitation/create` over SSE | Removed. Replaced by **MRTR**: `InputRequiredResult` + client retry with `inputResponses`. |
| Server→client streaming | GET/SSE channel + `resources/subscribe` | `subscriptions/listen` (POST long-lived stream, explicit filters). |
| Results | no discriminator | every result has `resultType` (`"complete"` \| `"input_required"` \| …); absent ⇒ `"complete"`. |
| Logging/keepalive | `ping`, `logging/setLevel`, `notifications/roots/list_changed` | Removed. Log level is per-request `_meta.io.modelcontextprotocol/logLevel`. |
| Tasks | experimental core feature | Moved to `io.modelcontextprotocol/tasks` extension. |
| SSE resumability | `Last-Event-ID` redelivery | Removed; retry with a new request id. |
| HTTP headers | — | `Mcp-Method` / `Mcp-Name` required on POST; `Mcp-Protocol-Version` echoed. |
| Caching | — | `ttlMs` / `cacheScope` on cacheable results. |

## Status of this package

### Done (foundation, this PR)
- Vendored the real upstream draft schema (`schema.ts`, `schema.json`) at
  `sources/vendor/mcp-core/`.
- Retargeted the generator (`scripts/generate-mcp.mjs`) to the draft: requires
  `Discover{Request,Result}` instead of `Initialize*`, tolerates the absent
  `ServerRequest` union (no server-initiated requests), and has an empty
  empty-result-method set (every draft client request has a concrete result).
- Regenerated the revisioned protocol facts
  (`src/generated/mcp/2026-07-28/McpProtocol.generated.ts`) and Effect codecs
  (`src/generated/mcp/2026-07-28/McpSchema.generated.ts`) —
  `LATEST_PROTOCOL_VERSION = "2026-07-28"`.
- Migrated the client path:
  - `McpClient` — no handshake; calls `server/discover`; attaches per-request
    `_meta`; `resultType`-aware with bounded automatic or manual
    `input_required` handling; no server-request loop; draft
    request/notification surface; adds
    `subscriptionsListen` and `discover`.
  - `McpNotifications` — inbound handler dispatch only; caller interruption at
    the stdio transport boundary emits `notifications/cancelled`.
  - `McpClientError` — adds `UnsupportedProtocolVersion` and `InputRequired`;
    drops session-era reasons.
  - `McpTransport` — one request maps to one caller-owned frame stream for both
    stdio and Streamable HTTP.
- Removed the compatibility protocol/serialization layer and legacy
  `HttpTransport`, SSE, and WebSocket clients. The root now publishes only
  modern stdio and Streamable HTTP client/server transports.
- Kept only the marked Roots, Sampling, and Logging hooks under
  `mcp-effect-sdk/deprecated` for migration. Elicitation is stable only through
  `InputRequiredPolicy` and `requestInput`; no deprecated Elicitation service
  or standalone server-request route remains.
- Added packed-consumer/root-export guards, cumulative `test:wp4-http` and
  `test:wp4-transports` gates, and frozen-draft parity/deferred-ledger checks.
- Migrated the server RPC surface (`McpSchema` RPC groups + `McpServer`):
  `server/discover` replaces `initialize`; legacy requests/notifications and
  server-initiated requests removed; tasks removed from core. (See the PR diff.)
- Added cache metadata and low-risk draft follow-ups:
  - `CacheableResult` fields (`resultType`, `ttlMs`, `cacheScope`) are carried
    by cacheable discover/list/read result shapes.
  - Server list/read handlers use private, immediately-stale cache hints by
    default; the stateless HTTP `server/discover` helper can emit public cache
    metadata for gateway-facing discovery responses.
  - `tools/list` returns tools in ascending tool-name order.
  - Request `_meta` preserves W3C `traceparent`, `tracestate`, and `baggage`
    values in the request-scoped client context.
  - Missing resources now fail with the draft `InvalidParams` code `-32602`;
    the old `-32002` resource-not-found code is not emitted as active draft
    behavior.
  - Tool `inputSchema`/`outputSchema` preserve JSON Schema 2020-12 keywords,
    and `structuredContent` may carry any decoded JSON value.
- Added the stable MRTR boundary:
  - `InputRequiredPolicy` automatically handles generated sampling, roots, and
    Elicitation requests for `prompts/get`, `resources/read`, and `tools/call`.
    It defaults to ten rounds, 32 requests per round, and concurrency four;
    callers may lower those limits. URL Elicitation requires an explicit
    handler and is never fetched or opened by the SDK.
  - `InputRequiredPolicy.manual` sends once and returns the generated
    `input_required` union. Callers resume by supplying the exact generated
    `inputResponses` and `requestState` fields on the same high-level method.
  - `requestInput` builds capability-checked generated continuations inside an
    active server request. It is unavailable for every other parent method.
  - `SecureRequestState` seals opaque state with caller-provided 32-byte key
    material, AES-256-GCM, a short expiry, principal and purpose binding, and
    one-time consumption through the explicit `RequestStateReplayStore`
    service. Use this for security or business state.
  - `HarmlessRawRequestState` is a separately named, bounded constructor only
    for harmless failure-only retry hints. It provides no confidentiality,
    integrity, principal binding, expiry, or replay protection and must never
    contain authorization or business state.

Run `pnpm run test:wp5f-policy` to verify the focused MRTR, Elicitation, secure
state, replay, runtime, and public-type contract.

- Added the scoped Subscription product:
  - `subscriptionsListen` returns after exact acknowledgement with an immutable
    acknowledged filter, typed selected-notification Stream, idempotent close,
    and typed graceful/abrupt/protocol closure.
  - Caller scope owns the request; HTTP cancels its response body and stdio
    emits the exact accepted cancellation notification without orphan fibers.
- Re-authored every active core example through published entrypoint owners.
  The core catalog includes stable form Elicitation through MRTR and the scoped
  Subscription product; URL Elicitation remains explicit and deny-by-default.
- Added direct focused `test:wp5-*` commands and the authoritative cumulative
  `pnpm run test:wp5-core` gate, including public-type and real-tarball consumer
  proof.

### Later work and approval-gated issue accounting

Local WP5 implementation is not remote issue closure. The implementations
associated with #13, #14, #17, and #19 have local package evidence, but their
remote disposition remains approval-gated and no official conformance or
readiness claim follows from local package health.

1. **Tasks extension** — re-author `McpTasks` as `io.modelcontextprotocol/tasks`
   negotiated via the `extensions` capability map. Excluded from the build.
2. **Authorization hardening** — implemented locally through the stable
   `mcp-effect-sdk/auth/client` and `mcp-effect-sdk/auth/protected-resource`
   subpaths: exact `iss`, issuer-bound credential storage, `application_type`,
   and Client ID Metadata Documents with DCR as a deprecated fallback. External
   authorization-server qualification and #20 disposition remain approval-gated.
   This local test and client-auth evidence does not prove that separate
   conformance gate.
3. **Conformance + tasks examples** — the Everything, core protocol catalog,
   and agent-facing proof examples are draft-aligned and compile. The active
   conformance package uses the draft-targeted
   `@modelcontextprotocol/conformance@0.2.x` path. `examples/task-heavy/**`
   remains excluded until tasks are re-authored as the
   `io.modelcontextprotocol/tasks` extension in #15.
4. **Auth conformance coordination** — draft-targeted client-auth and
   authorization conformance commands are wired. #20 is implemented locally,
   while external authorization-server qualification remains blocked until an
   approved target passes; no release, Tier, or issue-closure claim follows.
5. **Later-work ledger** — local WP5 implementation and deferred WP6-WP11
   expectations are retained in `docs/conformance/ts-sdk-parity-deferred.json`
   and checked without treating the TypeScript SDK design oracle as normative.

## Per-request `_meta` keys

```
io.modelcontextprotocol/protocolVersion   string         (every request)
io.modelcontextprotocol/clientInfo        Implementation (every request)
io.modelcontextprotocol/clientCapabilities ClientCapabilities (every request)
io.modelcontextprotocol/logLevel          LoggingLevel   (opt-in, per request)
traceparent                              string         (optional W3C trace context)
tracestate                               string         (optional W3C trace context)
baggage                                  string         (optional W3C baggage)
```
