import { createHash, createSign, randomBytes } from "node:crypto"

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
export type Middleware = (next: FetchLike) => FetchLike

export interface OAuthProtectedResourceMetadata {
  readonly resource: string
  readonly authorization_servers?: ReadonlyArray<string> | undefined
  readonly scopes_supported?: ReadonlyArray<string> | undefined
  readonly bearer_methods_supported?: ReadonlyArray<string> | undefined
}

export interface OAuthMetadata {
  readonly issuer: string
  readonly authorization_endpoint?: string | undefined
  readonly token_endpoint: string
  readonly registration_endpoint?: string | undefined
  readonly scopes_supported?: ReadonlyArray<string> | undefined
  readonly response_types_supported?: ReadonlyArray<string> | undefined
  readonly grant_types_supported?: ReadonlyArray<string> | undefined
  readonly token_endpoint_auth_methods_supported?: ReadonlyArray<string> | undefined
  readonly client_id_metadata_document_supported?: boolean | undefined
  readonly authorization_response_iss_parameter_supported?: boolean | undefined
}

export interface OAuthClientMetadata {
  readonly redirect_uris: ReadonlyArray<string>
  readonly application_type?: "web" | "native" | undefined
  readonly token_endpoint_auth_method?: string | undefined
  readonly grant_types?: ReadonlyArray<string> | undefined
  readonly response_types?: ReadonlyArray<string> | undefined
  readonly client_name?: string | undefined
  readonly scope?: string | undefined
  readonly client_uri?: string | undefined
  readonly logo_uri?: string | undefined
  readonly contacts?: ReadonlyArray<string> | undefined
  readonly tos_uri?: string | undefined
  readonly policy_uri?: string | undefined
  readonly jwks_uri?: string | undefined
  readonly jwks?: unknown
}

export interface OAuthClientInformation {
  readonly client_id: string
  readonly issuer?: string | undefined
  readonly client_secret?: string | undefined
  readonly client_id_issued_at?: number | undefined
  readonly client_secret_expires_at?: number | undefined
}

export type OAuthClientInformationFull = OAuthClientInformation & OAuthClientMetadata
export type OAuthClientInformationMixed = OAuthClientInformation | OAuthClientInformationFull
export type ClientAuthMethod = "client_secret_basic" | "client_secret_post" | "none"

export interface OAuthTokens {
  readonly access_token: string
  readonly token_type: string
  readonly expires_in?: number | undefined
  readonly scope?: string | undefined
  readonly refresh_token?: string | undefined
  readonly id_token?: string | undefined
}

export interface OAuthDiscoveryState {
  readonly authorizationServerUrl: string
  readonly resourceMetadataUrl?: string | undefined
  readonly resourceMetadata?: OAuthProtectedResourceMetadata | undefined
  readonly authorizationServerMetadata?: OAuthMetadata | undefined
}

export type AddClientAuthentication = (
  headers: Headers,
  params: URLSearchParams,
  url: string | URL,
  metadata?: OAuthMetadata
) => void | Promise<void>

