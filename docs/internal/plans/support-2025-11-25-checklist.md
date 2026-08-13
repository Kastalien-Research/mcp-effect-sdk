# MCP `2025-11-25` dual-version support checklist

This is the implementation checklist for supporting MCP `2025-11-25` **in
addition to**, rather than instead of, the existing `2026-07-28` profile. It is
based on the authoritative dated
[`2025-11-25` schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts)
and specification, compared with the dated
[`2026-07-28` schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts).

The two releases are different protocol profiles, not merely two accepted
version strings. The older release is stateful and handshake-based; the newer
release is stateless, puts capabilities on every request, and replaces several
bidirectional operations. Consequently, adding the old date to
`supportedProtocolVersions` is specifically **not** sufficient.

## Definition of done

- [ ] Both client and server can be explicitly configured for either dated
      profile over stdio and Streamable HTTP.
- [ ] HTTP servers select one profile before profile-specific validation or
      dispatch, never decode a `2025-11-25` message with the `2026-07-28` codec
      (or vice versa), and bind an HTTP session to the version negotiated at
      initialization.
- [ ] The existing `2026-07-28` public API, wire behavior, generated artifacts,
      conformance evidence, and defaults remain backward compatible.
- [ ] Version-specific APIs and generated types are available through explicit
      package subpaths; shared APIs expose only genuinely common semantics.
- [ ] Unit, type, integration, transport, end-to-end, authorization, packaging,
      and official conformance coverage pass independently for both profiles.

## Normative surface inventory

Use this inventory as a review backstop. Generated unions remain authoritative;
this list exists so a green generator cannot conceal an omitted runtime route.

- [ ] Client-to-server requests cover `initialize`, `ping`,
      `completion/complete`, `logging/setLevel`, `prompts/get`, `prompts/list`,
      `resources/list`, `resources/templates/list`, `resources/read`,
      `resources/subscribe`, `resources/unsubscribe`, `tools/list`,
      `tools/call`, `tasks/get`, `tasks/result`, `tasks/list`, and
      `tasks/cancel`.
- [ ] Server-to-client requests cover `ping`, `sampling/createMessage`,
      `roots/list`, `elicitation/create`, `tasks/get`, `tasks/result`,
      `tasks/list`, and `tasks/cancel`.
- [ ] Client-to-server notifications cover `notifications/initialized`,
      `notifications/cancelled`, `notifications/progress`,
      `notifications/roots/list_changed`, and `notifications/tasks/status`.
- [ ] Server-to-client notifications cover `notifications/cancelled`,
      `notifications/progress`, `notifications/message`,
      `notifications/resources/updated`, `notifications/resources/list_changed`,
      `notifications/prompts/list_changed`, `notifications/tools/list_changed`,
      `notifications/elicitation/complete`, and `notifications/tasks/status`.
- [ ] Both directions can carry JSON-RPC responses for requests initiated by the
      opposite peer; request-ID allocation and correlation are safe when both
      peers have requests in flight concurrently.
- [ ] Initialization capability gating covers client `roots` (including
      `listChanged`), `sampling`, `elicitation`, and task request augmentation,
      and server `logging`, `completions`, `prompts`, `resources`, `tools`, and
      tasks, including each nested list-change, subscribe, list, cancel, and
      method-specific flag.
- [ ] Runtime tests assert that every generated method appears in exactly the
      permitted direction(s), has a handler or intentional notification sink,
      uses its generated params/result codec, and is rejected when its required
      capability was not negotiated.

## 1. Freeze and govern the second normative source

- [ ] Pin the exact upstream revision containing the released `2025-11-25`
      schema and prose. Do not rely on `main` at build or test time.
- [ ] Extend `sources/manifest.json` from its single `protocolVersion`/single
      core-schema assumption to a version-keyed core inventory.
- [ ] Vendor and hash at least `schema/2025-11-25/schema.ts`,
      `schema/2025-11-25/schema.json`, the specification index, lifecycle,
      Streamable HTTP transport, authorization, cancellation, progress, ping,
      and tasks documents, plus the upstream license.
