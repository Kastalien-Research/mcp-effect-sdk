#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import { make as makeClient } from "mcp-effect-sdk/legacy/client"
import { make as makeHttp } from "mcp-effect-sdk/legacy/transport/http"
import { McpSchema } from "mcp-effect-sdk/protocol/2025-11-25"

const endpoint = process.argv[2]
if (endpoint === undefined) throw new Error("Usage: everything-client-2025 <server-url>")
const scenario = process.env.MCP_CONFORMANCE_SCENARIO ?? "initialize"

const defaults = (schema: unknown): Record<string, unknown> => {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return {}
  const properties = (schema as { readonly properties?: unknown }).properties
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return {}
  return Object.fromEntries(
    Object.entries(properties).flatMap(([name, value]) =>
      typeof value === "object" && value !== null && Object.hasOwn(value, "default")
        ? [[name, (value as { readonly default: unknown }).default]]
        : []
    )
  )
}

const program = Effect.scoped(
  Effect.gen(function* () {
    const transport = yield* makeHttp({
      url: endpoint,
      openListenerAfterInitialize: scenario !== "sse-retry",
      onMessage:
        process.env.MCP_LEGACY_DEBUG === "1"
          ? (direction, message) => Effect.sync(() => console.error(direction, message))
          : undefined
    })
    const client = yield* makeClient({
      transport,
      clientInfo: new McpSchema.Implementation({ name: "mcp-effect-sdk-conformance-client", version: "1.0.0" }),
      capabilities: { elicitation: { form: {} }, sampling: {}, roots: {} },
      requestHandlers: {
        "elicitation/create": (params) => {
          const requestedSchema = (params as { readonly requestedSchema?: unknown }).requestedSchema
          return Effect.succeed({ action: "accept", content: defaults(requestedSchema) })
        },
        "sampling/createMessage": () =>
          Effect.succeed({
            role: "assistant",
            model: "mcp-effect-sdk-test-model",
            stopReason: "endTurn",
            content: { type: "text", text: "Sampled response" }
          }),
        "roots/list": () => Effect.succeed({ roots: [] })
      }
    })

    switch (scenario) {
      case "initialize":
        break
      case "tools_call": {
        const list = (yield* client.request("tools/list")) as {
          readonly tools: ReadonlyArray<{ readonly name: string }>
        }
        const tool = list.tools.find(({ name }) => name === "add_numbers")
        if (tool === undefined) throw new Error("add_numbers tool not found")
        yield* client.request("tools/call", { name: tool.name, arguments: { a: 2, b: 3 } })
        break
      }
      case "elicitation-sep1034-client-defaults":
        yield* client.request("tools/call", { name: "test_client_elicitation_defaults", arguments: {} })
        break
      case "sse-retry":
        yield* client.request("tools/call", { name: "test_reconnection", arguments: {} })
        break
      default:
        throw new Error(`Unsupported legacy client conformance scenario: ${scenario}`)
    }
    yield* client.close
  })
)

NodeRuntime.runMain(program)