export interface OAuthClientProvider {
  readonly redirectUrl: string | URL | undefined
  readonly clientMetadataUrl?: string | undefined
  readonly clientMetadata: OAuthClientMetadata
  readonly state?: () => string | Promise<string>
  readonly clientInformation: () =>
    OAuthClientInformationMixed | undefined | Promise<OAuthClientInformationMixed | undefined>
  readonly saveClientInformation?: (
    clientInformation: OAuthClientInformationMixed
  ) => void | Promise<void>
  readonly tokens: () => OAuthTokens | undefined | Promise<OAuthTokens | undefined>
  readonly saveTokens: (tokens: OAuthTokens) => void | Promise<void>
  readonly redirectToAuthorization: (authorizationUrl: URL) => void | Promise<void>
  readonly saveCodeVerifier: (codeVerifier: string) => void | Promise<void>
  readonly codeVerifier: () => string | Promise<string>
  readonly addClientAuthentication?: AddClientAuthentication
  readonly validateResourceURL?: (
    serverUrl: string | URL,
    resource?: string
  ) => Promise<URL | undefined>
  readonly invalidateCredentials?: (
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ) => void | Promise<void>
  readonly prepareTokenRequest?: (scope?: string) =>
    URLSearchParams | Promise<URLSearchParams | undefined> | undefined
  readonly saveAuthorizationServerUrl?: (authorizationServerUrl: string) => void | Promise<void>
  readonly authorizationServerUrl?: () => string | undefined | Promise<string | undefined>
  readonly saveResourceUrl?: (resourceUrl: string) => void | Promise<void>
  readonly resourceUrl?: () => string | undefined | Promise<string | undefined>
  readonly saveDiscoveryState?: (state: OAuthDiscoveryState) => void | Promise<void>
  readonly discoveryState?: () =>
    OAuthDiscoveryState | undefined | Promise<OAuthDiscoveryState | undefined>
}

export type AuthResult = "AUTHORIZED" | "REDIRECT"

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message)
    this.name = "UnauthorizedError"
  }
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly errorUri?: string | undefined
  ) {
    super(message)
    this.name = "OAuthError"
  }
}

const AUTHORIZATION_CODE_CHALLENGE_METHOD = "S256"

const isClientAuthMethod = (method: string): method is ClientAuthMethod =>
  method === "client_secret_basic" || method === "client_secret_post" || method === "none"

export const selectClientAuthMethod = (
  clientInformation: OAuthClientInformationMixed,
  supportedMethods: ReadonlyArray<string>
): ClientAuthMethod => {
  const registeredMethod =
    "token_endpoint_auth_method" in clientInformation
      ? clientInformation.token_endpoint_auth_method
      : undefined
  if (
    registeredMethod &&
    isClientAuthMethod(registeredMethod) &&
    (supportedMethods.length === 0 || supportedMethods.includes(registeredMethod))
  ) {
    return registeredMethod
  }

  const hasClientSecret = clientInformation.client_secret !== undefined
  if (supportedMethods.length === 0) {
    return hasClientSecret ? "client_secret_basic" : "none"
  }
  if (hasClientSecret && supportedMethods.includes("client_secret_basic")) {
    return "client_secret_basic"
  }
  if (hasClientSecret && supportedMethods.includes("client_secret_post")) {
    return "client_secret_post"
  }
  if (supportedMethods.includes("none")) {
    return "none"
  }
  return hasClientSecret ? "client_secret_post" : "none"
}

export const resourceUrlFromServerUrl = (url: URL | string): URL => {
  const resourceURL = typeof url === "string" ? new URL(url) : new URL(url.href)
  resourceURL.hash = ""
  return resourceURL
}

export const checkResourceAllowed = (options: {
  readonly requestedResource: URL | string
  readonly configuredResource: URL | string
}): boolean => {
  const requested = new URL(String(options.requestedResource))
  const configured = new URL(String(options.configuredResource))
  if (requested.origin !== configured.origin) {
    return false
  }
  const requestedPath = requested.pathname.endsWith("/")
    ? requested.pathname
    : `${requested.pathname}/`
  const configuredPath = configured.pathname.endsWith("/")
    ? configured.pathname
    : `${configured.pathname}/`
  return requestedPath.startsWith(configuredPath)
}

export const extractWWWAuthenticateParams = (response: Response): {
  readonly resourceMetadataUrl?: URL | undefined
  readonly scope?: string | undefined
} => {
  const header =
    response.headers.get("WWW-Authenticate") ?? response.headers.get("www-authenticate")
  if (!header) {
    return {}
  }
  const params = new Map<string, string>()
  for (const part of header.split(",")) {
    const [key, ...rest] = part.trim().replace(/^Bearer\s+/i, "").split("=")
    if (!key || rest.length === 0) {
      continue
    }
    params.set(key, rest.join("=").replace(/^"|"$/g, ""))
  }
  const resource = params.get("resource_metadata") ?? params.get("resource")
  return {
    resourceMetadataUrl: resource ? new URL(resource) : undefined,
    scope: params.get("scope")
  }
}

