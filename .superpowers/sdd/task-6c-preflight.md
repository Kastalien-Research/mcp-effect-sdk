# WP6C preflight: authorization discovery, registration, and scope resolution

Status: coordinator draft. No production or test edit is authorized until this
artifact is reviewed, corrected if necessary, force-added, and committed.

## Accepted base and authority

WP6C starts from accepted WP6B closeout commit
`662bddf34deaebc8f6ba66e793e361bb0be36659` / tree
`f0e20a4136208861f69f5d020c18341eeebbca09` on
`codex/wp6-authorization` in `/private/tmp/mcp-effect-sdk-wp6`.

The normative source is the vendored MCP core authorization prose pinned at
`modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288`:

- `sources/vendor/mcp-core/authorization/index.mdx`;
- `authorization-server-discovery.mdx`;
- `client-registration.mdx`;
- `security-considerations.mdx`.

PR #27 commits `7f19e5e` and `d82a50e` are test/design oracles only. They are
not authority and their mutable Promise, Web `URL`/`fetch`, casted JSON, raw
secrets, or legacy root API must not be copied. The optional Effect reference
repositories suggested by the user remain inspiration only; WP6C adds no
dependency, plugin, language service, visualization package, or toolchain
change.

## Bounded outcome

WP6C implements a package-private, Effect-native engine that:

1. discovers and validates protected-resource metadata;
2. selects one advertised authorization server deterministically;
3. discovers and validates that server's metadata using the exact MCP endpoint
   order and exact issuer comparison;
4. chooses or obtains issuer-correct client credentials using the required
   pre-registration, prior registration, CIMD, then deprecated DCR policy;
5. includes an appropriate DCR `application_type`; and
6. computes an immutable, stable exact union of previous, explicitly requested,
   and newly challenged scopes.

This engine is the discovery/registration input to WP6D. WP6C does **not**
publish a partial `AuthorizationClient` implementation or Layer. The exact 24
runtime keys of `mcp-effect-sdk/auth/client` remain unchanged. WP6D must compose
the accepted package-private engine with state, PKCE, callback, and token
behavior before it publishes the one complete client Layer. This avoids a
public service whose `acquire` or `respondToChallenge` methods are knowingly
incomplete.

## Normative decisions

### Protected-resource metadata

The engine receives the protected MCP resource identifier and an optional
already-parsed `resource_metadata` URI. WP6E will eventually parse that URI
from `WWW-Authenticate`; WP6C accepts the safe identifier only and never parses
the header itself.

- When an explicit metadata URI exists, request exactly it. Do not probe a
  fallback after an explicit endpoint fails.
- Otherwise probe, in order, the endpoint-path well-known URI and then the
  origin-root well-known URI required by RFC 9728/MCP. For a root endpoint the
  identical root candidate appears once.
- Continue probing only for HTTP `404 Not Found`. A
  success with malformed JSON/metadata, a redirect not handled by the injected
  adapter, a server failure, interruption, or injected HTTP error fails closed.
- A successful document must decode through the shared
  `ProtectedResourceMetadata` Effect Schema. Unknown extension members are
  ignored; malformed known members fail.
- The decoded `resource` must have the exact requested origin and be the same
  path or a path-segment parent of the requested MCP endpoint. It becomes the
  canonical resource for later RFC 8707 use. A different origin, child path,
  path-prefix collision, userinfo, or fragment fails with `ResourceMismatch`.
- The document must contain the already-required nonempty
  `authorization_servers` array. No silent same-origin authorization-server
  fabrication is permitted.

### Authorization-server selection and discovery

Every advertised authorization-server identifier is an independent issuer.
It must be a safe HTTPS issuer without userinfo, query, or fragment. The input
string is retained exactly for issuer validation and credential keys; scheme,
host, port, trailing slash, and percent encoding are never normalized before
comparison.

Selection is deterministic and does not add an unreviewed callback/policy
service:

1. among advertised issuers, choose the first with an exact configured
   pre-registration;
2. otherwise choose the first with an exact stored credential;
3. otherwise choose the first advertised issuer.

Only advertised exact issuer strings participate. A credential for a
different issuer cannot steer selection. A selected stored handle is read and
its stored `issuer` must exactly equal the selected issuer; store corruption or
cross-issuer data fails `CredentialIssuerMismatch` rather than falling through.
No credential or token is ever tried at another issuer.

For the selected issuer, discovery candidates are attempted exactly as the
vendored MCP source specifies:

- issuer without a path:
  1. `/.well-known/oauth-authorization-server`;
  2. `/.well-known/openid-configuration`;
