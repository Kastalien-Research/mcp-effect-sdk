---
title: "feat: Align the Effect MCP SDK with MCP 2026-07-28 and qualify for Tier 1"
type: feat
date: 2026-07-16
status: proposed
---

# Align the Effect MCP SDK with MCP 2026-07-28 and qualify for Tier 1

## Summary

Rebuild `mcp-effect-sdk` as an Effect 3-native, modern-only implementation of the pinned MCP `2026-07-28` release-candidate contract. The stable package will implement the complete applicable core client/server surface, stdio and stateless Streamable HTTP, OAuth client behavior, and protected-resource hooks. It will also ship independently gated support for experimental Tasks and all three MCP Apps roles: server helpers, iframe/View runtime, and browser Host bridge.

This is an intentional clean break. There will be no legacy MCP handshake, session, HTTP+SSE, or compatibility mode in the stable API. Deprecated but still wire-relevant Roots, Sampling, Logging, and DCR behavior will be isolated under deprecated APIs. The package identity remains `mcp-effect-sdk`, ISC, owned by Kastalien Research.

The immediate deliverable is `1.0.0-rc.1` against the frozen snapshots below. Changes made upstream after those snapshots are not folded into this work opportunistically. After the official July 28 release exists, a separate bounded delta PR must reconcile the final schema and harness before `1.0.0` is published. Official Tier 1 status is only claimed after MCP SDK Working Group approval.

## Locked targets and precedence

### Source manifest

Create a checked-in manifest recording repository, revision, source paths, hashes, license, and refresh command for each independently versioned input:

| Surface | Pinned source | Role |
| --- | --- | --- |
| MCP core | `modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288`; protocol `2026-07-28` | Normative core contract |
| Core schema | `schema/draft/schema.ts` SHA-256 `c56f0ad2395f9f7109a903a304344a61c65555cb0b2d28c1635cc32497221c87`; JSON SHA-256 `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708` | Generated core codecs and method registry |
| Conformance | `modelcontextprotocol/conformance@ce25103b1baa6e0653e0b7bf4f79de385ea7a116`; npm `0.2.0-alpha.9` | Frozen qualification harness; every runner passes `--spec-version 2026-07-28` explicitly |
| Tasks | `modelcontextprotocol/ext-tasks@2c1425d9a288b9b1f489430fe1e00bb392b47e48` | Experimental overlay on core |
| Apps stable | Apps `2026-01-26`; `@modelcontextprotocol/ext-apps@1.7.4`, tag `ca1d29894fabbd1558885a9ec8620dcb01d7457e` | Stable Apps wire profile and interop oracle |
| Apps preview | `modelcontextprotocol/ext-apps@2ca6a59d2f493b227a83a2e3ce0396db4705621a`, `specification/draft/apps.mdx` | Experimental preview profile |
| TypeScript SDK reference | v2 beta `2.0.0-beta.4`, audited at `e81758caed29f6568ce8873f7f9a3bd65b017d9c` | Differential design oracle only |

Precedence is fixed:

1. The pinned core TypeScript schema and normative core prose win for core behavior.
2. The pinned extension specification controls only its extension surface; the newer core contract wins when extension examples or copied core types lag.
3. The pinned official conformance harness verifies behavior but does not override the specification.
4. The TypeScript v2 SDK supplies useful architecture and differential-interoperability evidence, never normative truth.
5. Effect-native ergonomics may improve APIs but may not alter the wire contract.

Normal verification is network-free and validates vendored hashes. A separate explicit refresh command updates a selected source, records the old/new revisions and semantic diff, regenerates code, and fails until the reconciliation notes and fixtures are updated.

### Extension reconciliation rules

- Tasks is an overlay on core `2026-07-28`: use `-32021`/HTTP 400 for missing capabilities, include mandatory core request `_meta`, add core subscription metadata, and enforce literal `resultType` discriminators even where the extension source is stale.
- Apps stable and Apps preview share `io.modelcontextprotocol/ui`; never infer the profile from that ID. Every Host/View session receives an explicit `AppsProfile` and rejects methods outside it.
- Host-to-server Apps capability negotiation is adapted to modern per-request core metadata plus `server/discover`; it must not reintroduce legacy core `initialize`.
- App-to-Host remains its separate postMessage dialect and uses the Apps `ui/initialize` then `ui/notifications/initialized` lifecycle.

## Public API and package design

### Effect 3 substrate

