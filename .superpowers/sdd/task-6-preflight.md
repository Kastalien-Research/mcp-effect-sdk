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
