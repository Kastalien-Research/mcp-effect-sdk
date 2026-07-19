import * as HttpRouter from "@effect/platform/HttpRouter"
import { Context, Effect, FiberRef, Layer, Schema, Scope, Stream } from "effect"
import { McpSchema, McpServer, StdioServerTransport } from "../../src/index.js"
import type { SchemaValidationError } from "../../src/McpErrors.js"
import * as EffectPlatform from "../../src/integrations/EffectPlatform.js"
import { currentRequestAnnotations } from "../../src/internal/RuntimeContext.js"

class Prefix extends Context.Tag("fixture/Prefix")<Prefix, string>() {}

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Assert<Value extends true> = Value
type LayerOutput<Value> = Value extends Layer.Layer<infer Output, infer _Error, infer _Input> ? Output : never
type LayerError<Value> = Value extends Layer.Layer<infer _Output, infer Error, infer _Input> ? Error : never

const registered = McpServer.registerTool({
  name: "typed-echo",
  parameters: { value: Schema.String },
  content: ({ value }) => Effect.map(Prefix, (prefix) => `${prefix}:${value}`)
})

const registrationLayer: Layer.Layer<never, SchemaValidationError, McpServer.McpServer> = Layer.effectDiscard(
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
const listToolsResultWithExtension = new McpSchema.ListToolsResult({
  resultType: "complete",
  ttlMs: 0,
  cacheScope: "private",
  tools: [],
  vendorExtension: { enabled: true }
})
const inputRequiredResultWithExtension = McpSchema.InputRequiredResult.make({
  resultType: "input_required",
  requestState: "opaque",
  vendorExtension: { enabled: true }
})
const listToolsExtension: unknown = listToolsResultWithExtension.vendorExtension
const inputRequiredExtension: unknown = inputRequiredResultWithExtension.vendorExtension
const textContentWithExtension = new McpSchema.TextContent({
  type: "text",
  text: "fixture",
  vendorExtension: { enabled: true }
})
const madeTextContentWithExtension = McpSchema.TextContent.make({
  type: "text",
  text: "fixture",
  vendorExtension: { enabled: true }
})
const textContentExtension: unknown = textContentWithExtension.vendorExtension
const madeTextContentExtension: unknown = madeTextContentWithExtension.vendorExtension

const numericId = McpSchema.param("numericId", Schema.NumberFromString)
const typedResourceTemplate = McpServer.resource`fixture://items/${numericId}`({
  name: "typed-resource-template",
  content: (_uri, id) => Effect.succeed(id.toFixed(0))
})
const registeredTypedResourceTemplate = McpServer.registerResource`fixture://registered/${numericId}`({
  name: "registered-typed-resource-template",
  content: (_uri, id) => Effect.succeed(id.toExponential())
})
const onlyFixtureClient = Context.make(
  McpSchema.EnabledWhen,
  (client) => client.clientInfo?.name === "fixture-client"
)
const conditionalTool = McpServer.tool({
  name: "conditional-tool",
  annotations: onlyFixtureClient,
  content: () => Effect.succeed("visible")
})

const requestClientId = McpSchema.McpServerClient.pipe(Effect.map((client) => client.clientId))
const requestAwareTool: Layer.Layer<never, SchemaValidationError, McpServer.McpServer> = McpServer.tool({
  name: "request-aware-tool",
  content: () => requestClientId
})
const requestAwareResource: Layer.Layer<never, SchemaValidationError, McpServer.McpServer> = McpServer.resource({
  uri: "fixture://request-aware",
  name: "request-aware-resource",
  content: requestClientId
})
const requestAwarePrompt: Layer.Layer<never, SchemaValidationError, McpServer.McpServer> = McpServer.prompt({
  name: "request-aware-prompt",
  content: () => requestClientId.pipe(Effect.map(String))
})
const requestAwareZeroTemplate: Layer.Layer<never, SchemaValidationError, McpServer.McpServer> = McpServer.resource`fixture://zero`({
  name: "request-aware-zero-template",
  content: () => requestClientId
})
const requestAwareOneTemplate: Layer.Layer<never, SchemaValidationError, McpServer.McpServer> = McpServer.resource`fixture://one/${numericId}`({
  name: "request-aware-one-template",
  completion: {
    numericId: () => requestClientId.pipe(Effect.as([1]))
  },
  content: (_uri, id) => requestClientId.pipe(Effect.as(id.toFixed(0)))
})
const templateOverloadWitness = McpServer.resource`fixture://overload-witness`({
  name: "template-overload-witness",
  content: () => Effect.succeed("ok")
})
type _TemplateOutputIsNever = Assert<Equal<LayerOutput<typeof templateOverloadWitness>, never>>
type _TemplateErrorIsSchemaValidation = Assert<Equal<LayerError<typeof templateOverloadWitness>, SchemaValidationError>>
const flag = McpSchema.param("flag", Schema.BooleanFromString)
const requestAwareMultipleTemplate: Layer.Layer<never, never, McpServer.McpServer> = McpServer.resource`fixture://many/${numericId}/${flag}`({
  name: "request-aware-multiple-template",
  content: (_uri, id, enabled) => requestClientId.pipe(Effect.as(`${id}:${enabled}`))
})
const contextualNumber = Schema.make<number, string, Prefix>(Schema.NumberFromString.ast)
const contextualId = McpSchema.param("contextualId", contextualNumber)
const contextualTemplate: Layer.Layer<never, never, McpServer.McpServer | Prefix> = McpServer.resource`fixture://context/${contextualId}`({
  name: "contextual-template",
  content: (_uri, id) => requestClientId.pipe(Effect.as(id.toFixed(0)))
})

void registrationLayer
void scopedStream
void annotations
void requestId
void listToolsExtension
void inputRequiredExtension
void textContentExtension
void madeTextContentExtension
void typedResourceTemplate
void registeredTypedResourceTemplate
void conditionalTool
void requestAwareTool
void requestAwareResource
void requestAwarePrompt
void requestAwareZeroTemplate
void requestAwareOneTemplate
void requestAwareMultipleTemplate
void contextualTemplate

const httpLayer: Layer.Layer<
  never,
  never,
  HttpRouter.Default | McpServer.McpServer
> = EffectPlatform.layer({
  path: "/mcp"
})

const stdioLayer: Layer.Layer<
  never,
  never,
  McpServer.McpServer
> = StdioServerTransport.layer()

void httpLayer
void stdioLayer