- issuer with a path:
  1. OAuth path insertion;
  2. OIDC path insertion;
  3. OIDC path appending.

The first successful document is decoded through
`AuthorizationServerMetadata`, and its `issuer` must be byte-for-byte equal to
the selected advertised issuer. A successful but malformed or issuer-mismatched
document fails closed and is not used as a cue to downgrade to another
mechanism. Only HTTP `404 Not Found` may advance to the next
candidate. Exhaustion yields `DiscoveryFailed`.

All authorization and token endpoints required by later flow must be HTTPS
safe identifiers. WP6C records PKCE capability but WP6D owns the decision to
refuse when `S256` is absent. WP6C does not fabricate default `/authorize` or
`/token` endpoints.

### Registration configuration and precedence

WP6C defines package-private final-purpose configuration types. They may be
re-exported as **types only** by WP6D when the complete Layer is published; no
WP6C runtime export is added.

The configuration contains:

- a bounded non-control-character client name;
- one or more exact redirect URIs;
- optional exact issuer-bound pre-registrations, whose secret fields are
  already `Redacted`;
- an optional CIMD client identifier; and
- optional public client metadata fields limited to token endpoint auth method,
  grant types, and response types.

Redirect configuration is validated before network work. Each redirect is
either HTTPS or HTTP on `localhost`, `127.0.0.1`, or `[::1]`, contains no
userinfo or fragment, and contains only fixed non-secret routing query data.
The CIMD client identifier is HTTPS, has a non-root path, and has no userinfo,
query, or fragment.

For the selected, exactly validated issuer, client selection is:

1. exact configured pre-registration;
2. the exact stored credential found during selection, or an exact-issuer
   store lookup when selection did not already find one;
3. CIMD when metadata advertises
   `client_id_metadata_document_supported === true` and a valid CIMD client
   identifier is configured;
4. deprecated DCR when metadata contains a registration endpoint;
5. otherwise `UnsupportedRegistration`.

Configured pre-registration is saved through `AuthorizationClientStore` so
WP6D consumes one handle-based boundary. CIMD uses its URL as `clientId` and
is likewise saved under the selected issuer; changing issuers never triggers
DCR, but creates/reuses the portable CIMD identity under the new exact issuer.
Existing stored DCR credentials are reused before a new CIMD/DCR operation.

DCR sends a redacted UTF-8 JSON byte body with a redacted `content-type` header.
It contains only the configured public metadata, the resolved stable scope
string when nonempty, and an `application_type`:

- `native` when any redirect uses HTTP loopback or an HTTPS loopback host;
- `web` when every redirect is remote HTTPS.

The request defaults to `grant_types: ["authorization_code", "refresh_token"]`,
`response_types: ["code"]`, and `token_endpoint_auth_method: "none"` unless
valid configuration supplies those public fields. The registration response
must be a bounded JSON object with required nonempty `client_id` and optional
`client_secret` and `registration_access_token`. Secret response strings are
wrapped in `Redacted` immediately, are never retained in errors, and the saved
credential's issuer is always the selected validated issuer regardless of any
untrusted response extension. Non-2xx or malformed responses yield closed
`RegistrationFailed`/decode errors with numeric status only.

### Scope resolution

Scope values are already decoded `AuthorizationScope` values. The engine
builds one frozen `AuthorizationScopeSet`, removes only exact duplicates, and
preserves first appearance in this order:

1. scopes from the exact prior grant, when supplied;
2. explicitly requested scopes;
3. scopes from the current 401/403 challenge.

If all three sources are empty and there is no challenge scope source, use the
protected-resource metadata `scopes_supported` array; if it is absent, use an
empty set and omit `scope` from DCR/later requests. A challenge scope source is
authoritative for the current operation and is never replaced by
`scopes_supported`, but it is unioned with prior/requested scopes so step-up
authorization does not discard existing permissions. No semantic hierarchy,
sorting, case folding, or whitespace normalization is attempted.

If a prior grant handle is supplied, the stored grant must exactly match the
selected issuer and canonical resource before its scopes are used. A mismatch
fails closed and does not contribute scopes.

## Platform, data, and error boundary

The new engine requires only `AuthorizationHttpClient |
AuthorizationClientStore`; it returns `Effect` and preserves interruption.
It does not catch interruption as OAuth failure or use Promise callbacks.

The public HTTP port remains unchanged: every header value and body is
`Redacted`, and bodies are `Uint8Array`. Package-private helpers must implement
bounded strict UTF-8 and JSON encode/decode without `URL`, `TextEncoder`,
`TextDecoder`, `fetch`, Web request/response/header types, Node builtins,
`Buffer`, Promise, `@effect/platform`, or unstable Effect. URI decomposition
and well-known construction are platform-neutral string/byte operations with
focused adversarial tests. Maximum accepted JSON response size is 1 MiB;
oversize, invalid UTF-8, invalid JSON, non-object roots, accessors/proxies at a
trusted-port boundary, and malformed known fields fail closed.

