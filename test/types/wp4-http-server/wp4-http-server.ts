import * as HttpRouter from "@effect/platform/HttpRouter"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as EffectPlatform from "../../../src/integrations/EffectPlatform.js"
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
    const requestHeaders: Readonly<Record<string, string>> = context.requestHeaders
    const exactHeader: string | undefined = requestHeaders["x-extension-mirror"]
    void principal
    void exactHeader
    return Effect.void
  }
} satisfies StreamableHttpServerTransport.StreamableHttpServerTransportOptions

const web = StreamableHttpServerTransport.toWebHandler(Layer.empty, options)
const webHandler: (
  request: Request,
  options?: StreamableHttpServerTransport.HandleRequestOptions
) => Promise<Response> = web.handler
void webHandler

const handled = StreamableHttpServerTransport.handle(
  new Request("http://localhost/mcp"),
  options
)
const callerScopedHandle: Effect.Effect<
  Response,
  never,
  McpServer.McpServer | Scope.Scope
> = handled
type EffectRequirements<Value> = Value extends Effect.Effect<unknown, unknown, infer R>
  ? R
  : never
type AssertTrue<Value extends true> = Value
type HandleRequiresCallerScope = AssertTrue<
  Scope.Scope extends EffectRequirements<typeof handled> ? true : false
>
declare const handleRequiresCallerScope: HandleRequiresCallerScope
void callerScopedHandle
void handled
void handleRequiresCallerScope

const effectPlatformLayer: Layer.Layer<
  McpServer.McpServer,
  never,
  HttpRouter.Default
> = EffectPlatform.layer(options)
void effectPlatformLayer

type AssertFalse<Value extends false> = Value
type McpServerHasLegacyHttp = AssertFalse<
  "handleWebRequest" extends keyof typeof McpServer ? true
    : "layerHttp" extends keyof typeof McpServer ? true
      : "HttpRouteRegistry" extends keyof typeof McpServer ? true
        : false
>
type EffectPlatformHasLegacyRegistry = AssertFalse<
  "httpRouteRegistryLayer" extends keyof typeof EffectPlatform ? true : false
>
declare const mcpServerHasLegacyHttp: McpServerHasLegacyHttp
declare const effectPlatformHasLegacyRegistry: EffectPlatformHasLegacyRegistry
void mcpServerHasLegacyHttp
void effectPlatformHasLegacyRegistry

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
