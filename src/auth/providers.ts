import {
  signPrivateKeyJwt,
  type OAuthClientInformation,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthMetadata,
  type OAuthTokens
} from "./auth.js"

export class ClientCredentialsProvider implements OAuthClientProvider {
  private readonly clientId: string
  private readonly clientSecret: string
  private tokenState: OAuthTokens | undefined

  constructor(options: {
    readonly clientId: string
    readonly clientSecret: string
  }) {
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
  }

  get redirectUrl(): undefined {
    return undefined
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [],
      grant_types: ["client_credentials"],
      token_endpoint_auth_method: "client_secret_basic"
    }
  }

  clientInformation(): OAuthClientInformation {
    return {
      client_id: this.clientId,
      client_secret: this.clientSecret
    }
  }

  tokens(): OAuthTokens | undefined {
    return this.tokenState
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokenState = tokens
  }

  redirectToAuthorization(): void {
    throw new Error("ClientCredentialsProvider does not use authorization redirects")
  }

  saveCodeVerifier(): void {
    throw new Error("ClientCredentialsProvider does not use PKCE")
  }

  codeVerifier(): string {
    throw new Error("ClientCredentialsProvider does not use PKCE")
  }

  prepareTokenRequest(scope?: string): URLSearchParams {
    const params = new URLSearchParams({ grant_type: "client_credentials" })
    if (scope) {
      params.set("scope", scope)
    }
    return params
  }
}

export class PrivateKeyJwtProvider implements OAuthClientProvider {
  private readonly clientId: string
  private readonly privateKey: string
  private readonly algorithm: string
  private tokenState: OAuthTokens | undefined

  constructor(options: {
    readonly clientId: string
    readonly privateKey: string
    readonly algorithm?: string | undefined
  }) {
    this.clientId = options.clientId
    this.privateKey = options.privateKey
    this.algorithm = options.algorithm ?? "ES256"
  }

  get redirectUrl(): undefined {
    return undefined
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [],
      grant_types: ["client_credentials"],
      token_endpoint_auth_method: "private_key_jwt"
    }
  }

  clientInformation(): OAuthClientInformation {
    return { client_id: this.clientId }
  }

  tokens(): OAuthTokens | undefined {
    return this.tokenState
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokenState = tokens
  }

  redirectToAuthorization(): void {
    throw new Error("PrivateKeyJwtProvider does not use authorization redirects")
  }

  saveCodeVerifier(): void {
    throw new Error("PrivateKeyJwtProvider does not use PKCE")
  }

  codeVerifier(): string {
    throw new Error("PrivateKeyJwtProvider does not use PKCE")
  }

  prepareTokenRequest(scope?: string): URLSearchParams {
    const params = new URLSearchParams({ grant_type: "client_credentials" })
    if (scope) {
      params.set("scope", scope)
    }
    return params
  }

  addClientAuthentication(
    _headers: Headers,
    params: URLSearchParams,
    url: string | URL
  ): void {
    params.set("client_id", this.clientId)
    params.set(
      "client_assertion_type",
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    )
    params.set(
      "client_assertion",
      signPrivateKeyJwt({
        clientId: this.clientId,
        tokenEndpoint: String(url),
        privateKey: this.privateKey,
        algorithm: this.algorithm
      })
    )
  }
}

export class CrossAppAccessProvider implements OAuthClientProvider {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly assertion: (context: {
    readonly authorizationServerUrl: string
    readonly resourceUrl?: string | undefined
    readonly fetchFn?: typeof fetch | undefined
  }) => Promise<string>
  private tokenState: OAuthTokens | undefined
  private authorizationServerUrlState: string | undefined
  private resourceUrlState: string | undefined

  constructor(options: {
    readonly clientId: string
    readonly clientSecret: string
    readonly assertion: (context: {
      readonly authorizationServerUrl: string
      readonly resourceUrl?: string | undefined
      readonly fetchFn?: typeof fetch | undefined
    }) => Promise<string>
  }) {
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.assertion = options.assertion
  }

  get redirectUrl(): undefined {
    return undefined
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [],
      grant_types: ["urn:ietf:params:oauth:grant-type:jwt-bearer"],
      token_endpoint_auth_method: "client_secret_basic"
    }
  }

  clientInformation(): OAuthClientInformation {
    return {
      client_id: this.clientId,
      client_secret: this.clientSecret
    }
  }

  tokens(): OAuthTokens | undefined {
    return this.tokenState
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokenState = tokens
  }

  redirectToAuthorization(): void {
    throw new Error("CrossAppAccessProvider does not use authorization redirects")
  }

  saveCodeVerifier(): void {
    throw new Error("CrossAppAccessProvider does not use PKCE")
  }

  codeVerifier(): string {
    throw new Error("CrossAppAccessProvider does not use PKCE")
  }

  saveAuthorizationServerUrl(authorizationServerUrl: string): void {
    this.authorizationServerUrlState = authorizationServerUrl
  }

  saveResourceUrl(resourceUrl: string): void {
    this.resourceUrlState = resourceUrl
  }

  async prepareTokenRequest(): Promise<URLSearchParams> {
    const assertion = await this.assertion({
      authorizationServerUrl: this.authorizationServerUrlState ?? "",
      resourceUrl: this.resourceUrlState
    })
    return new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  }

  addClientAuthentication(
    headers: Headers,
    params: URLSearchParams,
    _url: string | URL,
    _metadata?: OAuthMetadata
  ): void {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")
    headers.set("Authorization", `Basic ${credentials}`)
    params.set("client_id", this.clientId)
  }
}

export const requestJwtAuthorizationGrant = async (options: {
  readonly tokenEndpoint: string
  readonly audience: string
  readonly resource?: string | undefined
  readonly idToken: string
  readonly clientId: string
  readonly fetchFn?: typeof fetch | undefined
}): Promise<{ readonly jwtAuthGrant: string }> => {
  const fetchFn = options.fetchFn ?? fetch
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    subject_token: options.idToken,
    audience: options.audience,
    client_id: options.clientId
  })
  if (options.resource) {
    params.set("resource", options.resource)
  }
  const response = await fetchFn(options.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  const body = await response.json() as {
    readonly access_token?: string | undefined
    readonly jwtAuthGrant?: string | undefined
  }
  return { jwtAuthGrant: body.jwtAuthGrant ?? body.access_token ?? "" }
}
