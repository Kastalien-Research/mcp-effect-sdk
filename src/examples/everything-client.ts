#!/usr/bin/env node
import { Effect } from "effect"
import * as McpClient from "../McpClient.js"
import * as McpClientProtocol from "../McpClientProtocol.js"
import * as StreamableHttpClientTransport from "../transport/StreamableHttpClientTransport.js"
import {
  auth,
  extractWWWAuthenticateParams,
  UnauthorizedError,
  type FetchLike,
  type Middleware,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens
} from "../auth/auth.js"
import {
  ClientCredentialsProvider,
  CrossAppAccessProvider,
  PrivateKeyJwtProvider,
  requestJwtAuthorizationGrant
} from "../auth/providers.js"

const CIMD_CLIENT_METADATA_URL = "https://conformance-test.local/client-metadata.json"

type ScenarioHandler = (serverUrl: string) => Promise<void>
const scenarioHandlers: Record<string, ScenarioHandler> = {}

function registerScenario(name: string, handler: ScenarioHandler): void {
  scenarioHandlers[name] = handler
}

function registerScenarios(names: ReadonlyArray<string>, handler: ScenarioHandler): void {
  for (const name of names) {
    registerScenario(name, handler)
  }
}

class ConformanceOAuthProvider implements OAuthClientProvider {
  private clientInformationState: OAuthClientInformationMixed | undefined
  private tokensState: OAuthTokens | undefined
  private codeVerifierState: string | undefined
  private authCodeState: string | undefined

  constructor(
    private readonly redirectUrlState: string | URL,
    private readonly clientMetadataState: OAuthClientMetadata,
    private readonly clientMetadataUrlState?: string | URL | undefined
  ) {}

  get redirectUrl(): string | URL {
    return this.redirectUrlState
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.clientMetadataState
  }

  get clientMetadataUrl(): string | undefined {
    return this.clientMetadataUrlState?.toString()
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInformationState
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.clientInformationState = clientInformation
  }

  tokens(): OAuthTokens | undefined {
    return this.tokensState
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokensState = tokens
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const response = await fetch(authorizationUrl, { redirect: "manual" })
    const location = response.headers.get("location")
    if (!location) {
      throw new Error(`No redirect location received from ${authorizationUrl}`)
    }
    const code = new URL(location).searchParams.get("code")
    if (!code) {
      throw new Error("No authorization code in redirect URL")
    }
    this.authCodeState = code
  }

  getAuthCode(): string {
    if (!this.authCodeState) {
      throw new Error("No authorization code")
    }
    return this.authCodeState
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierState = codeVerifier
  }

  codeVerifier(): string {
    if (!this.codeVerifierState) {
      throw new Error("No code verifier saved")
    }
    return this.codeVerifierState
  }
}

const handle401 = async (
  response: Response,
  provider: ConformanceOAuthProvider,
  next: FetchLike,
  serverUrl: string | URL
): Promise<void> => {
  const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response)
  const result = await auth(provider, {
    serverUrl,
    resourceMetadataUrl,
    scope,
    fetchFn: next
  })
  if (result === "REDIRECT") {
    await auth(provider, {
      serverUrl,
      resourceMetadataUrl,
      scope,
      authorizationCode: provider.getAuthCode(),
      fetchFn: next
    })
  }
}

const withOAuthRetry = (
  clientName: string,
  baseUrl?: string | URL,
  handle401Fn: typeof handle401 = handle401,
  clientMetadataUrl?: string,
  existingProvider?: ConformanceOAuthProvider
): Middleware => {
  const provider = existingProvider ??
    new ConformanceOAuthProvider(
      "http://localhost:3000/callback",
      {
        client_name: clientName,
        redirect_uris: ["http://localhost:3000/callback"]
      },
      clientMetadataUrl
    )
  return (next: FetchLike) => async (input: string | URL, init?: RequestInit) => {
    const request = async (): Promise<Response> => {
      const headers = new Headers(init?.headers)
      const tokens = await provider.tokens()
      if (tokens) {
        headers.set("Authorization", `Bearer ${tokens.access_token}`)
      }
      return next(input, { ...init, headers })
    }

    let response = await request()
    if (response.status === 401 || response.status === 403) {
      const serverUrl = baseUrl ?? (typeof input === "string" ? new URL(input).origin : input.origin)
      await handle401Fn(response, provider, next, serverUrl)
      response = await request()
    }
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedError(`Authentication failed for ${String(input)}`)
    }
    return response
  }
}

function parseContext(): Record<string, string> {
  const raw = process.env.MCP_CONFORMANCE_CONTEXT
  if (!raw) {
    throw new Error("MCP_CONFORMANCE_CONTEXT not set")
  }
  return JSON.parse(raw) as Record<string, string>
}

async function withClient(
  serverUrl: string,
  options: {
    readonly name: string
    readonly authProvider?: OAuthClientProvider | undefined
    readonly fetch?: FetchLike | undefined
  },
  run: (client: McpClient.McpClient) => Effect.Effect<void, unknown>
): Promise<void> {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const raw = yield* StreamableHttpClientTransport.make({
          url: serverUrl,
          authProvider: options.authProvider,
          fetch: options.fetch
        })
        const protocol = yield* McpClientProtocol.make(raw)
        const client = yield* McpClient.make(protocol, {
          clientInfo: { name: options.name, version: "1.0.0" }
        })
        yield* run(client)
      })
    )
  )
}

