/** Optional stable Effect Platform adapter for the core Web HTTP transport. */
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpServer from "../McpServer.js"
import * as StreamableHttpServerTransport from "../transport/StreamableHttpServerTransport.js"

export const layer = (
  options: StreamableHttpServerTransport.StreamableHttpServerTransportOptions
): Layer.Layer<McpServer.McpServer, never, HttpRouter.Default> => {
  McpServer.normalizeExtensionCapabilities(options.extensions)
  return Layer.scoped(McpServer.McpServer, Effect.gen(function*() {
    const server = yield* McpServer.McpServer.makeWithOptions(options)
    const router = yield* HttpRouter.Default
    yield* router.all(options.path as HttpRouter.PathInput, Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const webRequest = yield* HttpServerRequest.toWeb(request)
      const response = yield* StreamableHttpServerTransport.handle(webRequest, options).pipe(
        Effect.provideService(McpServer.McpServer, server)
      )
      return HttpServerResponse.fromWeb(response)
    }))
    return server
  }))
}
