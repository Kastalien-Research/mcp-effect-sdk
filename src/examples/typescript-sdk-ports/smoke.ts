#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as McpClient from "../../McpClient.js"
import * as McpClientProtocol from "../../McpClientProtocol.js"
import type * as McpServer from "../../McpServer.js"
import { LATEST_PROTOCOL_VERSION } from "../../generated/mcp/McpProtocol.generated.js"
import * as StreamableHttpClientTransport from "../../transport/StreamableHttpClientTransport.js"
import * as StreamableHttpServerTransport from "../../transport/StreamableHttpServerTransport.js"
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

type RegistrationLayer = Layer.Layer<never, never, McpServer.McpServer>

const runStory = async (
  name: string,
  registrations: RegistrationLayer,
  scenario: (client: McpClient.McpClient) => Effect.Effect<void, unknown, never>
): Promise<void> => {
  const mounted = StreamableHttpServerTransport.toWebHandler(
    registrations,
    {
      name: `${name}-parity-smoke-server`,
      version: "1.0.0",
      path: "/mcp",
      supportedProtocolVersions: [LATEST_PROTOCOL_VERSION]
    }
  )
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const raw = yield* StreamableHttpClientTransport.make({
            url: "http://127.0.0.1/mcp",
            fetch: (input, init) => mounted.handler(new Request(input, init))
          })
          const protocol = yield* McpClientProtocol.make(raw)
          const client = yield* McpClient.make(protocol, {
            clientInfo: { name: `${name}-parity-smoke-client`, version: "1.0.0" }
          })
          yield* scenario(client)
        })
      )
    )
    console.log(`[parity] ${name}: pass`)
  } finally {
    mounted.dispose()
  }
}

export const runModernParitySmoke = async (): Promise<void> => {
  await runStory("tools", toolsServer, runToolsClient)
  await runStory("prompts", promptsServer as RegistrationLayer, runPromptsClient)
  await runStory("resources", resourcesServer, runResourcesClient)
  await runStory("parallel-calls", parallelCallsServer, runParallelCallsClient)
  await runStory("subscriptions", subscriptionsServer, runSubscriptionsClient)
  await runStory("streaming", streamingServer, (client) =>
    client.callTool({
      name: "countdown",
      arguments: { n: 2, delayMs: 1 }
    }).pipe(
      Effect.tap((result) => Effect.sync(() => assert(result.content.length > 0, "streaming returns content"))),
      Effect.asVoid
    ))
  await runStory("stickynotes", stickyNotesServer, (client) =>
    Effect.gen(function*() {
      const added = yield* client.callTool({
        name: "add_note",
        arguments: { text: "Buy milk" }
      })
      const structured = added.structuredContent as Record<string, unknown> | undefined
      assert(typeof structured?.uri === "string", "add_note returns a resource URI")
      const read = yield* client.readResource({ uri: structured.uri })
      assert(read.contents.length === 1, "added note can be read")
    }))
  await runStory("effect-schema", schemaValidatorsServer, (client) =>
    Effect.gen(function*() {
      const listed = yield* client.listTools()
      assert(listed.tools.length === 2, "Effect Schema tools are listed")
    }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runModernParitySmoke().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
