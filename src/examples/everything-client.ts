#!/usr/bin/env node
import { Buffer } from "node:buffer"
import { Effect, Option, Redacted, Schema } from "effect"
import * as Auth from "../auth/client.js"
import * as McpClient from "../client.js"
import { StreamableHttpClientTransport } from "../transport/http.js"

const LOCAL_FIXTURE_ENDPOINT_POLICY = "allow-loopback-http" as const
const CALLBACK_URI = "http://localhost:3000/callback"
const CIMD_CLIENT_METADATA_URL = "https://conformance-test.local/client-metadata.json"
const emptyScopes = Schema.decodeUnknownSync(Auth.AuthorizationScopeSet)([])

type ScenarioHandler = (serverUrl: string) => Promise<void>
const scenarioHandlers: Record<string, ScenarioHandler> = {}

const registerScenario = (name: string, handler: ScenarioHandler): void => {
  scenarioHandlers[name] = handler
}

const registerScenarios = (names: ReadonlyArray<string>, handler: ScenarioHandler): void => {
  for (const name of names) registerScenario(name, handler)
}

const parseContext = (): Record<string, string> => {
  const raw = process.env.MCP_CONFORMANCE_CONTEXT
  return raw === undefined ? {} : JSON.parse(raw) as Record<string, string>
}

type StoreOperation = ConstructorParameters<typeof Auth.AuthorizationStoreError>[0]["operation"]

const failStore = (operation: StoreOperation) =>
  Effect.fail(new Auth.AuthorizationStoreError({ operation, reason: "NotFound" }))

const sameScopes = (left: Auth.AuthorizationScopeSet, right: Auth.AuthorizationScopeSet): boolean =>
  left.length === right.length && left.every((scope, index) => scope === right[index])

const makeMemoryStore = (): Auth.AuthorizationClientStoreService => {
  let nextHandle = 0
  const credentials = new Map<Auth.AuthorizationCredentialHandle, Auth.StoredAuthorizationCredential>()
  const grants = new Map<Auth.AuthorizationGrantHandle, Auth.StoredAuthorizationGrant>()
  const transactions = new Map<Auth.AuthorizationTransactionHandle, Auth.StoredAuthorizationTransaction>()
  const credentialHandle = (): Auth.AuthorizationCredentialHandle =>
    Schema.decodeUnknownSync(Auth.AuthorizationCredentialHandle)(`credential-${++nextHandle}`)
  const grantHandle = (): Auth.AuthorizationGrantHandle =>
    Schema.decodeUnknownSync(Auth.AuthorizationGrantHandle)(`grant-${++nextHandle}`)
  const transactionHandle = (): Auth.AuthorizationTransactionHandle =>
    Schema.decodeUnknownSync(Auth.AuthorizationTransactionHandle)(`transaction-${++nextHandle}`)

  return {
    findCredential: (key) => Effect.sync(() => {
      for (const [candidate, credential] of credentials) {
        if (credential.issuer === key.issuer &&
          (key.clientId === undefined || credential.clientId === key.clientId)) return Option.some(candidate)
      }
      return Option.none()
    }),
    saveCredential: (credential) => Effect.sync(() => {
      const saved = credentialHandle()
      credentials.set(saved, credential)
      return saved
    }),
    readCredential: (saved) => credentials.has(saved)
      ? Effect.succeed(credentials.get(saved)!)
      : failStore("readCredential"),
    findGrant: (key) => Effect.sync(() => {
      for (const [candidate, grant] of grants) {
        if (grant.issuer === key.issuer && grant.resource === key.resource &&
          grant.clientId === key.clientId && sameScopes(grant.scopes, key.scopes)) return Option.some(candidate)
      }
      return Option.none()
    }),
    saveGrant: (grant) => Effect.sync(() => {
      const saved = grantHandle()
      grants.set(saved, grant)
      return saved
    }),
    readGrant: (saved) => grants.has(saved)
      ? Effect.succeed(grants.get(saved)!)
      : failStore("readGrant"),
    removeGrant: (saved) => Effect.sync(() => { grants.delete(saved) }),
    saveTransaction: (transaction) => Effect.sync(() => {
      const saved = transactionHandle()
      transactions.set(saved, transaction)
      return saved
    }),
    takeTransaction: (saved) => {
      const transaction = transactions.get(saved)
      if (transaction === undefined) return failStore("takeTransaction")
      return Effect.sync(() => {
        transactions.delete(saved)
        return transaction
      })
    }
  }
}

