import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { SchemaValidationError } from "../../../src/McpErrors.js"
import {
  JsonSchemaResolver,
  JsonSchemaValidator,
  make,
  registerTool,
  tool,
  type CompiledJsonSchema,
  type JsonSchema,
  type JsonSchemaResolverService,
  type JsonSchemaResolverOptions,
  type JsonSchemaResolverPolicy,
  type JsonSchemaValidatorService,
  type McpServerService,
  type ResolvedJsonSchemaBytes
} from "../../../src/server.js"

const schema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object"
}
const validator: JsonSchemaValidatorService = JsonSchemaValidator.default
const compiledEffect: Effect.Effect<CompiledJsonSchema, SchemaValidationError> = validator.compile({ schema })
const compiled: CompiledJsonSchema = {
  validate: (_value: unknown) => Effect.void
}
const validated: Effect.Effect<void, SchemaValidationError> = compiled.validate({})

const policy: JsonSchemaResolverPolicy = {
  allowedSchemes: ["https"],
  allowedHosts: ["schemas.example"],
  maxDepth: 8,
  maxBytes: 1_048_576,
  maxRedirects: 3,
  timeoutMs: 5_000
}
const resolverOptions: JsonSchemaResolverOptions<never> = {
  ...policy,
  load: (_uri: string): Effect.Effect<ResolvedJsonSchemaBytes> => Effect.succeed({
    bytes: new Uint8Array(),
    finalUri: "https://schemas.example/schema",
    redirects: []
  })
}
const resolverEffect: Effect.Effect<JsonSchemaResolverService, SchemaValidationError> =
  JsonSchemaResolver.make(resolverOptions)

const registration: Effect.Effect<void, SchemaValidationError, import("../../../src/McpServer.js").McpServer> =
  registerTool({
    name: "typed-output",
    outputSchema: { type: "string" },
    content: () => Effect.succeed({ content: [], structuredContent: "ok" })
  })
const layer: Layer.Layer<never, SchemaValidationError, import("../../../src/McpServer.js").McpServer> = tool({
  name: "typed-layer-output",
  outputSchema: { type: "string" },
  content: () => Effect.succeed({ content: [], structuredContent: "ok" })
})
const server: Effect.Effect<McpServerService, SchemaValidationError> = make({
  serverInfo: { name: "wp5c-types", version: "1" },
  handlers: registration,
  jsonSchemaValidator: validator,
  jsonSchemaResolver: undefined
})

// @ts-expect-error protocol Tool.outputSchema remains object-only
registerTool({ name: "boolean-output", outputSchema: true, content: () => Effect.void })

void compiledEffect
void validated
void resolverEffect
void policy
void layer
void server
