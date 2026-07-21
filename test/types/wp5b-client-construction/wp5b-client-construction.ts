import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as McpClient from "../../../src/McpClient.js"
import type { McpClientError } from "../../../src/McpClientError.js"
import type { McpTransport } from "../../../src/McpTransport.js"

class Profile extends Context.Tag("wp5b/Profile")<
  Profile,
  { readonly name: string }
>() {}

declare const transport: McpTransport<Error>

const construction: Effect.Effect<
  McpClient.McpClient,
  McpClientError,
  Scope.Scope | Profile
> = McpClient.make({
  transport,
  clientInfo: {
    name: "typed-wp5b-client",
    title: "Typed WP5B client",
    version: "5.0.0"
  },
  capabilities: (context) => Effect.map(Profile, (profile) => ({
    experimental: {
      "com.example/profile": {
        name: profile.name,
        requestId: context.id,
        method: context.method
      }
    }
  })),
  extensions: (context) => Effect.map(Profile, (profile) => ({
    "com.example/profile": {
      name: profile.name,
      requestId: context.id,
      method: context.method
    }
  }))
})

declare const client: McpClient.McpClient
const methodHasNoProviderRequirements: Effect.Effect<
  unknown,
  McpClientError,
  never
> = client.listTools()

const optionalIdentity: Effect.Effect<
  McpClient.McpClient,
  McpClientError,
  Scope.Scope
> = McpClient.make({ transport })

// @ts-expect-error positional client construction is removed
McpClient.make(transport, { clientInfo: { name: "legacy", version: "1" } })

// @ts-expect-error client identity requires an exact Implementation
McpClient.make({ transport, clientInfo: { name: "missing-version" } })

McpClient.make({
  transport,
  // @ts-expect-error the dedicated extension provider exclusively owns extensions
  capabilities: () => Effect.succeed({ extensions: { "com.example/ambiguous": {} } })
})

void construction
void methodHasNoProviderRequirements
void optionalIdentity
