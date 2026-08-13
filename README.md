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

| If you want to              | Go to                                                          |
| --------------------------- | -------------------------------------------------------------- |
| Use the SDK                 | [`docs/`](docs/README.md)                                      |
| See working code            | [`examples/`](examples/README.md)                              |
| Migrate from `2025-11-25`   | [`docs/migration-2026-07-28.md`](docs/migration-2026-07-28.md) |
| Review feature coverage     | [`docs/feature-coverage.md`](docs/feature-coverage.md)         |
| Connect Effect DevTools     | [`docs/observability.md`](docs/observability.md)               |
| Read the dependency policy  | [`DEPENDENCY_POLICY.md`](DEPENDENCY_POLICY.md)                 |
| Read the versioning policy  | [`VERSIONING.md`](VERSIONING.md)                               |
| Read the maintenance policy | [`MAINTENANCE.md`](MAINTENANCE.md)                             |
| Read release notes          | [`CHANGELOG.md`](CHANGELOG.md)                                 |
| Follow release work         | [`ROADMAP.md`](ROADMAP.md)                                     |
| Contribute                  | [`CONTRIBUTING.md`](CONTRIBUTING.md)                           |

## Protocol version

The default API targets the released **MCP `2026-07-28`** protocol. The SDK also
provides an explicit, additive **MCP `2025-11-25`** profile under `legacy/*` for
stateful initialization, bidirectional requests, core Tasks, resource
subscriptions, logging, stdio, and session-based Streamable HTTP. The profiles
have separate generated schemas and cannot be mixed on one connection. See the
[usage guide](docs/usage.md#using-the-2025-11-25-profile) and
[migration guide](docs/migration-2026-07-28.md).

## Current Package Shape

- `src/McpSchema.ts` exposes the Effect schema facade over generated MCP schema
  data.
- `sources/vendor/mcp-core/` contains the pinned authoritative final MCP schema
  (`schema.ts`, `schema.json`). The generator structurally parses `schema.ts`
  and cross-checks its active message metadata against `schema.json`;
  `src/generated/mcp/2026-07-28/McpProtocol.generated.ts` contains the
  deterministic descriptors, lookups, HTTP metadata, and protocol codecs, and
  `src/generated/mcp/2026-07-28/McpSchema.generated.ts` contains the revisioned
  deterministic Effect codecs.
- `src/McpClient.ts`, `src/McpServer.ts`, `src/McpDispatcher.ts`, and
  `src/McpWire.ts` are the core client/server/request-stream modules.
- `examples/everything-server.ts` is the Everything-style conformance server.
- The root publishes the modern stdio and Streamable HTTP client/server
  transports. Stateful `2025-11-25` transports are opt-in under
  `mcp-effect-sdk/legacy/transport/*`; the deprecated `2024-11-05` HTTP+SSE and
  WebSocket transports are not supported.
- `mcp-effect-sdk/deprecated` is the explicit package subpath for retained
  roots, sampling, and logging migration hooks. They are not root exports.
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
authorization lane. The local final-spec E2E can also be run directly:

```bash
pnpm run e2e:2026-07-28
pnpm run e2e:2025-11-25
pnpm run test:http
pnpm run test:transports
```

MCP SDK Tier self-assessment requires official final-spec conformance:

```bash
pnpm run conformance:run
pnpm run conformance:client
pnpm run conformance:client-auth
pnpm run conformance:2025-11-25
pnpm run conformance:client:2025-11-25
```

The server and client runners select `--suite all --spec-version 2026-07-28` and
fail if their artifacts do not exactly match the scenario inventory exposed by
the pinned official harness. The focused auth command remains available for
diagnosis but does not replace the complete client run. A same-commit composite
must cover all three lanes at 100% of applicable checks.

## MCP SDK Tier status

The repository is preparing a Tier 1 self-assessment. Passing local gates does
not grant a Tier designation; approval belongs to the MCP SDK Working Group.
Stable release publication remains separately evidenced, and the checked-in
rolling maintenance score currently remains a blocker. An upstream advancement
request is outside the `1.0.0` implementation scope.
