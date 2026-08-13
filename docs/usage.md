# Using the SDK

Every snippet here follows the runnable programs in [`examples/`](../examples/),
which are exercised by `pnpm run e2e:2026-07-28` and the official conformance
suites. If a snippet and an example disagree, the example is authoritative.

The default entrypoints target the released **MCP `2026-07-28`** specification,
whose connections have no handshake, session, or server-initiated request. The
explicit `legacy/*` entrypoints implement the stateful MCP `2025-11-25` profile;
see [Using the `2025-11-25` profile](#using-the-2025-11-25-profile) and
[`migration-2026-07-28.md`](migration-2026-07-28.md).

## Using the `2025-11-25` profile

Legacy support is an explicit profile rather than a version string passed to the
modern client. Construct a duplex transport, then construct the legacy client;
`make` performs `initialize`, validates the selected version, and sends
`notifications/initialized` before returning.

```ts
import * as Effect from "effect/Effect"
import { make as makeLegacyClient } from "mcp-effect-sdk/legacy/client"
import { make as makeLegacyHttp } from "mcp-effect-sdk/legacy/transport/http"
import { McpSchema } from "mcp-effect-sdk/protocol/2025-11-25"

const program = Effect.scoped(
  Effect.gen(function* () {
    const transport = yield* makeLegacyHttp({ url: "https://example.com/mcp" })
    const client = yield* makeLegacyClient({
      transport,
      clientInfo: new McpSchema.Implementation({
        name: "example",
        version: "1.0.0"
      }),
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
        elicitation: { form: {} }
      },
      requestHandlers: {
        "roots/list": () => Effect.succeed({ roots: [] }),
        "sampling/createMessage": () =>
          Effect.fail(new Error("User declined sampling")),
        "elicitation/create": () => Effect.succeed({ action: "decline" })
      }
    })

    return yield* client.request("tools/list")
  })
)
```

Servers use `mcp-effect-sdk/legacy/server` with a connection transport, or the
Web `Request`/`Response` handler from `mcp-effect-sdk/legacy/transport/http`.
Server-originated sampling, roots, elicitation, ping, and Tasks use the same
typed, correlated `request` method. Core Tasks, connection-scoped resource
subscriptions, and legacy logging state are available from
`mcp-effect-sdk/legacy/tasks`, `mcp-effect-sdk/legacy/resources`, and
`mcp-effect-sdk/legacy/logging`.

Do not share request state, caches, sessions, or generated values between the
two profiles. `Mcp-Session-Id` belongs only to `2025-11-25`; modern
`subscriptions/listen`, MRTR, cache hints, and required request `_meta` belong
only to `2026-07-28`.

## Install

```bash
pnpm add mcp-effect-sdk effect
```

`effect` is a peer dependency. `@effect/platform` is an optional peer, needed
only for
[`mcp-effect-sdk/integrations/effect-platform`](../src/integrations/EffectPlatform.ts).

## Building a server

A server is an `McpServer.make` call over a handlers `Effect`. Handlers register
tools, resources, and prompts; each returns an `Effect`, so failures are typed
rather than thrown.

```ts
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as McpServer from "mcp-effect-sdk/server"

const handlers = Effect.gen(function* () {
  yield* McpServer.registerTool({
    name: "add_numbers",
    description: "Adds two numbers.",
    parameters: { a: Schema.Number, b: Schema.Number },
    content: ({ a, b }) => Effect.succeed(String(a + b))
  })
})

const makeServer = McpServer.make({
  serverInfo: { name: "my-server", version: "1.0.0" },
  handlers,
  instructions: "What this server is for."
})
```

`parameters` is the fields shorthand and is generated into JSON Schema 2020-12.
For full control — `$defs`, composition, conditionals, anchors — pass a complete
`parameterSchema` instead. The two are mutually exclusive, and a complete
`parameterSchema` must describe a JSON object.

A tool declared with neither takes no arguments and advertises
`{"type":"object","properties":{},"additionalProperties":false}`.

### Resources and prompts

Register these inside the same `handlers` generator:

```ts
const handlers = Effect.gen(function* () {
  yield* McpServer.registerResource({
    uri: "docs://policy",
    name: "Deployment policy",
    description: "The policy a deployment must satisfy.",
    content: Effect.succeed(JSON.stringify({ window: "Tue 14:00-16:00 UTC" }))
  })

  yield* McpServer.registerPrompt({
    name: "summarize_release",
    description: "Drafts a release summary.",
    content: () => Effect.succeed("Summarize the release notes below.")
  })
})
```

Descriptions are not decoration. They are the only thing an agent has when
choosing between affordances — see
[`agent-evidence/`](agent-evidence/README.md), where a vague description is what
one eval scenario deliberately tests.

## Serving over Streamable HTTP

```ts
import { StreamableHttpServerTransport } from "mcp-effect-sdk/transport/http"

const { handler, dispose } = StreamableHttpServerTransport.toWebHandler(
  Effect.runSync(McpServer.make({ serverInfo, handlers })),
  {
    path: "/mcp",
    enableJsonResponse: true,
    allowedOrigins: ["http://127.0.0.1:3000"]
  }
)
```

`allowedOrigins` is an exact allowlist and is checked before any method
handling. A present `Origin` that does not match is rejected with a
bodyless 403.

Complete program:
[`examples/everything-server.ts`](../examples/everything-server.ts).

## Serving over stdio

```ts
import { StdioServerTransport } from "mcp-effect-sdk/transport/stdio"
```

See [`examples/core-protocol-catalog.ts`](../examples/core-protocol-catalog.ts),
which drives both transports.

## Building a client

A client is scoped: the transport and its connections are released when the
scope closes.

```ts
import * as Effect from "effect/Effect"
import * as McpClient from "mcp-effect-sdk/client"
import { StreamableHttpClientTransport } from "mcp-effect-sdk/transport/http"

const program = Effect.scoped(
  Effect.gen(function* () {
    const transport = yield* StreamableHttpClientTransport.make({
      url: "http://127.0.0.1:3000/mcp"
    })
    const client = yield* McpClient.make({
      transport,
      clientInfo: { name: "my-client", version: "1.0.0" }
    })

    const tools = yield* client.listTools()
    const result = yield* client.callTool({
      name: "add_numbers",
      arguments: { a: 2, b: 3 }
    })
    return result
  })
)
```

`listResources`, `readResource`, `listPrompts`, `getPrompt`, and `discover`
follow the same shape. Complete program:
[`examples/everything-client.ts`](../examples/everything-client.ts).

## Authorization

OAuth lives behind two subpaths so a server that only verifies tokens never
pulls in the client machinery:

- `mcp-effect-sdk/auth/client` — the authorization client a caller uses.
- `mcp-effect-sdk/auth/protected-resource` — the `TokenVerifierService` seam a
  server implements.

Both are wired end to end in the Everything example and covered by
`pnpm run conformance:client-auth`.

## Errors

Failures are typed values in the Effect error channel, not exceptions.
`mcp-effect-sdk/protocol/2026-07-28` exports `McpErrors`; the client surfaces
`McpClientError`. Handle them with `Effect.catchTag` rather than `try`/`catch`.

## Current limitations

Stated plainly, because knowing where the edges are matters more than a feature
list:

| Limitation                                | Detail                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks are experimental                    | Tasks are not required core MCP `2026-07-28`. `mcp-effect-sdk/experimental/tasks` is an opt-in schema boundary, not a completed task runtime.                          |
| Authorization-server role is not shipped  | The SDK implements an OAuth client and protected-resource seams. The separate authorization-server conformance suite is nonblocking unless that role is claimed later. |
| Legacy transports are gone                | HTTP+SSE, standalone SSE, and WebSocket are removed. Only stdio and Streamable HTTP ship.                                                                              |
| Server-initiated requests are gone        | Sampling, elicitation, and roots input use MRTR (`input_required`). Retained migration symbols live under `mcp-effect-sdk/deprecated`.                                 |
| Extensions are opt-in                     | They are disabled by default and governed by [`extensions.md`](extensions.md).                                                                                         |
| Stable publication is not yet evidenced   | See the canonical [`VERSIONING.md`](../VERSIONING.md) and [`CHANGELOG.md`](../CHANGELOG.md).                                                                           |
| Official TypeScript SDK ports are partial | `examples/typescript-sdk-ports/` is compile-checked and documents which upstream stories are ported, partial, blocked, or intentionally out of scope.                  |

## Dependency and update policy

[`DEPENDENCY_POLICY.md`](../DEPENDENCY_POLICY.md) covers dependencies, the
pinned conformance harness, and exact upstream source snapshots.

## Complete feature map

[`feature-coverage.md`](feature-coverage.md) links every supported
non-experimental method, notification, capability, transport, authorization
role, and retained deprecated feature to its API, documentation, runnable
example, and test evidence.
