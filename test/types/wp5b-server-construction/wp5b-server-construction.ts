import type * as HttpRouter from "@effect/platform/HttpRouter"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { SchemaValidationError } from "../../../src/McpErrors.js"
import * as McpServer from "../../../src/McpServer.js"
import * as EffectPlatform from "../../../src/integrations/EffectPlatform.js"
import * as StdioServerTransport from "../../../src/transport/StdioServerTransport.js"
import * as StreamableHttpServerTransport from "../../../src/transport/StreamableHttpServerTransport.js"

class RegistryProfile extends Context.Tag("wp5b/RegistryProfile")<
  RegistryProfile,
  { readonly name: string }
>() {}

const handlers = McpServer.registerTool({
  name: "typed-tool",
  content: () => Effect.map(RegistryProfile, ({ name }) => name)
})

const serverEffect: Effect.Effect<
  McpServer.McpServerService,
  SchemaValidationError,
  RegistryProfile
> = McpServer.make({
  serverInfo: {
    name: "typed-server",
    title: "Typed server",
    version: "5.0.0"
  },
  handlers,
  instructions: "typed explicit construction",
  extensions: { "com.example/typed": {} },
  supportedProtocolVersions: ["2026-07-28"]
})

const serverLayer: Layer.Layer<
  McpServer.McpServer,
  SchemaValidationError,
  RegistryProfile
> = McpServer.layer({
  serverInfo: { name: "typed-layer-server", version: "5.0.0" },
  handlers
})

const stdioOptions: StdioServerTransport.StdioServerTransportOptions = {
  maxLineBytes: 1024,
  stderrSink: () => Effect.void
}
const stdioRuntime: Layer.Layer<
  never,
  never,
  McpServer.McpServer
> = StdioServerTransport.layer(stdioOptions)

const httpOptions: StreamableHttpServerTransport.StreamableHttpServerTransportOptions = {
  path: "/mcp",
  enableJsonResponse: true
}
const webServerLayer = McpServer.layer({
  serverInfo: { name: "typed-web-server", version: "5.0.0" },
  handlers: Effect.void,
  supportedProtocolVersions: ["2026-07-28"]
})
const web = StreamableHttpServerTransport.toWebHandler(webServerLayer, httpOptions)
void web.handler

const platformRoutes: Layer.Layer<
  never,
  never,
  HttpRouter.Default | McpServer.McpServer
> = EffectPlatform.layer(httpOptions)

// @ts-expect-error module construction requires explicit options
McpServer.make()
// @ts-expect-error serverInfo is required
McpServer.make({ handlers: Effect.void })
// @ts-expect-error handlers are required even for an intentionally empty registry
McpServer.make({ serverInfo: { name: "missing-handlers", version: "5.0.0" } })
// @ts-expect-error loose name/version constructor options are removed
McpServer.make({ name: "legacy", version: "1.0.0", handlers: Effect.void })
// @ts-expect-error constructor statics are removed from the Context tag
McpServer.McpServer.make
// @ts-expect-error split option constructor is removed
McpServer.McpServer.makeWithOptions
// @ts-expect-error default static layer is removed
McpServer.McpServer.layer
// @ts-expect-error ServerLayerOptions is removed
type RemovedServerLayerOptions = McpServer.ServerLayerOptions

const invalidStdioOptions: StdioServerTransport.StdioServerTransportOptions = {
  // @ts-expect-error transport configuration cannot own server identity
  name: "hidden-stdio-server",
  version: "1.0.0"
}
const invalidHttpOptions: StreamableHttpServerTransport.StreamableHttpServerTransportOptions = {
  path: "/mcp",
  // @ts-expect-error transport configuration cannot own server identity
  serverInfo: { name: "hidden-http-server", version: "1.0.0" }
}
const invalidHttpVersions: StreamableHttpServerTransport.StreamableHttpServerTransportOptions = {
  path: "/mcp",
  // @ts-expect-error protocol-version support belongs to server configuration
  supportedProtocolVersions: ["2026-07-28"]
}
// @ts-expect-error HTTP construction requires an explicit McpServer-producing layer
StreamableHttpServerTransport.toWebHandler(Layer.empty, httpOptions)

void serverEffect
void serverLayer
void stdioRuntime
void platformRoutes
void invalidStdioOptions
void invalidHttpOptions
void invalidHttpVersions
