/** Modern HTTP-hosting ports from the official TypeScript SDK examples. */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import { make as makeClient } from "mcp-effect-sdk/client"
import { McpErrors, McpProtocol } from "mcp-effect-sdk/protocol/2026-07-28"
import * as McpServer from "mcp-effect-sdk/server"
import {
  StreamableHttpClientTransport,
  StreamableHttpServerTransport
} from "mcp-effect-sdk/transport/http"
import { makeDevToolsRuntimeLayer } from "../internal/DevTools.js"
import { assert, firstText } from "./shared.js"

const endpoint = "/mcp"

type MountedHandler = {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

// toWebHandler (not makeScopedHandler) is required here: the returned handler
// is invoked repeatedly by an external caller (a framework's own request
// loop) outside of any single Effect fiber, so the devtools runtime layer
// needs its own ManagedRuntime lifecycle rather than one captured from the
// ambient runtime at mount time.
const mount = (
  name: string,
  handlers: Effect.Effect<void, McpErrors.SchemaValidationError, McpServer.McpServer>,
  options: {
    readonly enableJsonResponse?: boolean
    readonly extensions?: McpServer.ExtensionCapabilities
  } = {}
): Effect.Effect<MountedHandler, McpErrors.SchemaValidationError> =>
  Effect.gen(function* () {
    const server = yield* McpServer.make({
      serverInfo: {
        name,
        version: "1.0.0"
      },
      handlers,
      extensions: options.extensions,
      supportedProtocolVersions: [McpProtocol.LATEST_PROTOCOL_VERSION]
    })
    return StreamableHttpServerTransport.toWebHandler(server, {
      path: endpoint,
      enableDnsRebindingProtection: true,
      enableJsonResponse: options.enableJsonResponse,
      runtimeLayer: makeDevToolsRuntimeLayer()
    })
  })

const whoAmIServer = McpServer.registerTool({
  name: "whoami",
  description: "Returns the subject accepted by the example bearer gate.",
  content: () => Effect.succeed("demo-user")
})

/**
 * Web-standard equivalent of both upstream bearer-auth stories. Authentication
 * is composed outside the MCP handler.
 */
export const bearerAuthWebHandler = Effect.gen(function* () {
  const mounted = yield* mount("bearer-auth-web-example", whoAmIServer)
  return async (request: Request): Promise<Response> => {
    if (request.headers.get("authorization") !== "Bearer demo-token") {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource"'
        }
      })
    }
    return mounted.handler(request)
  }
})

export const runBearerAuthClient = (
  url: string
): Effect.Effect<void, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const transport = yield* StreamableHttpClientTransport.make({
      url,
      headers: { authorization: "Bearer demo-token" }
    })
    const client = yield* makeClient({
      transport,
      clientInfo: {
        name: "bearer-auth-example-client",
        version: "1.0.0"
      }
    })
    const result = yield* client.callTool({ name: "whoami", arguments: {} })
    assert(firstText(result) === "demo-user", "bearer-auth whoami succeeds")
  })

const jsonResponseServer = McpServer.registerTool({
  name: "greet",
  description: "Returns a greeting from the JSON-response example.",
  content: () => Effect.succeed("hello")
})

/** A framework adapter can mount the returned Web-standard handler directly. */
export const jsonResponseWebHandler = mount(
  "json-response-example",
  jsonResponseServer,
  { enableJsonResponse: true }
)

const extensionServer = McpServer.registerTool({
  name: "extension-info",
  description: "Returns a marker for the extension-capabilities story.",
  content: () => Effect.succeed("acme/search is advertised")
})

export const extensionCapabilitiesWebHandler = mount(
  "extension-capabilities-example",
  extensionServer,
  {
    extensions: {
      "acme/search": { version: "1.0.0" }
    }
  }
)