- [ ] Record source reconciliation explaining which behavior is shared,
      version-gated, or deliberately unsupported; preserve the immutable audited
      `2026-07-28` baseline.
- [ ] Teach source refresh/check scripts to update or verify exactly one
      `(source, protocolVersion)` entry without overwriting the other version.
- [ ] Pin a conformance-harness version that actually exercises `2025-11-25`,
      record its npm/Git provenance, and keep it separate from the existing
      `2026-07-28` harness evidence.

## 2. Make generation multi-version

- [ ] Change `scripts/generate-mcp.mjs` to accept or iterate protocol versions,
      with independent inputs and outputs under `src/generated/mcp/<version>/`.
- [ ] Replace generator assertions that require `DiscoverRequest`, prohibit
      `ServerRequest`, and assume no empty-result methods with per-version
      profile rules.
- [ ] For `2025-11-25`, recognize `InitializeRequest`/`InitializeResult`, the
      server-request union, and the empty results for `ping`,
      `logging/setLevel`, `resources/subscribe`, and `resources/unsubscribe`.
- [ ] Generate complete Effect schemas and protocol method/result maps for the
      older schema, including its task types and server-to-client requests.
- [ ] Keep generated identifiers version-local so same-named types with
      different fields (for example `RequestParams`, `Result`, capabilities, and
      content blocks) cannot be accidentally interchanged.
- [ ] Add deterministic generation snapshots, schema-codec tests, method-map
      tests, and `generate:mcp --check` coverage for both versions.

## 3. Add explicit protocol-profile boundaries

- [ ] Add `mcp-effect-sdk/protocol/2025-11-25` and retain
      `mcp-effect-sdk/protocol/2026-07-28`, with matching `package.json`
      exports, declaration files, packed-package checks, and API leak tests.
- [ ] Introduce an internal `ProtocolProfile` abstraction owning the version,
      request/notification codecs, direction maps, result codecs, lifecycle,
      capability rules, HTTP rules, and dispatcher factory.
- [ ] Rename concepts such as `McpModern`/`MODERN_PROTOCOL_VERSION` where needed
      so “latest/default” is distinct from “only supported”; keep compatibility
      aliases if already public.
- [ ] Keep the default profile `2026-07-28`; require an intentional opt-in (or a
      documented negotiation policy) for legacy support to avoid silently
      weakening stateless/security assumptions.
- [ ] Partition caches, request state, observability attributes, and errors by
      selected protocol version.

## 4. Implement the `2025-11-25` lifecycle and negotiation

- [ ] Client: send `initialize` first with `protocolVersion`, `capabilities`,
      and `clientInfo`; accept the server-selected supported version according
      to the older negotiation rule; then send `notifications/initialized`.
- [ ] Server: reject ordinary requests before initialization, negotiate the
      version in `initialize`, return `capabilities`, `serverInfo`, and optional
      `instructions`, and transition only after `notifications/initialized`.
- [ ] Track per-connection/session lifecycle states (new, initializing,
      initialized, closing/closed), reject duplicate or out-of-order lifecycle
      messages, and clear all state on shutdown/transport close.
- [ ] Implement the exact version fallback: a server that supports the client's
      requested version selects it; otherwise it selects one it supports, and
      the client disconnects if it cannot support the returned version. Never
      infer successful negotiation merely from an HTTP header.
- [ ] Permit ping during the operation phase from either peer and implement
      transport-specific shutdown (close stdin/terminate the process for stdio;
      close the HTTP connection/session with no protocol shutdown RPC).
- [ ] Implement request timeouts and cancellation behavior during the stateful
      lifecycle, including cancellation of in-flight work on disconnect.
- [ ] Retain `server/discover`, mandatory per-request protocol/capability
      metadata, and handshake-free operation exclusively for `2026-07-28`.
