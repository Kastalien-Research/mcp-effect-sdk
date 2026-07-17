import { Context, Effect, FiberRef, Layer, Schema, Scope, Stream } from "effect"
import { McpSchema, McpServer } from "../../src/index.js"
import { currentRequestAnnotations } from "../../src/internal/RuntimeContext.js"

class Prefix extends Context.Tag("fixture/Prefix")<Prefix, string>() {}

const registered = McpServer.registerTool({
  name: "typed-echo",
  parameters: { value: Schema.String },
  content: ({ value }) => Effect.map(Prefix, (prefix) => `${prefix}:${value}`)
})

const registrationLayer: Layer.Layer<never, never, McpServer.McpServer> = Layer.effectDiscard(
  registered.pipe(Effect.provideService(Prefix, "fixture"))
)

const scopedStream: Effect.Effect<ReadonlyArray<number>, never, Scope.Scope> = Stream.range(1, 3).pipe(
  Stream.runCollect,
  Effect.map((chunk) => Array.from(chunk))
)

const annotations: Effect.Effect<Readonly<Record<string, unknown>>> = FiberRef.get(
  currentRequestAnnotations
)

const requestId: McpSchema.RequestId = "fixture-id"

void registrationLayer
void scopedStream
void annotations
void requestId

const httpLayer: Layer.Layer<
  McpServer.McpServer,
  never,
  McpServer.HttpRouteRegistry
> = McpServer.layerHttp({
  name: "typed-http",
  version: "1.0.0",
  path: "/mcp"
})

const stdioLayer: Layer.Layer<
  McpServer.McpServer,
  never,
  McpServer.StdioServerIO
> = McpServer.layerStdio({
  name: "typed-stdio",
  version: "1.0.0"
})

void httpLayer
void stdioLayer