async function runBasicClient(serverUrl: string): Promise<void> {
  await withClient(
    serverUrl,
    { name: "test-client" },
    (client) => client.listTools().pipe(Effect.asVoid)
  )
}

async function runToolsCallClient(serverUrl: string): Promise<void> {
  await withClient(
    serverUrl,
    { name: "test-client" },
    (client) =>
      Effect.gen(function*() {
        yield* client.listTools()
        yield* client.callTool({ name: "add_numbers", arguments: { a: 5, b: 3 } })
      })
  )
}

async function runAuthClient(serverUrl: string): Promise<void> {
  const oauthFetch = withOAuthRetry(
    "test-auth-client",
    new URL(serverUrl),
    handle401,
    CIMD_CLIENT_METADATA_URL
  )(fetch)
  await withClient(
    serverUrl,
    { name: "test-auth-client", fetch: oauthFetch },
    (client) =>
      Effect.gen(function*() {
        yield* client.listTools()
        yield* client.callTool({ name: "test-tool", arguments: {} })
      })
  )
}

async function runClientCredentialsJwt(serverUrl: string): Promise<void> {
  const ctx = parseContext()
  const provider = new PrivateKeyJwtProvider({
    clientId: ctx.client_id ?? "",
    privateKey: ctx.private_key_pem ?? "",
    algorithm: ctx.signing_algorithm ?? "ES256"
  })
  await withClient(
    serverUrl,
    { name: "conformance-client-credentials-jwt", authProvider: provider },
    (client) => client.listTools().pipe(Effect.asVoid)
  )
}

async function runClientCredentialsBasic(serverUrl: string): Promise<void> {
  const ctx = parseContext()
  const provider = new ClientCredentialsProvider({
    clientId: ctx.client_id ?? "",
    clientSecret: ctx.client_secret ?? ""
  })
  await withClient(
    serverUrl,
    { name: "conformance-client-credentials-basic", authProvider: provider },
    (client) => client.listTools().pipe(Effect.asVoid)
  )
}

async function runPreRegistrationClient(serverUrl: string): Promise<void> {
  const ctx = parseContext()
  const provider = new ConformanceOAuthProvider(
    "http://localhost:3000/callback",
    {
      client_name: "conformance-pre-registration",
      redirect_uris: ["http://localhost:3000/callback"]
    }
  )
  provider.saveClientInformation({
    client_id: ctx.client_id ?? "",
    client_secret: ctx.client_secret ?? "",
    redirect_uris: ["http://localhost:3000/callback"]
  })
  const oauthFetch = withOAuthRetry(
    "conformance-pre-registration",
    new URL(serverUrl),
    handle401,
    undefined,
    provider
  )(fetch)
  await withClient(
    serverUrl,
    { name: "conformance-pre-registration", fetch: oauthFetch },
    (client) =>
      Effect.gen(function*() {
        yield* client.listTools()
        yield* client.callTool({ name: "test-tool", arguments: {} })
      })
  )
}

async function runCrossAppAccessCompleteFlow(serverUrl: string): Promise<void> {
  const ctx = parseContext()
  const provider = new CrossAppAccessProvider({
    clientId: ctx.client_id ?? "",
    clientSecret: ctx.client_secret ?? "",
    assertion: async (authCtx) => {
      const result = await requestJwtAuthorizationGrant({
        tokenEndpoint: ctx.idp_token_endpoint ?? "",
        audience: authCtx.authorizationServerUrl,
        resource: authCtx.resourceUrl,
        idToken: ctx.idp_id_token ?? "",
        clientId: ctx.idp_client_id ?? "",
        fetchFn: authCtx.fetchFn
      })
      return result.jwtAuthGrant
    }
  })
  await withClient(
    serverUrl,
    { name: "conformance-cross-app-access", authProvider: provider },
    (client) => client.listTools().pipe(Effect.asVoid)
  )
}

registerScenario("initialize", runBasicClient)
registerScenario("tools_call", runToolsCallClient)
registerScenario("auth/client-credentials-jwt", runClientCredentialsJwt)
registerScenario("auth/client-credentials-basic", runClientCredentialsBasic)
registerScenario("auth/pre-registration", runPreRegistrationClient)
registerScenario("auth/cross-app-access-complete-flow", runCrossAppAccessCompleteFlow)
registerScenarios([
  "auth/basic-cimd",
  "auth/metadata-default",
  "auth/metadata-var1",
  "auth/metadata-var2",
  "auth/metadata-var3",
  "auth/2025-03-26-oauth-metadata-backcompat",
  "auth/2025-03-26-oauth-endpoint-fallback",
  "auth/scope-from-www-authenticate",
  "auth/scope-from-scopes-supported",
  "auth/scope-omitted-when-undefined",
  "auth/scope-step-up",
  "auth/scope-retry-limit",
  "auth/token-endpoint-auth-basic",
  "auth/token-endpoint-auth-post",
  "auth/token-endpoint-auth-none",
  "auth/resource-mismatch"
], runAuthClient)

const scenarioName = process.env.MCP_CONFORMANCE_SCENARIO
const serverUrl = process.argv[2]

if (!scenarioName || !serverUrl) {
  console.error("Usage: MCP_CONFORMANCE_SCENARIO=<scenario> everything-client <server-url>")
  process.exit(1)
}

const handler = scenarioHandlers[scenarioName]
if (!handler) {
  console.error(`Unknown scenario: ${scenarioName}`)
  process.exit(1)
}

try {
  await handler(serverUrl)
} catch (error) {
  console.error(error)
  process.exit(1)
}
