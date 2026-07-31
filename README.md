# MCP Effect SDK

An Effect-native SDK for the Model Context Protocol: clients, servers, stdio and
Streamable HTTP transports, and OAuth authorization, all expressed as Effect
values with typed error and context channels.

```bash
pnpm add mcp-effect-sdk effect
```

`effect` is a peer dependency; `@effect/platform` is an optional peer for the
platform integration.

```ts
import * as Effect from "effect/Effect"
import * as McpServer from "mcp-effect-sdk/server"
import { StreamableHttpServerTransport } from "mcp-effect-sdk/transport/http"
```

See [`examples/`](examples/) for complete runnable programs — every example
imports the SDK through its published entrypoints, so they double as a check
that the export surface is sufficient.

## Where to look

| If you want to                        | Go to                                    |
| ------------------------------------- | ---------------------------------------- |
| Use the SDK                           | [`docs/`](docs/README.md)                |
| See working code                      | [`examples/`](examples/README.md)        |
| Contribute                            | [`CONTRIBUTING.md`](CONTRIBUTING.md)     |
| Understand the roadmap and invariants | [`ROADMAP.md`](ROADMAP.md)               |
| Read conformance evidence             | [`docs/conformance/`](docs/conformance/) |
| Run the visual workbench              | [`apps/`](apps/README.md)                |

## Protocol version

This SDK targets the **`2026-07-28` MCP "stateless draft"** protocol as a clean
break from `2025-11-25`. The handshake, sessions, and server-initiated requests
are gone; `server/discover`, per-request `_meta`, `resultType`, MRTR, and
`subscriptions/listen` are in. See
[`docs/draft-2026-07-28-migration.md`](docs/draft-2026-07-28-migration.md) for
the migration status and the tracked follow-up work.

## Current Package Shape

- `src/McpSchema.ts` exposes the Effect schema facade over generated MCP schema
  data.
- `sources/vendor/mcp-core/` contains the pinned authoritative draft MCP schema
  (`schema.ts`, `schema.json`). The generator structurally parses `schema.ts`
  and cross-checks its active message metadata against `schema.json`;
  `src/generated/mcp/2026-07-28/McpProtocol.generated.ts` contains the
  deterministic descriptors, lookups, HTTP metadata, and protocol codecs, and
  `src/generated/mcp/2026-07-28/McpSchema.generated.ts` contains the revisioned
  deterministic Effect codecs.
- `src/McpClient.ts`, `src/McpServer.ts`, `src/McpDispatcher.ts`, and
  `src/McpWire.ts` are the core client/server/request-stream modules.
- `examples/everything-server.ts` is the Everything-style conformance server.
- The root publishes only modern stdio and Streamable HTTP client/server
  transports. Legacy HTTP+SSE, standalone SSE, and WebSocket transports are
  removed.
- `mcp-effect-sdk/deprecated` is the explicit package subpath for the retained
  roots, sampling, elicitation, and logging hooks. They are not root exports.
- `docs/conformance/historical-mcp-reconciliation.md` records the cleanup of the
  older duplicated `mcp/` implementation tree.
- Extension capabilities are disabled by default and governed by
  `docs/extensions.md`.

## Tool input schemas

`McpServer.registerTool` accepts either the concise `parameters` fields
shorthand or a complete Effect `parameterSchema`. The complete schema is used
for both runtime argument decoding and JSON Schema 2020-12 generation, so
root-level annotations such as `$defs`, composition, conditionals, and anchors
are preserved. The two options are mutually exclusive, and a complete
`parameterSchema` must describe a JSON object.

```ts
const parameterSchema = Schema.Struct({
  query: Schema.String
}).annotations({
  jsonSchema: { additionalProperties: false }
})

McpServer.registerTool({
  name: "search",
  parameterSchema,
  content: ({ query }) => Effect.succeed(query)
})
```

## Commands

Refresh both revisioned generated artifacts from the pinned, network-free
sources, then verify byte-for-byte drift and protocol parity:

```bash
pnpm run generate:mcp
pnpm run check:generated
pnpm run test:protocol-metadata
```

```bash
pnpm run verify
```

`pnpm test` runs the authoritative verification gate. It includes package health
plus complete official server/client conformance and the focused client
authorization lane. Local draft E2E can also be run directly:

```bash
pnpm run e2e:draft
pnpm run test:http
pnpm run test:transports
```

MCP readiness/Tier qualification requires official draft-targeted conformance:

```bash
pnpm run conformance:run
pnpm run conformance:client
pnpm run conformance:client-auth
```

The server and client runners select `--suite all --spec-version 2026-07-28` and
fail if their artifacts do not exactly match the scenario inventory exposed by
the pinned official harness. The focused auth command remains available for
diagnosis but does not replace the complete client run.
