# Task 6B preflight: public Effect authorization boundaries

## Status and approval gate

This document freezes the bounded WP6B contract before any RED test,
production source, package export, dependency, lockfile, example, transport, or
verification-script edit.

- Accepted WP6A closeout base:
  `8541cf9773292c5337f5f9b4b7146e6c48f3827c`.
- Accepted WP6A closeout tree:
  `32e88bedcd8bc6ed4edbcd8a14f04d34a767ed16`.
- Worktree/branch: `/private/tmp/mcp-effect-sdk-wp6` /
  `codex/wp6-authorization`.
- Tracked status was clean before this preflight.
- Commit only this preflight, then stop for coordinator approval before the
  committed RED.
- Preserve accepted WP2-WP6A behavior and all release, official-conformance,
  external-AS, issue, Tier, and Goal blockers.

WP6B defines public Effect service ports, schema-decoded value models,
secret-safe tagged errors, and the two final package subpaths. It deliberately
ships no working OAuth implementation, fake/default/live `Layer`, discovery,
registration, transaction, token, or HTTP integration behavior.

## Authority and inspected evidence

The following were read completely before this preflight:

1. `AGENTS.md`;
2. the authoritative Goal execution prompt and full implementation plan;
3. `ROADMAP.md`, the draft migration guide, scenario map, Tier evidence, and
   SDK readiness requirements;
4. `.superpowers/sdd/task-6-preflight.md` and accepted
   `.superpowers/sdd/task-6-report.md`;
5. all four accepted vendored authorization authorities under
   `sources/vendor/mcp-core/authorization/`;
6. all current `src/auth/*` files, root/client/server/HTTP barrels, and package
   exports;
7. accepted Effect `Context.Tag`, `Layer`, `Effect`, `Schema.Class`,
   `Schema.TaggedError`, `Data.TaggedError`, callback-containment, and
   interrupt-preservation conventions;
8. the exact WP5 public type fixtures, platform graph checker, package export
   tests, real tarball consumer, Effect foundation tests, and current HTTP
   transport auth types.

The four vendored MCP files remain normative at accepted WP6A. The TypeScript
SDK, PR #27, `kitlangton/effect-solutions`, `kitlangton/visual-effect`, and the
Effect language-service repository are optional design references only. WP6B
does not read, copy, depend on, or introduce tooling from those optional
repositories.

## Current boundary and coordinator decisions

The accepted base still has a mutable Promise/callback implementation in
`src/auth/auth.ts`, `OAuthClientProvider.ts`, `providers.ts`, and `errors.ts`.
It imports `node:crypto`, casts untrusted JSON, exposes raw token-bearing
models, and is published only through root `OAuth`, `OAuthProviders`, and
`OAuthErrors` namespaces. The HTTP client reads provider tokens and owns a
legacy combined 401/403 retry. The HTTP server accepts token-bearing
`HandleRequestOptions.authInfo`.

Those are future migration inputs, not the WP6B public design.

Coordinator decisions frozen here:

- Final WP6 removes root `OAuth`, `OAuthProviders`, and `OAuthErrors`, but
  WP6B does **not** remove or modify them before the legacy Everything client
  migrates in WP6F.
- `authInfo` replacement waits for WP6E. WP6B does not edit either transport.
- WP6B exposes service ports with final-purpose Effect-returning signatures
  and nominal handles/models. It exposes no inspection-only facade and no
  default implementation that implies OAuth works.
- Tests inject fake services with `Context.make`, `Effect.provideService`, or
  `Layer.succeed` to prove runtime tag identity and exact Effect channels.
- Concrete discovery/issuer/registration/scope behavior is WP6C;
  state/PKCE/callback/token/audience behavior is WP6D; transport bearer/header
  integration and principal propagation are WP6E.
- Consumer-facing `AuthorizationClient` successes use opaque credential,
  grant, and transaction handles. Necessary low-level HTTP/store/interaction
  port material uses bytes or `Redacted` values. Raw client secrets, tokens,
  authorization codes, PKCE verifiers, state values, bearer headers, and
  cookies never appear in a principal, error, log, inspection string, or
  evidence artifact.

## Shared model rules

