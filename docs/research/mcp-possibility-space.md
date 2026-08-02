# MCP Possibility Space — Research Report

**Date:** 2026-08-02 **Purpose:** Map the under-explored territory of MCP to
inform the design of an Effect-native, MCP-2026-07-28-native CLI coding agent
running on Inception Mercury 2. **Method:** Web research (Exa + targeted
fetches). Every claim carries a URL. Each finding is tagged with a one-line **So
what** for our design.

> Caveat on freshness: the 2026-07-28 spec was published five days before this
> report. "Early adopter" material is therefore thin and mostly consists of SDK
> release notes, migration guides, and vendor day-one posts rather than battle
> reports. Where a claim comes from a vendor's own marketing, it is labeled as
> such.

---

## Hunt 1 — Obscure / interesting MCP implementations

### 1.1 "MCP on the Wire" — Craig Johnston (IMTI), ~20-post series reading every primitive off the wire in Go

- Series opener: https://imti.co/mcp-why-the-wire/
- JSON-RPC grammar: https://imti.co/mcp-json-rpc/
- Handshake & capabilities: https://imti.co/mcp-handshake-lifecycle/
- Resources (list/read/templates/subscriptions): https://imti.co/mcp-resources/
- Completion: https://imti.co/mcp-completion/
- Sampling: https://imti.co/mcp-sampling/
- Elicitation: https://imti.co/mcp-elicitation/
- Capstone — full server + client exercising every primitive:
  https://imti.co/mcp-capstone-go/

This is the single highest-signal obscure source found. It is low-popularity,
written against a real production server (`txn2/mcp-data-platform`, Apache-2.0
Go MCP gateway over Trino/DataHub/S3), and every post shows raw JSON frames next
to the code that produced them. Notable mechanisms exercised:

- **Elicitation as a cost/PII guardrail, not a form-filler.** Before running a
  Trino query the platform runs `EXPLAIN IO`, and if the query is too expensive
  or touches PII columns it elicits confirmation naming the specific columns
  found. Decline is recorded as `user-declined` in the audit trail.
  (https://imti.co/mcp-elicitation/)
- **Capability negotiation as per-user authorization.** Default-deny personas
  map each verified identity to an allowed tool set, so two users complete the
  same handshake and then see _different_ `tools/list` results.
  (https://imti.co/mcp-handshake-lifecycle/)
- **Resource templates instead of tools for structural data.** RFC 6570
  templates (`schema://{catalog}.{schema_name}/{table}`, `glossary://{term}`,
  `availability://...`) let an agent read any table's shape by URI without
  enumerating anything, and without burning a tool slot.
  (https://imti.co/mcp-resources/)
- **Deliberate _non_-use of sampling.** The platform grounds the model by
  injecting catalog context into tool results rather than calling back for
  sampling, keeping the model's reasoning entirely client-side. The author's
  framing: "Sampling is the tool for servers that genuinely need the host's
  model mid-task; many data platforms do not."
- **In-memory transport as the test harness.** `mcp.NewInMemoryTransports()`
  connects client and server in one process speaking the real protocol, with the
  test client supplying sampling and elicitation handlers — the whole protocol
  surface tested without a process boundary. (https://imti.co/mcp-capstone-go/)

**So what:** This series is the closest thing to a conformance reading list for
a maximal client — and the per-user `tools/list` filtering plus
resource-templates-over-tools pattern are both things our client must not assume
away (lists are _not_ invariant per server; under 2026-07-28 that is exactly
what `cacheScope: "private"` exists to express).

### 1.2 Completions — the one MCP primitive the model never sees

- Spec:
  https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/completion
- Wire-level walkthrough: https://imti.co/mcp-completion/
- Python SDK guide:
  https://py.sdk.modelcontextprotocol.io/v2/servers/completions/

`completion/complete` supplies autocomplete for **prompt arguments** and
**resource-template variables** only. Johnston's framing is the insight:
"Completion is the one primitive so far that the model never sees. It is purely
for the person typing into the client... It belongs to the user-controlled world
of prompts, not the model-controlled world of tools." The `context.arguments`
field carries already-resolved arguments so suggestions narrow progressively
(pick `owner`, then `repo` completes against that owner's repos). Results are
capped at 100 values with `total`/`hasMore` for paging. The capability is
declared implicitly by registering the handler.

**So what:** This is a near-free differentiator for a _CLI_. MCP prompts are
explicitly designed to surface as slash commands; completions make their
arguments tab-completable against live server state. Almost no client implements
this, and it costs the model nothing because it never enters the context window.

### 1.3 Elicitation in practice — the failure modes people actually hit

- GitHub Blog, Chris Reddington:
  https://github.blog/ai-and-ml/github-copilot/building-smarter-interactions-with-mcp-elicitation-from-clunky-tool-calls-to-seamless-user-experiences/
- DEV, kachurun — server + client + real chat UI:
  https://dev.to/kachurun/mcp-elicitation-human-in-the-loop-for-mcp-servers-m6a

Reddington's lessons from building a turn-based-game server: (a) shipping
elicitation-enabled tools _alongside_ the originals produced eight
near-duplicate tools and Copilot repeatedly picked the wrong one — he
consolidated to four; (b) his first implementation elicited on _every_
invocation regardless of what the user already supplied, so the fix was to parse
the initial request and elicit only the missing fields, with property names
aligned between the tool schema and the elicitation schema.

kachurun's post is the more architecturally interesting one: it documents why
elicitation is hard on the client side under the _old_ push model. HTTP
streaming is one-way, so the frontend can't answer on the same connection; most
frameworks therefore terminate the thread when a tool asks for confirmation. But
the MCP server is still blocked on a Promise, so killing the thread drops the
answer. His workaround was a shared registry of pending elicitation resolvers
plus a separate `/api/chat/elicitation` endpoint, with an explicit note that
this Map-of-promises approach breaks on edge runtimes or multi-process backends
and would need Redis pub/sub.

**So what:** kachurun's entire workaround is exactly what MRTR deletes — the
2026-07-28 design turns his ad-hoc promise registry into a protocol-level
`requestState` blob. Worth citing internally as the "why MRTR" motivation.
Reddington's lesson transfers directly to the tool factory: generated tools with
overlapping names/descriptions actively degrade selection accuracy.

### 1.4 MCP Apps — 20 apps in 2 days, and the load-bearing constraints

- Teal Larson, "Lessons from building 20 MCP Apps in 2 days":
  https://www.teallarson.dev/blog/2026-05-20-mcp-apps
- Spec/docs: https://modelcontextprotocol.io/docs/extensions/apps.md ·
  https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md
- SEP-1865:
  https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp.md
- Build walkthrough with current (not deprecated) spec values:
  https://dreaming.press/posts/how-to-ship-an-mcp-app-interactive-ui.html
- Second walkthrough: https://alatirok.com/build-an-mcp-app/

Larson's findings, in order of usefulness:

1. **The text response is still the contract.** `_meta.ui` is silently ignored
   by hosts without Apps support — "Claude Code, most terminal-based clients,
   anything that isn't on the new extension." Putting the actual answer in the
   UI and leaving the text empty ships a tool that silently breaks in half your
   clients.
2. **The UI ships inside the server**, fetched over MCP via `ui://`, not from a
   hosted URL.
3. **Keep components pure** — all data as props from the tool result, no
   fetches, no state machines inside the sandbox.
4. **Hosts implement the spec with their own opinions** — container width,
   padding, typography, dark/light all vary; ChatGPT renders wide, Claude
   narrow.
5. **Never collect secrets in an App** — iframe content is visible to the host.

Two spec values changed under people's feet and the old ones are still in
circulation: MIME type is now `text/html;profile=mcp-app` (not `text/html+mcp`)
and the tool binding is nested `_meta.ui.resourceUri` (not the flat
`_meta["ui/resourceUri"]`).

Also notable: **app-only tool visibility.** `visibility: ["app"]` exposes a tool
to the View but not the model — refresh buttons, pagination, form submits — so
UI plumbing never enters the agent's context
(https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md).

**So what:** As a terminal client we are on the degrading side of this. The
right posture is to _consume_ `structuredContent` and ignore `_meta.ui`
gracefully — but the `visibility: ["app"]` idea inverts usefully: a client can
also filter which tools reach the model versus which are available to its own
UI/automation layer.

### 1.5 Live data in an MCP App via `connectedDomains` CSP escape hatch

- https://dev.to/ashita/how-i-added-websocket-powered-realtime-streaming-to-mcp-apps-3oh6

MCP App iframes are sandboxed with no outbound network by default. The
`_meta.ui.csp` object has two distinct fields: `resourceDomains`
(scripts/styles/images) and `connectedDomains` (fetch/XHR/**WebSocket**).
Declaring `connectedDomains: ["ws://localhost:8765"]` grants a targeted
`connect-src` and lets the View hold a persistent WebSocket to a separate
backend — bypassing the host relay entirely, with per-client filter state and
server-side pause/resume.

**So what:** Concrete demonstration that the "MCP can't push" constraint is
routinely worked around _outside_ the protocol. Relevant when we evaluate
whether `subscriptions/listen` is genuinely sufficient for live tool-factory
build status, or whether we need a side channel.

### 1.6 The honest state of subscriptions and notifications (pre-2026-07-28)

- https://chatforest.com/guides/event-driven-mcp-patterns/
- https://chatforest.com/guides/mcp-real-time-streaming/

Blunt capability matrix from these surveys: resource subscriptions are "Stable /
Very low" client support; notifications are "Stable / Low — most clients
ignore"; sampling and elicitation are "Limited." Claude Desktop did not support
resource subscriptions as of March 2026. The diagnosis is a coordination
failure: "servers avoid implementing notification features because clients don't
advertise support for them." The pragmatic default they recommend is polling.

Also worth knowing about the _design_: MCP deliberately decouples notification
from delivery. `notifications/resources/updated` carries only the URI; the
client must re-read. That is a nudge, not a payload — it keeps servers from
flooding clients but costs an extra round trip per update.

**So what:** The client-capability gap is our opening. Being the client that
actually implements `subscriptions/listen`, cacheable lists, and completions is
a real differentiator, not a checkbox — but we should expect most _servers_ not
to emit anything, and design the UX so that a fully silent server is the normal
case.

### 1.7 Python SDK's subscriptions guide — the security wrinkle nobody mentions

- https://py.sdk.modelcontextprotocol.io/v2/handlers/subscriptions/

By default any caller may open a `subscriptions/listen` stream on any URI, and
nothing consults the read handler — because nobody is reading. A caller that
`resources/read` would reject can still learn that `files://payroll.csv`
changed, and when. Never the content, and it cannot probe existence (unknown
URIs are accepted and simply never fire), but it is a real side channel in
multi-tenant servers. The recommended gate is middleware that validates the
requested filter before the SDK acknowledges, with a uniform refusal message
that names no URI. Also: the subscription decision holds for the stream's
lifetime — there is no per-event re-check, so expiring credentials require
ending the connection.

**So what:** If we ever expose our own MCP surface (the tool factory as a
server), subscription authorization is a separate gate from read authorization.
Note it in the threat model now.

---

## Hunt 2 — 2026-07-28 early adopters and the stateless spec

### 2.1 Primary sources

- Official announcement: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- MRTR pattern spec:
  https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- Tasks extension: https://modelcontextprotocol.io/extensions/tasks/overview ·
  https://tasks.extensions.modelcontextprotocol.io/
- SEP-2663 (Tasks):
  https://github.com/modelcontextprotocol/modelcontextprotocol/blob/02dd8f61/seps/2663-tasks-extension.md
- Client registration / CIMD:
  https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- Anthropic/Claude rollout:
  https://claude.com/blog/bringing-mcp-2026-07-28-to-claude

### 2.2 MRTR — the mechanism, and the trap

The core loop: server returns `resultType: "input_required"` with an
`inputRequests` map and an opaque `requestState`; client fulfills each request
and **retries the original call with a different JSON-RPC id**, echoing
`requestState` byte-for-byte. Only `prompts/get`, `resources/read`, and
`tools/call` may return it.

**The trap, stated most clearly by Particula Tech**
(https://particula.tech/blog/mcp-stateless-spec-migration): _"MRTR makes your
tool handler re-entrant... the server processing the retry needs nothing beyond
what is in that retry, which means your handler runs from the top, every round.
Everything before the elicitation point executes again: authorization checks,
rate-limit decrements, audit-log writes, billing meters, any side effect at
all."_

Spec-mandated `requestState` hygiene
(https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr):
servers **MUST** treat it as attacker-controlled; **MUST** integrity-protect it
(HMAC/AEAD) if it influences authz, resource access, or business logic;
**SHOULD** embed the authenticated principal, a short TTL, and an identifier for
the originating request to bound replay. Servers **MUST NOT** send an
`inputRequests` entry for a capability the client did not declare. Servers
**MUST NOT** assume the client will retry at all.

**So what:** As a client we own three obligations most implementations will get
wrong: (1) never inspect or mutate `requestState`; (2) mint a _new_ request id
on retry; (3) durably persist the pending round if the user may take minutes.
Effect's typed error channel plus a `Schema`-opaque `RequestState` newtype makes
(1) enforceable at the type level — that is a genuine advantage over the
reference SDKs.

### 2.3 The Python SDK's MRTR story — the best worked example available

- https://github.com/modelcontextprotocol/python-sdk/blob/1963af52/examples/stories/mrtr/README.md
- DeepWiki summary:
  https://deepwiki.com/modelcontextprotocol/python-sdk/5.5-multi-round-trip-and-input-required

Highest-value details:

- `MCPServer` **seals `requestState` by default** under a process-local key
  generated at startup. Handlers keep writing plaintext
  (`request_state="awaiting-confirm"`); the wire only ever carries an opaque
  token. The example deliberately flips one character of the token and shows the
  single frozen error every verification failure maps to: `-32602`,
  `"Invalid or expired requestState"`, `{"reason": "invalid_request_state"}` —
  the _specific_ reason (tampered tag / expiry / wrong request / wrong
  principal) appears only in the server log, never on the wire.
- **The default key dies with the process.** A restart, or a retry landing on a
  different instance, invalidates in-flight rounds. Fleets must configure
  `RequestStateSecurity(keys=[...])`.
- Client side has **two tiers**: an auto-loop
  (`Client(..., elicitation_callback=...)` then a plain
  `await client.call_tool(...)`, callbacks fired transparently, bounded by
  `input_required_max_rounds`, default 10, raising
  `InputRequiredRoundsExceededError`) and a manual loop
  (`client.session.call_tool(..., allow_input_required=True)` returning the raw
  `InputRequiredResult` so `request_state` can be persisted between rounds).

The C# SDK has the mirror-image test showing what happens when a server returns
`input_required` with only `requestState` and no `inputRequests`: the client has
nothing to dispatch, retries with the same state, and exhausts its retry budget
(https://github.com/modelcontextprotocol/csharp-sdk/blob/0d34048e/tests/ModelContextProtocol.Tests/Server/MrtrInputRequiredExceptionTests.cs).

**So what:** Ship both tiers from day one. The auto-loop is the ergonomic
default; the manual loop is what makes "the user walked away for ten minutes and
the CLI restarted" survivable. Bound the rounds and surface the exhaustion as a
distinct typed error, not a hang.

### 2.4 Arcade's day-one client checklist — the only real client-side field report

- https://www.arcade.dev/blog/supporting-stateless-mcp-client-checklist/ (vendor
  post, published 2026-07-28)

The sharpest line: _"That `requestState` blob is the server's encrypted memory
of a half-finished operation, handed to your client for safekeeping... Your
client must not peek inside it, must not lose it, and must be able to resume the
operation on a different server replica than the one that issued it. In practice
that means durably parking in-flight work, which is a genuinely new
responsibility for a client."_

Their overall assessment: _"how much of it is auth and lifecycle: per-user
tokens, issuer keying, silent refresh, mix-up defense, third-party OAuth, and
keeping every credential away from the model. The stateless parts
(self-contained requests, discovery, MRTR, tasks) are mechanical and
well-scoped. The auth parts are where the real engineering (and the real
security surface) lives."_

**So what:** Directly contradicts the intuitive effort estimate. Budget the auth
work (CIMD, per-issuer credential keying, silent refresh, RFC 9207 `iss`
validation) as the hard half, and the protocol mechanics as the easy half.

### 2.5 The failure modes that are silent

Particula (https://particula.tech/blog/mcp-stateless-spec-migration) names two
changes that fail without an error:

1. **`cacheScope` defaulting the wrong way for entitlement-filtered tool
   lists.** If a server's `tools/list` varies per user (see §1.1 — personas do
   exactly this) and the response is cached as shareable, you serve one tenant's
   tool list to another.
2. **Per-request `logLevel`: omit it and your server emits no
   `notifications/message` at all**, with no error. `logging/setLevel` is gone.

Also gone with no replacement: **stream resumability**. No `Last-Event-ID`, no
SSE event IDs. A broken response stream loses the in-flight request and the
client must re-issue with a new id — which means _every non-idempotent tool now
needs a server-side idempotency key it did not need before, because the client's
retry is indistinguishable from a fresh call._ And **`ping` is removed**, so
`subscriptions/listen` (now the only long-lived connection) has no protocol
keep-alive: quiet streams need an SSE comment line (`:\r\n`) below the shortest
intermediary idle timeout, and servers should set `X-Accel-Buffering: no`.

New error codes, renumbered late: `HeaderMismatch` `-32020`,
`MissingRequiredClientCapability` `-32021`, `UnsupportedProtocolVersion`
`-32022` (were `-32001/-32003/-32004` in the v2 alphas).

**So what:** Three concrete client requirements: (a) partition the response
cache by `cacheScope` _and_ by authenticated principal, never trusting a
server's `cacheScope: "public"` blindly on an authenticated connection; (b)
always send `logLevel` in `_meta` or accept total log silence; (c) treat every
stream break as "in-flight request lost," and never auto-retry a non-idempotent
tool call without an explicit user-visible decision.

### 2.6 Tasks vs MRTR — two mechanisms, same field names, separate keyspaces

From SEP-2663 and the Tasks docs:

- Task creation is **server-directed** but client-gated: client advertises
  `io.modelcontextprotocol/tasks` in per-request `_meta` capabilities; server
  decides per request whether to return `resultType: "task"`. **The client must
  be ready for either an inline result or a handle from the same `tools/call`.**
- **`tasks/list` does not exist** — cut over scoping concerns. The client owns
  the durable record of every handle it created. Persist `taskId` the moment you
  get it.
- `tasks/get` is a pure idempotent read; `tasks/update` carries writes
  (`inputResponses`). They were deliberately split so reads stay cacheable and
  replayable.
- Task creation is **strongly consistent**: a server MUST NOT return
  `CreateTaskResult` until a `tasks/get` for that id would resolve.
  `tasks/update` and `tasks/cancel` are eventually consistent. Cancellation is
  cooperative — acknowledged, not guaranteed.
- Over Streamable HTTP, `tasks/*` **MUST** set the `Mcp-Name` header to
  `params.taskId` so intermediaries can route to the instance holding state.
- **The MRTR and task `inputRequests` keyspaces are independent.** MRTR resolves
  _before_ task creation (to decide whether to proceed); task `inputRequests`
  surface _during_ execution via `tasks/get` and are answered via
  `tasks/update`. Clients do not deduplicate across the two.

C# SDK implementation notes worth stealing
(https://csharp.sdk.modelcontextprotocol.io/v2/concepts/tasks/tasks.html):
`CallToolWithPollingAsync` deduplicates already-resolved input-request keys
across polls, and includes a safety net — if a task stays `InputRequired` across
many consecutive polls without exposing any _new_ keys, the client gives up,
issues a best-effort `tasks/cancel`, and throws. Guards against an unbounded
poll loop against a misbehaving server.

**So what:** Model Tasks and MRTR as two distinct Effect state machines with
distinct types, not one generalized "server needs something" abstraction — the
spec explicitly warns they only look alike. And the taskId ledger is ours to
own: a durable store keyed by taskId, surviving CLI restarts, is a hard
requirement, not a nicety.

### 2.7 SDK migration notes (official)

- TypeScript, adopting 2026-07-28:
  https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- TypeScript, v1→v2:
  https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html
- Go SDK v1.7.0 release notes:
  https://newreleases.io/project/github/modelcontextprotocol/go-sdk/release/v1.7.0
- Rust SDK MRTR PR: https://github.com/modelcontextprotocol/rust-sdk/pull/929
- Python SDK tracking issue:
  https://github.com/modelcontextprotocol/python-sdk/issues/2898

Details that matter for a clean-break client:

- **TS SDK: nothing speaks 2026-07-28 by default.** A hand-constructed
  `Client`/`Server` keeps the 2025 handshake byte-for-byte. Opt in via
  `ClientOptions.versionNegotiation`: `'legacy'` (default, no probe), `'auto'`
  (probe `server/discover`, fall back to `initialize` — costs one extra round
  trip; on stdio the probe rides a _disposable sibling process_), or
  `{ pin: '2026-07-28' }` (rejects with `SdkError(EraNegotiationFailed)` against
  a 2025-only server).
- **`ConnectOptions.prior`** accepts a cached negotiation verdict:
  `{ kind: 'modern', discover }` adopts a previously obtained `DiscoverResult`
  with **zero round trips**; `{ kind: 'legacy' }` skips the probe. Stop
  supplying it and `connect()` falls back to the configured mode and re-probes.
- **Final-revision wire change (spec PR #3002), landed late:** `serverInfo`
  moved _out of_ the `DiscoverResult` body into result
  `_meta['io.modelcontextprotocol/serverInfo']`, and envelope `clientInfo`
  demoted from MUST to SHOULD. The TS SDK shipped the pre-#3002 shape first,
  which made its client **hard-reject a conforming server's `DiscoverResult`**,
  misclassify it as legacy, and fail to connect against go-sdk v1.7.0-pre.3.
  Fixed in #2513.
- **Go SDK:** the Streamable HTTP transport accepts 2026-07-28 **only when
  `StreamableHTTPOptions.Stateless = true`**; otherwise clients negotiate down
  to 2025-11-25. `ping`, `logging/setLevel`, `resources/subscribe`,
  `resources/unsubscribe` are rejected with `MethodNotFound` on this revision.
- **TS SDK cache defaults:** when serving 2026-07-28 the SDK _always_ emits
  `ttlMs` and `cacheScope`, defaulting to the most conservative policy
  (`ttlMs: 0`, `cacheScope: 'private'`). Real policy comes from
  `ServerOptions.cacheHints`.
- **Legacy shim for `input_required`:** handlers written once in the 2026
  `inputRequired(...)` style are served on 2025-era connections by re-issuing
  each embedded request as a real server→client request and re-entering the
  handler. Both SDKs (TS and Go) ship this shim.
- **Deprecated (SEP-2577), 12-month floor, earliest removal 2027-07-28:** Roots,
  Sampling, Logging, legacy HTTP+SSE, and OAuth DCR. Suggested migrations: pass
  directories as tool params/resource URIs instead of Roots; integrate the LLM
  provider API directly instead of Sampling; stderr or OpenTelemetry instead of
  Logging.

**So what:** Two direct actions. (1) `ConnectOptions.prior`-style verdict
caching is the right shape for a CLI that reconnects constantly — persist the
discover result per server and start at zero round trips. (2) The #3002 incident
is a warning: pin against the _final_ revision schemas and build a cross-SDK
interop test (our client vs. go-sdk and python-sdk reference servers) rather
than trusting one SDK's types.

### 2.8 CIMD — client identity as a URL

- Spec:
  https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- IETF draft:
  https://datatracker.ietf.org/doc/draft-parecki-oauth-client-id-metadata-document/
- WorkOS explainer:
  https://workos.com/blog/client-id-metadata-documents-cimd-oauth-client-registration-mcp
- Auth0 explainer incl. SSRF caveat:
  https://auth0.com/blog/cimd-vs-dcr-mcp-registration/

Registration priority order is: pre-registration → CIMD → DCR → prompt the user.
CIMD makes the `client_id` an HTTPS URL (with a path component) hosting a JSON
doc whose `client_id` field must exactly match the URL. Auth servers advertise
`client_id_metadata_document_supported: true`. The client's identity is then
**stable and portable across every authorization server** — no per-server
credential storage, no re-registration when a server changes its AS.
Confidential clients use `token_endpoint_auth_method: "private_key_jwt"` plus
`jwks_uri` instead of per-server secrets.

The tradeoff Auth0 names: CIMD moves the attack surface from a writable
registration endpoint to an **SSRF** on the auth server's fetcher (block
loopback/internal ranges, aggressive timeouts, response-size caps ~5kb).

Also in 2026-07-28: clients **MUST** validate the RFC 9207 `iss` parameter
before redeeming a code (SEP-2468, closes AS mix-up); client credentials are
**bound to the issuer that minted them** and MUST NOT be reused across
authorization servers (SEP-2352); `application_type` must be set during DCR so
localhost redirects stop being rejected (SEP-837).

**So what:** For a CLI, CIMD is a large ergonomic win — publish one
`client.json` at a stable URL and every MCP server on the internet can identify
us with zero registration. It also removes the "CLI OAuth is broken because
localhost redirects get rejected" class of bug. This should be table stakes in
v1, and it is the single most user-visible thing we get from the new spec.

### 2.9 Adoption signals (as of 2026-08-02)

- All four Tier 1 SDKs (TS, Python, Go, C#) shipped 2026-07-28 support on
  release day; Rust in beta.
  (https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- Supabase, quoted in the official announcement: _"Supporting elicitations has
  been on our roadmap for a while, but since Supabase MCP runs statelessly, it
  wasn't something we could do easily. MRTR changes that."_
- Anthropic reports MCP passed 400M monthly SDK downloads and 950+ servers in
  the Claude connectors directory.
  (https://claude.com/blog/bringing-mcp-2026-07-28-to-claude — vendor figures)
- Third-party migration writeups, all published 2026-07-28/29 and all _guides_
  rather than experience reports:
  https://www.cometapi.com/mcp-2026-07-28-migration-guide/ ·
  https://lilting.ch/en/articles/mcp-stateless-core-spec ·
  https://blog.mcpservers.org/posts/mcp-spec-2026-07-28 ·
  https://newrelic.com/blog/ai/mcp-is-going-stateless ·
  https://hashnode.com/blog/mcp-stateless-migration
- Press:
  https://www.theregister.com/devops/2026/07/23/model_context_protocol_prepares_to_break_with_its_stateful_past/

Compatibility reality: **both mixed pairs fail.** A legacy client hitting a
modern server has no fall-forward mechanism at all — `initialize` is an unknown
method, required headers are missing, and on HTTP it gets a `400` it cannot
interpret.

**So what:** Our clean break to 2026-07-28-only means we simply cannot talk to
the existing installed base of servers. That is a deliberate, defensible choice
— but it needs to be an explicit product decision with a `mode: 'auto'`-style
fallback on the roadmap, because on 2026-08-02 the overwhelming majority of
deployed servers still speak 2025-11-25.

---

## Hunt 3 — Self-extending agents and tool factories

### 3.1 Academic lineage

| Work                                  | Contribution                                                                                                                                                                                                                                                                                                                                                                              | URL                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Voyager** (2023)                    | Ever-growing **skill library** of executable code; skills indexed by embedding of their description and retrieved by similarity; iterative prompting with execution errors + self-verification before commit; skills compose into complex skills. 3.3× more items, 15.3× faster tech-tree; library transfers zero-shot to a new world and _also boosts AutoGPT_ as a plug-and-play asset. | https://voyager.minedojo.org/ · https://github.com/MineDojo/Voyager                            |
| **LATM / LLMs as Tool Makers** (2023) | The tool-maker/tool-user split — expensive model makes the tool once, cheap model reuses it.                                                                                                                                                                                                                                                                                              | arXiv:2305.17126                                                                               |
| **CREATOR** (2023)                    | Four stages: creation, decision, execution, **rectification**. Explicitly disentangles abstract reasoning (making a generalizable tool) from concrete reasoning (using it). Code as the medium _because it is error-sensitive and produces tracebacks that drive automatic rectification_.                                                                                                | https://aclanthology.org/2023.findings-emnlp.462v1.pdf · https://github.com/qiancheng0/CREATOR |
| **TOOLMAKER** (ACL 2025)              | Critique of the above: building each tool _from scratch_ yields simple, narrowly-scoped tools. TOOLMAKER instead autonomously downloads, installs, and wraps _existing_ repos into LLM-callable tools, including environment setup. 80% on TM-Bench, beating OpenHands.                                                                                                                   | https://aclanthology.org/2025.acl-long.1266.pdf                                                |
| **Agent Skills survey** (2026)        | Situates the filesystem-based `SKILL.md` paradigm against the model-generated lineage; notes the open problem is _externalizing_ learned skills as portable, auditable artifacts rather than model-internal ones.                                                                                                                                                                         | https://arxiv.org/html/2602.12430v3                                                            |

**So what:** Three transferable design constraints. (1) Voyager's _retrieval by
description embedding_ is the answer to "how does the model find the tool it
built three sessions ago" — and its self-verification gate before committing to
the library is exactly the no-self-graded-verification rule this repo already
enforces. (2) CREATOR's rectification stage says the tracebacks are the point:
the factory's build/test loop should feed errors back, not just fail. (3)
TOOLMAKER's critique is the warning: a factory that only synthesizes single-file
functions will produce toys. Wrapping existing packages/CLIs is where the
leverage is.

### 3.2 MCP-specific "agent builds its own MCP tools" experiments

| Project                 | Mechanism                                                                                                                                                                                                                                                                                                                  | URL                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **genesis-mcp**         | Six meta-tools. `create_tool` returns a _code-generation prompt_ to the **host** LLM — the server never calls an API itself — then `register_tool(code=...)` validates, writes to disk, and hot-loads into the running server. Plus `list_tools`, `delete_tool`, `update_tool`, `describe_tool` (returns schema + source). | https://github.com/adeoluwaadesina/genesis-mcp        |
| **diy-tools-mcp**       | `add_tool` / `remove_tool` / `list_tools` / `view_source`. Multi-language (Python, JS, Bash, Ruby, TS), file-based or inline, syntax + security validation before registration, persistence across restarts, configurable entry points.                                                                                    | https://github.com/hesreallyhim/diy-tools-mcp         |
| **ai-meta-mcp-server**  | `define_function` meta-tool; JS/Python/Shell runtimes in isolated sandboxes; **explicit human approval required for both tool creation and tool execution**.                                                                                                                                                               | https://github.com/alxspiker/ai-meta-mcp-server       |
| **Codegen (ms1963)**    | `generate_and_register_tool`, `list_registered_tools`, `get_tool_source`, `remove_tool`, `get_registry_stats` — note the **usage statistics** per tool.                                                                                                                                                                    | https://github.com/ms1963/Codegen                     |
| **mcp-on-demand-tools** | Registers a _contract_ (name, description, paramSchema, expectedOutput, sideEffects) and simulates execution via a Goose recipe. Keeps **call history per tool** and feeds it as aggregate context to later calls.                                                                                                         | https://github.com/AaronGoldsmith/mcp-on-demand-tools |

The single most useful operational note, from mcp-on-demand-tools' README:
_"This server works best with MCP clients that support dynamic tool list updates
(like Goose Desktop). **Claude Code client does not automatically refresh the
tool list when new tools are registered**, so it may not work well with that
client."_

**So what:** This is the sentence that makes our client interesting. Every
existing tool-factory experiment is bottlenecked on client-side dynamic
tool-list refresh, and the reference clients don't do it. Under 2026-07-28 the
mechanism is explicit: `subscriptions/listen` with `toolsListChanged` opt-in,
plus `ttlMs: 0` on the factory's `tools/list` so nothing caches a stale catalog.
A client that handles this correctly makes the whole self-extension category
work for the first time. Also steal genesis-mcp's inversion — having the _host_
model generate the code (rather than the server calling out to an API) keeps the
factory model-agnostic and cost-transparent, and it fits our
tool-factory-as-deterministic-pipeline thesis exactly.

### 3.3 Code Mode / programmatic tool calling — measured evidence

- Cloudflare, original: https://blog.cloudflare.com/code-mode/
- Cloudflare, server-side: https://blog.cloudflare.com/code-mode-mcp/
- Cloudflare docs & patterns:
  https://developers.cloudflare.com/agents/model-context-protocol/codemode/ ·
  https://github.com/cloudflare/agents/tree/main/packages/codemode
- Anthropic, code execution with MCP:
  https://www.anthropic.com/engineering/code-execution-with-mcp
- Anthropic, advanced tool use:
  https://www.anthropic.com/engineering/advanced-tool-use
- Claude PTC docs:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling

The thesis, in Cloudflare's words: _"LLMs have seen a lot of code. They have not
seen a lot of 'tool calls'. In fact, the tool calls they have seen are probably
limited to a contrived training set constructed by the LLM's own developers."_

Numbers, all from vendor sources:

- Anthropic: presenting MCP servers as a filesystem of TypeScript modules the
  agent explores on demand took a scenario from **150,000 → 2,000 tokens (98.7%
  reduction)**.
- Anthropic Tool Search Tool: 58 tools ≈ 55K tokens before the conversation
  starts; internally they have seen 134K tokens of tool definitions. With
  search-based deferred loading, Opus 4 MCP eval accuracy went **49% → 74%**,
  Opus 4.5 **79.5% → 88.1%**.
- Cloudflare server-side Code Mode: the _entire_ Cloudflare API behind two tools
  (`search()` and `execute()`) at a **fixed ~1,000 tokens** regardless of
  endpoint count.
- Anthropic PTC: **~38% fewer billed input tokens** on a 75-tool benchmark with
  no accuracy change; **+11% task performance with 24% fewer input tokens** on
  BrowseComp/DeepSearchQA. But on τ²-bench (one or two sequential calls per
  turn) scores were unchanged and it cost **~8% more** — _"Sequential
  single-call workflows do not benefit."_

Two design patterns from the Cloudflare docs worth naming: **single code tool**
(one `code` tool whose description carries generated TS declarations for every
upstream tool) versus **search + execute** (for catalogs too large to fit in a
description; the OpenAPI doc never enters context). Progressive discovery via
`codemode.search()` / `codemode.describe()` from inside the running code.

### 3.4 The observability cost of Code Mode — the finding that matters most to us

- https://dreaming.press/posts/programmatic-tool-calling-claude-explained.html

_"The tokens you save are exactly the observations your evals were reading. PTC
doesn't hide a bug — it moves the trace. If your observability or eval harness
grades an agent by inspecting its tool trajectory — which tool it called, what
came back, how it reacted — that trace no longer exists at the model boundary.
It exists inside the sandbox... if you were using tool-trajectory correctness as
an eval signal, you're now grading a black box that reasons over a summary you
didn't inspect."_

**So what:** This is a hard constraint on "LangSmith-native from day one." If we
adopt any code-mode/sandbox execution, tracing instrumentation must live
_inside_ the execution environment and emit spans for each in-sandbox tool
invocation — otherwise our trajectory evals silently degrade to output-only
evals the moment we turn code mode on. Decide this before writing the tracing
layer, not after. (The 2026-07-28 spec helps: W3C Trace Context now propagates
through fixed `_meta` key names, so sandbox-internal MCP calls can carry the
parent trace — https://newrelic.com/blog/ai/mcp-is-going-stateless.)

---

## Hunt 4 — Diffusion LLM agents

### 4.1 Mercury 2 — the vendor picture

- Announcement: https://www.inceptionlabs.ai/blog/introducing-mercury-2
- Developer guide:
  https://www.developersdigest.tech/blog/mercury-2-developer-guide
- DataCamp agent tutorial: https://www.datacamp.com/tutorial/mercury-2-tutorial

Specs: **1,009 tok/s** on Blackwell; **$0.25/$0.75** per M input/output;
**128K** context; native tool use; schema-aligned JSON; **four
`reasoning_effort` levels** (instant / low / medium / high); OpenAI-compatible
API (`https://api.inceptionlabs.ai/v1`, model `mercury-2`). Claimed AIME 2025
parity with GPT-5 Mini (91.1). Comparison points cited: ~89 t/s Claude Haiku
4.5, ~71 t/s GPT-5 Mini.

The Developers Digest guide's most actionable claims: _"Tool calls are where
autoregressive models eat your latency budget alive... In a tool-heavy agent the
wall clock time on Mercury 2 lands somewhere between five and ten times
faster."_ And the mixing advice: _"Use instant for the planner, medium for the
executor, low for the formatter."_ Their recommended `reasoning_effort` mapping
— instant: classification/routing/intent; low: schema extraction, single-tool
calls; medium: multi-tool agent loops, code edits across one or two files; high:
math, deep code reasoning, agent loops with conditional branching.

They also claim diffusion is a natural fit for structured generation _because
the model refines the whole output at once instead of committing left to right_,
so "schema adherence stops feeling like a fight with the sampler."

### 4.2 The counter-evidence — and it is strong

**"The Bitter Lesson of Diffusion Language Models for Agentic Workflows"
(ACL 2026)**

- https://aclanthology.org/2026.acl-long.2036/ ·
  https://arxiv.org/html/2601.12979v1 ·
  https://coldmist-lu.github.io/DiffuAgent/ · notes:
  https://en.papernotes.org/ACL2026/llm_agent/the_bitter_lesson_of_diffusion_language_models_for_agentic_workflows_a_comprehen/

Evaluated LLaDA, Dream, FdLLM-7B, DVar-8B on AgentBoard (embodied) and BFCL
(tool calling):

- **Multi-turn tool calling: none of the dLLMs succeeded on any test instance
  (0.0%).** Best single-turn dLLM (DVar-8B) hit 28.0% overall BFCL vs Qwen-8B's
  57.8%.
- Embodied success rates below 10% in most settings, 0.0% in ScienceWorld;
  progress rates below 20% (i.e. cannot complete even one subgoal on average).
- **Two named failure modes.** _Retry loops_: dLLMs repeat the same action
  three-plus times without branching, "an over-reliance on recent context."
  _Symbolic imprecision_: "dLLMs are more prone to produce malformed JSON
  schemas," violating strict schemas or hallucinating API parameters "under
  diffusion noise."
- **Root cause claim:** "parallel decoding weakens causal dependency and induces
  fuzzy intermediate states, hindering stable commitment to partial plans or
  structured outputs" — connected to known non-autoregressive results on
  uncoordinated slot filling and lexical-choice errors.
- **Remedies were tried and did not close the gap.** APD, D2F, DCD decoding
  optimizations improved local metrics substantially (D2F raised Dream-7B BFCL
  Single-Live 1.5 → 34.3) but left a large gap. AR self-refine raised embodied
  SR 0.7% → 1.5%; periodic AR feedback → 2.2%.
- **Where dLLMs _do_ work (the DiffuAgent decomposition):** as a
  **memory/summarization module** LLaDA-8B beat Qwen-8B at its own job (40.5% vs
  34.9% SR for a Qwen-8B agent); as a **tool selector** they remain useful; as
  **tool-call editors** they fail (0.0–2.0%); as verifiers they terminate more
  reliably than LLM verifiers, which trigger premature early exits.

**"DLLM Agent: See Farther, Run Faster"** (https://arxiv.org/html/2602.07451v1)
is the counterweight: with the agent framework held fixed and _matched
agent-oriented fine-tuning on the same trajectory data_, diffusion backbones
were **>30% faster end-to-end on average (some cases >8×)** at comparable
accuracy, needing **fewer interaction rounds and fewer tool invocations**, with
evidence of "stronger global planning signals." Its two practical caveats: (1)
"naive DLLM policies are more prone to structured tool-call failures,
necessitating stronger tool-call-specific training"; (2) multi-turn agent inputs
interleaving context and action spans need **attention-mask alignment**, or
diffusion-style span corruption creates spurious context→action information flow
and performance degrades.

**Important scoping:** the bitter-lesson results are on 7–8B _open_ dLLMs, not
Mercury 2 (a reasoning dLLM with native tool use and schema-constrained output).
The results are not a direct measurement of Mercury. But the failure mechanism
is architectural, not a scale artifact, and the burden of proof runs the other
way.

**So what — the most consequential finding in this report.** Our stated model
thesis ("fast, cheap, weak at long-horizon tool orchestration") is _confirmed
and sharpened_ by independent evaluation. Three concrete design consequences:

1. **Never let the model's raw output be the tool call.** Every generated call
   must pass deterministic schema validation with a bounded repair loop before
   dispatch. Effect `Schema` decoding at the tool-call boundary is not optional
   plumbing here; it is load-bearing correctness. Note that the paper found
   dLLMs are _bad tool-call editors_ — the repair loop should be deterministic
   code or an AR model, not Mercury.
2. **Assign Mercury the roles diffusion demonstrably wins at:** tool _selection_
   from a large catalog, memory/history compression, and whole-file edit
   generation. Keep the long-horizon causal orchestration loop as a
   deterministic state machine (which is our thesis anyway — the tool factory is
   a pipeline, not a model decision).
3. **Add explicit retry-loop detection to the agent loop** (three consecutive
   identical actions ⇒ break out), because that is the documented dLLM embodied
   failure signature and it is cheap to detect.

### 4.3 A diffusion-native agent architecture that already exists

- **dllm-agent** (Codeberg, yamchabot):
  https://codeberg.org/yamchabot/dllm-agent

A coding agent on Mercury Edit (FIM / Apply / Edit endpoints). Its README states
the problem precisely: _"Autoregressive models generate tokens one at a time.
This works for tool calling because the model can stop mid-stream, run a tool,
and change direction based on the result. Diffusion models stamp out the entire
document at once — they can't stop mid-generation. So we don't try to force the
autoregressive pattern."_

The architecture is a **two-phase loop over a mutable working document**, not an
append-only conversation history:

- _Phase 1 — Tool Call Generation (FIM endpoint)._ Prompt = state + tool
  schemas, suffix = a closing marker; the model fills in the middle with tool
  calls. Because it sees both sides simultaneously it emits multiple coherent
  calls in one shot.
- _Execute tools in parallel._
- _Phase 2 — State Evolution (Edit endpoint)._ The working document is the "code
  to edit," tool results are the context, and the model **holistically
  rewrites** a new version. The state transforms rather than grows.

Tools: `read_file`, `write_file`, `list_files`, `shell`, `search`, `done`.

**So what:** This is the most directly relevant prior art in the entire report
and it is nearly invisible (a Codeberg repo with no blog post). Two ideas worth
stealing outright: (a) **multi-call-per-forward-pass via FIM with a
closing-marker suffix** — the diffusion-native replacement for sequential
tool-call emission, and a natural fit for a batched Effect fiber fan-out; (b)
**mutable working state instead of append-only history**, which sidesteps the
context-growth problem _and_ matches the paper's finding that dLLMs make good
memory-compression modules. Worth cloning and running before we commit to an
agent-loop shape.

### 4.4 Gemini Diffusion / DiffusionGemma

- Gemini Diffusion: https://deepmind.google/models/gemini-diffusion/ ·
  https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-diffusion/
- **DiffusionGemma (2026-06-10)**:
  https://blog.google/innovation-and-ai/technology/developers-tools/diffusion-gemma-faster-text-generation/
  · developer guide:
  https://developers.googleblog.com/en/diffusiongemma-the-developer-guide/

Gemini Diffusion remains an experimental waitlist demo. Its published benchmarks
are roughly Gemini 2.0 Flash-Lite parity on code (LiveCodeBench 30.9% vs 28.5%,
HumanEval 89.6% vs 90.2%) but notably _worse_ on reasoning and science (GPQA
Diamond 40.4% vs 56.5%, BIG-Bench Extra Hard 15.0% vs 21.0%) — the same
causal-reasoning gap the bitter-lesson paper measures. Its "Instant Edit" mode
(paste text/code, edit in place with minimal prompting) is the same
in-line-editing strength Mercury Edit exposes.

DiffusionGemma is the real news: **Apache-2.0, open weights**, 26B MoE
activating 3.8B params, quantized into 18 GB VRAM, 1000+ tok/s on a single H100
and 700+ on an RTX 5090, generating **256 tokens in parallel per forward pass
with bidirectional attention**. Served via vLLM, HF Transformers, SGLang, MLX.
Google is explicit that "DiffusionGemma's overall output quality is lower than
standard Gemma 4" and positions it for "speed-critical, interactive local
workflows such as in-line editing, rapid iteration, and generating non-linear
text structures."

**So what:** An open, locally-runnable dLLM with the same generation profile as
Mercury means we can develop and eval the diffusion-specific parts of the agent
loop (FIM tool-call emission, schema-repair rates, retry-loop frequency) offline
and for free, then swap in Mercury 2 behind the same interface. Also a hedge
against single-vendor dependence on Inception.

### 4.5 YouTube — candidates, no transcripts obtained

`yt-dlp` is **not installed** on this machine, and per the brief I did not
install it. Transcripts would need
`yt-dlp --skip-download --write-auto-sub --sub-format vtt` or a transcript API
key. Promising videos:

- _Inception Labs says its diffusion LLM is 10x faster than Claude, ChatGPT,
  Gemini_ — The New Stack Agents, CEO **Stefano Ermon**, ~2026-03-02:
  https://www.youtube.com/watch?v=xBGYx91YiEQ (companion article:
  https://thenewstack.io/inception-labs-mercury-2-diffusion/)
- _Diffusion LLMs? Inside Inception Labs' New Breakthrough with Stefano Ermon_:
  https://www.youtube.com/watch?v=iUDVwwOhnfo
- _Mercury 2: The First Reasoning Diffusion Language Model (1,000+ tokens/sec)_:
  https://www.youtube.com/watch?v=quOe8V2n9rU
- _Inception Labs' Mercury Coder Diffusion LLM | A NotebookLM Deep Dive_:
  https://www.youtube.com/watch?v=KEyhlVpr3Hw
- _Diffusion LLMs Are Here! Is This the End of Transformers?_:
  https://www.youtube.com/watch?v=0B9EMddwlOQ
- _What an Anthropic Engineer Thinks About MCP_ — Agentic AI Foundation:
  https://home.mlops.community/public/videos/what-an-anthropic-engineer-thinks-about-mcp

No dedicated 2026-07-28 spec deep-dive talk surfaced; the spec's launch
communication was blog + X thread
(https://x.com/dsp_/status/2082173429399142616), not a talk.

---

## Appendix — search gaps and confidence notes

- **Hunt 2 is the weakest on primary field reports**, by necessity: the spec is
  five days old. Everything labeled "migration guide" is prospective advice, not
  retrospective experience. The Python SDK's `examples/stories/mrtr/` and the
  C#/Rust SDK tests are the most trustworthy sources because they are
  executable.
- **Vendor claims are labeled inline.** Mercury 2's throughput and speedup
  figures, Anthropic's token-reduction figures, and Cloudflare's context figures
  are all first-party.
- **The bitter-lesson results do not test Mercury 2.** They test 7–8B open
  dLLMs. Treat the _mechanism_ as transferable and the _magnitudes_ as not. The
  cheapest way to close this gap is our own BFCL-style multi-turn tool-calling
  eval against Mercury 2 before committing to the agent-loop architecture —
  which is also the first thing our LangSmith harness should measure.