export const auth = async (
  provider: OAuthClientProvider,
  options: {
    readonly serverUrl: string | URL
    readonly authorizationCode?: string | undefined
    readonly authorizationIssuer?: string | undefined
    readonly scope?: string | undefined
    readonly resourceMetadataUrl?: URL | undefined
    readonly fetchFn?: FetchLike | undefined
  }
): Promise<AuthResult> => {
  const fetchFn = options.fetchFn ?? fetch
  const discovery = await discoverOAuthServerInfo(options.serverUrl, {
    resourceMetadataUrl: options.resourceMetadataUrl,
    fetchFn
  })
  await provider.saveDiscoveryState?.(discovery)
  await provider.saveAuthorizationServerUrl?.(discovery.authorizationServerUrl)

  const resource = await selectResourceURL(options.serverUrl, provider, discovery.resourceMetadata)
  if (resource) {
    await provider.saveResourceUrl?.(resource.href)
  }

  let clientInformation = await provider.clientInformation()
  const issuer = discovery.authorizationServerMetadata.issuer
  if (clientInformation && isBoundToDifferentIssuer(clientInformation, issuer)) {
    await provider.invalidateCredentials?.("client")
    clientInformation = undefined
  }

  const scope = await resolvedScope(options.scope, discovery.resourceMetadata, provider)
  if (!clientInformation) {
    clientInformation = await registerOrUseMetadataUrl(
      provider,
      discovery,
      fetchFn,
      scope
    )
  }

  if (!options.authorizationCode && provider.redirectUrl) {
    const verifier = base64Url(randomBytes(32))
    await provider.saveCodeVerifier(verifier)
    const authorizationUrl = buildAuthorizationUrl(
      discovery.authorizationServerMetadata,
      provider,
      clientInformation,
      verifier,
      resource,
      scope
    )
    await provider.redirectToAuthorization(authorizationUrl)
    return "REDIRECT"
  }

  if (options.authorizationCode) {
    validateAuthorizationResponseIssuer(
      discovery.authorizationServerMetadata,
      options.authorizationIssuer
    )
  }
  const tokens = await fetchToken(provider, discovery.authorizationServerMetadata, {
    clientInformation,
    authorizationCode: options.authorizationCode,
    scope,
    resource,
    fetchFn
  })
  await provider.saveTokens(tokens)
  return "AUTHORIZED"
}

export const discoverOAuthServerInfo = async (
  serverUrl: string | URL,
  options: {
    readonly resourceMetadataUrl?: URL | undefined
    readonly fetchFn?: FetchLike | undefined
  } = {}
): Promise<OAuthDiscoveryState & { readonly authorizationServerMetadata: OAuthMetadata }> => {
  const fetchFn = options.fetchFn ?? fetch
  const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
    serverUrl,
    options.resourceMetadataUrl,
    fetchFn
  )
  const authorizationServerUrl =
    resourceMetadata.authorization_servers?.[0] ?? resourceUrlFromServerUrl(serverUrl).origin
  const authorizationServerMetadata = await discoverAuthorizationServerMetadata(
    authorizationServerUrl,
    fetchFn
  )
  return {
    authorizationServerUrl,
    resourceMetadataUrl: options.resourceMetadataUrl?.href,
    resourceMetadata,
    authorizationServerMetadata
  }
}