- Make `effect@^3.22.0` the only required peer and pin `effect@3.22.0` for development.
- Remove `@effect/schema`, `@effect/rpc`, all `effect/unstable/*` imports, `ServiceMap`, and fiber-internal service access.
- Implement the JSON-RPC dispatcher and request-scoped streams directly with Effect 3 so string/integer IDs, transport frames, cancellation, and error channels remain exact.
- Use `Context.Tag`, `Layer`, `Scope`, `Stream`, `Schema`, `FiberRef`, and explicit captured `Context` at public boundaries.
- Keep `@effect/platform@^0.97.0` as an optional peer only for `./integrations/effect-platform`; keep `@effect/platform-node@0.108.0` dev-only for examples/tests.
- Remove the core `Tool`/`Toolkit` dependency on experimental Effect AI. An `effect-ai` adapter is deferred until after core 1.0 and is not part of this plan.
- Support Node `^22.0.0 || ^24.0.0`, compile against `@types/node@^22`, and test both runtimes.

### Stable exports

The root exports only modern stable core conveniences. Publish explicit subpaths for:

- `mcp-effect-sdk/client`
- `mcp-effect-sdk/server`
- `mcp-effect-sdk/protocol/2026-07-28`
- `mcp-effect-sdk/transport/stdio`
- `mcp-effect-sdk/transport/http`
- `mcp-effect-sdk/auth/client`
- `mcp-effect-sdk/auth/protected-resource`
- `mcp-effect-sdk/extensions/apps`
- `mcp-effect-sdk/extensions/apps/server`
- `mcp-effect-sdk/extensions/apps/view`
- `mcp-effect-sdk/extensions/apps/host`
- `mcp-effect-sdk/deprecated`
- `mcp-effect-sdk/integrations/effect-platform`

Publish experimental surfaces separately:

- `mcp-effect-sdk/experimental/tasks`
- `mcp-effect-sdk/experimental/apps-preview`
- `mcp-effect-sdk/experimental/apps-preview/server`
- `mcp-effect-sdk/experimental/apps-preview/view`
- `mcp-effect-sdk/experimental/apps-preview/host`

The root and Node subpaths must not import DOM types; browser subpaths must not import Node built-ins. Stable subpaths follow SemVer. Experimental subpaths are explicitly outside the stable compatibility guarantee and carry their pinned wire-profile revision in docs and runtime constants.

Remove legacy core `initialize`/`initialized`, session fields, `Mcp-Session-Id`, GET/delete/resume transport behavior, legacy HTTP+SSE, resource subscribe/unsubscribe, core ping, and root-level direct request/notification queues. Remove the current SSE and WebSocket transports from the published surface. Retain wire types and working MRTR/client hooks needed for deprecated Roots, Sampling, Logging, and DCR only under `deprecated` or auth fallback APIs, all marked `@deprecated`.

### Core interfaces

- `JsonRpcId` is exactly `string | number`; serialization never coerces it.
- `McpRequestContext` exposes the validated request envelope, per-request protocol version/capabilities/extensions, optional client info, authorization principal, cancellation signal, progress sink, and request-local annotations.
- `McpTransport.request` returns a scoped response stream containing zero or more request-bound notifications followed by exactly one terminal result/error. Stdio demultiplexes by request ID and subscription ID; HTTP maps one POST to one JSON/SSE response stream.
- `McpClient.make` accepts optional client info, capability/extension providers evaluated for every request, transport, authorization, cache, and `inputRequired` policy. Automatic MRTR is enabled by default with `maxRounds: 10`; callers can choose manual handling.
- `McpServer.make` requires server info and handler registries but never stores negotiated client capability or identity across requests.
- Every complete result emitted by high-level APIs has `resultType: "complete"`; input-required and extension results remain discriminated unions.
- `io.modelcontextprotocol/serverInfo` is read/written through each result's `_meta`, with a helper returning `Option<ServerInfo>`; it is not a required top-level `server/discover` field.
- Add typed Effect errors for JSON-RPC protocol failures, HTTP/transport failures, unsupported version, missing capability, header mismatch, MRTR limits/state, subscription closure, schema validation, and authorization. Centralize exact JSON-RPC-code and HTTP-status mapping.

### Core runtime behavior