- [ ] Do not advertise `2025-11-25` from a server until all lifecycle, session,
      and bidirectional routing work is enabled atomically.

## 5. Restore the older wire model and error semantics

- [ ] Decode `2025-11-25` request `_meta` as optional with optional
      `progressToken`; do not require the `2026-07-28` protocol-version and
      client-capabilities metadata keys.
- [ ] Decode older results without `resultType`, cache hints, or reserved
      server-info metadata. Do not add `resultType` to legacy wire responses.
- [ ] Restore `ping` and `logging/setLevel`, including connection-scoped log
      level and empty-result behavior.
- [ ] Restore server-to-client `roots/list`, `sampling/createMessage`, and
      `elicitation/create` request/response correlation and capability gating.
- [ ] Restore `notifications/roots/list_changed`,
      `notifications/elicitation/complete`, and the full older client/server
      notification direction unions.
- [ ] Restore the `URLElicitationRequiredError`/`-32042` contract and ensure
      modern-only header mismatch, missing-capability, and unsupported-version
      typed errors are not emitted where the old profile specifies different
      behavior.
- [ ] Apply every remaining generated-schema difference automatically rather
      than hand-maintaining a partial compatibility type: required/optional
      `_meta`, icons and metadata, content blocks, tool annotations/execution,
      sampling/tool choice/model hints, elicitation schemas, and capability
      fields must all come from the pinned dated schema.
- [ ] Preserve the older JSON-RPC envelope rules: a POST body is one request,
      notification, response, or error response (not a batch); notifications
      have no ID; responses correlate exactly and travel back over the
      appropriate transport stream/POST channel.
- [ ] Enforce cancellation direction and lifecycle rules: cancel only a request
      previously sent in the same direction and believed in flight, never cancel
      `initialize`, use `tasks/cancel` rather than `notifications/cancelled` for
      task-augmented work, send no response after accepted cancellation, and
      safely ignore unknown, completed, malformed, and late cancellation races.

## 6. Restore legacy resources and streaming

- [ ] Implement `resources/subscribe` and `resources/unsubscribe` with
      connection/session-scoped subscription storage, URI validation,
      idempotency rules, cleanup, and `notifications/resources/updated`
      delivery.
- [ ] Keep legacy subscriptions distinct from `2026-07-28`
      `subscriptions/listen`, subscription IDs, acknowledgement notifications,
      and request-owned streams.
- [ ] Support the older Streamable HTTP GET/SSE listener, POST response modes,
      multiple concurrent SSE streams, event IDs, reconnect via `Last-Event-ID`,
      replay/redelivery, and server-initiated messages.
- [ ] For POST, require `Accept` to advertise both `application/json` and
      `text/event-stream`; accept exactly one JSON-RPC message; return 202 with
      no body for accepted notifications/responses; and support either JSON or
      SSE for requests. For GET, require SSE acceptance and return either an SSE
      stream or 405.
- [ ] Implement SSE polling details: optionally prime with an ID plus empty
      data, honor the SSE `retry` delay, keep logical streams distinct from
      physical reconnects, terminate a request stream after its response, and
      never broadcast one server message onto multiple open streams.
- [ ] Make event IDs globally unique within the session/client and bound to the
      originating stream; `Last-Event-ID` may replay only that stream and must
      not become a cross-stream replay oracle.
- [ ] Implement `Mcp-Session-Id` creation, response propagation, validation,
      session affinity, expiry, and client `DELETE` termination. Preserve the
      dated optionality: servers may decline to create sessions or accept client
      termination; when a session is issued, clients send it on every later
      request, missing required IDs produce 400, expired/terminated IDs produce
      404, and a client receiving 404 reinitializes without the old ID.
- [ ] Generate session IDs with cryptographic entropy and visible ASCII only,
      never accept one on the initialization request as proof of an existing
      session, and prevent fixation, guessing, or reuse across principals.