Untrusted JSON crosses Effect Schema before becoming a metadata or
registration value. No public function casts `unknown`, returns a
`ParseResult.ParseError`, or interpolates a response body, URI query,
credential, scope string, or secret into an error. Existing
`AuthorizationHttpError` and `AuthorizationStoreError` values pass through
unchanged. Semantic failures use the existing closed
`AuthorizationProtocolError` reasons and safe optional status/issuer/resource
fields. Metadata structural failures use `AuthorizationDecodeError` with only
the model and bounded known paths. DCR structural failures may use
`RegistrationFailed` until a separately reviewed public registration model is
needed; no raw parse detail escapes.

## Exact internal API and file ownership

WP6C production changes are limited to new package-private modules under
`src/auth/client/` plus only narrowly required shared helper/model amendments:

- `uri.ts` — parsed safe URI snapshot, contextual HTTPS/loopback checks, and
  exact well-known candidate construction;
- `json.ts` — bounded strict UTF-8/JSON redacted byte conversion;
- `discovery.ts` — protected-resource and authorization-server discovery;
- `registration.ts` — configuration validation and credential selection/DCR;
- `resolution.ts` — deterministic issuer selection, stable scope union, and
  the composed WP6C engine;
- `models.ts` — only package-private/final-purpose type additions if avoiding
  duplication requires them;
- `common.ts` — only a reusable internal safe-URI snapshot helper if the new
  URI module cannot consume the existing validation without duplicating it.

The intended package-private entry points are:

```ts
discoverProtectedResourceMetadata(input)
discoverAuthorizationServerMetadata(issuer)
selectAuthorizationServer(input)
resolveAuthorizationCredential(input)
resolveAuthorizationScopes(input)
resolveAuthorizationContext(input)
```

Their exact TypeScript types are frozen by the meaningful RED fixture before
production. `resolveAuthorizationContext` returns the decoded protected-resource
metadata, exact selected issuer, decoded authorization-server metadata,
credential handle, canonical resource, and frozen resolved scopes. It requires
only the two injected WP6B ports. Sub-functions expose no raw secret.

No `src/auth/client.ts`, public service accessor, package export, root export,
legacy OAuth file, transport, example, generated source, dependency, lockfile,
package script, readiness checker, conformance ledger, or docs other than the
SDD report may change in WP6C. If implementation needs a different tracked
file, stop and amend this preflight before editing.

New focused tests are limited to:

- `test/auth/wp6c-discovery.test.mjs`;
- `test/auth/wp6c-registration.test.mjs`;
- `test/auth/wp6c-scopes.test.mjs`;
- `test/auth/wp6c-security.test.mjs`;
- `test/types/wp6c-auth-resolution/*` only if an ES2022/no-DOM declaration
  fixture is needed for the package-private final-purpose types.

The existing WP6B package graph test remains unchanged because the public
surface does not change. WP6C security tests explicitly scan every new emitted
JS/declaration file so the files are already safe before WP6D makes them
reachable from the public graph.

## Meaningful committed RED

After this preflight is approved and committed, the first implementation
commit contains tests/type fixtures only. The RED must fail because the WP6C
engine is absent, while accepted build and WP6B focused tests remain green.
It must prove at least:

1. explicit PR metadata URI precedence and no fallback;
2. endpoint-path then root PR metadata fallback, exact request order, and
   fail-closed status/malformed/oversize/UTF-8/JSON cases;
3. canonical resource same-origin/path-boundary validation;
4. exact two/three AS discovery candidate orders;
5. exact, unnormalized issuer match and no default endpoint fabrication;
6. multiple advertised issuers selected by pre-registration, then stored
   credential, then document order, without cross-issuer credential reuse;
7. pre-registration, stored reuse, CIMD, DCR, and unsupported precedence;
8. CIMD HTTPS/path validation and portability across issuers;
9. DCR exact redacted request shape, native/web `application_type`, safe
   response decoding, immediate secret redaction, exact issuer binding, and
   closed non-2xx/malformed failure;
10. stable prior/requested/challenged scope union, exact deduplication,
    metadata fallback, and prior-grant issuer/resource validation;
11. every port method returns/propagates Effect, injected interruption remains
    interruption, and no secret/body/query sentinel reaches an error or
    inspection/JSON/property walk;