export const discoverOAuthProtectedResourceMetadata = async (
  serverUrl: string | URL,
  resourceMetadataUrl: URL | undefined,
  fetchFn: FetchLike
): Promise<OAuthProtectedResourceMetadata> => {
  const url = resourceMetadataUrl ?? new URL("/.well-known/oauth-protected-resource", serverUrl)
  const response = resourceMetadataUrl
    ? await fetchFn(url)
    : await discoverMetadataWithFallback(serverUrl, "oauth-protected-resource", fetchFn)
  if (!response?.ok) {
    return { resource: resourceUrlFromServerUrl(serverUrl).href }
  }
  return await response.json() as OAuthProtectedResourceMetadata
}

export const discoverAuthorizationServerMetadata = async (
  authorizationServerUrl: string | URL,
  fetchFn: FetchLike
): Promise<OAuthMetadata> => {
  for (const url of buildAuthorizationServerDiscoveryUrls(authorizationServerUrl)) {
    const response = await fetchFn(url)
    if (response.ok) {
      return await response.json() as OAuthMetadata
    }
  }
  const issuer = new URL(authorizationServerUrl)
  return {
    issuer: issuer.origin,
    authorization_endpoint: new URL("/authorize", issuer).href,
    token_endpoint: new URL("/token", issuer).href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"]
  }
}

export const selectResourceURL = async (
  serverUrl: string | URL,
  provider: OAuthClientProvider,
  resourceMetadata: OAuthProtectedResourceMetadata | undefined
): Promise<URL | undefined> => {
  const resource = resourceMetadata?.resource
  if (provider.validateResourceURL) {
    return provider.validateResourceURL(serverUrl, resource)
  }
  if (!resource) {
    return resourceUrlFromServerUrl(serverUrl)
  }
  if (!checkResourceAllowed({ requestedResource: serverUrl, configuredResource: resource })) {
    throw new OAuthError("invalid_target", `Resource ${resource} does not allow ${serverUrl}`)
  }
  return new URL(resource)
}