- [ ] Apply the HTTP protocol-version header only after initialization, using
      the negotiated version. Reject invalid/unsupported headers with HTTP 400;
      when neither a header nor session negotiation identifies a version,
      implement the specified `2025-03-26` fallback without accidentally
      claiming full `2025-03-26` SDK support.
- [ ] Preserve stdio framing while adding a duplex router capable of
      server-initiated requests and responses in both directions.
- [ ] Keep the modern POST-only/request-owned HTTP path and `Mcp-Method`,
      `Mcp-Name`, and modern metadata/header consistency checks isolated from
      the legacy transport path.
- [ ] Decide separately whether to implement the optional, deprecated
      `2024-11-05` HTTP+SSE endpoint fallback. It is not required to claim
      `2025-11-25` Streamable HTTP support and must not be implied by the dual
      version claim if omitted.

## 7. Restore core Tasks for `2025-11-25`

- [ ] Implement the core task schemas: `Task`, statuses, task metadata,
      related-task metadata, task-augmented params, task creation result, and
      task payload/result types.
- [ ] Implement `tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel`, and
      `notifications/tasks/status`, including pagination and empty-result/error
      cases.
- [ ] Implement task augmentation and capability negotiation for supported
      client- and server-originated methods, including tool-level execution
      declarations.
- [ ] Implement task IDs, ownership/isolation, status transitions,
      `input_required`, TTL/retention, result availability, cancellation races,
      progress association, disconnect cleanup, authorization, and resource
      limits.
- [ ] Test task-specific invariants: receivers reject unsupported augmentation;
      task creation returns immediately; status notifications and polling agree;
      terminal states are immutable; payload/result retrieval follows
      availability and retention rules; pagination cursors are opaque; and task
      cancellation returns final task state rather than an empty result.
- [ ] Keep these released core tasks separate from the current experimental
      `ext-tasks` overlay for `2026-07-28`; document whether application-level
      adapters are offered, without conflating their wire contracts.

## 8. Version capabilities and high-level client/server APIs

- [ ] Model legacy capabilities as initialization-scoped and modern capabilities
      as request-scoped; never reuse a capability decision across profiles.
- [ ] Add high-level legacy client operations for initialization, ping,
      set-log-level, resource subscribe/unsubscribe, and core tasks.
- [ ] Add client handlers/layers for server-originated sampling, roots, and
      elicitation requests, with consent and policy hooks.
- [ ] Add server APIs for initiating those requests and awaiting correlated
      responses, plus roots-change and elicitation-complete notification
      handling.
- [ ] Decide and document whether constructors are profile-specific
      (`McpClient2025`, `McpServer2025`) or accept a discriminated profile
      option; ensure TypeScript prevents calling profile-inapplicable
      operations.
- [ ] Preserve current `InputRequiredPolicy`, MRTR retry/state-token behavior,
      result caching, and subscription APIs only for `2026-07-28`; provide
      explicit adapters rather than pretending they are legacy wire features.

## 9. Version authorization and security behavior

- [ ] Audit the complete dated `2025-11-25` authorization document against the
      current auth client and protected-resource modules: protected resource
      metadata discovery, authorization-server metadata discovery,
      pre-registration, Client ID Metadata Documents, Dynamic Client
      Registration, PKCE, resource indicators, token audience validation,
      scopes, `WWW-Authenticate` challenges, step-up authorization, and token
      refresh.
- [ ] Add a `specVersion`/profile input to auth discovery and validation rather
      than hard-coding `2026-07-28`; retain version-specific conformance
      invocations and evidence.
- [ ] Bind legacy HTTP sessions, subscriptions, tasks, and server-initiated
      requests to the authenticated principal; prevent cross-session replay or
      data leakage.
- [ ] Apply the dated origin/Host validation and DNS-rebinding requirements to
      both POST and GET/SSE endpoints, and validate redirect URIs, metadata
      URLs, and SSRF-sensitive discovery independently of peer input.
