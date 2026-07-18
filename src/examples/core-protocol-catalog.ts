import { Buffer } from "node:buffer"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as McpClient from "../McpClient.js"
import * as McpClientApi from "../McpClient.js"
import * as McpClientProtocol from "../McpClientProtocol.js"
import * as McpSchema from "../McpSchema.js"
import * as McpServer from "../McpServer.js"
import * as McpProtocol from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import type { OAuthClientInformationMixed, OAuthTokens } from "../auth/auth.js"
import * as HttpTransport from "../transport/HttpTransport.js"
import * as StreamableHttpServerTransport from "../transport/StreamableHttpServerTransport.js"
import * as StdioClientTransport from "../transport/StdioClientTransport.js"
import * as StdioServerTransport from "../transport/StdioServerTransport.js"

const endpoint = "/mcp"
const protocolVersion = McpProtocol.LATEST_PROTOCOL_VERSION
const imageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
const audioBase64 = "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA="

const binary = (base64: string): Uint8Array => Uint8Array.from(Buffer.from(base64, "base64"))

const text = (value: string): McpSchema.TextContent =>
  McpSchema.TextContent.make({ type: "text", text: value })

const image = (): McpSchema.ImageContent =>
  McpSchema.ImageContent.make({
    type: "image",
    data: binary(imageBase64),
    mimeType: "image/png"
  })

const audio = (): McpSchema.AudioContent =>
  McpSchema.AudioContent.make({
    type: "audio",
    data: binary(audioBase64),
    mimeType: "audio/wav"
  })

const resourceBlock = (uri: string, body: string): McpSchema.EmbeddedResource =>
  McpSchema.EmbeddedResource.make({
    type: "resource",
    resource: McpSchema.TextResourceContents.make({
      uri,
      mimeType: "text/plain",
      text: body
    })
  })

const promptMessage = (content: McpSchema.ContentBlock): McpSchema.PromptMessage =>
  McpSchema.PromptMessage.make({ role: "user", content })

export const minimalStdioServerLayer = McpServer.tool({
  name: "echo",
  description: "Echo text after draft discovery has completed.",
  parameters: {
    value: Schema.String
  },
  content: ({ value }) => Effect.succeed(`echo:${value}`)
}).pipe(
  Layer.provide(StdioServerTransport.layer({
    name: "minimal-stdio-server",
    version: "1.0.0"
  }))
)

export const runMinimalStdioClient = (
  command: string,
  args: ReadonlyArray<string> = []
): Effect.Effect<void, unknown, unknown> =>
  Effect.scoped(
    Effect.gen(function*() {
      const protocol = yield* StdioClientTransport.makeCompatibilityProtocol({ command, args })
      const client = yield* McpClientApi.make(protocol, {
        clientInfo: { name: "minimal-stdio-client", version: "1.0.0" }
      })
      yield* client.discover()
      yield* client.listTools()
      yield* client.callTool({ name: "echo", arguments: { value: "hello" } })
    })
  )

export const streamableHttpServer = StreamableHttpServerTransport.toWebHandler(
  McpServer.tool({
    name: "health",
    description: "Return a streamable HTTP health marker.",
    content: () => Effect.succeed("ok")
  }),
  {
    name: "streamable-http-server",
    version: "1.0.0",
    path: endpoint,
    enableDnsRebindingProtection: true,
    allowedHosts: ["127.0.0.1", "localhost"],
    allowedOrigins: ["http://127.0.0.1:3000"],
    supportedProtocolVersions: [protocolVersion]
  }
)

export const runStreamableHttpClient = (
  url = "http://127.0.0.1:3000/mcp"
): Effect.Effect<void, unknown, unknown> =>
  Effect.scoped(
    Effect.gen(function*() {
      const raw = yield* HttpTransport.make({
        url,
        headers: { "MCP-Protocol-Version": protocolVersion }
      })
      const protocol = yield* McpClientProtocol.make(raw)
      const client = yield* McpClientApi.make(protocol, {
        clientInfo: { name: "streamable-http-client", version: "1.0.0" }
      })
      yield* client.discover()
      yield* client.callTool({ name: "health", arguments: {} })
    })
  )

