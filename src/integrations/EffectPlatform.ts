/** Effect v4 HTTP router adapter for the core Web HTTP transport. */
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import type * as HttpServerError from "effect/unstable/http/HttpServerError"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as McpServer from "../McpServer.js"
import * as StreamableHttpServerTransport from "../transport/StreamableHttpServerTransport.js"

export const layer = (
  options: StreamableHttpServerTransport.StreamableHttpServerTransportOptions
): Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | McpServer.McpServer | HttpRouter.Request.From<"Error", HttpServerError.RequestError>
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer
      const router = yield* HttpRouter.HttpRouter
      const handler = yield* StreamableHttpServerTransport.makeScopedHandler(server, options)
      yield* router.add(
        "*",
        options.path as HttpRouter.PathInput,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const webRequest = yield* HttpServerRequest.toWeb(request)
          const response = yield* handler(webRequest)
          return HttpServerResponse.fromWeb(response)
        })
      )
    })
  )
