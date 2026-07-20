# Task 6 preflight: authorization client and protected-resource boundaries

## Status and approval gate

This document freezes WP6 before any RED test, production, dependency, example,
checker, or public-documentation edit. It is a planning artifact only.

- Frozen base: accepted WP5H closeout
  `21c6b4f7ebb93854f519a2a709a9d53e2dcf887d` (tree
  `9577ee96ff15a532cb5e31c873341a09fe243cff`).
- Isolated linked worktree: `/private/tmp/mcp-effect-sdk-wp6` on
  `codex/wp6-authorization`.
- Implement only WP6 after coordinator approval. Stop after committing this
  preflight and do not create the RED witness until that approval is explicit.
- Preserve the accepted WP2-WP5H behavior, generated MCP `2026-07-28`
  surfaces, stateless transports, modern core API, and package-health gates.
- Do not read or write secrets, `.env` files, credentials, or private config.
  Do not mutate remotes, issues, PRs, releases, tags, npm, Goal state, or an
  external authorization system. Do not implement WP7+.

## Authorities, provenance, and precedence

Implementation and review use this precedence, without combining conflicting
sources opportunistically:

1. Pinned MCP core `2026-07-28` schema and authorization prose at commit
   `26897cc322f356487da89113451bd16b520b9288` are normative.
2. A pinned extension is authoritative only inside its own extension scope.
3. `@modelcontextprotocol/conformance@0.2.0-alpha.9` at pinned harness commit
   `ce25103b1baa6e0653e0b7bf4f79de385ea7a116` is a validation oracle, not
   normative protocol prose.
4. TypeScript SDK v2 and the local PR #27 branch are design and regression
   oracles only. They cannot replace the pinned core contract or define this
   package's Effect-native public API.
5. Effect references are optional ergonomic inspiration only. WP6 adds no
   Effect dependency, runtime dependency, generator, compiler, or tooling.

Before any behavior implementation, vendor and manifest these exact normative
authorization files from the pinned core commit under the existing `mcp-core`
source family. Preserve their paths, hashes, license, and refresh/check policy:

| Pinned upstream path | SHA-256 |
| --- | --- |
| `docs/specification/draft/basic/authorization/index.mdx` | `4e1e0b760e8c9ff7bc322502dccf4450cd626036648b8221f66eb4be371da3c3` |
| `docs/specification/draft/basic/authorization/authorization-server-discovery.mdx` | `22e2841a5e561afa1bd246c9e3cac64392402b3cac19d33da1e5d0987ccb3df8` |
| `docs/specification/draft/basic/authorization/client-registration.mdx` | `462d87866544bef7ce44fcbd6fcbb615eb30708e635d4d33a72ea7ae49866c23` |
| `docs/specification/draft/basic/authorization/security-considerations.mdx` | `592befe83fe38e7184fda6e18a4dfba9748ab50280ea31fe1ad64974065a1612` |

The current `sources/manifest.json` vendors core schema/spec-index/Streamable
HTTP material but not this four-file authorization directory. The current
vendored conformance source contains package/license metadata but no auth
fixture source. Therefore:

- the first post-approval commit is provenance-only and must make
  `test:source-refresh` prove these exact files and hashes;
- no behavior may be called normatively reviewed before that commit;
- no harness behavior may be promoted into the wire contract merely because
  alpha.9 expects it;
- no simulated issuer test or local runner result can support an external
  protected-resource qualification claim.

## Evidence reviewed

The preflight is based on complete reads of the execution prompt, implementation
plan, root/project instructions, accepted WP5 report, roadmap, migration guide,
scenario map, Tier evidence, readiness requirements, manifest, conformance
package metadata, authorization sources, public entrypoints, both HTTP transport
kernels, active Everything examples, relevant HTTP tests, conformance runners,
conformance evidence checker, readiness runner, and readiness compiler.

It also includes the complete local diffs and commit history for PR #27's two
input commits:

- `7f19e5e32ec024689b589fbf5ee1276d5832c185` — draft OAuth hardening.
- `d82a50e5257e83bd6906363acc19e2633b634e79` — optional callback issuer
  extraction correction; it does not remove metadata-conditioned validation.

No PR commit will be cherry-picked. Equivalent behavior is ported behind the
new architecture only where it remains correct under the frozen authorities.

## Current behavior and gaps at the frozen base

### OAuth client

The current implementation lives in `src/auth/auth.ts`,
`src/auth/OAuthClientProvider.ts`, `src/auth/providers.ts`, and
`src/auth/errors.ts`. It is a mutable Promise/callback API using Node
`crypto`, JSON casts, and root namespaces `OAuth`/`OAuthProviders`.

Existing behavior worth preserving through tests includes:

- protected-resource metadata lookup and discovery fallback;
- PKCE with S256 and a generated verifier/challenge;
- resource selection and resource-indicator use during authorization/token
  exchange;
- pre-registered client information, CIMD, and DCR paths;
- private-key JWT, client-credentials, and cross-app credential providers;
- challenge-triggered authorization and one bounded request retry;
- request cancellation reaching discovery/authorization fetches.

The current gaps against WP6 are:

- it selects only `authorization_servers[0]` rather than handling multiple
  advertised issuers deliberately;
- it does not enforce exact issuer matching throughout discovery, selection,
  credentials, and response processing;
- stored credentials are not reliably partitioned by selected issuer;
- state, redirect URI, authorization-response `iss`, and token audience are
  not validated as one transaction;
- requested scope replaces rather than unions prior grants and newly required
  challenge scope;
- registration priority and downgrade boundaries are not one typed policy;
- parsing, network, metadata, registration, token, validation, and user-action
  failures are not represented in an Effect error channel;
- Node crypto and Promise callbacks leak into the auth core instead of being
  explicit platform/service boundaries.

### HTTP client transport

`StreamableHttpClientTransport` currently reads mutable provider tokens for
each request, overwrites `Authorization`, parses challenges loosely, and runs
the legacy Promise authorization flow for any `401` or `403`. It casts the
provider to retrieve a redirect code and has no authorization-response issuer
input. Its auth retry shares a budget with the accepted bounded protocol-header
recovery path.

WP6 must retain cancellation and bounded retries while making status/challenge
semantics explicit:

- `401` drives missing/invalid-token reauthorization only when a valid bearer
  challenge and client auth service permit it;
- `403` with insufficient scope may drive cumulative scope escalation, but a
  generic forbidden response is not an automatic login loop;
- the transport receives an Effect-native authorization service, not a raw
  mutable token callback contract;
- user-supplied bearer headers cannot bypass or race SDK-owned authorization;
- raw access tokens never enter MCP request envelopes, request annotations,
  errors, logs, evidence, or public principals;
- auth retry remains bounded independently from header-mismatch recovery, with
  no multiplication between the two budgets.

### Protected-resource server

`StreamableHttpServerTransport` currently trusts an upstream
`HandleRequestOptions.authInfo` object. That object may include `token` and is
passed through to `McpRequestContext`. There is no SDK-owned bearer extraction,
`TokenVerifier`, protected-resource metadata helper, scope policy, or
standards-correct challenge helper.

WP6 introduces a verifier boundary before dispatch:

- raw bearer text is input only to `TokenVerifier` and is never propagated;
- a successful verifier returns a token-free `AuthorizationPrincipal` with
  stable identity/client/scopes/claims suitable for authorization decisions;