All untrusted metadata, challenge, callback, and principal inputs cross an
exported `effect/Schema` codec before becoming a public decoded model. Public
functions do not cast `unknown`, return `ParseResult.ParseError`, or leak raw
JSON exceptions. Decode failures map to `AuthorizationDecodeError`.

Decoded models use camel-case fields while their schemas encode/decode the
standards-defined snake-case JSON names. Unknown metadata extension members
are accepted and ignored; known required members remain required and malformed
known members fail. WP6B performs structural decoding only. Contextual URI,
issuer, registration, scope-union, callback, resource, and audience semantics
are owned by WP6C/WP6D.

The common runtime schemas are:

- `AuthorizationScope`: a nominal nonempty string containing no ASCII scope
  separator whitespace;
- `AuthorizationScopeSet`: an immutable array of `AuthorizationScope` values;
- `AuthorizationCredentialHandle`, `AuthorizationGrantHandle`,
  `AuthorizationTransactionHandle`, and `AuthorizationSigningKeyHandle`:
  nominal opaque nonempty strings, safe to route but not treated as secrets;
- `ProtectedResourceMetadata`: decoded `resource`, nonempty
  `authorizationServers`, optional `scopesSupported`, and optional
  `bearerMethodsSupported`;
- `AuthorizationServerMetadata`: decoded `issuer`, optional
  `authorizationEndpoint`, required `tokenEndpoint`, optional
  `registrationEndpoint`, scope/response/grant/token-auth/PKCE capability
  arrays, and optional CIMD and response-`iss` support flags;
- `AuthorizationChallenge`: `scheme: "Bearer"`, `status: 401 | 403`, optional
  `error: "invalid_token" | "insufficient_scope"`, optional safe
  `errorDescription`, `scopes`, and optional `resourceMetadata` URI;
- `AuthorizationCallbackInput`: opaque transaction handle, exact redirect URI,
  and the raw encoded callback parameter string held as
  `Redacted.Redacted<string>`. It contains no inspectable code or state; WP6D
  consumes and validates it once.

Metadata and challenge schemas must be reusable from both public subpaths with
strict runtime identity, not duplicated lookalikes.

## `mcp-effect-sdk/auth/client` public contract

### Platform-neutral port types

`AuthorizationHttpClient` uses SDK-owned byte/header records and never Web or
Node HTTP types:

```ts
export type AuthorizationHeaders = ReadonlyArray<readonly [string, string]>

export interface AuthorizationHttpRequest {
  readonly method: "GET" | "POST"
  readonly url: string
  readonly headers: AuthorizationHeaders
  readonly body?: Uint8Array
}

export interface AuthorizationHttpResponse {
  readonly status: number
  readonly headers: AuthorizationHeaders
  readonly body: Uint8Array
}

export interface AuthorizationHttpClientService {
  readonly request: (
    request: AuthorizationHttpRequest
  ) => Effect.Effect<AuthorizationHttpResponse, AuthorizationHttpError>
}

export class AuthorizationHttpClient extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationHttpClient"
)<AuthorizationHttpClient, AuthorizationHttpClientService>() {}
```

No `fetch`, `Request`, `Response`, `Headers`, `AbortSignal`, `URL`, Node
builtin, or Promise appears in the public declaration graph. Effect fiber
interruption is the cancellation mechanism and platform adapters must preserve
it.

`AuthorizationCrypto` owns only capabilities required by later WP6 behavior:

```ts
export interface AuthorizationSignRequest {
  readonly algorithm: "ES256" | "RS256"
  readonly key: AuthorizationSigningKeyHandle
  readonly payload: Uint8Array
}

export interface AuthorizationCryptoService {
  readonly randomBytes: (
    length: number
  ) => Effect.Effect<Uint8Array, AuthorizationCryptoError>
  readonly sha256: (
    value: Uint8Array
  ) => Effect.Effect<Uint8Array, AuthorizationCryptoError>
  readonly sign: (
    request: AuthorizationSignRequest
  ) => Effect.Effect<Uint8Array, AuthorizationCryptoError>
}

export class AuthorizationCrypto extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationCrypto"
)<AuthorizationCrypto, AuthorizationCryptoService>() {}
```

`AuthorizationInteraction` separates user-agent/callback ownership from core
orchestration and performs no implicit navigation:

```ts
export interface AuthorizationInteractionRequest {
  readonly authorizationUri: string
  readonly redirectUri: string
  readonly transaction: AuthorizationTransactionHandle
}

export interface AuthorizationCallbackRequest {
  readonly redirectUri: string
  readonly transaction: AuthorizationTransactionHandle
}

export interface AuthorizationInteractionService {
  readonly open: (
    request: AuthorizationInteractionRequest
  ) => Effect.Effect<void, AuthorizationInteractionError>
  readonly waitForCallback: (
    request: AuthorizationCallbackRequest
  ) => Effect.Effect<AuthorizationCallbackInput, AuthorizationInteractionError>
}

export class AuthorizationInteraction extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationInteraction"
)<AuthorizationInteraction, AuthorizationInteractionService>() {}
```

### Store boundary

`AuthorizationClientStore` is issuer-keyed and Effect-native. Secret-bearing
material is accepted only in dedicated stored-value inputs whose secret fields
use `effect/Redacted.Redacted<string>`. Lookup/write methods return opaque
handles or safe absence; explicit `read*`/`takeTransaction` operations return
only `Redacted` secret fields to the later orchestrator. No store error may
retain or interpolate a stored value.

```ts
export interface AuthorizationCredentialKey {
  readonly issuer: string
  readonly clientId?: string
}

export interface AuthorizationGrantKey {
  readonly issuer: string
  readonly resource: string
  readonly clientId: string
  readonly scopes: AuthorizationScopeSet
}

export interface StoredAuthorizationCredential {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret?: Redacted.Redacted<string>
  readonly registrationAccessToken?: Redacted.Redacted<string>
}

export interface StoredAuthorizationGrant {
  readonly issuer: string
  readonly resource: string
  readonly clientId: string
  readonly scopes: AuthorizationScopeSet
  readonly tokenType: string
  readonly accessToken: Redacted.Redacted<string>
  readonly refreshToken?: Redacted.Redacted<string>
  readonly expiresAt?: number
}

export interface StoredAuthorizationTransaction {
  readonly issuer: string
  readonly resource: string
  readonly redirectUri: string
  readonly scopes: AuthorizationScopeSet
  readonly state: Redacted.Redacted<string>
  readonly codeVerifier: Redacted.Redacted<string>
  readonly createdAt: number
}

export interface AuthorizationClientStoreService {
  readonly findCredential: (
    key: AuthorizationCredentialKey
  ) => Effect.Effect<Option.Option<AuthorizationCredentialHandle>, AuthorizationStoreError>
  readonly saveCredential: (
    value: StoredAuthorizationCredential
  ) => Effect.Effect<AuthorizationCredentialHandle, AuthorizationStoreError>
  readonly readCredential: (
    handle: AuthorizationCredentialHandle
  ) => Effect.Effect<StoredAuthorizationCredential, AuthorizationStoreError>
  readonly findGrant: (
    key: AuthorizationGrantKey
  ) => Effect.Effect<Option.Option<AuthorizationGrantHandle>, AuthorizationStoreError>
  readonly saveGrant: (
    value: StoredAuthorizationGrant
  ) => Effect.Effect<AuthorizationGrantHandle, AuthorizationStoreError>
  readonly readGrant: (
    handle: AuthorizationGrantHandle
  ) => Effect.Effect<StoredAuthorizationGrant, AuthorizationStoreError>
  readonly removeGrant: (
    handle: AuthorizationGrantHandle
  ) => Effect.Effect<void, AuthorizationStoreError>
  readonly saveTransaction: (
    value: StoredAuthorizationTransaction
  ) => Effect.Effect<AuthorizationTransactionHandle, AuthorizationStoreError>
  readonly takeTransaction: (
    handle: AuthorizationTransactionHandle
  ) => Effect.Effect<StoredAuthorizationTransaction, AuthorizationStoreError>
}

export class AuthorizationClientStore extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationClientStore"
)<AuthorizationClientStore, AuthorizationClientStoreService>() {}
```

`takeTransaction` is the final atomic consume boundary. WP6B defines its type
but does not implement state, replay, or persistence behavior.

### Authorization client service and facade

The final-purpose public service is small and handle-returning:

```ts
export interface AuthorizationRequest {
  readonly protectedResource: string
  readonly requestedScopes: AuthorizationScopeSet
}

export interface AuthorizationChallengeRequest {
  readonly protectedResource: string
  readonly challenge: AuthorizationChallenge
  readonly priorGrant?: AuthorizationGrantHandle
}

export interface AuthorizationClientService {
  readonly currentGrant: (
    request: AuthorizationRequest
  ) => Effect.Effect<Option.Option<AuthorizationGrantHandle>, AuthorizationClientError>
  readonly acquire: (
    request: AuthorizationRequest
  ) => Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError>
  readonly respondToChallenge: (
    request: AuthorizationChallengeRequest
  ) => Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError>
}

export class AuthorizationClient extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationClient"
)<AuthorizationClient, AuthorizationClientService>() {}

export const currentAuthorizationGrant: (
  request: AuthorizationRequest
) => Effect.Effect<
  Option.Option<AuthorizationGrantHandle>,
  AuthorizationClientError,
  AuthorizationClient
>

export const acquireAuthorization: (
  request: AuthorizationRequest
) => Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError, AuthorizationClient>

export const respondToAuthorizationChallenge: (
  request: AuthorizationChallengeRequest
) => Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError, AuthorizationClient>
```

WP6B accessors only retrieve and delegate to an injected service. There is no
`make`, `default`, `live`, or platform `Layer`. WP6C/WP6D later build Layers
requiring `AuthorizationHttpClient | AuthorizationCrypto |
AuthorizationInteraction | AuthorizationClientStore` and provide
`AuthorizationClient`; those Layers are not part of WP6B.

### Client error taxonomy

Errors are `Schema.TaggedError` values with exact safe fields. They expose no
enumerable `cause`; an internal non-enumerable cause may support diagnostics
but is never schema encoded, JSON serialized, or included in inspection
output.

- `AuthorizationDecodeError`: `model: "ProtectedResourceMetadata" |
  "AuthorizationServerMetadata" | "AuthorizationChallenge" |
  "AuthorizationCallbackInput" | "AuthorizationPrincipal"`, safe `message`,
  and bounded safe issue paths only;
- `AuthorizationHttpError`: `operation: "request"`, safe `message`, optional numeric
  `status`, and `retryable`; never request/response bodies or authorization
  headers;
- `AuthorizationCryptoError`: `operation: "randomBytes" | "sha256" | "sign"`
  and safe `message`;
- `AuthorizationInteractionError`: `operation: "open" |
  "waitForCallback"`, `reason: "Unavailable" | "Rejected" |
  "CancelledByUser" | "Failed"`, and safe `message`;
- `AuthorizationStoreError`: `operation: "findCredential" |
  "saveCredential" | "readCredential" | "findGrant" | "saveGrant" |
  "readGrant" | "removeGrant" | "saveTransaction" | "takeTransaction"`,
  `reason: "NotFound" | "Conflict" | "Unavailable" | "Failed"`, and safe
  `message`;
- `AuthorizationProtocolError`: safe `reason`, `message`, optional issuer,
  resource, scopes, and status. Its reason union is exactly
  `InvalidConfiguration | DiscoveryFailed | IssuerMismatch |
  UnsupportedAuthorizationServer | InvalidChallenge |
  UnsupportedRegistration | CredentialMissing | CredentialIssuerMismatch |
  RegistrationFailed | StateMismatch | StateReplay | RedirectMismatch |
  ResponseIssuerMismatch | AuthorizationDenied | TokenExchangeFailed |
  TokenRefreshFailed | ResourceMismatch | AudienceMismatch`.

`AuthorizationClientError` is the type union of those six tagged errors.
Effect interruption remains interruption; it is never converted to an OAuth
denial, store failure, or retry signal. Optional issuer/resource diagnostics
are sanitized identifiers without userinfo, query, fragment, or response
content.

## `mcp-effect-sdk/auth/protected-resource` public contract

### Principal and verifier

`AuthorizationPrincipal` is an exported schema-decoded class with exact
token-free fields:

```ts
export class AuthorizationPrincipal extends Schema.Class<AuthorizationPrincipal>(
  "mcp-effect-sdk/auth/protected-resource/AuthorizationPrincipal"
)({
  subject: Schema.String,
  clientId: Schema.optional(Schema.String),
  issuer: Schema.optional(Schema.String),
  audiences: Schema.Array(Schema.String),
  scopes: AuthorizationScopeSet,
  claims: Schema.optional(AuthorizationPrincipalClaims)
}) {}
```

