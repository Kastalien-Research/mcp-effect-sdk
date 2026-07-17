/** Optional stable Effect Platform adapter for the core Web HTTP transport. */
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpServer from "../McpServer.js"
import type { StreamableHttpServerTransportOptions } from "../transport/StreamableHttpServerTransport.js"

export const httpRouteRegistryLayer = Layer.effect(
  McpServer.HttpRouteRegistry,
  HttpRouter.Default.pipe(Effect.map((router) => ({
    post: (path: string, handler: (request: Request) => Effect.Effect<Response>) =>
      router.post(path as HttpRouter.PathInput, Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const webRequest = yield* HttpServerRequest.toWeb(request)
        const response = yield* handler(webRequest)
        return HttpServerResponse.fromWeb(response)
      }))
  })))
)

export const layer = (options: StreamableHttpServerTransportOptions) =>
  McpServer.layerHttp(options).pipe(Layer.provide(httpRouteRegistryLayer))