- only that verified principal reaches `McpRequestContext` and notification
  context;
- missing/malformed/invalid/expired tokens map to a `401` Bearer challenge;
- an authenticated principal lacking required scope maps to `403` with an
  `insufficient_scope` challenge and required scope where applicable;
- protected-resource metadata and `resource_metadata` challenge linkage are
  derived from explicit configuration, not request headers;
- verifier defects and cancellation stay typed and are not reported as token
  validity facts accidentally.

Replace `authInfo` outright with the explicitly named low-level
`verifiedAuthorizationPrincipal` embedding hook. It uses the protected-resource
principal type, rejects any token-bearing shape, cannot be populated from
network data, is available only when no configured verifier owns the request,
and never bypasses configured verification. The preferred public path is the
new `auth/protected-resource` service and middleware/hook.

### Evidence and accounting

- `pnpm run verify` is package health and currently owns `test:wp5-core`.
- `pnpm run conformance:client-auth` is an intentionally separate official
  client-auth evidence lane with literal `--spec-version 2026-07-28`.
- The latest accepted report records alpha.9 client-auth at exit 1: 14
  scenarios, 225 passes, 12 failures, and 1 warning. The failures concern DCR
  `application_type`; the warning concerns cumulative scope.
- `pnpm run conformance:authorization` requires an explicit external target or
  settings file. Missing configuration is a blocker artifact, not a skipped
  pass. It is an optional external-integration lane, not ordinary package
  readiness.
- Readiness currently accounts #20 as `deferred-wp6`. WP6 may update that to a
  truthful local implementation state only after candidate acceptance. It may
  not close/reclassify issue #20 or imply external resolution.
- Official core conformance, release provenance, maintenance history, agent
  evidence, final-spec reconciliation, publication, and Working Group Tier
  designation remain separate blockers.

## PR #27 port contract

### Invariants to port and re-prove

1. DCR `application_type` is `native` if any registered redirect URI uses a
   non-HTTPS scheme or a localhost/loopback host; otherwise it is `web`.
2. Credentials and registration records are bound to the selected exact
   issuer. A record for another issuer is never sent, refreshed, or reused.
3. CIMD is preferred when advertised and configured; explicit pre-registration
   remains authoritative; deprecated DCR is a last fallback only.
4. The selected issuer is retained with credentials created through CIMD or
   DCR so later use can prove the partition.
5. If an authorization response contains `iss`, it must exactly equal the
   selected, discovered issuer.
6. Scope escalation is the deterministic union of all previously granted
   scopes and all newly required scopes; it never silently drops a prior grant.

### Source-corrected response `iss` behavior

The pinned authorization overview is normative. Commit `d82a50e` made callback
issuer extraction optional, but it did not remove the metadata-conditioned
validator from `7f19e5e`. Apply the pinned table exactly:

- metadata `authorization_response_iss_parameter_supported === true` and a
  present `iss`: compare it to the recorded issuer using exact simple-string
  comparison;
- metadata `authorization_response_iss_parameter_supported === true` and an
  absent `iss`: reject before token exchange;
- metadata flag false or absent and a present `iss`: compare it to the recorded
  issuer using exact simple-string comparison;
- metadata flag false or absent and an absent `iss`: proceed.

Never normalize issuer strings before comparison: no scheme/host case folding,
default-port elision, trailing-slash change, or percent-encoding normalization.
A mismatch, malformed issuer, or metadata-conditioned absence fails before the
client acts on an error response or sends a code to any token endpoint.

### Stale code and evidence not to port

- the removed `src/transport/HttpTransport.ts` patch;
- the legacy mutable Promise/Node-crypto public API;
- root-only OAuth namespaces as the final WP6 package boundary;
- casts used to obtain authorization codes or parse metadata;
- the standalone seven-case script as sufficient coverage;
- alpha.7 documentation and its historical 569-check claim;
- any unconditional `iss` rule from either PR commit that ignores the pinned
  metadata-conditioned table;
- any implication that client-auth success proves a protected resource, real
  external AS integration, release readiness, issue closure, or Tier status.

## Frozen WP6 architecture

### Boundary 1: `mcp-effect-sdk/auth/client`

The new public subpath owns OAuth client orchestration. Its public operations
return `Effect.Effect<Success, AuthorizationClientError, Requirements>` (or a
more specific typed error union), never a raw `Promise`. Promise/fetch/browser
callbacks are adapted once at platform edges with cancellation preserved.

The public contract owns these roles (final names may only change during RED
review if a collision is demonstrated):

- `AuthorizationClient` — transaction orchestration and challenge handling;
- `AuthorizationClientConfig` — protected resource, redirect, requested
  scopes, optional issuer selection policy, and registration policy;
- `AuthorizationTransaction` — opaque, one-use state/PKCE/issuer/redirect/
  resource binding passed between start and callback completion;
- `AuthorizationClientStore` — issuer-keyed credentials, tokens, grants, and
  pending transactions with explicit Effect failures;
- `AuthorizationInteraction` — user-agent/redirect callback boundary, with no
  implicit navigation in the core;
- `AuthorizationHttpClient` and `AuthorizationCrypto` — injectable platform
  boundaries for HTTP, random bytes, hashing, and signing;
- metadata, credential, token, challenge, scope, and registration models with
  schema-backed decoding at untrusted boundaries.

The subpath must implement and test:

- protected-resource metadata and multiple authorization-server discovery;
- deterministic issuer selection and exact issuer validation, including URL
  normalization rules that do not broaden equality;
- issuer-keyed credentials/tokens/transactions with no cross-issuer fallback;
- PKCE S256, high-entropy verifier/state, one-use state, callback redirect URI
  equality, and replay rejection;
- RFC 8707 resource parameters on authorization and token requests where the
  frozen contract requires them;
- audience validation of returned token claims/introspection results through a
  typed validation input, without treating an opaque token as a JWT;
- metadata-conditioned/exact response `iss` behavior above;
- explicit pre-registration, CIMD, then deprecated DCR fallback priority;
- DCR application type selection and deprecated annotation;
- cumulative, normalized scope union across prior grant and new challenge;
- no secret/token values in errors, inspection output, logs, or evidence.

The stable auth subpath may expose the DCR fallback required by the plan, but
the fallback itself is marked deprecated. It does not leak into
`mcp-effect-sdk/deprecated`, the root, client, server, or transport entrypoints.

### Boundary 2: `mcp-effect-sdk/auth/protected-resource`

The new public subpath owns server-side bearer verification and response
helpers, not an authorization server. It owns:

- `TokenVerifier` — an Effect service from raw bearer input plus request facts
  to a token-free `AuthorizationPrincipal` or typed verification error;
- `AuthorizationPrincipal` — identity/client/scopes/claims without a raw token;
- `ProtectedResourceMetadata` construction/serialization;
- bearer extraction and verification middleware/hooks usable by the
  Streamable HTTP server adapter;
- scope authorization helpers that distinguish unauthenticated from
  authenticated-but-insufficient;
- deterministic `WWW-Authenticate` helpers for `401` and `403`, including
  escaping, scope, and protected-resource metadata linkage;
- an explicit already-verified embedding adapter if compatibility requires it,
  with a token-free input type.

