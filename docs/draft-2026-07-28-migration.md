# Migration: MCP `2025-11-25` → `2026-07-28` stateless draft

This SDK is being migrated to the new MCP "stateless draft" protocol,
`2026-07-28` (`LATEST_PROTOCOL_VERSION`). This is a **clean break**: the SDK
targets the draft only and does not retain `2025-11-25` lifecycle support.

The draft is a substantial architectural redesign, not an incremental revision.
The authoritative inputs are the vendored raw schema artifacts under
`src/generated/mcp/2026-07-28/` plus the regenerated protocol facts in
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
  `src/generated/mcp/2026-07-28/`.
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
5. **Caching** — `ttlMs`/`cacheScope` (`CacheableResult`) on discover/list/read.
6. **Authorization hardening** — `iss` validation, issuer-bound credential
   storage, `application_type` in DCR, prefer Client ID Metadata Documents.
7. **Low-risk wins** — deterministic `tools/list` ordering, OpenTelemetry
   `_meta` (`traceparent`/`tracestate`/`baggage`), resource-not-found error
   code `-32002` → `-32602`, error-code reallocation (`-32020`..`-32099`).
8. **Examples + conformance** — re-author `src/examples/**` and the conformance
   suite against the draft (currently excluded from the build).
9. **Verify gates** — update the `scripts/check-*.mjs` gates and acceptance-gate
   docs that assert `2025-11-25` facts/tiers.

## Per-request `_meta` keys

```
io.modelcontextprotocol/protocolVersion   string         (every request)
io.modelcontextprotocol/clientInfo        Implementation (every request)
io.modelcontextprotocol/clientCapabilities ClientCapabilities (every request)
io.modelcontextprotocol/logLevel          LoggingLevel   (opt-in, per request)
```