- Enforce mandatory per-request metadata and stateless capability checks. `clientInfo` is optional but sent when configured and is never used as a security or behavior key.
- Fix the core error table: header mismatch `-32020`, missing capability `-32021`, unsupported version `-32022`, invalid metadata or missing resource `-32602`, and unknown method `-32601`/HTTP 404. Never emit the legacy resource-not-found code.
- Implement `server/discover`, tools, resources/templates, prompts, completion, pagination, caching, progress, cancellation, Elicitation, MRTR, and `subscriptions/listen` across client and server.
- Require deterministic list ordering where specified, preserve opaque empty-string cursors, require `ttlMs`/`cacheScope`, and partition private caches by authorization context.
- Support JSON Schema 2020-12. Disable automatic network `$ref`; expose an opt-in resolver service with scheme/host allowlists plus depth, byte, redirect, and timeout limits. Validate tool output against `outputSchema`; allow any JSON `structuredContent`.
- Implement `x-mcp-header` end to end: validate statically reachable primitive fields, exclude invalid tool definitions with a warning, encode/decode exact sentinel values, compare headers to body, return HTTP 400/`-32020` on mismatch, then refresh `tools/list` and retry at most once.
- Streamable HTTP is POST-only and validates `Origin`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, custom headers, body metadata, content negotiation, and JSON/SSE framing. GET and DELETE return 405.
- MRTR is allowed only for `prompts/get`, `resources/read`, and `tools/call`. Retries use new JSON-RPC IDs, echo `requestState` exactly, preserve input-response keys, and never leak state across requests. Supply a sealed, expiring, principal-bound request-state codec for security/business state; document raw passthrough only for harmless failure-only state.
- `subscriptions/listen` returns a scoped `Subscription` with acknowledged filters, `notifications: Stream`, and `close`. The acknowledgement is the first frame for its subscription ID; other subscriptions may interleave. HTTP closes the response stream for cancellation; stdio sends the cancellation notification.

### Authorization boundary

- `auth/client` implements protected-resource metadata, multiple authorization-server discovery, issuer-exact credential partitioning, PKCE/S256, state and redirect checks, RFC 8707 resource indicators, audience validation, authorization-response `iss`, Client ID Metadata Documents, pre-registration, deprecated DCR fallback, and cumulative scope escalation.
- `auth/protected-resource` exposes `TokenVerifier`, bearer middleware/hooks, protected-resource metadata, principal propagation, and correct 401/403 challenge helpers.
- Do not implement a general authorization-server framework. The authorization-server conformance command becomes an optional external-integration command, not an SDK readiness gate.
- Preserve the behavior and tests from open PR #27 as input. Port them after the new transport/auth interfaces exist; do not merge the obsolete public API merely to avoid rebasing. Supersede/close PR #27 only after equivalent Node 22/24 and pinned-harness evidence passes.

### Experimental Tasks

- Negotiate `io.modelcontextprotocol/tasks` on every augmented request and advertise it through discovery. Only `tools/call` may produce `resultType: "task"`; without request opt-in it must return an ordinary result or missing-capability error.
- Export strict schemas for `Task`, `DetailedTask`, `CreateTaskResult`, `tasks/get`, `tasks/update`, `tasks/cancel`, and task subscription notifications. Status is exactly `working | input_required | completed | failed | cancelled`. Do not expose `tasks/list`, `tasks/result`, or obsolete core task types.
- Provide `TaskStore` and `TaskRuntime` services with atomic create-before-return, get, input update, cancel, transition, TTL, and authenticated principal/tenant binding. Ship an explicitly non-durable in-memory Layer for tests/development and a production adapter contract, not a production persistence implementation.
- Enforce high-entropy IDs, immediate post-create readability, monotonic status transitions, immutable terminal states, idempotent terminal cancellation, polling interval changes, partial/repeated input, key deduplication, and race-safe cancellation/completion.
- Provide raw task-aware call results plus `callToolAndWait`/`awaitTask` helpers that poll or subscribe until a final ordinary `CallToolResult`, preserve caller cancellation, and expose a persistence hook for resumable clients.
- Compose task notifications with core subscription metadata. Streamable HTTP uses the normal method headers plus `Mcp-Name: <taskId>` for task get/update/cancel. A tool result with `isError: true` completes the task; only a JSON-RPC/protocol failure produces task status `failed`.
- App bridge calls consume tasks through the fixed-result helper and never expose task handles over the stable Apps postMessage profile.

### MCP Apps stable and preview

