# Migrating to MCP `2026-07-28`

`mcp-effect-sdk` targets the released MCP `2026-07-28` protocol as a clean break
from `2025-11-25`.

## Protocol changes

| Area         | `2025-11-25`                              | `2026-07-28`                                                      |
| ------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| Lifecycle    | `initialize` handshake and sessions       | Stateless requests with required protocol and capability metadata |
| Discovery    | Initialization result                     | `server/discover`                                                 |
| Server input | Server-initiated requests                 | Multi-round-trip results with `input_required` and retry          |
| Streaming    | Session GET/SSE and resource subscription | Request-owned `subscriptions/listen` streams                      |
| Results      | No discriminator                          | Required `resultType`; older peer results default to `complete`   |
| HTTP         | Session and resumability headers          | `Mcp-Method`, `Mcp-Name`, and `Mcp-Protocol-Version`              |
| Caching      | No standard result hints                  | `ttlMs` and `cacheScope`                                          |
| Tasks        | Experimental core surface                 | Separate experimental extension                                   |

The SDK does not emulate the old handshake or session lifecycle. Migrate clients
to `McpClient.make`, discovery, and per-request metadata. Migrate servers to
`McpServer.make`, request-owned streams, and MRTR input handling.

## Public API migration

- Use `mcp-effect-sdk/client` and `mcp-effect-sdk/server` for the stable API.
- Use `mcp-effect-sdk/transport/stdio` or `mcp-effect-sdk/transport/http`.
- Use `InputRequiredPolicy` for elicitation, sampling, and roots input.
- Use `subscriptionsListen` for scoped server notifications.
- Use `mcp-effect-sdk/deprecated` only for the documented roots, sampling, and
  logging compatibility symbols; it does not restore server-initiated requests.

### Authorization registration

OAuth clients can use pre-registered client metadata, Client ID Metadata
Documents (CIMD), or Dynamic Client Registration (DCR). DCR remains the
deprecated fallback when neither pre-registration nor CIMD is available. The
entire flow is owned by `mcp-effect-sdk/auth/client`; the protected-resource
entrypoint does not pull in registration machinery.

## Verification

```bash
pnpm run build
pnpm run test:e2e
pnpm run e2e:2026-07-28
pnpm run verify:conformance
```

The final-spec feature mapping is published in
[feature-coverage.md](feature-coverage.md).