It does not own authorization endpoints, login pages, consent, token issuance,
key management, user directories, DCR endpoints, or a general AS framework.

### Boundary 3: optional external authorization server

The real AS is an external test fixture/target controlled through the existing
authorization conformance settings/URL contract. This boundary:

- is opt-in and excluded from `verify` and package-readiness commands;
- reads configuration only in the runner process and never commits values;
- redacts client secrets, access tokens, authorization codes, and cookies from
  output/evidence;
- records exact harness package, literal spec version, command, target kind,
  case/check/failure/warning totals, and artifact location without recording
  credentials;
- must pass for a protected-resource release qualification claim;
- cannot be replaced by local mocks, simulated issuers, or client-auth alone.

No implementation work may provision, mutate, or administer that external AS.

## Typed error and Effect contract

Auth failures are inspectable tagged values, not thrown strings, unchecked
JSON exceptions, or collapsed `TransportError`s. Use the repo's Effect 3
`Data.TaggedError`/`Schema.TaggedError` and `Context.Tag` conventions.

At minimum the typed union must preserve these distinct categories:

- metadata/discovery failure, malformed metadata, and issuer mismatch;
- unsupported authorization server or registration method;
- credential missing, credential issuer mismatch, and credential-store failure;
- invalid challenge and insufficient/malformed scope challenge;
- state mismatch/replay, redirect mismatch, response issuer mismatch, and
  authorization denial;
- PKCE/crypto/platform failure;
- registration, token endpoint, refresh, and token decode/validation failure;
- resource indicator and audience mismatch;
- interaction/callback failure and cancellation;
- bearer missing/malformed, token invalid/expired, verifier unavailable, and
  insufficient scope.

Errors may contain safe issuer/resource/scope/status metadata but never client
secrets, private keys, access/refresh tokens, codes, verifiers, raw bearer
headers, or full credential objects. `Cause` handling must preserve interrupts
and defects; cancellation cannot become an OAuth rejection or a retry.

## Required behavior matrix

Every plan case is owned by an explicit test, not only a checker substring:

| Area | Required cases |
| --- | --- |
| Discovery | protected-resource metadata, missing metadata policy, multiple advertised issuers, selected issuer metadata, exact issuer mismatch, malformed/unsafe URLs |
| Credentials | issuer partition, same-issuer reuse, cross-issuer rejection, pre-registration, CIMD, DCR priority/fallback, DCR native/web `application_type` |
| Authorization transaction | PKCE S256, strong state, one-use state, state mismatch, exact redirect, redirect mismatch, resource indicator, cancellation |
| Callback | metadata flag true/false/absent crossed with present/absent `iss`, exact/mismatched/invalid `iss`, authorization error, no exchange or error display after validation failure |
| Tokens | authorization-code exchange, refresh, resource parameter, audience success/mismatch, opaque-token validation boundary, safe error redaction |
| Scope | prior plus new union, duplicates, ordering normalization, no requested scope loss, insufficient-scope escalation |
| Client HTTP | valid 401 challenge, 403 insufficient scope, generic 403 no login loop, bounded retry, independent header-recovery budget, abort propagation, no user token bypass |
| Protected resource | missing/malformed/invalid/expired bearer, verifier cancellation/defect, verified principal propagation, no token propagation, required-scope pass/fail, correct 401/403 challenges and metadata link |
| Packaging | exact stable auth subpaths, no deep imports, no Node built-in in root/browser graphs, no DOM type in root/Node graphs, deprecated DCR only at auth fallback |
| External evidence | alpha.9 client-auth zero failures; real external AS protected-resource integration; missing target remains explicit blocker |

## Bounded file and symbol ownership

Production/public ownership after approval is limited to:

- `src/auth/client.ts` — public `./auth/client` entrypoint;
- `src/auth/client/**` — client services, schemas/models, transaction, scope,
  discovery, registration, and platform adapters;
- `src/auth/protected-resource.ts` — public `./auth/protected-resource`
  entrypoint;
- `src/auth/protected-resource/**` — verifier/principal/metadata/challenges;
- the four current `src/auth/*` files, only for a bounded migration/removal or
  compatibility shim proved by tests;
- `src/transport/StreamableHttpClientTransport.ts` and
  `src/transport/StreamableHttpServerTransport.ts`, only at the auth hooks;
- `src/transport/http.ts`, only to expose the approved HTTP/auth adapter types;
- `src/examples/everything-client.ts` and `everything-server.ts`, only for the
  compiling public auth examples and official fixture behavior;
- `package.json` exports/scripts and `scripts/verify.mjs` cumulative ownership;
- narrowly named WP6 auth tests/type fixtures/checkers/runners;
- source manifest/vendor files and operational auth/conformance/migration/
  readiness docs required for truthful accounting.

The root, `./client`, and `./server` do not become duplicate auth entrypoints.
WP6 removes root `OAuth`, `OAuthProviders`, and `OAuthErrors`; there is no
temporary compatibility shim. The authoritative stable contract is only the
two auth subpaths. Deprecated DCR fallback remains marked deprecated only
inside `./auth/client`. No generated protocol/schema output is edited because
OAuth metadata is not the generated MCP JSON-RPC surface.

If implementation requires files outside this list, stop and amend this
preflight with coordinator approval before editing them.

### Coordinator-approved WP6E compile migration (2026-07-19)

The committed WP6E RED and subsequent removal of the raw mutable
`authProvider` transport option exposed two active compile-only call sites:
`src/examples/core-protocol-catalog.ts` and
`src/examples/everything-client.ts`. Retaining a deprecated type-only transport
field would contradict the frozen no-shim architecture. WP6E therefore owns a
mechanical removal or Effect-authorization-option migration at only those two
call sites, in the same production GREEN as the transport removal. This
exception does not authorize new example behavior, example documentation,
package/script changes, or the compiling public authorization examples and
governance evidence reserved for WP6F.

### Coordinator-approved WP6E review repair (2026-07-19)

The first immutable WP6E review returned REQUEST CHANGES with six Important
findings and no Critical or Minor findings. The bounded repair may additionally
edit `src/auth/common.ts` only to enforce RFC 6750 `scope-token` grammar, and
may edit `src/auth/protected-resource.ts` plus
`src/auth/protected-resource/**` to add the already-frozen public bearer
extraction/verification, scope-policy, typed extraction-error, and serialized
challenge helpers. Corresponding existing WP6 auth boundary tests and the
focused WP6E runtime/type fixtures may be extended before production repair.

The same repair owns: removal of arbitrary authorized-fetch Causes from public
transport errors; pure-failure-only verifier classification so composite
defect/interruption Causes cannot become token facts; complete HTTP `token`
grammar for challenge schemes and auth-parameter names; and an explicit
HeaderMismatch-before-authorization retry-order witness. It does not authorize
dependencies, lockfiles, generated code, package/scripts, further example
changes, external targets, remotes, issues/PRs, releases, or Tier work.

### Coordinator-approved WP6E second review repair (2026-07-19)

The first repair rereview returned REQUEST CHANGES with one Important finding
and no Critical or Minor findings. The bounded second repair may edit only
`src/auth/protected-resource.ts`, `src/auth/protected-resource/services.ts`,
`src/transport/StreamableHttpServerTransport.ts`, and the existing exact
protected-resource export/runtime/type/source-reuse witnesses. It must add a
public Effect-native exact token-free principal/already-verified embedding
adapter, reuse it inside both `verifyBearerAuthorization` and the server's
`verifiedAuthorizationPrincipal` hook, and remove both private duplicate
normalizers.