- Stable constants are `EXTENSION_ID = "io.modelcontextprotocol/ui"`, `RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"`, and `UI_PROTOCOL_VERSION = "2026-01-26"`. Require `mimeTypes` in the client extension capability.
- `Apps.Server` exposes `registerAppTool`, `registerAppResource`, `getUiCapability`, visibility helpers, and linked-resource validation. Emit nested `_meta.ui.resourceUri`, never the deprecated flat key. Validate `ui://`, exact MIME, HTML content, CSP, permissions, domain, metadata precedence, resource existence, same-server visibility, and meaningful text fallback.
- `Apps.View` is a scoped session with `connect`, `events: Stream<HostEvent>`, server tool/resource calls, link/message/context/display requests, size notification, and acknowledged teardown.
- `Apps.HostBridge` is a scoped policy-backed bridge with ordered partial/full tool input, exactly one result or cancellation, context changes, teardown, and per-action consent/authorization hooks.
- `Apps.PostMessageTransport` validates JSON-RPC schemas and `event.source`, installs handlers before connect, rejects outbound calls before initialization, isolates concurrent views, and removes listeners/pending requests on Scope close. The View may post to `"*"` because its sandbox origin is unknown; the outer Sandbox proxy additionally validates the expected Host origin and uses an explicit target origin.
- The Host uses the official cross-origin double-iframe design, applies a deny-by-default CSP, sanitizes declared origins/tokens, maps only declared permissions, may tighten but never loosen policy, bounds content/messages/results, rejects unsafe links/downloads, and audits app-originated actions. Follow the official sandbox attributes, including its permitted `allow-same-origin`; isolation comes from the distinct Sandbox origin.
- The stable profile implements `tools/call`, `resources/read`, `notifications/message`, `ping`, `ui/open-link`, `ui/message`, `ui/update-model-context`, `ui/request-display-mode`, acknowledged `ui/resource-teardown`, size changes, Host context changes, ordered partial/full tool input, and exactly one tool result or cancellation around the `ui/initialize`/`ui/notifications/initialized` lifecycle.
- The preview profile implements all additions at the pinned draft revision, including app-provided tools, downloads, expanded resource/prompt/sampling operations, and preview teardown semantics. Preview tools are app-instance and same-server scoped, attributed, confirmation-gated for side effects, bounded, and removed atomically at teardown.
- Use framework-neutral browser primitives and a vanilla example. React/framework adapters are not production dependencies.

## Sequential implementation plan

Each item lands as a focused GitHub Flow PR with tests written before or alongside behavior and atomic commits. A later PR may not compensate for a red required gate in an earlier one.

1. **Freeze sources and begin Tier operations.** Add the source manifest, vendored licenses/notices, deterministic refresh/check tooling, extension reconciliation record, security/maintenance policies, issue templates/labels, P0 escalation path, and machine-readable SLA ledger. Record the policy effective date; do not retroactively claim compliance.
2. **Establish the Effect 3 foundation.** Pin the approved dependency/peer matrix, remove unsupported Effect 4/deprecated packages, replace services and schemas with Effect 3 APIs, remove unstable imports, update generator templates, and add banned-import/single-runtime/type-fixture gates. Preserve only behavior that remains in the clean-break target.
3. **Make generation authoritative.** Regenerate revisioned Effect schemas, message unions, method/result registries, HTTP metadata, and fixtures from the vendored core schema. Remove handwritten generated-surface drift and make requiredness/result discriminators fail closed.
4. **Replace the wire kernel and transports.** Implement exact JSON-RPC serialization, SDK-owned dispatcher, typed errors, request-scoped streams, stdio, stateless Streamable HTTP, Origin checks, required headers, custom headers, SSE parsing, cancellation, and bounded header-mismatch recovery. Remove legacy transports and session paths.
5. **Complete the core feature surface.** Implement discovery, tools/resources/prompts/completion, JSON Schema validation, pagination/caching, progress/cancellation, Elicitation, MRTR, subscriptions, and minimal deprecated hooks. Re-author examples against only the public modern API.
6. **Finish authorization.** Port PR #27's tested invariants, implement the OAuth client and protected-resource boundaries, add issuer/scope/resource negative cases, and separate optional authorization-server integration from qualification.
7. **Add the Tasks profile.** Generate the reconciled overlay, implement server/client/store/runtime/subscription behavior, add restart-capable reference-store tests, and pass every runnable official Tasks scenario plus local coverage for upstream-skipped notification behavior.
8. **Add stable Apps server and View.** Implement stable schemas, capability adapter, resource/tool helpers, postMessage transport, complete View lifecycle, text fallback, and bidirectional interop with ext-apps 1.7.4.
9. **Add stable Apps Host and draft preview.** Implement the double-iframe Host bridge, policy/security layer, browser lifecycle and teardown, then add the isolated preview profile and all pinned draft additions without changing stable codecs.
10. **Qualify the release candidate.** Complete API docs, examples, migration guide, changelog, support/dependency/versioning policies, package metadata, ISC license, packed-consumer tests, CI evidence uploads, and all draft/core/extension/browser gates. Publish nothing yet; produce `1.0.0-rc.1` provenance and request approval.
11. **Reconcile final MCP and release.** After the July 28 final artifacts exist, create a separate delta report/PR, update only demonstrated changes, run the final official harness, and request approval for the tag and npm provenance publication. Then request separate approval to submit Tier evidence and wait for Working Group designation before claiming Tier 1.