const webAuthorizationHttpClient: Auth.AuthorizationHttpClientService = {
  request: (request) => Effect.tryPromise({
    try: async () => {
      const headers = new Headers()
      for (const [name, value] of request.headers) headers.append(name, Redacted.value(value))
      const response = await fetch(request.url, {
        method: request.method,
        headers,
        redirect: "manual",
        ...(request.body === undefined
          ? {}
          : { body: Buffer.from(Redacted.value(request.body)) })
      })
      return {
        status: response.status,
        headers: Object.freeze([...response.headers.entries()].map(
          ([name, value]) => Object.freeze([name, Redacted.make(value)] as const)
        )),
        body: Redacted.make(new Uint8Array(await response.arrayBuffer()))
      }
    },
    catch: () => new Auth.AuthorizationHttpError({
      operation: "request",
      retryable: false
    })
  })
}

const webAuthorizationCrypto: Auth.AuthorizationCryptoService = {
  randomBytes: (length) => Effect.try({
    try: () => crypto.getRandomValues(new Uint8Array(length)),
    catch: () => new Auth.AuthorizationCryptoError({ operation: "randomBytes", reason: "Failed" })
  }),
  sha256: (value) => Effect.tryPromise({
    try: async () => new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer)),
    catch: () => new Auth.AuthorizationCryptoError({ operation: "sha256", reason: "Failed" })
  }),
  sign: () => Effect.fail(new Auth.AuthorizationCryptoError({ operation: "sign", reason: "Unavailable" }))
}

const makeFixtureInteraction = (): Auth.AuthorizationInteractionService => {
  let callback: string | undefined
  return {
    open: (request) => Effect.tryPromise({
      try: async () => {
        const response = await fetch(Redacted.value(request.authorizationUri), { redirect: "manual" })
        const location = response.headers.get("location")
        if (location === null) throw new Error("authorization redirect missing")
        callback = location
      },
      catch: () => new Auth.AuthorizationInteractionError({ operation: "open", reason: "Failed" })
    }),
    waitForCallback: (request) => Effect.try({
      try: () => {
        if (callback === undefined) throw new Error("authorization callback missing")
        const received = new URL(callback)
        return new Auth.AuthorizationCallbackInput({
          transaction: request.transaction,
          redirectUri: `${received.origin}${received.pathname}`,
          parameters: Redacted.make(received.search.slice(1))
        })
      },
      catch: () => new Auth.AuthorizationInteractionError({
        operation: "waitForCallback",
        reason: "Failed"
      })
    })
  }
}

const makeAuthorization = async (
  serverUrl: string,
  options: {
    readonly name: string
    readonly clientIdMetadataDocument?: string
    readonly preRegisteredCredentials?: ReadonlyArray<Auth.PreRegisteredAuthorizationCredential>
  }
) => {
  const store = makeMemoryStore()
  const client = await Effect.runPromise(Auth.makeAuthorizationClient({
    protectedResource: serverUrl,
    requestedScopes: emptyScopes,
    redirectUri: CALLBACK_URI,
    endpointPolicy: LOCAL_FIXTURE_ENDPOINT_POLICY,
    registration: {
      clientName: options.name,
      redirectUris: [CALLBACK_URI],
      preRegisteredCredentials: options.preRegisteredCredentials ?? [],
      ...(options.clientIdMetadataDocument === undefined
        ? {}
        : { clientIdMetadataDocument: options.clientIdMetadataDocument })
    },
    validateAudience: (input) => Effect.succeed([input.resource])
  }).pipe(
    Effect.provideService(Auth.AuthorizationHttpClient, webAuthorizationHttpClient),
    Effect.provideService(Auth.AuthorizationCrypto, webAuthorizationCrypto),
    Effect.provideService(Auth.AuthorizationInteraction, makeFixtureInteraction()),
    Effect.provideService(Auth.AuthorizationClientStore, store)
  ))
  return { client, store }
}