export const toolKitchenSinkLayer = Layer.mergeAll(
  McpServer.tool({
    name: "no_args",
    description: "No-argument tool returning text content.",
    content: () => Effect.succeed("no args accepted")
  }),
  McpServer.tool({
    name: "validated_add",
    description: "Validated numeric input with structured output.",
    parameters: {
      left: Schema.Number,
      right: Schema.Number
    },
    content: ({ left, right }) =>
      Effect.succeed(new McpSchema.CallToolResult({
        resultType: "complete",
        content: [text(`${left} + ${right} = ${left + right}`)],
        structuredContent: { left, right, sum: left + right }
      }))
  }),
  McpServer.tool({
    name: "multimodal_result",
    description: "Return text, image, audio, and embedded resource content.",
    content: () =>
      Effect.succeed([
        text("multimodal response"),
        image(),
        audio(),
        resourceBlock("example://tool-kitchen-sink/note", "embedded note")
      ])
  }),
  McpServer.tool({
    name: "recoverable_tool_error",
    description: "Return an isError tool result instead of a protocol error.",
    content: () =>
      Effect.succeed(new McpSchema.CallToolResult({
        resultType: "complete",
        isError: true,
        content: [text("The request was valid, but the domain operation failed.")]
      }))
  })
)

export const resourceWorkspaceLayer = Layer.mergeAll(
  McpServer.resource({
    uri: "workspace://README.md",
    name: "README",
    description: "Text workspace resource.",
    mimeType: "text/markdown",
    content: Effect.succeed("# Workspace\n\nResource examples are visible to agents.")
  }),
  McpServer.resource({
    uri: "workspace://pixel.png",
    name: "Pixel",
    description: "Blob workspace resource.",
    mimeType: "image/png",
    content: Effect.succeed(binary(imageBase64))
  }),
  McpServer.resource`workspace://notes/${McpSchema.param("slug", Schema.String)}`({
    name: "Note by slug",
    description: "Templated resource with slug completion.",
    mimeType: "text/plain",
    completion: {
      slug: () => Effect.succeed(["alpha", "beta"])
    },
    content: (uri, slug) => Effect.succeed(`Resource ${uri} resolved slug=${slug}.`)
  })
)

export const resourceWorkspaceClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown, unknown> =>
  Effect.gen(function*() {
    yield* client.listResources()
    yield* client.listResourceTemplates()
    yield* client.subscriptionsListen({
      resourcesListChanged: true,
      resourceSubscriptions: ["workspace://README.md"]
    })
    yield* client.readResource({ uri: "workspace://README.md" })
    yield* client.readResource({ uri: "workspace://notes/alpha" })
  })

export const promptPackLayer = Layer.mergeAll(
  McpServer.prompt({
    name: "summarize_resource",
    description: "Prompt with arguments and embedded resource content.",
    parameters: {
      uri: Schema.String
    },
    content: ({ uri }) =>
      Effect.succeed([
        promptMessage(resourceBlock(uri, "resource body supplied by the server")),
        promptMessage(text("Summarize the embedded resource."))
      ])
  }),
  McpServer.prompt({
    name: "describe_image",
    description: "Prompt with multimodal image content.",
    content: () =>
      Effect.succeed([
        promptMessage(image()),
        promptMessage(text("Describe the image content."))
      ])
  })
)