Issues #13-#20 are reconciled against these PRs and closed only with explicit implementation/evidence links. Existing passing local package-health checks or conceptual file overlap do not count as issue closure.

## Verification and acceptance criteria

### Command structure

- `pnpm run verify:core` runs source/hash checks, banned-import checks, generation parity, strict types/build, unit/integration/E2E, core client/server conformance, and client-auth conformance. Every official conformance invocation passes `--spec-version 2026-07-28`; runner scripts must not rely on the package's default version.
- `pnpm run verify:extensions` runs Tasks schema/runtime/scenarios and Apps schema, browser-security, lifecycle, and reference-interoperability suites.
- `pnpm run verify:release` runs both gates plus docs coverage, package export/type tests, `pnpm pack` inspection, clean Node/browser consumer installs, provenance generation, and readiness accounting.
- `pnpm run verify` and `pnpm test` alias the authoritative release gate. Smaller focused commands remain available for iteration.
- Every evidence producer writes schema-validated JSON with command, versions/revisions, runtime, timestamp, cases/scenarios, exit status, and mapped readiness requirement IDs. CI uploads artifacts; checked-in Markdown never substitutes for execution evidence.

### Core protocol cases

- Preserve string and integer IDs exactly; reject null/fractional IDs and duplicate active IDs.
- Accept valid per-request metadata and reject missing/wrong protocol/capability/header combinations with exact JSON-RPC and HTTP statuses.
- Verify optional client info, per-result server info, strict result types, unknown extension results, and no capability leakage between concurrent requests.
- Exercise JSON and incremental SSE responses, interleaved requests/subscriptions, stream cancellation, abrupt close, no post-completion progress, and stdio stdout cleanliness.
- Cover Origin rejection, GET/DELETE 405, all required headers, Base64 sentinel edge cases, invalid `x-mcp-header` tools, mismatch refresh, and single retry.
- Cover MRTR new IDs, exact state echo, capability gating, ten-round limit, tamper/replay/expiry/cross-principal failures, manual mode, and handler reentrancy.
- Cover subscription acknowledgement ordering per ID, exact filters, concurrent interleaving, typed close, and transport-specific cancellation.
- Cover opaque empty cursors, private-cache partitioning, TTL, missing resources, deterministic lists, arbitrary structured JSON, output validation, blocked network refs, and bounded opt-in resolvers.
- Cover Elicitation form/URL security, deprecated Roots/Sampling/Logging hooks, and the prohibition on standalone server requests.

### Authorization cases

- Exercise multiple issuers, exact issuer matching, issuer-bound credentials, optional/invalid response `iss`, metadata discovery, pre-registration/CIMD/DCR priority, PKCE, state, redirect, resource indicators, audience validation, 401/403 challenges, and no token passthrough.
- Scope escalation unions all previously granted and newly required scopes.
- Core client-auth conformance has zero failures. Protected-resource integration uses a real external authorization-server fixture; simulated issuer tests alone cannot support a release claim.

### Extension cases

- Tasks: all runnable pinned official server scenarios pass with no expected-failure baseline; locally cover the currently skipped task-notification scenario, client behavior, durable-store restart, principal isolation, TTL, update/cancel races, repeated input, polling changes, MRTR composition, and exact task headers.
- Apps: schema/link/fallback/visibility tests; stable/preview profile isolation; metadata precedence; all lifecycle orderings; malformed/unknown-source postMessage rejection; concurrent-view isolation; listener cleanup; double-origin sandbox, CSP, permissions, links/downloads, consent and teardown; Apps+Tasks final-result composition.
- Interoperate in both directions against pinned ext-apps 1.7.4: Effect View to reference Host and reference View to Effect Host. Run Playwright against the real double-iframe boundary; unit tests alone are insufficient.