const withClient = async (
  serverUrl: string,
  options: {
    readonly name: string
    readonly authorization?: Awaited<ReturnType<typeof makeAuthorization>>
    readonly inputRequired?: McpClient.AutomaticInputRequiredPolicy
  },
  run: (client: McpClient.McpClient) => Effect.Effect<void, unknown>
): Promise<void> => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* StreamableHttpClientTransport.make({
      url: serverUrl,
      ...(options.authorization === undefined ? {} : {
        authorization: {
          client: options.authorization.client,
          store: options.authorization.store,
          protectedResource: serverUrl,
          requestedScopes: emptyScopes
        }
      })
    })
    const client = yield* McpClient.make({
      transport,
      clientInfo: { name: options.name, version: "1.0.0" },
      ...(options.inputRequired === undefined ? {} : { inputRequired: options.inputRequired })
    })
    yield* run(client)
  })))
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const runBasicClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  { name: "test-client" },
  (client) => client.listTools().pipe(Effect.asVoid)
)

const runToolsCallClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  { name: "test-client" },
  (client) => Effect.gen(function*() {
    const tools = yield* client.listTools()
    assert(tools.tools.length > 0, "tools/list returned a non-empty tool set")
    const result = yield* client.callTool({ name: "add_numbers", arguments: { a: 2, b: 3 } })
    assert(result.content.length > 0, "tools/call returned non-empty content")
  })
)

const runRequestMetadataClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  {
    name: "request-metadata-client",
    inputRequired: McpClient.InputRequiredPolicy.automatic({
      roots: { list: Effect.succeed({ roots: [] }) },
      sampling: {
        handle: () => Effect.succeed({
          role: "assistant",
          content: { type: "text", text: "sample" },
          model: "conformance-client",
          stopReason: "endTurn"
        })
      },
      elicitation: {
        form: () => Effect.succeed({ action: "accept", content: {} })
      }
    })
  },
  () => Effect.void
)

const runStandardHeadersClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  { name: "standard-headers-client" },
  (client) => Effect.gen(function*() {
    yield* client.listTools()
    yield* client.callTool({ name: "test_headers", arguments: {} })
    yield* client.listResources()
    yield* client.readResource({ uri: "file:///path/to/file%20name.txt" })
    yield* client.listPrompts()
    yield* client.getPrompt({ name: "test_prompt" })
  })
)

const runCustomHeadersClient = (serverUrl: string): Promise<void> => {
  const context = parseContext() as {
    readonly toolCalls?: ReadonlyArray<{
      readonly name: string
      readonly arguments: Record<string, unknown>
    }>
  }
  return withClient(serverUrl, { name: "custom-headers-client" }, (client) =>
    Effect.gen(function*() {
      yield* client.listTools()
      for (const call of context.toolCalls ?? []) yield* client.callTool(call)
    }))
}

const runInvalidToolHeadersClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  { name: "invalid-tool-headers-client" },
  (client) => Effect.gen(function*() {
    yield* client.listTools()
    yield* client.callTool({ name: "valid_tool", arguments: { region: "us-west1" } })
  })
)

const runJsonSchemaRefClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  { name: "json-schema-ref-client" },
  (client) => client.listTools().pipe(Effect.asVoid)
)

const runInputRequiredClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  {
    name: "input-required-client",
    inputRequired: McpClient.InputRequiredPolicy.automatic({
      elicitation: {
        form: () => Effect.succeed({ resultType: "complete", action: "accept", content: { confirmed: true } })
      }
    })
  },
  (client) => Effect.gen(function*() {
    yield* Effect.all([
      client.callTool({ name: "test_mrtr_echo_state", arguments: {} }),
      client.callTool({ name: "test_mrtr_unrelated", arguments: {} })
    ], { concurrency: "unbounded" })
    yield* client.callTool({ name: "test_mrtr_no_state", arguments: {} })
    yield* client.callTool({ name: "test_mrtr_no_result_type", arguments: {} })
  })
)