The public adapter must fail typed for non-exact/token-bearing/hostile values,
must never accept a raw token, and must remain platform-neutral. Tests and type
fixtures are committed RED before production changes. This amendment does not
authorize any other auth behavior, dependency, lockfile, generated code,
package/script, example, external target, remote, issue/PR, release, Tier, or
Goal mutation.

### Coordinator-approved WP6F root export removal (2026-07-20)

The frozen public architecture requires WP6 to remove root `OAuth`,
`OAuthProviders`, and `OAuthErrors` with no compatibility shim, but the bounded
ownership list above omitted their existing export site in `src/index.ts`.
WP6F may therefore edit `src/index.ts` only to remove those three legacy root
namespace exports after a committed meaningful RED. It may update existing
exact-root/package/example witnesses only as needed to prove the deletion and
the two stable auth-subpath owners. This amendment does not authorize any other
root API change, root auth re-export, compatibility shim, production behavior,
dependency, generated output, or WP7+ work.

### Coordinator-approved WP6F core-catalog compile migration (2026-07-20)

The committed WP6F delivery RED and authorized root `OAuth` removal exposed
one additional active compile consumer in
`src/examples/core-protocol-catalog.ts`. That catalog still imports the legacy
root `OAuth` namespace and retains an unused mutable provider plus an
OAuth-named remote-client entry that no longer supplies authorization. WP6F
may edit only that file to remove the legacy root import, its two type aliases,
the dead provider class, the OAuth-named client function, and its catalog
property. The public Effect authorization example remains solely in the
authorized Everything client/server pair. This amendment does not authorize
new core-catalog behavior, a compatibility shim, any other example change,
dependency/generated/WP7 work, or a broader public API edit.

### Coordinator-approved WP6F DCR public-client interoperability repair (2026-07-20)

The first official alpha.9 client-auth run against WP6F GREEN `a326d19`
reached the real DCR fixtures and returned 136 passes, 15 failures, and zero
warnings. Nine scenarios failed at one shared accepted-runtime seam: the
client requested `token_endpoint_auth_method: "none"`, authorization-server
metadata advertised `none`, and the 201 registration response omitted
`token_endpoint_auth_method` but included an unsolicited `client_secret`.
The accepted selector rejected the secret/method combination before any
authorization or token request. Rewriting fixture responses in the example is
forbidden.

The MCP draft delegates DCR to RFC 7591. RFC 7591 defines `none` as a public
client without token-endpoint secret authentication and permits the server to
assign a secret; RFC 8252 further requires native-app secrets not to be treated
as proof of confidentiality. The bounded compatible behavior is therefore:

- only when the returned `token_endpoint_auth_method` member is absent and the
  requested/resolved method remains `none`, an unsolicited response
  `client_secret` is ignored and never persisted or sent;
- the stored credential remains an exact public client with method `none`;
- an explicitly returned `token_endpoint_auth_method: "none"` together with a
  secret remains a contradictory response and is rejected;
- confidential methods still require and persist a Redacted secret exactly as
  before, and advertised-method validation remains unchanged.

A fresh implementer must commit a focused RED before production. Ownership is
limited to `test/auth/wp6c-registration.test.mjs` and
`src/auth/client/registration.ts`. The RED must prove the omitted-method/
unsolicited-secret success case, absence of the secret from the saved
credential, and preservation of the explicit-none contradiction failure.
After GREEN, run focused registration/runtime/package tests, all three WP6
type fixtures, build, the cumulative WP6 gate, full verify, and official
client-auth on exact Node 22 and Node 24. Zero client-auth failures are
required; every warning is classified. Freeze a new immutable package and
obtain fresh independent review before WP6F acceptance. No other runtime,
example, package/script, dependency/lock/generated, external-AS, remote,
release, Tier, WP7+, or Goal mutation is authorized by this amendment.

### Coordinator-approved WP6F remembered-grant step-up repair (2026-07-20)

After DCR GREEN, exact Node 22 package verification passed and official
alpha.9 client-auth improved to 270 passes, zero failures, and one warning.
The remaining `scope-step-up-escalation` warning is blocking under this
preflight. Artifact
`.local/conformance/client-auth-2026-07-20T08-08-28-060Z` proves three
authorization requests all requested only `mcp:basic`; the final operation
received a valid 403 challenge for `mcp:write` and the client exited after its
already-consumed one-request auth retry.

The root cause is internal runtime lookup. After a successful initial
challenge grants `mcp:basic`, the next `currentGrant` call has no challenge and
reapplies protected-resource `scopes_supported` fallback (`mcp:basic` plus
`mcp:write`). The exact-scope store lookup therefore cannot find the valid
narrower grant, sends the next MCP request unauthenticated, and consumes the
retry before its operation-specific 403. This contradicts the pinned scope
selection and step-up flow, which makes a current challenge authoritative and
requires the prior-plus-new union on reauthorization.

A fresh implementer must commit focused RED before production. Ownership is
limited to `test/auth/wp6-client-runtime.test.mjs` and
`src/auth/client/runtime.ts`. The internal resource-bound runtime may remember
the last successfully audience-validated grant handle. On each `currentGrant`
it must re-read and snapshot that handle, revalidate exact issuer, canonical
resource, client identity, expiry, and that its scopes contain every explicit
configured/request scope before reuse. Protected-resource metadata fallback
remains the initial selection rule when no compatible remembered grant exists;
it must not expand the minimum needed to reuse a valid prior grant. Expired
grants still refresh or are removed through Effect Clock; invalid-token removal
must clear the remembered handle; successful refresh or authorization records
the returned handle only after validation/persistence succeeds. Mismatch,
hostile store data, failed refresh, interruption, and typed errors remain
fail-closed. No public API or store interface changes.

RED must prove the real sequence: initial explicit `mcp:basic` acquisition
while metadata advertises `mcp:basic mcp:write`; a later no-challenge
`currentGrant` reuses that stored basic grant without AS discovery or another
interaction; a 403 `mcp:write` challenge then authorizes with the deterministic
`mcp:basic mcp:write` union. It must also prove a remembered grant cannot
bypass explicit scope requirements or expiry/removal. After GREEN, rerun the
focused runtime/HTTP/registration and real package matrix, all WP6 type
fixtures, cumulative WP6/WP5/WP4, full verify, and official client-auth on
exact Node 22 and Node 24. Zero failures and zero warnings are required. No
other runtime, transport, example, package/script, dependency, external-AS,
remote, release, Tier, WP7+, or Goal mutation is authorized.

### Coordinator-approved WP6F stale root-witness correction (2026-07-20)

The first cumulative `test:wp6` after the authorized root removal reached one
older accepted assertion in `test/auth/wp6c-security.test.mjs` that still
required root `OAuth`, `OAuthProviders`, and `OAuthErrors` objects. This is the
inverse of the frozen WP6 public boundary and the committed WP6F package RED.
WP6F may edit only those three assertions to require absence of the removed
root namespaces. No other WP6C security expectation, source behavior, auth
subpath, package surface, or test ownership is authorized by this correction.

