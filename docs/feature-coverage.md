# MCP `2026-07-28` Feature Coverage

This document is the human-readable companion to
[`conformance/feature-coverage.json`](conformance/feature-coverage.json). The
matrix checker derives the required methods, notifications, and capabilities
from the pinned final schema and rejects missing or extra supported rows. Each
row also names a public API owner, runnable example, and test.

## Protocol requests

The client exposes `discover`, completion, prompt, resource, subscription, and
tool methods from `mcp-effect-sdk/client`. The server registers generated-backed
handlers with `McpServer.make`, `registerTool`, `registerResource`, and
`registerPrompt`.

`server/discover` is performed when a client is constructed and may be refreshed
explicitly. Every request carries the final protocol version and declared client
capabilities. Lists and reads support pagination and cache metadata where the
specification permits it.

## Protocol notifications

Request interruption emits `notifications/cancelled`. Progress and logging are
active-request notifications delivered only on that request's SSE response; they
are never delivered through `subscriptions/listen`.

Resource updates and resource, tool, and prompt list-change notifications use
the separate subscription path. They are filtered by the scope acknowledged by
`subscriptions/listen` and delivered only on that subscription response.

The server exposes typed helpers for progress and list/update notifications plus
the generated-backed `publish` boundary. The client validates every received
notification before dispatching it.

## Client capabilities

Elicitation, roots, and sampling are implemented through `InputRequiredPolicy`.
They do not restore the removed server-initiated request loop: a server returns
`input_required`, the client obtains input under its policy, and retries with
exact `inputResponses` and `requestState`.

Extension capabilities are supplied separately from core client capabilities so
an extension cannot silently alter the core declaration.

## Server capabilities

The server derives completion, prompt, resource, tool, and list-change
capabilities from registered handlers. Deprecated logging support is opt-in:
`McpServerOptions.logging` defaults to `false`, and the server advertises the
`logging` capability only when it is `true`. A typed
`ClientRequestOptions.logLevel` selects the severity threshold and forces an
HTTP SSE response so each accepted message remains on its owning request stream.
No message is emitted when a request omitted `logLevel`, and logging is never
redirected to a `subscriptions/listen` stream. Extension capabilities are
explicit and disabled by default.

## Transports

The stable transports are stdio and Streamable HTTP, each for both client and
server use. Streamable HTTP is stateless and request-owned; it validates DNS
rebinding controls, standard MCP headers, custom tool headers, JSON/SSE response
forms, and cancellation.

## Authorization

### Metadata discovery and issuer validation

`mcp-effect-sdk/auth/client` discovers protected-resource metadata at the
resource path and origin candidates, then discovers the selected authorization
server at the exact OAuth and OpenID metadata candidates. Canonical resource and
issuer identifiers are validated before use, and returned issuer metadata must
exactly match the selected issuer.

### Registration modes

Credential resolution has an explicit order: pre-registered credentials,
previously stored credentials, client ID metadata documents (CIMD), then dynamic
client registration (DCR). Token endpoint authentication methods are checked
against server metadata, and stored credentials remain partitioned by exact
issuer.

### PKCE authorization code

Authorization transactions generate independent state and a PKCE S256
verifier/challenge, bind the redirect URI, resource, issuer, and credential, and
consume callback state exactly once. The response `iss` policy selected at
transaction start cannot be weakened during callback handling.

### Resource indicators and token audience

Authorization and token requests carry the RFC 8707 `resource` indicator. Opaque
access tokens are persisted only after the caller's `TokenAudienceValidator`
accepts the exact issuer/resource binding.

### Token exchange and refresh

Authorization-code exchange and refresh use the selected token endpoint and
compatible client authentication method. Grants are issuer/resource/client/scope
partitioned, expiry uses the Effect clock, and refresh preserves a valid
unrotated refresh token.

### Challenge step-up and scope hierarchy

`invalid_token` removes the rejected grant. `insufficient_scope` performs a
bounded step-up retry while preserving the prior, configured, challenge, and
issuer-defined scope hierarchy. An explicitly empty challenge scope set remains
distinct from an absent set, which may fall back to protected-resource metadata.

### Credential redaction

Authorization codes, tokens, refresh tokens, client secrets, request headers,
and response bodies cross public storage and HTTP seams as `Redacted` values.
Typed errors and evidence logs exclude credential material.

### Protected-resource metadata

`mcp-effect-sdk/auth/protected-resource` exposes the final
`ProtectedResourceMetadata` model and standards-compliant resource metadata and
challenge integration for Streamable HTTP.

### Bearer verification

Bearer extraction produces a redacted token, delegates to the caller-supplied
`TokenVerifier`, embeds only a token-free verified principal, and enforces
scopes before MCP dispatch. Invalid credentials and insufficient scope produce
the required 401/403 challenges without disclosing bearer material.

### Scope hierarchy policy

Protected resources may supply an `AuthorizationScopeSatisfies` callback to
`requireAuthorizationScopes`, `verifyBearerAuthorization`, or the Streamable
HTTP authorization configuration. The callback receives
`AuthorizationScopeSatisfaction`, containing the token-free principal plus one
granted and one required scope. Every required scope must be satisfied by at
least one granted scope.

The default is exact equality for flat-scope issuers. The SDK never infers a
hierarchy from separators or prefixes; broad-to-narrow relationships must be
listed by the issuer's policy. An unmatched required scope produces the normal
redacted 403 insufficient-scope challenge. A callback that throws or returns a
non-boolean is contained as `AuthorizationPolicyError` reason `PolicyFailure`
and becomes a bodyless 500 without a bearer challenge or credential material.

The package does not implement an OAuth authorization server. Therefore the
official authorization-server conformance command is a diagnostic,
non-qualifying lane unless that role is added and claimed later.

## Deprecated compatibility

`mcp-effect-sdk/deprecated` retains `RootsProvider`, `SamplingHandler`, and
`sendLoggingMessage` as named migration boundaries. Roots and sampling execute
through MRTR in the stable API; these exports do not restore legacy
server-initiated requests. Logging remains a supported server notification with
request-scoped level metadata: the helper honors the request's typed severity
threshold and emits nothing when logging is disabled or the request supplied no
`logLevel`.

## Experimental exclusions

The schema fields named `experimental` and features supplied only by Tasks or
MCP Apps are excluded from Tier 1 completeness by the official policy.
Experimental extensions remain opt-in and are documented separately.