`AuthorizationPrincipalClaims` is immutable strict JSON. It represents decoded
token/introspection claims, not the encoded bearer token. The verifier must not
copy the raw bearer string into it, and it cannot contain non-JSON secret
wrappers or executable/accessor values.

The verifier boundary receives the bearer value only as `Redacted` input and
returns the token-free principal:

```ts
export interface TokenVerificationRequest {
  readonly bearerToken: Redacted.Redacted<string>
  readonly protectedResource: string
}

export interface TokenVerifierService {
  readonly verify: (
    request: TokenVerificationRequest
  ) => Effect.Effect<AuthorizationPrincipal, TokenVerificationError>
}

export class TokenVerifier extends Context.Tag(
  "mcp-effect-sdk/auth/protected-resource/TokenVerifier"
)<TokenVerifier, TokenVerifierService>() {}

export const verifyToken: (
  request: TokenVerificationRequest
) => Effect.Effect<AuthorizationPrincipal, TokenVerificationError, TokenVerifier>
```

WP6B does not extract a bearer header, call a verifier from HTTP, or propagate
a principal into MCP context. Those are WP6E behaviors.

### Scope policy and challenge models

```ts
export const unauthorizedChallenge: (options: {
  readonly resourceMetadata: string
  readonly error?: "invalid_token"
  readonly errorDescription?: string
}) => AuthorizationChallenge

export const insufficientScopeChallenge: (options: {
  readonly resourceMetadata: string
  readonly scopes: AuthorizationScopeSet
  readonly errorDescription?: string
}) => AuthorizationChallenge
```

These construct decoded challenge values only. WP6E owns bearer parsing,
escaping/serialization into `WWW-Authenticate`, 401/403 response mapping,
middleware/hooks, protected-resource metadata routing, and the trusted
`verifiedAuthorizationPrincipal` embedding hook.

`TokenVerificationError` is a `Schema.TaggedError` with safe `reason:
Invalid | Expired | AudienceMismatch | VerifierUnavailable | VerifierFailure`,
safe `message`, and optional issuer/resource metadata. It never contains a
bearer value or claims object. `AuthorizationPolicyError` is a
`Schema.TaggedError` with `reason: InsufficientScope`, safe `message`, and
required/granted scope sets only; its concrete scope-checking function waits
for the later authorized scope slice. Missing/malformed bearer extraction
errors are added at the WP6E HTTP boundary, not fabricated by WP6B's verifier
port.

## Exact production file ownership after approval

WP6B production changes are limited to:

- `src/auth/common.ts` — shared platform-neutral schemas, nominal handles,
  decoded metadata/challenge models, and safe schema helpers;
- `src/auth/client/models.ts` — client request, port, stored-value, and
  type-only models;
- `src/auth/client/errors.ts` — client tagged errors and union;
- `src/auth/client/services.ts` — five `Context.Tag` services and three
  injected-service facade accessors;
- `src/auth/client.ts` — exact public client barrel;
- `src/auth/protected-resource/models.ts` — principal, claims, verifier, and
  scope-policy models;
- `src/auth/protected-resource/errors.ts` — verifier/policy tagged errors;
- `src/auth/protected-resource/services.ts` — verifier accessor, scope helper,
  and challenge value constructors;
- `src/auth/protected-resource.ts` — exact protected-resource barrel;
- `package.json` — only the two exact exports below after the RED exists.

No current `src/auth/auth.ts`, `OAuthClientProvider.ts`, `providers.ts`, or
`errors.ts` edit is allowed in WP6B. No root/client/server/transport/example,
generated, dependency, lockfile, checker, runner, readiness, conformance, or
governance file changes.

If implementation needs a file or symbol outside this list, stop and amend
this preflight under coordinator approval before editing.

## Exact package and export boundary

WP6B adds exactly:

```json
"./auth/client": {
  "import": "./dist/auth/client.js",
  "types": "./dist/auth/client.d.ts"
},
"./auth/protected-resource": {
  "import": "./dist/auth/protected-resource.js",
  "types": "./dist/auth/protected-resource.d.ts"
}
```