export const signPrivateKeyJwt = (options: {
  readonly clientId: string
  readonly tokenEndpoint: string
  readonly privateKey: string
  readonly algorithm: string
}): string => {
  const header = {
    alg: options.algorithm,
    typ: "JWT"
  }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: options.clientId,
    sub: options.clientId,
    aud: options.tokenEndpoint,
    iat: now,
    exp: now + 300,
    jti: base64Url(randomBytes(16))
  }
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`
  const signatureAlgorithm = options.algorithm.startsWith("ES") ? "sha256" : "RSA-SHA256"
  const signature = createSign(signatureAlgorithm).update(signingInput).sign(options.privateKey)
  return `${signingInput}.${base64Url(signature)}`
}

const registerOrUseMetadataUrl = async (
  provider: OAuthClientProvider,
  discovery: OAuthDiscoveryState & { readonly authorizationServerMetadata: OAuthMetadata },
  fetchFn: FetchLike,
  scope: string | undefined
): Promise<OAuthClientInformationMixed> => {
  if (
    discovery.authorizationServerMetadata.client_id_metadata_document_supported &&
    provider.clientMetadataUrl
  ) {
    const clientInformation = {
      client_id: provider.clientMetadataUrl,
      issuer: discovery.authorizationServerMetadata.issuer
    }
    await provider.saveClientInformation?.(clientInformation)
    return clientInformation
  }
  if (!discovery.authorizationServerMetadata.registration_endpoint) {
    throw new OAuthError("invalid_client", "OAuth server does not advertise registration_endpoint")
  }
  const response = await fetchFn(discovery.authorizationServerMetadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(clientRegistrationMetadata(provider.clientMetadata, scope))
  })
  if (!response.ok) {
    throw new OAuthError("invalid_client", await response.text())
  }
  const clientInformation = withIssuer(
    await response.json() as OAuthClientInformationMixed,
    discovery.authorizationServerMetadata.issuer
  )
  await provider.saveClientInformation?.(clientInformation)
  return clientInformation
}

const buildAuthorizationUrl = (
  metadata: OAuthMetadata,
  provider: OAuthClientProvider,
  clientInformation: OAuthClientInformationMixed,
  codeVerifier: string,
  resource: URL | undefined,
  scope: string | undefined
): URL => {
  const endpoint = metadata.authorization_endpoint
  if (!endpoint) {
    throw new OAuthError(
      "invalid_request",
      "OAuth server does not advertise authorization_endpoint"
    )
  }
  const url = new URL(endpoint)
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest())
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientInformation.client_id)
  url.searchParams.set("redirect_uri", String(provider.redirectUrl))
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", AUTHORIZATION_CODE_CHALLENGE_METHOD)
  if (scope) {
    url.searchParams.set("scope", scope)
  }
  if (resource) {
    url.searchParams.set("resource", resource.href)
  }
  return url
}

const fetchToken = async (
  provider: OAuthClientProvider,
  metadata: OAuthMetadata,
  options: {
    readonly clientInformation: OAuthClientInformationMixed
    readonly authorizationCode?: string | undefined
    readonly scope?: string | undefined
    readonly resource?: URL | undefined
    readonly fetchFn: FetchLike
  }
): Promise<OAuthTokens> => {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" })
  const params = await buildTokenParams(provider, options)
  if (options.resource) {
    params.set("resource", options.resource.href)
  }
  if (provider.addClientAuthentication) {
    await provider.addClientAuthentication(headers, params, metadata.token_endpoint, metadata)
  } else {
    applyClientAuthentication(
      selectClientAuthMethod(
        options.clientInformation,
        metadata.token_endpoint_auth_methods_supported ?? []
      ),
      headers,
      params,
      options.clientInformation
    )
  }
  const response = await options.fetchFn(metadata.token_endpoint, {
    method: "POST",
    headers,
    body: params
  })
  if (!response.ok) {
    throw new OAuthError("invalid_grant", await response.text())
  }
  return await response.json() as OAuthTokens
}

const buildTokenParams = async (
  provider: OAuthClientProvider,
  options: {
    readonly clientInformation: OAuthClientInformationMixed
    readonly authorizationCode?: string | undefined
    readonly scope?: string | undefined
  }
): Promise<URLSearchParams> => {
  const prepared = await provider.prepareTokenRequest?.(options.scope)
  if (prepared) {
    return prepared
  }
  const params = new URLSearchParams()
  if (options.authorizationCode) {
    params.set("grant_type", "authorization_code")
    params.set("code", options.authorizationCode)
    params.set("code_verifier", await provider.codeVerifier())
    params.set("redirect_uri", String(provider.redirectUrl))
  } else {
    params.set("grant_type", "client_credentials")
    if (options.scope) {
      params.set("scope", options.scope)
    }
  }
  return params
}

const applyClientAuthentication = (
  method: ClientAuthMethod,
  headers: Headers,
  params: URLSearchParams,
  clientInformation: OAuthClientInformationMixed
): void => {
  if (method === "client_secret_basic") {
    if (!clientInformation.client_secret) {
      throw new OAuthError("invalid_client", "client_secret_basic requires a client_secret")
    }
    const credentials = Buffer.from(
      `${clientInformation.client_id}:${clientInformation.client_secret}`
    ).toString("base64")
    headers.set("Authorization", `Basic ${credentials}`)
    return
  }

  params.set("client_id", clientInformation.client_id)
  if (method === "client_secret_post" && clientInformation.client_secret) {
    params.set("client_secret", clientInformation.client_secret)
  }
}

const resolvedScope = async (
  scope: string | undefined,
  resourceMetadata: OAuthProtectedResourceMetadata | undefined,
  provider: OAuthClientProvider
): Promise<string | undefined> => {
  const requestedScope =
    scope ?? resourceMetadata?.scopes_supported?.join(" ") ?? provider.clientMetadata.scope
  if (!requestedScope) {
    return undefined
  }
  const tokens = await provider.tokens()
  return unionScopes(tokens?.scope, requestedScope)
}

const unionScopes = (
  currentScope: string | undefined,
  requestedScope: string
): string => {
  const scopes = new Set([
    ...scopeParts(currentScope),
    ...scopeParts(requestedScope)
  ])
  return [...scopes].join(" ")
}

const scopeParts = (scope: string | undefined): ReadonlyArray<string> =>
  scope?.split(/\s+/).filter((part) => part.length > 0) ?? []

const isBoundToDifferentIssuer = (
  clientInformation: OAuthClientInformationMixed,
  issuer: string
): boolean =>
  typeof clientInformation.issuer === "string" && clientInformation.issuer !== issuer

const withIssuer = <T extends OAuthClientInformationMixed>(
  clientInformation: T,
  issuer: string
): T =>
  ({
    ...clientInformation,
    issuer
  }) as T

export const validateAuthorizationResponseIssuer = (
  metadata: OAuthMetadata,
  authorizationIssuer: string | undefined
): void => {
  if (!authorizationIssuer) {
    if (metadata.authorization_response_iss_parameter_supported) {
      throw new OAuthError(
        "invalid_issuer",
        `Authorization response is missing iss for issuer ${metadata.issuer}`
      )
    }
    return
  }
  if (authorizationIssuer !== metadata.issuer) {
    throw new OAuthError(
      "invalid_issuer",
      `Authorization response iss ${authorizationIssuer} does not match ${metadata.issuer}`
    )
  }
}

const clientRegistrationMetadata = (
  metadata: OAuthClientMetadata,
  scope: string | undefined
): OAuthClientMetadata => ({
  ...metadata,
  application_type: metadata.application_type ?? selectApplicationType(metadata.redirect_uris),
  ...(scope === undefined ? {} : { scope })
})

export const selectApplicationType = (
  redirectUris: ReadonlyArray<string>
): "web" | "native" =>
  redirectUris.some(isNativeRedirectUri) ? "native" : "web"

const isNativeRedirectUri = (redirectUri: string): boolean => {
  try {
    const url = new URL(redirectUri)
    if (url.protocol !== "https:") {
      return true
    }
    return isLoopbackHost(url.hostname)
  } catch {
    return true
  }
}

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]" ||
  hostname === "::1"

const discoverMetadataWithFallback = async (
  serverUrl: string | URL,
  wellKnownType: "oauth-protected-resource",
  fetchFn: FetchLike
): Promise<Response | undefined> => {
  const issuer = new URL(serverUrl)
  const path = issuer.pathname.endsWith("/")
    ? issuer.pathname.slice(0, -1)
    : issuer.pathname
  const candidates = [
    new URL(`/.well-known/${wellKnownType}${path === "/" ? "" : path}`, issuer.origin),
    new URL(`/.well-known/${wellKnownType}`, issuer.origin)
  ]
  for (const candidate of candidates) {
    const response = await fetchFn(candidate)
    if (response.ok || response.status < 400 || response.status >= 500) {
      return response
    }
  }
  return undefined
}

const buildAuthorizationServerDiscoveryUrls = (
  authorizationServerUrl: string | URL
): ReadonlyArray<URL> => {
  const issuer = new URL(authorizationServerUrl)
  if (issuer.pathname === "/") {
    return [
      new URL("/.well-known/oauth-authorization-server", issuer.origin),
      new URL("/.well-known/openid-configuration", issuer.origin)
    ]
  }

  const path = issuer.pathname.endsWith("/")
    ? issuer.pathname.slice(0, -1)
    : issuer.pathname
  return [
    new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin),
    new URL(`/.well-known/openid-configuration${path}`, issuer.origin),
    new URL(`${path}/.well-known/openid-configuration`, issuer.origin)
  ]
}

const base64UrlJson = (value: unknown): string =>
  base64Url(Buffer.from(JSON.stringify(value)))

const base64Url = (value: Uint8Array): string =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