12. all new emitted graphs contain none of the forbidden platform terms;
13. the public 24-key auth client surface, root legacy deferral, package export
    list, dependencies, lockfile, transports, and examples are unchanged.

A missing-module assertion is acceptable only when the rest of the fixture is
already syntactically/type valid and the baseline green commands prove the
failure is the absent WP6C module, not a dependency or fixture defect. Record
exact exit codes, test counts, and diagnostics.

## GREEN and verification gate

Implement only the frozen files after the committed RED. Do not weaken a RED
assertion. The candidate gate on explicit NVM Node `v22.22.3` is:

```bash
CI=true pnpm run build
node --test test/auth/wp6c-discovery.test.mjs
node --test test/auth/wp6c-registration.test.mjs
node --test test/auth/wp6c-scopes.test.mjs
node --test test/auth/wp6c-security.test.mjs
pnpm exec tsc -p test/types/wp6c-auth-resolution/tsconfig.json --noEmit # if created
node --test test/auth/wp6b-client-boundary.test.mjs test/auth/wp6b-protected-resource-boundary.test.mjs
node --test test/packaging/wp6b-auth-subpaths.test.mjs
CI=true pnpm run test:wp5-core
CI=true pnpm run test:wp4-http
CI=true pnpm run verify
```

Repeat build, all WP6C focused groups, any type fixture, WP6B focused/package,
WP5 core, WP4 HTTP, and full verify on explicit NVM Node `v24.15.0`. Do not use
`/opt/homebrew/opt/node@24/bin/node`; it is not the accepted Node 24 runtime on
this machine.

Official client-auth/authorization conformance and a real external AS are not
WP6C gates because the public OAuth flow and transport integration do not yet
exist. Their absence is not a pass and remains deferred to WP6F. No local test
may be called official conformance or Tier qualification.

## Independent immutable review and acceptance

After GREEN, the implementer records a review package containing:

- accepted base, preflight, RED, code, and evidence commits/trees;
- binary full-index hashes for RED-only, code-only, full WP6C, and cumulative
  accepted-base ranges;
- a candidate archive hash and complete file inventory;
- exact Node/pnpm paths and command outputs/counts;
- proof that dependencies, lockfile, public runtime keys, package exports,
  root, transports, examples, generated output, and WP6D+ files are unchanged;
- all intentional non-runs and remaining gates.

A fresh reviewer receives only the immutable package/commits, reviews both
specification compliance and Effect/code quality, and reruns risk-proportionate
gates. Resolve every Critical or Important finding with its own meaningful RED
and re-review. A Minor may remain only when explicitly adjudicated as safe and
recorded. WP6C is complete only after `APPROVE`, a clean tracked tree, exact
identity reproduction, dual-runtime evidence, and an acceptance closeout
commit in `.superpowers/sdd/task-6-report.md`.

## Explicit exclusions

WP6C does not implement or change:

- state, PKCE generation/validation, redirect validation at callback time,
  callback parsing, authorization-response `iss`, authorization denials,
  token exchange/refresh, RFC 8707 request serialization, opaque token or
  audience validation (WP6D);
- bearer extraction, Authorization header ownership, 401/403 or
  `WWW-Authenticate` parsing, retry budgets, verifier middleware/hooks,
  `authInfo` removal, `verifiedAuthorizationPrincipal`, principal propagation,
  challenge serialization, or protected-resource HTTP metadata routes (WP6E);
- root `OAuth`/`OAuthProviders`/`OAuthErrors` removal, legacy example migration,
  cumulative `test:wp6`/verify governance, official conformance, external-AS
  coordination, readiness/ledger/docs, issue/PR disposition (WP6F);
- a general authorization server, secrets, credentials, `.env`, remote
  mutation, release, publication, WP7+, Tier application, designation, or Goal
  completion.

## Stop conditions

Stop and return to the coordinator before editing when any of these is needed:

- a new dependency, platform/Web/Node type, Promise API, public runtime key,
  package export, live/default/partial Layer, or root compatibility shim;
- a change to the accepted WP6B redaction, schema, error, store, or service
  contract that is not a narrow preflight-authorized internal helper;
- automatic issuer normalization, fallback to unadvertised issuers, credential
  reuse across issuers, default endpoint fabrication, or a response-body error;
- any WP6D/WP6E/WP6F behavior or file;
- external authorization-server provisioning/mutation, secret access, push,
  merge, issue close, release/tag/npm action, Tier claim, or Goal completion.

WP6C acceptance will prove only the package-private discovery, registration,
credential-binding, and scope-resolution engine. It will not prove a complete
OAuth flow, transport authorization, official conformance, release readiness,
Tier status, WP6 completion, or Goal completion.