### Coordinator-approved WP6F parity/readiness checker repair (2026-07-20)

The next exact Node 22 full verification failed at `check:ts-sdk-parity`
because its ledger validator still permits `evidence` and
`implemented-locally` only for WP5, while the authorized WP6F ledger now
records the same local-only state for WP6. A coordinator diagnostic also ran
the updated tier feature checker followed by readiness compilation and proved
that `scripts/check-sdk-readiness-requirements.mjs` still expects issue #20 as
`deferred-wp6`, producing a mismatched GR-TIER-001 result. The original WP6F
governance RED used an over-broad source regex and did not catch that exact
map entry.

WP6F may add and commit a meaningful repair RED only in
`test/packaging/wp6-auth-governance.test.mjs` that executes or otherwise
exactly proves the parity validator and exact #20 expected-status entry. After
that RED, production repair is limited to
`scripts/check-ts-sdk-parity.mjs` and
`scripts/check-sdk-readiness-requirements.mjs`: validate the exact WP6 ledger
fields/status/evidence already committed, and require #20
`implemented-locally`. All WP5 and WP7-WP11 accounting, blocker semantics,
remote approval status, and non-qualification language remain unchanged. No
other test, checker, evidence schema, production behavior, dependency,
external target, release, Tier, WP7+, or Goal mutation is authorized.

### Coordinator-approved WP6F WP4 ledger-witness correction (2026-07-20)

After the parity/readiness repair, full Node 22 verification reached the
historical WP4 governance witness and failed because
`test/packaging/wp4-governance.test.mjs` still requires every ledger item
after WP5 to be deferred and permits evidence only on WP5. WP6F may edit only
that test's ledger assertions so WP5 and WP6 are `implemented-locally` with
their exact evidence fields, while WP7-WP11 remain deferred without evidence.
All other WP4 governance, script ownership, frozen-oracle, and package
assertions remain unchanged. No production, checker, dependency, external,
release, Tier, WP7+, or Goal change is authorized.

### Coordinator-approved WP6F WP5 ledger-witness correction (2026-07-20)

The corrected WP4 witness passed, and cumulative `test:wp5-core` then reached
the same stale assumption in `test/packaging/wp5h-governance.test.mjs`: it
requires WP6 and every later package to remain deferred. A repository-wide
search found no other test retaining that WP6 expectation. WP6F may edit only
that test's deferred-ledger case to assert the exact WP5 and WP6 local evidence
objects already validated by the parity checker, while WP7-WP11 remain
deferred. All other WP5 alias, documentation, remote-approval, qualification,
and governance assertions remain unchanged. No production, checker,
dependency, external, release, Tier, WP7+, or Goal change is authorized.

## Meaningful committed RED sequence

After preflight approval and the provenance-only source commit, add tests before
the production behavior they specify. Do not bundle all missing behavior into
one noisy RED. Each RED commit records exact tests, pass/fail counts, and the
intended missing contract; accepted earlier suites remain green.

1. **Public Effect auth boundary RED**
   - `test/auth/wp6-client-boundary.test.mjs`
   - `test/auth/wp6-protected-resource-boundary.test.mjs`
   - `test/types/wp6-auth-public/**`
   - Proves both package subpaths, Effect return/error channels, exact public
     roles, graph/platform constraints, and secret-safe tagged errors.
   - Expected RED: subpaths/modules/types do not exist.
2. **Discovery, issuer, registration, and scope RED**
   - `test/auth/wp6-client-discovery.test.mjs`
   - `test/auth/wp6-client-registration.test.mjs`
   - `test/auth/wp6-client-scope.test.mjs`
   - Proves multiple/exact issuers, issuer-bound credentials, registration
     priority, DCR application type, cumulative scope, and all four metadata /
     response-`iss` combinations.
   - Expected RED: first-issuer selection, unbound records, replacement scope,
     and absent callback issuer support in the current API.
3. **Transaction and token validation RED**
   - `test/auth/wp6-client-transaction.test.mjs`
   - `test/auth/wp6-client-token.test.mjs`
   - Proves PKCE/state/replay/redirect/resource/audience/cancellation and no
     exchange after callback validation failure.
   - Expected RED: state/redirect/issuer/audience transaction validation is
     absent from the current implementation.
4. **HTTP client integration RED**
   - Extend the relevant `wp4-http-client` contract through a new focused
     `test/http/wp6-http-client-auth.test.mjs` rather than weakening WP4.
   - Proves challenge parsing/status distinction, cumulative-scope retry,
     independent retry budgets, abort propagation, and no token passthrough or
     caller-header bypass.
   - Expected RED: generic 403 triggers legacy auth and auth shares the header
     mismatch retry budget.
5. **Protected-resource integration RED**
   - `test/http/wp6-http-protected-resource.test.mjs`
   - `test/types/wp6-auth-protected-resource/**`
   - Proves bearer extraction, verifier interaction, token-free principal,
     exact 401/403 challenges, metadata linkage, scopes, and trusted-hook
     restrictions.
   - Expected RED: no verifier/middleware/challenge helpers and current
     `AuthInfo.token` propagation.
6. **Packaging, examples, governance, and evidence RED**
   - `test/packaging/wp6-auth-subpaths.test.mjs`
   - `test/packaging/wp6-auth-examples.test.mjs`
   - `test/packaging/wp6-auth-governance.test.mjs`
   - packed consumer and source-import allowlist coverage where the accepted
     WP5H fixtures can be extended coherently;
   - conformance runner/evidence tests that require literal
     `--spec-version 2026-07-28`, alpha.9, zero client-auth failures, safe
     external evidence, and explicit missing-target failure.
   - Expected RED: auth subpaths/aliases/accounting/examples are absent and #20
     remains deferred.

No production edit may precede its relevant committed RED. A RED that fails
because dependencies are missing, the build is broken, a fixture cannot start,
or an assertion is unrelated is not meaningful and must be repaired before
implementation.

## Candidate atomic commit sequence after approval

1. `sources: pin MCP draft authorization prose` — vendor the four exact files,
   update manifest/refresh/check evidence only.
2. `test: define WP6 Effect auth boundaries` — first meaningful RED.
3. `feat: add Effect authorization client services` — public boundary, typed
   errors, platform adapters.
4. `test: define WP6 OAuth discovery and transaction contract` — second and
   third meaningful RED groups, split if review size requires it.
5. `feat: harden OAuth issuer registration and transactions` — port only the
   approved PR #27 invariants plus plan cases.
6. `test: define WP6 HTTP authorization integration` — client and protected-
   resource RED groups.
7. `feat: integrate authorization with Streamable HTTP` — bounded transport
   hooks, token-free principal, challenges, independent retry budgets.
8. `test: define WP6 package and evidence contract` — packaging/governance RED.
9. `build/docs: make cumulative WP6 verification authoritative` — examples,
   aliases, evidence/checker/migration accounting without overclaims.
10. `docs: record WP6 candidate evidence` — append exact immutable candidate
    package and review inputs to `.superpowers/sdd/task-6-report.md`.

Implementation commits may be split smaller. They may not reorder production
ahead of RED, combine secrets/evidence, or hide failed cases in documentation.

## Command and verification contract

Add these stable aliases, with each underlying test owned exactly once by the
cumulative command:

- `test:wp6-auth-client` — discovery, issuer, registration, transaction,
  token, scope, and typed error behavior;
- `test:wp6-auth-protected-resource` — verifier, principal, metadata, scopes,
  and challenge behavior;
- `test:wp6-auth-http` — client/server HTTP auth integration and retry budgets;
- `test:wp6-auth-types` — public Effect/type/platform graph fixtures;
- `test:wp6-auth-package` — exports, packed consumer, examples, governance;
- `test:wp6` — the cumulative chain above.

`scripts/verify.mjs` adds exactly `test:wp6` after `test:wp5-core`. It does not
own `conformance:client-auth` or `conformance:authorization`, because official
or external lanes must not be inferred from package health.

### Node 22 candidate gates

Use the repository's CI runtime and pnpm `10.11.1` through Corepack:

```bash
CI=true pnpm install --frozen-lockfile --strict-peer-dependencies
CI=true pnpm run test:source-refresh
CI=true pnpm run test:wp6-auth-client
CI=true pnpm run test:wp6-auth-protected-resource
CI=true pnpm run test:wp6-auth-http
CI=true pnpm run test:wp6-auth-types
CI=true pnpm run test:wp6-auth-package
CI=true pnpm run test:wp6
CI=true pnpm run test:wp5-core
CI=true pnpm run test:wp4-http
CI=true pnpm run verify
CI=true pnpm run conformance:client-auth
```

The client-auth result must target the pinned alpha.9 package and literal
`--spec-version 2026-07-28`, exit zero, and record zero failures. Warnings are
not silently accepted: each is classified against the authority or blocks
candidate acceptance.

### Node 24 compatibility gates

```bash
CI=true pnpm install --frozen-lockfile --strict-peer-dependencies
CI=true pnpm run test:wp6
CI=true pnpm run test:wp5-core
CI=true pnpm run test:wp4-http
CI=true pnpm run verify
CI=true pnpm run conformance:client-auth
```

The final report records exact Node and pnpm versions, command exit codes,
test/check/scenario totals, warnings, and evidence paths. No machine-specific
runtime path is committed.

### External protected-resource qualification

Run only when the coordinator supplies/approves a real external AS fixture and
safe configuration outside the repository:

```bash
CI=true pnpm run conformance:authorization
```

The runner must redact credentials/tokens and record whether the target came
from the settings-file or URL mode without recording their secret fields.
Absent configuration remains an explicit exit-1 blocker. Until a real run
passes, the report must say protected-resource external qualification was not
performed and no release claim is supported.

## Independent immutable review gate

After all candidate commits and dual-runtime evidence, freeze an immutable
review package containing:

- accepted base SHA/tree and candidate head SHA/tree;
- ordered commit list and full `base..candidate` diff;
- `git diff --check`, changed-file inventory, and clean status;
- exact source paths/hashes and manifest refresh result;
- exact focused/cumulative/full/conformance commands and counted results;
- all warnings, skipped external work, and qualification boundaries;
- PR #27 invariant mapping showing each invariant's new test and implementation
  owner, including the source-corrected metadata-conditioned `iss` rule;
- proof that no credential/token/secret appears in tracked diff or evidence.

An independent reviewer must inspect that immutable package from the exact
candidate tree. Review findings are repaired with new commits and a new frozen
head/tree; the old review cannot be reused. Coordinator acceptance is required
before integration. Integration must reproduce the candidate tree exactly or
rerun the affected gates and review.

## Explicit exclusions and stop conditions

WP6 does not:

- implement a general authorization server;
- add Tasks, Apps, browser Host/View, release packaging, final-spec delta, or
  other WP7+ work;
- add or upgrade dependencies/tooling without a new approval gate;
- read/store/commit secrets, credentials, tokens, private keys, or `.env`;
- mutate an external AS or use a simulated issuer as release qualification;
- mutate remotes/issues/PRs, supersede PR #27, merge, publish, tag, or release;
- mark Goal complete or claim official conformance, release readiness, issue
  closure, Tier 1 qualification, or Working Group designation;
- weaken accepted WP2-WP5H tests, expected-failure prohibitions, source
  precedence, strict peers, Node 22/24 gates, or exact spec-version checks.

Stop and return to the coordinator if:

- the exact pinned authorization files cannot be vendored with matching hashes;
- normative prose conflicts with this frozen behavior or the plan;
- the harness requires behavior not supported by normative sources;
- a public API change outside the bounded ownership is needed;
- a dependency/tooling change is needed;
- a test needs secrets or an unapproved external mutation;
- external configuration is missing when qualification is requested;
- any accepted suite regresses or an error/token redaction invariant fails.

## Coordinator amendment: public authorization-client runtime prerequisite

WP6F preflight at `6cbab50732152afe32406b3a553567130f5e46cc`
proved that the accepted WP6B-WP6E surface exposes Effect service contracts and
low-level protocol primitives, but no public constructor or Layer composes
those primitives into `AuthorizationClientService`. The official alpha.9
client-auth fixture also uses HTTP exclusively on ephemeral loopback endpoints,
while the accepted primitives correctly default to HTTPS-only. Replacing the
legacy root OAuth client in the active Everything example cannot therefore
reach the required zero-failure gate through example/package wiring alone.

WP6F is paused before RED. This amendment authorizes one prerequisite slice
inside WP6, with a fresh implementer and independent immutable review before
WP6F resumes.

### Public runtime contract

- Add `AuthorizationClientConfig`, `makeAuthorizationClient`, and
  `layerAuthorizationClient` to `mcp-effect-sdk/auth/client`. The constructor
  composes the already accepted discovery, selection, registration,
  transaction, interaction, exchange, refresh, scope, and store primitives.
- The constructor captures `AuthorizationHttpClient`, `AuthorizationCrypto`,
  `AuthorizationInteraction`, and `AuthorizationClientStore` once. It remains
  Effect-native, interruption-preserving, typed-error-only, Node/DOM/Promise-
  free, and adds no default adapters or production dependency.
- Configuration is descriptor-safe and bounded. It owns the registration
  configuration, one selected redirect URI that must be a member of the
  configured redirect URI set, a token-audience validator, and the endpoint
  policy defined below. Export the existing support types needed to construct
  it rather than requiring deep imports.
- `currentGrant` performs discovery and exact issuer/resource/client/scope
  lookup without DCR or user interaction. It never returns an expired grant.
  A valid grant is returned; an expired grant with a refresh token is refreshed
  with the accepted refresh primitive and Effect Clock; an expired grant
  without a refresh token is removed and yields `None`. A failed refresh never
  makes the stale grant usable.
- `acquire` reuses a current valid/refreshable grant and otherwise resolves the
  authorization context, performs the accepted PKCE interaction, validates the
  callback and audience, exchanges the code, and returns the stored opaque
  grant handle.
- `respondToChallenge` uses the challenge's explicit resource-metadata URI when
  present and deterministically unions prior, configured, and challenge scopes.
  A `401 invalid_token` removes the rejected prior grant before acquiring a new
  one and cannot return or refresh it. A `403 insufficient_scope` may retain the
  prior stored grant while acquiring the union. Other challenge shapes remain
  rejected by the already accepted transport boundary.
- Raw access, refresh, credential, assertion, code, verifier, and state values
  remain confined to Redacted values and service ports. Runtime errors and
  evidence never disclose them.