The root export and runtime keys remain byte-for-byte behaviorally unchanged,
including the temporary legacy OAuth namespaces. `./client`, `./server`,
`./transport/http`, `./deprecated`, and the revisioned protocol entrypoint do
not re-export WP6B symbols. Deep paths such as
`mcp-effect-sdk/auth/client/services` and the legacy
`mcp-effect-sdk/auth/auth` remain sealed.

Exact `./auth/client` runtime keys, sorted, are:

1. `AuthorizationCallbackInput`
2. `AuthorizationChallenge`
3. `AuthorizationClient`
4. `AuthorizationClientStore`
5. `AuthorizationCredentialHandle`
6. `AuthorizationCrypto`
7. `AuthorizationCryptoError`
8. `AuthorizationDecodeError`
9. `AuthorizationGrantHandle`
10. `AuthorizationHttpClient`
11. `AuthorizationHttpError`
12. `AuthorizationInteraction`
13. `AuthorizationInteractionError`
14. `AuthorizationProtocolError`
15. `AuthorizationScope`
16. `AuthorizationScopeSet`
17. `AuthorizationServerMetadata`
18. `AuthorizationSigningKeyHandle`
19. `AuthorizationStoreError`
20. `AuthorizationTransactionHandle`
21. `ProtectedResourceMetadata`
22. `acquireAuthorization`
23. `currentAuthorizationGrant`
24. `respondToAuthorizationChallenge`

Exact `./auth/protected-resource` runtime keys, sorted, are:

1. `AuthorizationChallenge`
2. `AuthorizationPolicyError`
3. `AuthorizationPrincipal`
4. `AuthorizationScope`
5. `AuthorizationScopeSet`
6. `ProtectedResourceMetadata`
7. `TokenVerificationError`
8. `TokenVerifier`
9. `insufficientScopeChallenge`
10. `unauthorizedChallenge`
11. `verifyToken`

Shared runtime schemas re-exported by both subpaths must be strict-equal
objects. Type-only interfaces and unions named in the signatures above are
also public. No other runtime or declaration export is permitted.

## Platform and graph restrictions

- Both auth emitted JavaScript and declaration graphs are free of Node
  builtins, DOM names/libraries, `@effect/platform`, Promise/fetch/Web types,
  unstable Effect imports, ServiceMap, fiber internals, and Effect AI.
- The auth type fixture compiles with `lib: ["ES2022"]`, `types: []`, strict
  checking, and `skipLibCheck: false`.
- The existing root graph is not broadened to the new auth modules. Its legacy
  Node-coupled OAuth namespace remains an explicit WP6F migration debt rather
  than being mislabeled as a new platform-neutral path.
- WP6B adds no browser subpath and no browser global. Later browser Apps work
  cannot import either Node builtins or legacy auth.
- Effect `3.22.0` remains the single runtime. No dependency, peer, override,
  tooling, or lockfile change is permitted.

## Meaningful committed RED

After approval, the first commit adds only:

- `test/auth/wp6b-client-boundary.test.mjs`;
- `test/auth/wp6b-protected-resource-boundary.test.mjs`;
- `test/packaging/wp6b-auth-subpaths.test.mjs`;
- `test/types/wp6b-auth-public/client.ts`;
- `test/types/wp6b-auth-public/protected-resource.ts`;
- `test/types/wp6b-auth-public/tsconfig.json`.

The RED must prove:

1. both package subpaths are absent and every expected runtime key is missing;
2. all five client tags and `TokenVerifier` have the exact stable runtime tag
   identity;
3. fake services/Layers drive the three client accessors and verifier accessor
   with the exact success/error/environment channels, without a live Layer;
4. HTTP/crypto/interaction/store methods return `Effect`, never Promise;
5. malformed metadata/challenge/principal inputs fail closed through the
   schemas, while the public service error channel maps decode failures to
   `AuthorizationDecodeError` and never exposes `ParseResult.ParseError`, a
   cast, or a thrown JSON exception;
6. all error JSON/inspection forms exclude seeded token, secret, code,
   verifier, state, bearer, cookie, request-body, and response-body sentinels;
7. principal schema has no bearer/token field, accepts only snapshotted strict
   JSON claims, and cannot retain the encoded bearer input by construction;
8. shared schemas have identity across subpaths, exact keys remain fixed, and
   deep imports stay sealed;
