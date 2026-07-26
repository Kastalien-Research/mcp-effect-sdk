# Using the SDK

Every snippet here is the shape used by the runnable programs in
[`examples/`](../examples/), which are exercised by `pnpm run e2e:draft` and the
official conformance suites. If a snippet and an example disagree, the example
is right.

This SDK targets the **`2026-07-28` MCP stateless draft**. There is no
handshake, no session, and no server-initiated request; see
[`draft-2026-07-28-migration.md`](draft-2026-07-28-migration.md).

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

| Limitation                         | Detail                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tasks are not implemented          | Core tasks left the protocol in `2026-07-28`. `src/McpTasks.ts` and `examples/task-heavy/` are excluded from the build pending re-authoring as the `io.modelcontextprotocol/tasks` extension (#15). `mcp-effect-sdk/experimental/tasks` is a schema boundary only. |
| Three conformance checks fail      | All three are evaluator bugs, not SDK defects: the pinned harness contradicts the pinned normative schema. Adjudicated in [`conformance/conformance-blockers.json`](conformance/conformance-blockers.json) with executable reproducers.                            |
| Legacy transports are gone         | HTTP+SSE, standalone SSE, and WebSocket are removed. Only stdio and Streamable HTTP ship.                                                                                                                                                                          |
| Server-initiated requests are gone | Sampling, elicitation, and roots are reached through MRTR (`input_required`) instead. The retained migration hooks live behind `mcp-effect-sdk/deprecated` and are not root exports.                                                                               |
| Extensions are opt-in              | Disabled by default and governed by [`extensions.md`](extensions.md).                                                                                                                                                                                              |
| No stable release yet              | See [`conformance/versioning-policy.md`](conformance/versioning-policy.md).                                                                                                                                                                                        |
| Some example ports do not build    | `examples/typescript-sdk-ports/` predates the draft rewrite and is quarantined. See [`examples/README.md`](../examples/README.md).                                                                                                                                 |

## Dependency and update policy

[`conformance/dependency-update-policy.md`](conformance/dependency-update-policy.md)
covers how dependencies, the pinned conformance harness, and the vendored
upstream snapshots are updated.