export const completionLayer = Layer.mergeAll(
  McpServer.prompt({
    name: "write_release_note",
    description: "Prompt with context-aware argument completion.",
    parameters: {
      component: Schema.String
    },
    completion: {
      component: (input) =>
        Effect.succeed(["client", "server", "transport"].filter((value) => value.startsWith(input)))
    },
    content: ({ component }) => Effect.succeed(`Write release notes for ${component}.`)
  }),
  McpServer.resource`catalog://packages/${McpSchema.param("name", Schema.String)}`({
    name: "Package metadata",
    description: "Resource template with package name completion.",
    mimeType: "application/json",
    completion: {
      name: (input) =>
        Effect.succeed(["mcp-effect-sdk", "effect", "typescript"].filter((value) => value.startsWith(input)))
    },
    content: (uri, name) =>
      Effect.succeed({
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ name, selected: true })
        }]
      })
  })
)

export const runCompletionClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function*() {
    yield* client.complete({
      ref: { type: "ref/prompt", name: "write_release_note" },
      argument: { name: "component", value: "se" }
    })
    yield* client.complete({
      ref: { type: "ref/resource", uri: "catalog://packages/{name}" },
      argument: { name: "name", value: "mcp" }
    })
  })

export const loggingProgressCancellationLayer = McpServer.tool({
  name: "logged_progress",
  description: "Emit log and progress notifications during a tool call.",
  content: (_params, request) =>
    Effect.gen(function*() {
      yield* McpServer.sendLoggingMessage({
        level: "info",
        logger: "core-protocol-catalog",
        data: "starting logged_progress"
      })
      yield* McpServer.sendProgress({
        progressToken: request._meta?.progressToken ?? "core-progress",
        progress: 1,
        total: 2,
        message: "halfway"
      })
      yield* McpServer.sendProgress({
        progressToken: request._meta?.progressToken ?? "core-progress",
        progress: 2,
        total: 2,
        message: "done"
      })
      return "logged progress complete"
    })
})

export const runLoggingProgressCancellationClient = (
  client: McpClient.McpClient
): Effect.Effect<void, unknown, unknown> =>
  Effect.gen(function*() {
    yield* client.callTool({ name: "logged_progress", arguments: {} })
    yield* client.sendCancelled({
      requestId: "example-in-flight-request",
      reason: "client no longer needs the result"
    })
  })

class ExampleOAuthProvider {
  private tokenState: OAuthTokens | undefined
  private codeVerifierState = "verifier"
  readonly redirectUrl = "http://127.0.0.1:3000/callback"
  readonly clientMetadata = {
    client_name: "oauth-protected-example-client",
    redirect_uris: [this.redirectUrl],
    scope: "mcp:read mcp:call"
  }

  clientInformation(): OAuthClientInformationMixed {
    return { client_id: "oauth-protected-example-client" }
  }

  tokens(): OAuthTokens | undefined {
    return this.tokenState
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokenState = tokens
  }

  redirectToAuthorization(_authorizationUrl: URL): void {
    this.tokenState = {
      access_token: "example-token",
      token_type: "Bearer",
      scope: "mcp:read mcp:call"
    }
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierState = codeVerifier
  }

  codeVerifier(): string {
    return this.codeVerifierState
  }
}

export const runOAuthProtectedRemoteClient = (
  url = "https://mcp.example.test/mcp"
): Effect.Effect<void, unknown, never> =>
  Effect.scoped(
    Effect.gen(function*() {
      const raw = yield* HttpTransport.make({
        url,
        authProvider: new ExampleOAuthProvider()
      })
      const protocol = yield* McpClientProtocol.make(raw)
      const client = yield* McpClientApi.make(protocol, {
        clientInfo: { name: "oauth-protected-example-client", version: "1.0.0" }
      })
      yield* client.listTools()
    })
  )

export const coreProtocolExamples = {
  minimalStdioServerLayer,
  runMinimalStdioClient,
  streamableHttpServer,
  runStreamableHttpClient,
  toolKitchenSinkLayer,
  resourceWorkspaceLayer,
  resourceWorkspaceClient,
  promptPackLayer,
  completionLayer,
  runCompletionClient,
  loggingProgressCancellationLayer,
  runLoggingProgressCancellationClient,
  runOAuthProtectedRemoteClient
} as const
