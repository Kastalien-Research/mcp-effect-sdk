#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import * as Runtime from "effect/Runtime"
import type * as Scope from "effect/Scope"
import type * as McpClient from "mcp-effect-sdk/client"
import { make as makeClient } from "mcp-effect-sdk/client"
import { McpErrors, McpProtocol } from "mcp-effect-sdk/protocol/2026-07-28"
import * as McpServer from "mcp-effect-sdk/server"
import {
  StreamableHttpClientTransport,
  StreamableHttpServerTransport
} from "mcp-effect-sdk/transport/http"
import { makeDevToolsRuntimeLayer, runExample } from "../internal/DevTools.js"
import {
  parallelCallsServer,
  runParallelCallsClient,
  runSubscriptionsClient,
  stickyNotesServer,
  streamingServer,
  subscriptionsServer
} from "./interactions.js"
import {
  promptsServer,
  resourcesServer,
  runPromptsClient,
  runResourcesClient,
  runToolsClient,
  schemaValidatorsServer,
  toolsServer
} from "./primitives.js"
import { assert } from "./shared.js"

type Registrations = Effect.Effect<void, McpErrors.SchemaValidationError, McpServer.McpServer>

const runStory = Effect.fn("example.typescript-sdk-port.story")(function* (
  name: string,
  registrations: Registrations,
  scenario: (client: McpClient.McpClient) => Effect.Effect<void, unknown, Scope.Scope>
) {
  yield* Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.make({
        serverInfo: {
          name: `${name}-parity-smoke-server`,
          version: "1.0.0"
        },
        handlers: registrations,
        supportedProtocolVersions: [McpProtocol.LATEST_PROTOCOL_VERSION]
      })
      const handler = yield* StreamableHttpServerTransport.makeScopedHandler(server, {
        path: "/mcp",
        enableJsonResponse: true,
        // makeScopedHandler doesn't apply runtimeLayer itself (only
        // toWebHandler does); the devtools runtime this names is actually
        // installed by the Effect.provide(makeDevToolsRuntimeLayer()) inside
        // runExample, which wraps runModernParitySmoke below.
        runtimeLayer: makeDevToolsRuntimeLayer()
      })
      const runtime = yield* Effect.runtime<never>()
      const transport = yield* StreamableHttpClientTransport.make({
        url: "http://127.0.0.1/mcp",
        fetch: (input, init) =>
          Runtime.runPromise(runtime)(handler(new Request(input, init)))
      })
      const client = yield* makeClient({
        transport,
        clientInfo: {
          name: `${name}-parity-smoke-client`,
          version: "1.0.0"
        }
      })
      yield* scenario(client)
      yield* Effect.logInfo(`[parity] ${name}: pass`)
    })
  )
})

export const runModernParitySmoke = Effect.fn("example.typescript-sdk-port.smoke")(function* () {
  yield* runStory("tools", toolsServer, runToolsClient)
  yield* runStory("prompts", promptsServer, runPromptsClient)
  yield* runStory("resources", resourcesServer, runResourcesClient)
  yield* runStory("parallel-calls", parallelCallsServer, runParallelCallsClient)
  yield* runStory("subscriptions", subscriptionsServer, runSubscriptionsClient)
  yield* runStory("streaming", streamingServer, (client) =>
    client.callTool({
      name: "countdown",
      arguments: { n: 2, delayMs: 1 }
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => assert(result.content.length > 0, "streaming returns content"))
      ),
      Effect.asVoid
    ))
  yield* runStory("stickynotes", stickyNotesServer, (client) =>
    Effect.gen(function* () {
      const added = yield* client.callTool({
        name: "add_note",
        arguments: { text: "Buy milk" }
      })
      const structured = added.structuredContent as Record<string, unknown> | undefined
      assert(typeof structured?.uri === "string", "add_note returns a resource URI")
      const read = yield* client.readResource({ uri: structured.uri })
      assert(read.contents.length === 1, "added note can be read")
    }))
  yield* runStory("effect-schema", schemaValidatorsServer, (client) =>
    Effect.gen(function* () {
      const listed = yield* client.listTools()
      assert(listed.tools.length === 2, "Effect Schema tools are listed")
    }))
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(
    runExample("typescript-sdk-ports", runModernParitySmoke())
  )
}