const runDraftE2eClient = (serverUrl: string): Promise<void> => withClient(
  serverUrl,
  { name: "draft-e2e-client" },
  (client) => Effect.gen(function*() {
    yield* client.discover()
    assert((yield* client.listTools()).tools.length > 0, "tools/list returned results")
    assert((yield* client.callTool({ name: "test_simple_text", arguments: {} })).content.length > 0,
      "tools/call returned content")
    assert((yield* client.listResources()).resources.length > 0, "resources/list returned results")
    assert((yield* client.readResource({ uri: "test://static-text" })).contents.length > 0,
      "resources/read returned content")
    assert((yield* client.listPrompts()).prompts.length > 0, "prompts/list returned results")
    assert((yield* client.getPrompt({ name: "test_simple_prompt" })).messages.length > 0,
      "prompts/get returned content")
  })
)

const runAuthClient = async (serverUrl: string): Promise<void> => {
  const authorization = await makeAuthorization(serverUrl, {
    name: "test-auth-client",
    clientIdMetadataDocument: CIMD_CLIENT_METADATA_URL
  })
  await withClient(serverUrl, { name: "test-auth-client", authorization }, (client) =>
    Effect.gen(function*() {
      yield* client.listTools()
      yield* client.callTool({ name: "test-tool", arguments: {} })
    }))
}

const discoverFixtureIssuer = async (serverUrl: string): Promise<string> => {
  const resource = new URL(serverUrl)
  const candidates = [
    `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`,
    `${resource.origin}/.well-known/oauth-protected-resource`
  ]
  for (const candidate of candidates) {
    const response = await fetch(candidate)
    if (response.status === 404) continue
    const metadata = await response.json() as { authorization_servers?: ReadonlyArray<string> }
    const issuer = metadata.authorization_servers?.[0]
    if (typeof issuer === "string") return issuer
  }
  throw new Error("protected-resource metadata did not advertise an issuer")
}

const runPreRegistrationClient = async (serverUrl: string): Promise<void> => {
  const context = parseContext()
  const issuer = await discoverFixtureIssuer(serverUrl)
  const authorization = await makeAuthorization(serverUrl, {
    name: "conformance-pre-registration",
    preRegisteredCredentials: [{
      issuer,
      clientId: context.client_id ?? "",
      tokenEndpointAuthMethod: "client_secret_basic",
      clientSecret: Redacted.make(context.client_secret ?? "")
    }]
  })
  await withClient(serverUrl, { name: "conformance-pre-registration", authorization }, (client) =>
    client.listTools().pipe(Effect.asVoid))
}

registerScenario("discover", runBasicClient)
registerScenario("tools_call", runToolsCallClient)
registerScenario("draft_e2e", runDraftE2eClient)
registerScenario("request-metadata", runRequestMetadataClient)
registerScenario("sep-2322-client-request-state", runInputRequiredClient)
registerScenario("http-standard-headers", runStandardHeadersClient)
registerScenario("http-custom-headers", runCustomHeadersClient)
registerScenario("http-invalid-tool-headers", runInvalidToolHeadersClient)
registerScenario("json-schema-ref-no-deref", runJsonSchemaRefClient)
registerScenario("auth/pre-registration", runPreRegistrationClient)
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
  "auth/resource-mismatch",
  "auth/offline-access-scope",
  "auth/offline-access-not-supported",
  "auth/authorization-server-migration",
  "auth/iss-supported",
  "auth/iss-not-advertised",
  "auth/iss-supported-missing",
  "auth/iss-wrong-issuer",
  "auth/iss-unexpected",
  "auth/iss-normalized",
  "auth/metadata-issuer-mismatch"
], runAuthClient)

const scenarioName = process.env.MCP_CONFORMANCE_SCENARIO
const serverUrl = process.argv[2]
if (scenarioName === undefined || serverUrl === undefined) {
  console.error("Usage: MCP_CONFORMANCE_SCENARIO=<scenario> everything-client <server-url>")
  process.exit(1)
}
const handler = scenarioHandlers[scenarioName]
if (handler === undefined) {
  console.error(`Unknown scenario: ${scenarioName}`)
  process.exit(1)
}
try {
  await handler(serverUrl)
} catch (error) {
  console.error(error)
  process.exit(1)
}