### Qualification thresholds

- Pin the harness at alpha.9 for this draft effort and require the literal `--spec-version 2026-07-28` argument in the server, client, and client-auth runner scripts. Run every applicable modern core server and client scenario, not only the historical `draft` subset, with zero failures and no local expected-failure allowlist. Upstream-declared skips are reported, never counted as our pass.
- Do not run or retain legacy protocol scenarios as release gates.
- Tasks and Apps evidence is reported separately and never inflates core Tier coverage; official Tier rules exclude extensions and experimental features.
- CI passes on Node 22 and 24, installs with strict peer dependencies, and proves one Effect runtime.
- A packed tarball installs into clean core-only, optional Effect Platform, and browser Apps consumers; all documented exports compile and execute without importing unavailable platform globals.

## Release, documentation, and Tier 1

- Fill package description, author (`Kastalien Research`), repository, homepage, bugs, keywords, `files`, `exports`, `engines`, `sideEffects`, license, and public publish configuration. Add the ISC `LICENSE`, third-party notices, and retained upstream notices.
- Keep the public package name `mcp-effect-sdk`. Verify npm availability/ownership before creating a release tag; if unavailable, stop for a user decision rather than silently renaming.
- Document server, client, both transports, every core capability, MRTR, subscriptions, errors, auth client, protected-resource hooks, deprecated support, Tasks, all Apps roles, stable/preview profiles, security, Effect 3 requirements, and migration from the current API. Each stable feature gets a compiling example; experimental examples are clearly labeled.
- Release `1.0.0-rc.1` only after the frozen-draft gates pass and approval is given. Release `1.0.0` only after the final-spec delta gate passes and separate tag/npm approval is given. Publish with registry provenance from CI, then verify the public tarball.
- Adopt the official two-business-day issue-triage and seven-day P0/security-resolution commitments. Generate maintenance evidence from GitHub issue history beginning at the policy effective date and keep the current backlog classified.
- A stable release and technical conformance do not self-assign Tier 1. Submit the official evidence request only after approval and after the available maintenance ledger demonstrates the policy; add any Tier badge/claim only after SDK Working Group approval.

## Explicit boundaries and risks

- The plan does not speculate about changes after the pinned snapshots. The final-release delta is a later evidence-driven PR.
- No general OAuth authorization server, database, production task store, React integration, legacy MCP compatibility, HTTP+SSE, WebSocket, or automatic upstream drift is included.
- Core readiness, release readiness, Tasks readiness, Apps stable readiness, Apps preview readiness, and official Tier designation remain separate claims.
- Effect 3 migration and the protocol rewrite are intentionally sequential. Generated code is not refreshed until templates target Effect 3, and protocol behavior is not rebuilt on the unsupported Effect 4 graph.
- Browser Apps support adds Playwright as a justified development dependency but adds no framework production dependency.
- Long-term task durability is a consumer adapter responsibility; the SDK proves the contract and reference layers, not a consumer's production store.
- Interoperability is proven against the pinned official reference package/host and recorded third-party hosts, not claimed universally.

## References

- [MCP draft](https://modelcontextprotocol.io/specification/draft)
- [Draft changelog](https://modelcontextprotocol.io/specification/draft/changelog)
- [Modern versioning](https://modelcontextprotocol.io/specification/draft/basic/versioning)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http)
- [MRTR](https://modelcontextprotocol.io/specification/draft/basic/patterns/mrtr)
- [Subscriptions](https://modelcontextprotocol.io/specification/draft/basic/patterns/subscriptions)
- [Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [Tasks extension](https://github.com/modelcontextprotocol/ext-tasks/tree/2c1425d9a288b9b1f489430fe1e00bb392b47e48)
- [Apps stable specification](https://github.com/modelcontextprotocol/ext-apps/blob/ca1d29894fabbd1558885a9ec8620dcb01d7457e/specification/2026-01-26/apps.mdx)
- [Apps preview specification](https://github.com/modelcontextprotocol/ext-apps/blob/2ca6a59d2f493b227a83a2e3ce0396db4705621a/specification/draft/apps.mdx)
- [TypeScript SDK v2 beta](https://ts.sdk.modelcontextprotocol.io/v2/)
- [SDK Tier rules](https://modelcontextprotocol.io/community/sdk-tiers)
- [Effect package](https://www.npmjs.com/package/effect)
- [Open auth-hardening PR #27](https://github.com/Kastalien-Research/mcp-effect-sdk/pull/27)