### Closed endpoint policy

- Add the closed public value `AuthorizationEndpointPolicy = "https-only" |
  "allow-loopback-http"`; omitted configuration means `"https-only"`.
- Thread that value explicitly through the accepted discovery, resolution,
  registration, transaction/callback, token-exchange, and refresh primitives.
  It is not ambient state and is not a loose boolean.
- `"allow-loopback-http"` permits HTTP only when the repository's strict URI
  parser identifies `localhost`, IPv4 `127.0.0.1`, or IPv6 `::1`. It permits
  the protected resource, issuer, metadata candidates, authorization endpoint,
  registration endpoint, token endpoint, and present callback `iss` only under
  that exact rule. HTTPS remains accepted under both policies.
- The policy never permits non-loopback HTTP, userinfo, fragments, dot-segment
  confusion, encoded host tricks, alternate IPv4 spellings, or a redirect rule
  broader than the already accepted loopback redirect contract. The default
  rejection behavior remains frozen by regression tests.
- The Everything conformance example may opt into
  `"allow-loopback-http"` only as a clearly named local-fixture policy. No
  production default or release/external-AS qualification may rely on it.

### TDD, files, and gates

The fresh implementer is the sole writer. Before production edits, commit a
meaningful RED covering public factory/Layer types and behavior, current-grant
valid/expired/refresh/no-refresh cases, acquire/reuse/interaction, both
challenge paths, descriptor/accessor adversaries, port capture and
interruption, and default/loopback/non-loopback endpoint-policy matrices. RED
must fail on missing behavior rather than a broken build or missing fixture.

Production ownership is limited to:

- `src/auth/client.ts` and new `src/auth/client/runtime.ts`;
- `src/auth/client/uri.ts`, `discovery.ts`, `resolution.ts`, `registration.ts`,
  `transaction.ts`, and `token.ts` only for explicit endpoint-policy plumbing;
- focused tests under `test/auth/` and one public type fixture under
  `test/types/`.

No example, root export, package manifest/script, transport, generated source,
dependency/lockfile, evidence checker, readiness document, external system,
remote, issue, release, or WP7+ edit is authorized in this prerequisite.

After GREEN, run direct focused runtime and type gates on Node 22 and Node 24,
the complete accepted WP6 matrix, WP4 HTTP/type regressions, `test:wp5-core`,
and full `verify`. Freeze exact commits/trees/diffs and command evidence in the
WP6 report. A fresh independent reviewer must return 0 Critical / 0 Important
before coordinator acceptance. Then, and only then, resume WP6F and its
official dual-runtime `conformance:client-auth` zero-failure gate.

### Coordinator amendment: independent-review repair

The immutable review package at `95868412ab95caa5a5224e74bdb48eba9697445a`
received **REQUEST CHANGES: 0 Critical / 5 Important / 0 Minor**. Its code
candidate is rejected. A fresh repair implementer must commit all new RED
witnesses before production repair, and a new immutable package and independent
review replace rather than amend the rejected evidence.

The repair owns exactly these findings:

1. The earlier reported matrix named nonexistent
   `test/packaging/wp6-auth-subpaths.test.mjs`. The actual accepted file is
   `test/packaging/wp6b-auth-subpaths.test.mjs` and is 2/4 because its exact
   public/tarball exports omit the two authorized runtime values. This file is
   now authorized for exact factory/Layer export and packed-consumer witnesses.
   The corrected matrix must name the real file and report all tests.
2. A valid initial `401 Bearer` challenge may omit `error`. The runtime accepts
   both absent error and `invalid_token`; when a prior SDK grant was sent, both
   forms reject/remove it before reacquisition. `403` remains limited to
   `insufficient_scope`.
3. Challenge scope presence is preserved. `AuthorizationChallenge.scopes`
   becomes optional because the RFC attribute is optional; the transport omits
   the property when `scope` is absent and retains a present empty set when
   `scope=""`. Runtime orchestration passes `challengeScopes` separately to the
   accepted resolver so present-empty suppresses metadata fallback while absent
   scope permits it.
4. `currentGrant` does not require authorization-server metadata unless an
   expired refreshable grant needs the token endpoint. A missing default
   protected-resource metadata document yields `None` for the optional lookup
   so the normative initial unauthenticated MCP request can receive an explicit
   challenge. After successful authorization through an explicit
   `resource_metadata` URI, the resource-bound runtime remembers that validated
   URI in an internal Effect `Ref` and uses it for later grant lookup. Malformed,
   mismatched, or unsafe metadata still fails closed and the URI is remembered
   only after successful audience-validated exchange.
5. The transport accepts a stored grant whose canonical resource is the strict
   same-origin path parent of its configured protected-resource endpoint, using
   the existing descriptor-safe URI parser and `isSameOriginPathParent`. It
   still rejects cross-origin, sibling, query/fragment, malformed, and unsafe
   resource bindings before exposing a Bearer value.

Fresh RED must include the real package file; a real runtime initial 401 without
error; absent versus present-empty challenge scope with metadata fallback;
valid-grant reuse while AS discovery fails; missing default metadata followed
by explicit challenge acquisition and subsequent reuse; and canonical-parent
transport retry/subsequent request with negative origin/path cases. Test
fixtures must not mock across the seam being proved.

Production repair ownership expands only to:

- `src/auth/common.ts` for optional challenge scope presence;
- `src/auth/client/runtime.ts` for challenge semantics, deferred discovery,
  and validated explicit-metadata memory;
- `src/transport/StreamableHttpClientTransport.ts` for scope presence and
  canonical-resource grant validation;
- focused files under `test/auth/` and `test/http/`, the existing runtime type
  fixture if the optional field needs a type witness, and
  `test/packaging/wp6b-auth-subpaths.test.mjs`.

No other source, example, root entrypoint, package manifest/script,
dependency/lockfile, generated source, governance/readiness, external target,
remote, issue, release, or WP7+ edit is authorized. The repair must rerun the
corrected direct matrix, both public auth type fixtures, WP4 HTTP/type
regressions, WP5 core, and full verify on Node 22 and Node 24 before a fresh
immutable review.

### Coordinator amendment: optional-scope serialization seam

The committed repair RED at `d53362c` proves that making the public
`AuthorizationChallenge.scopes` field optional exposes one existing consumer
outside the repair ownership above. TypeScript correctly rejects the
protected-resource challenge serializer's unconditional `.length` and
`.join()` access. The repair therefore additionally owns only the minimal
optional-presence guard in `src/auth/protected-resource/services.ts` needed to
serialize a present non-empty scope and omit an absent or present-empty scope.
No other protected-resource behavior or file is authorized by this amendment.

### Coordinator amendment: fail-closed conformance evidence contract (2026-07-20)

Fresh immutable review of sealed WP6F package `330de22` returned **REQUEST
CHANGES: 0 Critical / 2 Important / 1 Minor**. Production authorization
behavior remains green, but the candidate is rejected because its preserved
machine-readable evidence cannot prove the dual-runtime narrative or safe
external-target provenance.

This state is prohibited: a harness result is not successful evidence unless
the evidence contract itself is complete and validated. The repair therefore
makes evidence validity a precondition of command success, not a later report
annotation.

The repair owns only:

- `test/packaging/wp6-auth-governance.test.mjs` for meaningful RED witnesses;
- `scripts/readiness-evidence.mjs` for one fail-closed conformance-evidence
  constructor/validator and artifact-local manifest;
- `scripts/run-conformance-client-auth.mjs` for real requirement mapping,
  per-runtime evidence names, and zero-warning exit behavior;
- `scripts/run-conformance-authorization.mjs` for requirement mapping and
  secret-free `missing`, `settings-file`, or `url` target provenance;
- `scripts/run-conformance-suite.mjs` only to make the shared evidence
  invariant universal across official conformance producers;
- `scripts/check-conformance-evidence.mjs` only if needed to keep the static
  governance checker aligned;
- coordinator-owned WP6 preflight/report/progress evidence.

Before production edits, commit tests proving all of the following against the
rejected candidate:

1. empty requirement IDs, missing runtime/package-manager/source provenance,
   unsafe/absent authorization target mode, or an incomplete report fail the
   evidence constructor rather than writing a success artifact;
2. exact Node and pnpm versions plus pinned MCP-core and conformance revisions
   are recorded from repository/runtime authority;
3. Node 22 and Node 24 client-auth runs cannot overwrite one another, and each
   artifact tree contains its own evidence manifest;
4. a green harness with any unadjudicated warning exits nonzero; no blanket
   `non-blocking` label may make warning classification tautological;
5. configured external authorization records only `settings-file` or `url`
   mode and never the path, URL, client identity, secret, token, or callback
   value.

The production repair may add no dependency, lockfile, generated source,
authorization runtime/transport behavior, example, public SDK API, external
target, secret, remote, issue, release, Tier, Tasks, Apps, or Visual Effect
change. After GREEN, rerun the focused governance/evidence tests, cumulative
WP6, full `verify`, and official client-auth on exact Node 22 and Node 24.
Both per-runtime machine artifacts must independently prove the same pinned
source/runtime contract with zero failures and zero warnings. Freeze a new
immutable package and obtain fresh 0 Critical / 0 Important review before WP6
acceptance.

### Coordinator amendment: adversarial evidence publication repair (2026-07-20)

Fresh review of sealed replacement package `03a5217` returned **REQUEST
CHANGES: 0 Critical / 4 Important / 0 Minor**. The two preserved runtime
artifacts are complete, but the shared contract still accepts unknown or
skipped check statuses, accepts a registry-real requirement unrelated to
conformance, and can publish the readiness file before a failing
artifact-manifest write. The reviewer also correctly found that two stronger
tests were added in the rejected production GREEN rather than its preceding
RED commit.

Package `03a5217` is rejected and must not be accepted or rewritten. The next
repair lineage starts from that rejected package and retains the same bounded
file ownership above. Before any further production edit, one committed
tests-only RED must prove all of the following against `03a5217`:

1. every `checks.json` entry has a closed known status; `SKIPPED`, unknown,
   malformed, and empty scenario check sets fail evidence construction and
   cannot count as passes;
2. conformance evidence requires the suite-appropriate `GR-CONF-001` mapping;
   a registry-real but unrelated ID such as `GR-TEST-002` is rejected;
3. fault injection at either destination cannot leave a newly published
   successful readiness file without the exact artifact-local manifest;
4. successful publication uses staged validated bytes, artifact-local manifest
   first, and readiness file last through atomic replacement; temporary files
   are cleaned on failure.

The tests may use temporary directories and filesystem fault fixtures, but may
not read secrets or use a real external target. Production may close the check
status set, validate conformance-specific requirement semantics, and add the
minimal atomic file publication helper inside `scripts/readiness-evidence.mjs`.
No other source, dependency, lockfile, generated, runtime, transport, example,
remote, issue, release, Tier, WP7+, Tasks, Apps, Visual Effect, or
language-service change is authorized.

The new review must evaluate the ordered repair from rejected `03a5217`, not
retroactively treat the insufficient `818f39d` RED as complete. After GREEN,
repeat the focused tests, cumulative WP6, exact Node 22/24 full `verify`, and
official client-auth evidence generation. WP6 remains unaccepted until a new
immutable review returns zero Critical and zero Important findings.

### Coordinator amendment: output redaction and final-scenario validation (2026-07-20)

Fresh review of sealed package `ca535f5` returned **REQUEST CHANGES: 0 Critical
/ 2 Important / 0 Minor**. Its source-check constructor, requirement mapping,
atomic publication, artifacts, and new RED/GREEN lineage reproduced, but the
external authorization runner can relay sensitive child argv through inherited
stdout/stderr, and the final report validator accepts malformed or `SKIPPED`
scenario summaries after construction.

Package `ca535f5` is rejected. The next bounded repair owns only:

- `test/packaging/wp6-auth-governance.test.mjs` for committed RED witnesses;
- `scripts/run-conformance-authorization.mjs` for child-output redaction;
- `scripts/readiness-evidence.mjs` for final scenario and aggregate validation;
- `scripts/check-conformance-evidence.mjs` only for aligned static markers;
- coordinator WP6 reports.

Before production edits, commit tests that fail against `ca535f5` and prove:

1. a synthetic configured authorization harness may echo or split every
   settings path, URL, client ID, client secret, and callback port across both
   stdout and stderr, but none of those exact values reaches runner output or
   evidence;
2. a final report containing a missing/malformed scenario, `SKIPPED` or unknown
   scenario status, inconsistent per-scenario status/counts, duplicate scenario
   identity, or aggregate count mismatch fails the contract and pass predicate;
3. valid official scenario summaries and safe output remain observable.

The production runner may capture child stdout/stderr and stream only exact-
value-redacted text with chunk-boundary-safe buffering. It must not buffer an
unbounded child stream or log the command argv. The final validator may require
the exact built scenario shape, closed `pass`/`warning`/`fail` status set,
unique identities, internally consistent status/counts, and exact aggregate
sums. No dependency, lockfile, generated source, authorization behavior,
external target, remote, release, Tier, or other scope is authorized.

After GREEN, repeat focused and cumulative WP6, exact Node 22/24 full `verify`,
and both official client-auth evidence runs. External authorization remains
unrun without an approved real target. A new immutable review with zero
Critical and zero Important findings remains mandatory before WP6 acceptance.

## Preflight ambiguities resolved or retained

Resolved:

- Pinned authorization prose is a four-file directory, not a single
  `authorization.mdx`; exact paths and hashes are frozen above.
- Authorization-response `iss` is conditionally required exactly as specified
  by the pinned metadata/response table; every present value uses unnormalized
  simple-string comparison.
- `conformance:authorization` is an optional real-external-AS integration lane,
  not an SDK readiness or ordinary `verify` gate.
- PR #27 is an invariant source, not a cherry-pick or public-API source.
- Root `OAuth`, `OAuthProviders`, and `OAuthErrors` are removed with no shim;
  only the two auth subpaths are authoritative.
- `authInfo` is replaced outright by token-free
  `verifiedAuthorizationPrincipal`, available only when no configured verifier
  owns the request and never as a verifier bypass.

Retained without blocking source provenance:

- the exact concrete external AS fixture and credentials are intentionally not
  selected or stored here. Their absence blocks only external qualification,
  not local TDD implementation.

WP6A source provenance is approved. No RED or implementation work begins until
WP6A receives independent review and the coordinator starts the next phase.
