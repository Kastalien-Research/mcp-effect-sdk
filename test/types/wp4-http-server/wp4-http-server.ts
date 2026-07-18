import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpServer from "../../../src/McpServer.js"
import * as StreamableHttpServerTransport from "../../../src/transport/StreamableHttpServerTransport.js"

const options = {
  name: "typed-http-server",
  version: "1.0.0",
  path: "/mcp",
  enableJsonResponse: true,
  supportedProtocolVersions: ["2026-07-28"],
  allowedOrigins: ["https://allowed.example"],
  allowedHosts: ["localhost"],
  enableDnsRebindingProtection: true,
  maxBodyBytes: 1024 * 1024,
  maxPendingFrames: 16,
  warningSink: (warning) => Effect.sync(() => {
    const tag: "InvalidHttpToolHeader" = warning._tag
    const toolName: string = warning.toolName
    const reason: string = warning.reason
    void tag
    void toolName
    void reason
  }),
  acceptNotification: (_notification, context) => {
    const principal: unknown = context.authorizationPrincipal
    void principal
    return Effect.void
  }
} satisfies StreamableHttpServerTransport.StreamableHttpServerTransportOptions

const web = StreamableHttpServerTransport.toWebHandler(Layer.empty, options)
const webHandler: (
  request: Request,
  options?: StreamableHttpServerTransport.HandleRequestOptions
) => Promise<Response> = web.handler
void webHandler

const handled: Effect.Effect<Response, never, McpServer.McpServer> =
  StreamableHttpServerTransport.handle(new Request("http://localhost/mcp"), options)
void handled

const removedModern = {
  name: "removed-modern",
  version: "1.0.0",
  path: "/mcp",
  // @ts-expect-error the server transport is modern-only
  modern: true
} satisfies StreamableHttpServerTransport.StreamableHttpServerTransportOptions
void removedModern

// @ts-expect-error the package-local HTTP Layer bypass was removed
StreamableHttpServerTransport.layer(options)

// @ts-expect-error arbitrary handler injection was removed
StreamableHttpServerTransport.handleRequest(
  new Request("http://localhost/mcp"),
  async () => new Response(),
  options
)
