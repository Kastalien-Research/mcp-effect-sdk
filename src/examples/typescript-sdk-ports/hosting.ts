/** Modern HTTP-hosting ports from the official TypeScript SDK examples. */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpClient from "../../McpClient.js"
import * as McpClientProtocol from "../../McpClientProtocol.js"
import * as McpServer from "../../McpServer.js"
import { LATEST_PROTOCOL_VERSION } from "../../generated/mcp/McpProtocol.generated.js"
import * as StreamableHttpClientTransport from "../../transport/StreamableHttpClientTransport.js"
import * as StreamableHttpServerTransport from "../../transport/StreamableHttpServerTransport.js"
import { assert, firstText } from "./shared.js"

const endpoint = "/mcp"

const whoAmIServer = Layer.effectDiscard(
  McpServer.registerTool({
    name: "whoami",
    description: "Returns the subject accepted by the example bearer gate.",
    content: () => Effect.succeed("demo-user")
  })
)

const webHandler = StreamableHttpServerTransport.toWebHandler(
  whoAmIServer,
  {
    name: "bearer-auth-web-example",
    version: "1.0.0",
    path: endpoint,
    enableDnsRebindingProtection: true,
    supportedProtocolVersions: [LATEST_PROTOCOL_VERSION]
  }
)

/**
 * Web-standard equivalent of both upstream bearer-auth stories. Authentication
 * is composed outside the MCP handler because this SDK has no token-verifier
 * abstraction or authenticated request context for tool handlers.
 */
export const bearerAuthWebHandler = async (
  request: Request
): Promise<Response> => {
  if (request.headers.get("authorization") !== "Bearer demo-token") {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "www-authenticate": 'Bearer resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource"'
      }
    })
  }
  return webHandler.handler(request, {
    authInfo: {
      token: "demo-token",
      clientId: "demo-client",
      scopes: ["mcp:read", "mcp:call"]
    }
  })
}

export const runBearerAuthClient = (
  url: string
): Effect.Effect<void, unknown, never> =>
  Effect.scoped(
    Effect.gen(function*() {
      const raw = yield* StreamableHttpClientTransport.make({
        url,
        headers: { authorization: "Bearer demo-token" }
      })
      const protocol = yield* McpClientProtocol.make(raw)
      const client = yield* McpClient.make(protocol, {
        clientInfo: { name: "bearer-auth-example-client", version: "1.0.0" }
      })
      const result = yield* client.callTool({ name: "whoami", arguments: {} })
      assert(firstText(result) === "demo-user", "bearer-auth whoami succeeds")
    })
  )

const jsonResponseServer = Layer.effectDiscard(
  McpServer.registerTool({
    name: "greet",
    description: "Returns a greeting from the JSON-response example.",
    content: () => Effect.succeed("hello")
  })
)

/**
 * Web-standard handler used for the upstream json-response and Hono stories.
 * A framework adapter can mount `handler` directly as a fetch handler.
 */
export const jsonResponseWebHandler = StreamableHttpServerTransport.toWebHandler(
  jsonResponseServer,
  {
    name: "json-response-example",
    version: "1.0.0",
    path: endpoint,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    supportedProtocolVersions: [LATEST_PROTOCOL_VERSION]
  }
)

const extensionServer = Layer.effectDiscard(
  McpServer.registerTool({
    name: "extension-info",
    description: "Returns a marker for the extension-capabilities story.",
    content: () => Effect.succeed("acme/search is advertised")
  })
)

export const extensionCapabilitiesWebHandler = StreamableHttpServerTransport.toWebHandler(
  extensionServer,
  {
    name: "extension-capabilities-example",
    version: "1.0.0",
    path: endpoint,
    extensions: {
      "acme/search": { version: "1.0.0" }
    },
    supportedProtocolVersions: [LATEST_PROTOCOL_VERSION]
  }
)