9. emitted auth JS/declaration graphs are Node/DOM/platform free;
10. an actual packed tarball imports and typechecks both subpaths with only
    declared dependencies/peers, one Effect runtime, ES2022-only library
    types, exact exports, and sealed deep paths;
11. root OAuth namespaces are still present and no new auth symbol leaks into
    root, client, server, protocol, deprecated, or HTTP exports.

Expected meaningful RED on accepted base:

- package export assertions fail because both auth subpaths are absent;
- runtime imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`;
- both strict public type fixtures fail module resolution for the absent
  subpaths;
- all accepted WP5 package/public fixtures remain green, proving the failure is
  the missing WP6B boundary rather than a broken baseline.

Do not accept a RED caused by missing dependencies, a broken build, invalid
fixtures, external network, unavailable credentials, or unrelated accepted
suite regression. Record exact command exit codes, test counts, and TypeScript
diagnostics in the later execution report.

## GREEN and verification contract

After a meaningful committed RED, implement only the files listed above. No
working OAuth Layer is added. The candidate gates on Node 22 are:

```bash
CI=true pnpm run build
node --test test/auth/wp6b-client-boundary.test.mjs
node --test test/auth/wp6b-protected-resource-boundary.test.mjs
pnpm exec tsc -p test/types/wp6b-auth-public/tsconfig.json --noEmit
node --test test/packaging/wp6b-auth-subpaths.test.mjs
CI=true pnpm run test:wp5-core
CI=true pnpm run test:wp4-http
CI=true pnpm run verify
```

Repeat build, the three WP6B focused groups, strict type fixture, WP5 core,
WP4 HTTP, and full verify on Node 24 before candidate review. The package test
owns actual tarball runtime/type/single-Effect/deep-seal proof; a source-only
fixture is insufficient.

`conformance:client-auth` is intentionally not a WP6B gate because no auth
behavior exists yet. `conformance:authorization` is not run because no
approved external target is supplied and WP6B does not implement protected-
resource HTTP integration. Neither absence can be described as a pass.

No new cumulative `test:wp6`, `verify` ownership, readiness accounting,
example, migration, or issue #20 status is added in WP6B. WP6F owns cumulative
authorization governance after WP6C-WP6E behavior exists.

## Explicit WP6B exclusions

WP6B does not implement or change:

- WP6C protected-resource metadata fetching, authorization-server discovery,
  exact issuer selection/validation, pre-registration, CIMD, deprecated DCR,
  DCR `application_type`, credential selection, or cumulative scope union;
- WP6D state/PKCE generation or validation, redirect checks, callback parsing,
  response `iss`, authorization errors, token exchange/refresh, RFC 8707
  request behavior, opaque-token validation, or audience validation;
- WP6E bearer extraction, authorization header ownership, 401/403 parsing,
  retry budgets, verifier middleware/hooks, `authInfo` removal,
  `verifiedAuthorizationPrincipal`, MCP principal propagation, challenge
  serialization, or protected-resource HTTP metadata routes;
- WP6F root OAuth removal, legacy example migration, conformance evidence,
  external AS coordination, cumulative commands, readiness/ledger/docs, or
  issue/PR disposition;
- a general authorization server, external AS fixture/configuration, secrets,
  credentials, `.env`, remote mutations, release, publication, WP7+, Tier, or
  Goal state;
- any dependency, tooling, language-service, visualization package, generated
  MCP output, core transport behavior, or optional Effect reference repo.

## Stop conditions and retained blockers

Stop and return to the coordinator if review requires:

- a public method or runtime key different from the exact contract above;
- a Node, DOM, Web, Promise, or platform type in either auth graph;
- a live/default Layer or fake behavior to make the boundary tests pass;
- unredacted secret/token/code/state/verifier values in consumer-facing
  successes or any principal, error, log, or evidence artifact;
- a root/client/server/transport/example/current-auth edit before its later
  work package;
- a dependency/tooling/lockfile change;
- a weakened package, graph, type, source, conformance, or readiness gate.

WP6A accepted only source provenance. WP6B candidate acceptance, if later
earned, will prove only the two public Effect auth boundaries and package
surfaces. It will not prove OAuth behavior, client-auth conformance,
protected-resource integration, external authorization-server qualification,
issue closure, release readiness, Tier status, WP6 completion, or Goal
completion.
