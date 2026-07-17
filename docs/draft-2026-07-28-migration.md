# Migration: MCP `2025-11-25` → `2026-07-28` stateless draft

This SDK is being migrated to the new MCP "stateless draft" protocol,
`2026-07-28` (`LATEST_PROTOCOL_VERSION`). This is a **clean break**: the SDK
targets the draft only and does not retain `2025-11-25` lifecycle support.

The draft is a substantial architectural redesign, not an incremental revision.
The authoritative inputs are the pinned vendored raw schema artifacts under
`sources/vendor/mcp-core/` plus the regenerated protocol facts in
`src/generated/mcp/McpProtocol.generated.ts`. Where rendered MCP docs lag the
raw schema, the raw schema wins.

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
- Regenerated the protocol facts (`McpProtocol.generated.ts`,
  `McpSchema.generated.ts`) — `LATEST_PROTOCOL_VERSION = "2026-07-28"`.
- Migrated the client path:
  - `McpClient` — no handshake; calls `server/discover`; attaches per-request
    `_meta`; `resultType`-aware (surfaces `input_required` as a typed error);
    no server-request loop; draft request/notification surface; adds
    `subscriptionsListen` and `discover`.
  - `McpNotifications` — outbound collapses to `notifications/cancelled`.
  - `McpClientError` — adds `UnsupportedProtocolVersion` and `InputRequired`;
    drops session-era reasons.
  - `HttpTransport` — drops session-expired (`404`) handling (stateless).
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

### Tracked as follow-up issues (not in this PR)
1. **MRTR end-to-end** — `InputRequiredResult` + `inputRequests`/`inputResponses`
   + `requestState`, replacing the old server-initiated `sampling`/`elicitation`/
   `roots` flows. Client currently fails fast on `input_required`.
2. **`subscriptions/listen` full implementation** — long-lived POST stream,
   filter semantics, `notifications/subscriptions/acknowledged`. Server handler
   is a minimal acknowledgement stub for now.
3. **Tasks extension** — re-author `McpTasks` as `io.modelcontextprotocol/tasks`
   negotiated via the `extensions` capability map. Excluded from the build.
4. **Stateless Streamable HTTP transport** — remove `Mcp-Session-Id`, return
   `405` on GET/DELETE, add required `Mcp-Method`/`Mcp-Name` headers and
   `Mcp-Protocol-Version` echo, drop SSE resumability (`Last-Event-ID`).
5. **Authorization hardening** — `iss` validation, issuer-bound credential
   storage, `application_type` in DCR, prefer Client ID Metadata Documents.
6. **Conformance + tasks examples** — the Everything, core protocol catalog,
   and agent-facing proof examples are draft-aligned and compile. The active
   conformance package uses the draft-targeted
   `@modelcontextprotocol/conformance@0.2.x` path. `examples/task-heavy/**`
   remains excluded until tasks are re-authored as the
   `io.modelcontextprotocol/tasks` extension in #15.
7. **Auth conformance coordination** — draft-targeted client-auth and
   authorization conformance commands are wired, but full authorization
   hardening and passing auth qualification remain tracked by #20.
8. **Verify gates** — keep `scripts/check-*.mjs` and acceptance-gate docs aligned
   with draft facts as the remaining tracked issues land.

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