- [ ] Document the security/lifecycle consequences of enabling the legacy
      stateful profile, including resource limits, session expiry, replay
      buffers, and user-consent requirements for tools, sampling, roots, and
      elicitation.

## 10. Observability, documentation, and examples

- [ ] Add protocol version, lifecycle state, session (safely hashed), message
      direction, task, subscription, reconnect, and server-request correlation
      to spans/metrics/logs without exposing tokens or sensitive payloads.
- [ ] Update the observability inventory and coverage generator for
      version-specific operations and verify no high-cardinality raw IDs leak.
- [ ] Replace “clean break/no legacy emulation” statements in README, usage,
      feature coverage, migration, maintenance, release, and security docs with
      an accurate dual-profile support matrix.
- [ ] Add client and server examples for legacy stdio and HTTP initialization,
      server requests, subscriptions, resumability, logging, and tasks while
      retaining all modern examples.
- [ ] Add a migration/interoperability guide that explicitly maps legacy
      initialize/session/server-request/task behavior to the modern discovery,
      MRTR, subscription, caching, and extension alternatives.
- [ ] Add a changeset and release notes identifying this as additive protocol
      support and documenting default-selection and compatibility guarantees.

## 11. Verification and release gates

- [ ] Unit-test every older generated codec, lifecycle transition, negotiation
      branch, capability gate, task transition, cache/profile partition, and
      error.
- [ ] Add transport matrices for
      `{stdio, HTTP} × {client, server} × {2025-11-25, 2026-07-28}`, including
      malformed cross-version messages.
- [ ] Add a machine-checked coverage manifest derived from both generated
      schemas that accounts for every request, response, notification,
      capability, error code, and HTTP method/status rule; fail CI when upstream
      source inventory and runtime/test inventory diverge.
- [ ] Test HTTP initialize/session creation, GET/SSE, DELETE, reconnect/replay,
      multiple streams, unknown/expired sessions, version-header rules, auth
      challenges, cancellation, backpressure, size limits, and shutdown cleanup.
- [ ] Test bidirectional request ID correlation and concurrent
      sampling/roots/elicitation requests over both transports, including
      timeout, disconnect, cancellation, and late-response races.
- [ ] Add a self-hosted `e2e:2025-11-25` equivalent to the modern e2e and run
      both in CI.
- [ ] Run the official `2025-11-25` server, client, and authorization
      conformance suites independently from the `2026-07-28` suites; store
      separate evidence keyed by profile, harness revision, transport, role, and
      scenario.
- [ ] Add differential interoperability tests against at least one official SDK
      locked to `2025-11-25`, but treat them as supplemental rather than
      normative.
- [ ] Extend lint, type fixtures, Effect diagnostics, generated checks, source
      snapshots, historical-cleanup rules, readiness checks, package exports,
      packed-consumer tests, and release-artifact checks to cover both profiles.
- [ ] Require the full existing `pnpm run verify` and
      `pnpm run conformance:client-auth` baselines to remain green before
      release; no legacy baseline may replace or waive a modern failure.
- [ ] Run negative negotiation tests proving a modern request cannot enter a
      legacy dispatcher, legacy session state cannot affect a modern request,
      unsupported versions fail deterministically, and an advertised version
      always has complete client and server runtime coverage.
- [ ] Perform a final public API and threat-model review, publish a prerelease,
      and validate packed artifacts with both real legacy and modern consumers
      before declaring dual-version support stable.

## Recommended implementation order

1. Source governance and multi-version generation.
2. Profile abstraction and explicit package/API boundaries.
3. Legacy lifecycle plus duplex stdio.
4. Legacy HTTP sessions and SSE/resumability.
5. Server-originated requests, resources, logging, and ping.
6. Core Tasks and authorization hardening.
7. Complete test/conformance matrix, documentation, prerelease, and stable
   release.

Each phase should keep `2026-07-28` as the default and keep its complete
verification lane green. Partial legacy work should remain behind an
experimental, non-advertised profile until every item needed for safe protocol
negotiation is complete.
