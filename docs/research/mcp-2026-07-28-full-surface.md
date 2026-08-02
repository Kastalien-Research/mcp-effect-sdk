# MCP 2026-07-28: The Complete Client-Side Surface

**Purpose.** A precise map of every protocol feature a maximal 2026-07-28 client
would exercise, for the design of an Effect-native CLI coding agent intended to
be the first public client to flex the full protocol.

**Sources.** All citations are to the spec checkout at
`references/modelcontextprotocol` (HEAD `bf583f0`). Paths below are relative to
that directory. `SPEC/` abbreviates `docs/specification/2026-07-28/`; `SCHEMA`
abbreviates `schema/2026-07-28/schema.ts` (3197 lines, the source of truth —
`schema.json` and `SPEC/schema.mdx` are generated from it).

Claims marked **[unverified]** come from documents outside this checkout or are
inferences; everything else was read directly.

---

## 0. The three cross-cutting changes

Every primitive in this document is affected by three global changes. A client
that misses any of them is non-conformant on _all_ primitives simultaneously.

**0.1 — Every result carries a required `resultType`.** `SCHEMA:216`:

```ts
export type ResultType = "complete" | "input_required" | string
```

`SPEC/basic/index.mdx:81-85`: `"complete"` = final content; `"input_required"` =
an `InputRequiredResult`; extensions **MAY** add values, but the set of
recognized values **MUST** be derived from core plus _advertised_ extensions;
**any unrecognized `resultType` MUST be treated as invalid**; and for backward
compatibility an _absent_ `resultType` **MUST** be treated as `"complete"`.

**0.2 — There is no `initialize` handshake.** `SPEC/changelog.mdx:14`. Every
request carries its protocol version and capabilities in `params._meta`.
`RequestParams._meta` is non-optional in the TS schema.
`SPEC/basic/index.mdx:191`: _"Servers **MUST NOT** rely on prior requests over
the same connection to establish context."_ And `SPEC/basic/index.mdx:204-209`:
an open stdio process **is not a session** — clients may interleave unrelated
requests on one transport.

**0.3 — There are no server-initiated requests, at all.**
`SPEC/basic/transports/streamable-http.mdx:115-124`: _"The server **MUST NOT**
send independent JSON-RPC requests on this stream. Server-to-client interactions
(sampling, elicitation, list-roots) are embedded as input requests inside an
`InputRequiredResult` per MRTR."_ This is why MRTR exists.

---

## 1. MRTR — Multi Round-Trip Requests (SEP-2322)

Spec: `SPEC/basic/patterns/mrtr.mdx`. Schema: `SCHEMA:537-612`.

### 1.1 Mechanics

Four-step flow (`mrtr.mdx:33-38`): client requests → server responds
`InputRequiredResult` → client gathers input and **retries the original
request** → server completes.

**`InputRequiredResult`** (`mrtr.mdx:124-131`) has two optional fields, at least
one of which **MUST** be present (`mrtr.mdx:245`):

- `inputRequests` — a **map**, keys are server-assigned identifiers unique
  within the request, values are `ElicitRequest` | `CreateMessageRequest` |
  `ListRootsRequest` (`mrtr.mdx:228-229`). Note these are bare request objects
  with `method` + `params` — **no `jsonrpc`, no `id`**. `ElicitRequest` is not a
  `JSONRPCRequest`; it exists only as a value in this map (`SCHEMA:537-565`).
- `requestState` — an opaque string. Clients **MUST NOT** inspect, parse,
  modify, or make assumptions about it (`mrtr.mdx:130`).

**`inputResponses`** is the mirror map, keyed identically, values are
`ElicitResult` | `CreateMessageResult` | `ListRootsResult` (`mrtr.mdx:101-102`).

**Supported requests are exactly three** (`mrtr.mdx:184-192`):

| Client request   | InputRequiredResult |
| ---------------- | ------------------- |
| `prompts/get`    | Yes                 |
| `resources/read` | Yes                 |
| `tools/call`     | Yes                 |

Servers **MUST NOT** send `InputRequiredResult` on any other request. That
`prompts/get` and `resources/read` are in this list is the single most
under-implemented fact in the revision: nearly every client wires MRTR into
`tools/call` only, and treats prompt rendering and resource reading as pure
functions. They are not.

### 1.2 Retry semantics

Client requirements (`mrtr.mdx:251-257`):

1. If `inputRequests` is present, the client **MUST** construct the requested
   inputs before retrying. If it is absent (only `requestState`), the client
   **MAY** retry immediately — this is the server's "come back in a moment"
   signal.
2. If `requestState` is present, the client **MUST** echo the exact value on
   retry. If it is absent, the client **MUST NOT** include one.
3. **The JSON-RPC `id` MUST differ between the initial request and the retry** —
   they are independent requests.
4. `inputRequests`/`requestState` affect **only** the retry of the original
   request; they **MUST NOT** leak into any parallel request.

Server-side (`mrtr.mdx:246-247`): a server **MUST NOT** send an `inputRequests`
entry whose type the client did not declare in its per-request capabilities, and
**MUST NOT** assume the client will ever fulfill or retry. A server **MAY**
return `InputRequiredResult` repeatedly across multiple attempts — so the
client's loop must be bounded, and boundedness is a client-side concern the spec
does not specify a limit for.

### 1.3 Error handling

`mrtr.mdx:261-267`: servers **SHOULD** validate `InputResponses`; malformed JSON
/ invalid schema / internal errors **SHOULD** return a JSON-RPC error.
Unrecognized extra fields **SHOULD** be ignored. Crucially: **if the client
omits information the server still needs, the server SHOULD respond with a new
`InputRequiredResult` rather than an error.** So partial fulfillment is a
supported, non-exceptional path — the client should not treat a repeat
`input_required` as a failure.

### 1.4 MRTR as the sampling replacement — the design-critical read

Sampling is deprecated (§8), but `CreateMessageRequest` remains a legal
`inputRequests` value (`mrtr.mdx:229`). This is the mechanism by which a tool
asks the client's model a question mid-call:

1. Client calls `tools/call`, declaring `sampling` in
   `_meta["io.modelcontextprotocol/clientCapabilities"]`.
2. Server returns `input_required` with
   `{"some_key": {"method": "sampling/createMessage", "params": {...}}}` plus
   `requestState`.
3. Client routes the messages to **its own** model, gets a completion, and
   retries `tools/call` (new id) with
   `inputResponses: {"some_key": <CreateMessageResult>}` and the echoed
   `requestState`.

Two consequences worth designing around:

- **The gate is purely capability-declaration.** The server must not send a
  sampling input-request unless the client declared `sampling`. Since
  capabilities are per-request, the client can enable sampling on a _per-call_
  basis — e.g. allow it for a trusted tool-factory server and refuse it for a
  third-party server, on the same connection, in the same turn. This is new
  leverage that the stateful protocol did not offer.
- **It is deprecated-but-load-bearing.** `sampling` is scheduled for removal no
  earlier than a revision on/after 2027-07-28 (`SPEC/deprecated.mdx:27`). A
  clean-break client that refuses sampling entirely gives up the only
  in-protocol route for a server to reach the client's model. Recommendation:
  implement the _MRTR handling_ of `CreateMessageRequest` (cheap — it is one map
  entry), but do not implement the legacy server-initiated
  `sampling/createMessage` RPC, which no longer exists on the wire.

### 1.5 `requestState`: state size and security

**Size.** The spec sets **no bound** on `requestState` length, and no bound on
`inputRequests` map cardinality. `requestState` rides in the response body and
then back up in the retry's request body. On Streamable HTTP that means it is
subject to whatever request-body limit the client's HTTP stack and any
intermediary impose — and the client has no way to know how large it will be
before receiving it. **This is an unspecified DoS surface for clients.** A
maximal client should impose its own ceiling (reject/abort above some size) and
log it, because nothing upstream will. The spec's own example labels the value
`"AEAD-protected blob"` (`mrtr.mdx:177`), implying encrypted-and-authenticated
payloads, which are larger than the plaintext they wrap.

**Security.** All obligations are on the _server_, which is exactly why a client
must not trust the round trip (`mrtr.mdx:232-243`, `mrtr.mdx:271-272`):

- Servers **MUST** treat `requestState` as attacker-controlled input. If it
  influences authorization, resource access, or business logic, servers **MUST**
  integrity-protect it (HMAC/AEAD) and **MUST** reject state failing
  verification. Integrity protection **MAY** be omitted only when tampering can
  cause nothing worse than request failure.
- To prevent replay, servers **SHOULD** bind inside the protected payload: the
  authenticated principal (reject a different principal), a short TTL, and an
  identifier for the originating request (method name + digest of salient
  params).
- Explicit warning (`mrtr.mdx:238-243`): these measures bound the replay window
  and prevent cross-user/cross-request reuse but **do not guarantee
  single-use**; one-time-redemption semantics **MUST** be enforced server-side.

**Client-side implications the spec does not state but that follow:** because
`requestState` may encode the principal and a TTL, a client that stashes a
pending MRTR across a long user interaction (e.g. a URL-mode elicitation the
user takes ten minutes to complete) may find the state expired. The client needs
to surface that as a retryable condition, not a hard error — and per
`SPEC/client/elicitation.mdx:376-383` it **SHOULD** provide manual retry/cancel
controls precisely for this case. Also: `requestState` is opaque but it is _not_
guaranteed confidential from the client's perspective — the client is holding a
server-minted token. It should be treated as sensitive (not logged, not written
to a transcript that gets shipped anywhere).

**Caching interaction.** `SPEC/server/utilities/caching.mdx:33-38`: results
produced by an MRTR retry — any request carrying `inputResponses` or
`requestState` — **MUST NOT** be cached, because they depend on inputs outside
the cache key. And interim `input_required` results are not cacheable and carry
no cache hints (`caching.mdx:23-25`).

---

## 2. `subscriptions/listen`

Spec: `SPEC/basic/patterns/subscriptions.mdx`.

This replaces **both** the HTTP GET endpoint **and**
`resources/subscribe`/`resources/unsubscribe` (`subscriptions.mdx:7-10`).

### 2.1 Opt-in filter

The request carries a `notifications` filter (`subscriptions.mdx:42-50`):

| Field                   | Type       | Delivers                                         |
| ----------------------- | ---------- | ------------------------------------------------ |
| `toolsListChanged`      | `boolean`  | `notifications/tools/list_changed`               |
| `promptsListChanged`    | `boolean`  | `notifications/prompts/list_changed`             |
| `resourcesListChanged`  | `boolean`  | `notifications/resources/list_changed`           |
| `resourceSubscriptions` | `string[]` | `notifications/resources/updated` for those URIs |

All fields optional; omitting one means not subscribing. **The server MUST NOT
send notification types the client has not explicitly requested**
(`subscriptions.mdx:15-16`).

> **The surprise.** Declaring `listChanged` in capabilities does _nothing_ on
> its own. A client that advertises `listChanged: true` and waits will receive
> **zero** notifications forever, because the GET stream is gone. You must POST
> `subscriptions/listen` and keep the response stream open. Any client ported
> from 2025-11-25 by "just updating the types" is silently deaf.

### 2.2 Acknowledgment and subscriptionId

The server **MUST** send `notifications/subscriptions/acknowledged` as the first
message on the subscription, and **MUST NOT** send any notification before it
(`subscriptions.mdx:54-59`). On stdio this ordering is per-subscription-ID, not
per-channel — other subscriptions' messages **MAY** interleave ahead of it.

The acknowledgment's `notifications` field reflects **the subset the server
agreed to honor**; unsupported types are omitted. The client **SHOULD** diff
requested vs acknowledged and degrade gracefully (`subscriptions.mdx:61-81`).

**`io.modelcontextprotocol/subscriptionId` is the JSON-RPC id of the
`subscriptions/listen` request itself** (`subscriptions.mdx:85-92`). It appears
in `_meta` on the ack, on every notification, and on the graceful-close
response. On stdio, clients **MUST** use it to demultiplex. Multiple concurrent
subscriptions are explicitly legal (`subscriptions.mdx:107-114`).

### 2.3 Termination and reconnect

A subscription ends when (`subscriptions.mdx:116-126`): the client cancels
(close the SSE stream on HTTP; send `notifications/cancelled` referencing the
listen request id on stdio); the server tears it down; or the transport drops.

**Graceful closure** (`subscriptions.mdx:128-157`) is the discriminator: on its
own initiative the server **SHOULD** respond to the long-lived
`subscriptions/listen` request with an empty `resultType: "complete"` result
before closing. A stream that closes _without_ that response is an abrupt
disconnect, which the client **MAY** treat as a reconnect trigger. So the client
needs two distinct code paths — clean end (do not reconnect) vs. drop (reconnect
with backoff).

On stdio, after a reconnect the client **MUST** re-send `subscriptions/listen`:
**the server holds no subscription state across reconnections**
(`subscriptions.mdx:159-161`).

There is no resumability. `Last-Event-ID` and SSE event ids were removed
(`SPEC/changelog.mdx:28`); a broken response stream loses the in-flight request
and the client **MUST** re-issue it **with a new request ID**. Servers
**SHOULD** send `X-Accel-Buffering: no` and **are encouraged** to emit periodic
SSE comment keep-alives (`:\r\n`) on long-lived streams; clients must ignore
comment lines (`streamable-http.mdx:136-155`).

### 2.4 What does _not_ come over this stream

`streamable-http.mdx:130-134`: **request-scoped notifications
(`notifications/progress`, `notifications/message`) are NOT delivered on the
listen stream — they flow only on the response stream of the request they relate
to.** Confirmed in the schema: `subscriptionId` is optional on notification
`_meta` precisely because progress notifications for an in-flight request don't
have one (`SCHEMA:127-138`).

**Architectural consequence: a maximal client cannot have one global
notification pump.** It needs (a) a per-in-flight-request SSE demultiplexer for
progress/log, and (b) a separate long-lived subscription multiplexer keyed by
subscriptionId. Two different lifetimes, two different cancellation semantics.

### 2.5 Direct relevance to the tool factory

This is the loop that makes the tool factory observable:

1. Agent's build pipeline registers a new tool on the (self-hosted) MCP server.
2. Server emits `notifications/tools/list_changed` on the client's open
   subscription (tagged with the subscriptionId).
3. Client invalidates its cached `tools/list` — `caching.mdx:120-121`: a
   relevant notification **invalidates** a still-fresh cached response
   immediately.
4. Client re-fetches `tools/list`, gets the new tool, and re-serializes the tool
   array into the model's context.

Two traps in step 4. First, the re-fetch must respect the server's deterministic
ordering (§3.3) or the prompt cache is destroyed on every tool addition —
meaning the agent pays a full context re-read every time it builds itself a
tool, which is exactly the operation the design does most. Second, if the new
tool is appended at the end of a deterministically-ordered list, only the tail
of the serialized tool block changes, and prompt-cache prefix reuse survives.
**The tool factory's server side should therefore append, never re-sort.** That
is a design constraint on our own server, derived from `tools.mdx:71-74`.

---

## 3. Cacheable list results (`ttlMs`, `cacheScope`)

Spec: `SPEC/server/utilities/caching.mdx`. Schema: `SCHEMA:1081-1119`.

### 3.1 Which operations

Servers **MUST** include caching hints on `resultType: "complete"` results from
(`caching.mdx:13-22`): `server/discover`, `tools/list`, `prompts/list`,
`resources/list`, `resources/templates/list`, `resources/read`.

Note what is _absent_: `prompts/get` is **not** cacheable, and neither is
`tools/call` or `completion/complete`. `resources/read` is the only non-list
cacheable operation.

`CacheableResult` makes both fields **required** (non-optional in TS), so an
absent `ttlMs` should only ever be seen from an older server.

### 3.2 Semantics

`ttlMs` (`caching.mdx:46-92`), analogous to `Cache-Control: max-age`:

- `0` → immediately stale. Positive → fresh for that many ms **from receipt**.
- Absent → assume `0`. Negative → ignore, treat as `0`. Servers **MUST** send
  `>= 0`.
- Freshness test is `now < t_received + ttlMs`.
- **Clients SHOULD NOT treat TTL as a polling interval.** Check freshness on
  access; re-fetch only if stale. Clients that do poll **MUST apply jitter and
  backoff**.
- Clients **MAY** re-fetch early on suspicion of change (the spec's own example:
  an unexpected method-not-found or invalid-params on a tool call), and **MAY**
  serve stale results when re-fetching fails.

`cacheScope` (`caching.mdx:93-108`):

- `"public"` — no user-specific data; any client, gateway, or proxy **MAY**
  store and serve it to any user.
- `"private"` — **caches MUST NOT be shared across authorization contexts**; a
  different access token requires a different cache.

Security note the client must internalize (`caching.mdx:171-179`): a `"public"`
result **may be shared across authorization contexts even though it came from an
authenticated endpoint**. So the client's cache key must include the
authorization context for `"private"` and deliberately exclude it for
`"public"`.

### 3.3 Cache key

`caching.mdx:28-38`: the key is the request method **plus the parameters that
affect the result** — explicitly including `cursor` for paginated lists and
`uri` for `resources/read`. Clients **MUST NOT** serve a cached response for a
request whose method or params differ. MRTR-retried results **MUST NOT** be
cached at all.

### 3.4 Pagination interaction

`caching.mdx:147-169`: each page is independently cacheable with its own `ttlMs`
and its own freshness clock; servers **MAY** vary `ttlMs` per page; an expired
page **SHOULD** be re-fetched by its cursor; **there is no cross-page
consistency guarantee** (duplicates and gaps are possible); a client needing a
consistent snapshot **SHOULD** re-fetch from the beginning without a cursor; an
invalidated cursor **SHOULD** cause the client to discard all cached pages and
restart. Servers **MUST** use the same `cacheScope` across all pages of one list
request.

### 3.5 Prompt-cache stability — the actual design payoff

`SPEC/server/tools.mdx:71-74`:

> _"Servers **SHOULD** return tools in a deterministic order (i.e., the same
> ordering across requests when the underlying set of tools has not changed).
> Deterministic ordering enables clients to reliably cache the tool list and
> improves LLM prompt cache hit rates when tools are included in model
> context."_

Also `tools.mdx:62-69`: the tool set **MUST NOT** vary per-connection or as a
side effect of other requests, but **MAY** vary by the authorization presented.
The same stability rule appears for prompts (`prompts.mdx:57-64`).

The chain this creates, which no shipping client currently exploits end to end:

**server deterministic order → client caches the exact serialized array → the
tool block is a stable prompt prefix → LLM prompt-cache hits across turns →
`list_changed` is the only invalidation event.**

The unstated client corollary: **do not re-sort, re-key, or re-serialize the
tool list between turns.** Any client-side normalization (alphabetizing,
grouping by server, re-emitting JSON with different key order) throws away the
benefit the server just handed you. For a multi-server aggregating CLI this
means the aggregation order itself must be deterministic and stable — and note
`tools.mdx:322-332` warns that `serverInfo.name` is **not guaranteed unique**
and **SHOULD NOT** be relied on for disambiguation, so the stable key must come
from the client's own server configuration, not from the server's self-report.

---

## 4. `server/discover`, `_meta` keys, and HTTP headers

### 4.1 `server/discover`

Spec: `SPEC/server/discover.mdx`. **Servers MUST implement it; clients MAY call
it** (`discover.mdx:7-9`, `62-66`).

Request carries no params beyond `_meta`. `DiscoverResult`
(`discover.mdx:88-101`) carries `supportedVersions`, `capabilities`,
`instructions` (optional natural-language guidance for LLMs),
`_meta["io.modelcontextprotocol/serverInfo"]`, and — because it is a
`CacheableResult` — `ttlMs` and `cacheScope` (the doc's example uses
`ttlMs: 3600000, cacheScope: "public"`).

Two documented reasons to call it (`discover.mdx:70-81`):

1. Present server identity/capabilities/versions in one request instead of
   probing with three list calls.
2. **stdio backward-compatibility probe** — stdio has no HTTP status code to
   drive fallback, so a client supporting both modern and legacy (`initialize`)
   servers **SHOULD** send `server/discover` first.

`serverInfo` is self-reported and unverified; clients **SHOULD NOT** change
behavior based on it and **SHOULD NOT** use it for security decisions
(`discover.mdx:103-108`).

**Gap worth knowing:** there is no per-response echo of server capabilities.
`ResultMetaObject` carries only `serverInfo`. A client that never calls
`server/discover` has no in-band way to learn which extensions or capabilities
the server supports — it must call `server/discover` or probe blind. For a
maximal client this settles the question: **always call `server/discover`, and
cache it per its own `ttlMs`.**

### 4.2 Reserved `_meta` keys

`SPEC/basic/index.mdx:346-358`. Key-name format: optional dot-separated prefix
ending in `/`, then a name. **Any prefix whose second label is
`modelcontextprotocol` or `mcp` is reserved** — so `io.modelcontextprotocol/`,
`dev.mcp/`, `com.mcp.tools/` are all reserved, but `com.example.mcp/` is not
(`basic/index.mdx:337-339`).

**Per-request fields** (`basic/index.mdx:373-382`):

| Key                                          | Type                 | Required         |
| -------------------------------------------- | -------------------- | ---------------- |
| `io.modelcontextprotocol/protocolVersion`    | `string`             | **Yes**          |
| `io.modelcontextprotocol/clientCapabilities` | `ClientCapabilities` | **Yes**          |
| `io.modelcontextprotocol/clientInfo`         | `Implementation`     | No (SHOULD send) |
| `io.modelcontextprotocol/logLevel`           | `LoggingLevel`       | No               |

A request missing a required field is malformed → `-32602`, HTTP `400`. A server
**MUST NOT** rely on undeclared capabilities; if it needs one the client didn't
declare it **MUST** return `MissingRequiredClientCapabilityError` (`-32021`)
with `data.requiredCapabilities`, HTTP `400` (`basic/index.mdx:387-392`).

`logLevel` replaces `logging/setLevel` and is **per-request**: servers **MUST
NOT** emit `notifications/message` for requests that did not include it
(`SPEC/changelog.mdx:20`). This is strictly better for a CLI — log verbosity
becomes a property of the individual call, so a debug flag can be scoped to one
tool invocation rather than a whole connection.

**Per-response:** `io.modelcontextprotocol/serverInfo`, SHOULD-level
(`basic/index.mdx:394-402`).

**Subscription:** `io.modelcontextprotocol/subscriptionId` **MUST** be present
on notifications delivered via a listen stream (`basic/index.mdx:412-414`).

**OpenTelemetry:** `traceparent`, `tracestate`, `baggage` are reserved as an
explicit exception to the prefix rule and **MUST** follow W3C Trace Context /
Baggage formats (`basic/index.mdx:419-427`). This is free distributed tracing
across the agent → MCP server boundary and should be wired from day one.

**`progressToken`** remains an unprefixed reserved key (`basic/index.mdx:352`).

### 4.3 HTTP headers

`SPEC/basic/transports/streamable-http.mdx:244-298`.

- **`MCP-Protocol-Version`** — required on every POST; **MUST** match the
  `_meta` protocol version in the body or the server **MUST** reject with `400`
  and a `HeaderMismatch` (`-32020`) error (`streamable-http.mdx:252-261`).
- **`Mcp-Method`** — the JSON-RPC `method`. Required on **all** requests.
- **`Mcp-Name`** — `params.name` or `params.uri`. Required on `tools/call`,
  `resources/read`, `prompts/get`.

Both are marked **REQUIRED for compliance** (`streamable-http.mdx:293`). Values
that can't be represented as plain ASCII **MUST** use the Base64 sentinel format
`=?base64?{Base64EncodedValue}?=` (`streamable-http.mdx:295-297`, `490-502`).

Status codes: unknown protocol version → `400` +
`UnsupportedProtocolVersionError` (`-32022`) listing supported versions; unknown
RPC method → **`404` + JSON-RPC `-32601`**, where the JSON-RPC body is what
distinguishes it from a legacy HTTP+SSE server's bare 404
(`streamable-http.mdx:263-275`).

**`x-mcp-header`** (`SPEC/server/tools.mdx:334-402`,
`streamable-http.mdx:359-408`) is a per-property JSON Schema extension in a
tool's `inputSchema` naming an `Mcp-Param-{name}` header the argument is
mirrored into. Constraints: non-empty; RFC 9110 §5.1 field-name token syntax; no
CR/LF/control chars; case-insensitively unique within the schema; **only
`integer`, `string`, `boolean` — `number` is not permitted**; integers within
IEEE-754 safe range; only on properties statically reachable from the schema
root.

The client obligation here is unusually sharp (`tools.mdx:362-368`): a
Streamable HTTP client **MUST reject** tool definitions violating these
constraints, and _"rejection means the client **MUST exclude the invalid tool
from the result of `tools/list`**"_ — it **SHOULD** log a warning naming the
tool and reason, and one bad tool **MUST NOT** poison the rest of the list.
stdio clients **MAY** ignore `x-mcp-header` entirely. **This is a client-side
validation pass over every tool definition that essentially nothing implements
today.**

---

## 5. Extensions framework

Spec: `docs/extensions/overview.mdx`, `SPEC/basic/versioning.mdx:119-123`.

### 5.1 Negotiation

Identical on both sides (`SCHEMA:775-785` and `SCHEMA:872-882`):

```ts
extensions?: { [key: string]: JSONObject };
```

Keys are extension identifiers following the `_meta` key rules **with a
mandatory prefix**, reverse-DNS by convention (`io.modelcontextprotocol/tasks`).
An empty object means "supported, no settings". **The settings object is
untyped** — SEP-2133 explicitly declines to define a schema-advertisement
mechanism (`seps/2133-extensions.md:227`).

The negotiation is **asymmetric**:

- **Client → server:** per-request, inside
  `_meta["io.modelcontextprotocol/clientCapabilities"].extensions`, on _every_
  request. `SCHEMA:92-98`: _"Servers MUST NOT infer capabilities from prior
  requests."_
- **Server → client:** only via the `server/discover` result's
  `capabilities.extensions` (`docs/extensions/overview.mdx:150-179`).

Graceful degradation (`docs/extensions/overview.mdx:181-185`, normatively
`seps/2133-extensions.md:190`): the supporting party **MUST** either revert to
core behavior or reject with an error if the extension is mandatory.

Extensions may add `resultType` values, but only ones advertised via
capabilities count (`basic/index.mdx:83-84`).

> **Stale-doc warning.** `SPEC/index.mdx:77-80` still says extensions are
> negotiated "during initialization," and SEP-2133's entire negotiation section
> (`seps/2133-extensions.md:113-186`) is written against the removed
> `initialize` handshake with `protocolVersion: "2025-06-18"`. **Implement from
> `docs/extensions/overview.mdx`, not from the SEP.**

### 5.2 Tasks extension (`io.modelcontextprotocol/tasks`, SEP-2663)

Tasks are **not in `SCHEMA`** — moved out of core into an extension
(`SPEC/changelog.mdx:22`). Normative text: `seps/2663-tasks-extension.md`
(Status: Final); full spec lives at `github.com/modelcontextprotocol/ext-tasks`
**[not in this checkout]**.

**Methods:** `tasks/get` (poll), `tasks/update` (client→server input),
`tasks/cancel`, plus `notifications/tasks`. `tasks/result` and `tasks/list` are
**removed** — a client calling `tasks/result` **MUST** get `-32601`
(`seps/2663:949`). Only `tools/call` is task-augmentable (`seps/2663:113-117`).

**Shape** (`seps/2663:136-176`):
`Task = { taskId, status, statusMessage?, createdAt, lastUpdatedAt, ttlMs: number|null, pollIntervalMs? }`.
Status enum: `working | input_required | completed | cancelled | failed`. Note
`completed` **includes tool calls that returned `isError: true`**; `failed` is
reserved for JSON-RPC errors during execution.

**Discriminator:** `CreateTaskResult` carries `resultType: "task"`. **But
`tasks/get`, `tasks/update`, and `tasks/cancel` responses carry
`resultType: "complete"`** (`seps/2663:340`) — only the initial handoff uses
`"task"`. (Two examples in the SEP's error-handling section contradict this; the
normative text wins.)

**Unsolicited task handles** (`seps/2663:85-89`) — the design-relevant part:
there is **no per-request opt-in**. Declaring the extension capability _is_ the
entire handshake, and the server unilaterally decides, per request, whether to
return a `CallToolResult` or a `CreateTaskResult`. _"A client that has
negotiated this extension MUST be prepared to handle either ... in response to
any supported request it issues."_ Conversely a server **MUST NOT** return
`CreateTaskResult` to a client that did not declare the capability on that
request.

**Polling** (`seps/2663:310-312`): clients **SHOULD** respect `pollIntervalMs`
(servers **MAY** rate-limit faster pollers); **SHOULD** poll to a terminal
status; **SHOULD persist task IDs to durable storage so polling resumes after a
crash**. `ttlMs` is a backstop after which the server **MAY** mark the task
failed and delete it. `pollIntervalMs` has **no specified default** — an
unspecified gap.

**Tasks vs MRTR — they are distinct mechanisms** (`seps/2663:592`). A task in
`input_required` status surfaces `inputRequests` via `tasks/get` and is
fulfilled via `tasks/update` — **not** by retrying `tools/call`. A server
needing input _before_ creating the task uses MRTR on the original request; one
needing input _during_ execution uses the task mechanism. They maintain separate
state despite sharing field names, and **clients do not need to deduplicate keys
across the two flows**. Servers **SHOULD** resolve all MRTR exchanges
synchronously _before_ returning `CreateTaskResult` (`seps/2663:304`).

Two operational MUSTs: on Streamable HTTP, `tasks/get|update|cancel` **MUST**
set `Mcp-Name` to the `taskId` (`seps/2663:515`) for load-balancer stickiness;
and `notifications/progress` and `notifications/message` **MUST NOT** be sent
for a task (`seps/2663:511`) — **there are no progress bars for tasks**, only
`statusMessage` observed via polling.

Useful escape hatch for an SDK (`seps/2663:130`): a library may drive the
polling loop internally and surface only the final result, keeping `callTool`'s
public contract a blocking call that returns `CallToolResult`.

### 5.3 MCP Apps (`io.modelcontextprotocol/ui`, SEP-1865)

Normative spec is at `github.com/modelcontextprotocol/ext-apps` **[not in this
checkout]** — the `ui/*` method set, `ui/initialize`, `externalIframes`,
permission/CSP schemas, and threat model are all out of tree.

What this checkout establishes: URI scheme `ui://` (`seps/1865:70`); MIME type
`text/html;profile=mcp-app`; a tool binds to its UI via `_meta.ui.resourceUri`
on the **tool definition** (`docs/extensions/apps/overview.mdx:53-55`), with
`_meta.ui.csp` and `_meta.ui.permissions` also named. The host fetches the
`ui://` resource (and **may preload it before the tool is called**), renders it
in a sandboxed deny-by-default-CSP iframe, and bridges to it over **postMessage
carrying a JSON-RPC dialect of MCP** — some methods shared with core
(`tools/call`), most new under a `ui/` prefix (`overview.mdx:71-75`). The app
can request tool calls, open links, and push structured data into the model's
context; the host controls which of those capabilities it gets.

**For a CLI/TUI host, the honest answer is: not much, and the spec has no story
for you.** The only unambiguous option is to **not declare the capability**, in
which case the server must fall back to core behavior. The strongest supporting
statement is advisory, not normative (`docs/extensions/overview.mdx:185`): _"a
server offering UI-enhanced tools should still return meaningful text content
for clients that don't support the UI extension."_ Nothing forbids a server from
returning `content: []` and putting the entire payload in the app. Further: only
one MIME profile is defined, so a TUI cannot declare "I support UI, but
text-only"; the two client-side libraries offered (`@mcp-ui/client` React
components, and the SDK App Bridge) both assume a DOM; and `overview.mdx:64`'s
hedge — _"**Web hosts typically** render the HTML inside a sandboxed iframe"_ —
is the only acknowledgment non-web hosts exist and it leads nowhere.

**Recommendation:** do not declare `io.modelcontextprotocol/ui`. Optionally read
`_meta.ui.resourceUri` on tool definitions purely as a signal to tell the user
"this tool is designed for a graphical host," which costs nothing and is honest.
**[inference, not spec-backed]**

### 5.4 Auth extensions

- **OAuth Client Credentials**
  (`io.modelcontextprotocol/oauth-client-credentials`, draft): adds RFC 6749
  §4.4 client-credentials, either JWT bearer assertions (RFC 7523, recommended)
  or client secrets. Explicitly _not_ for interactive use: _"If your integration
  has a human user who should explicitly authorize access, use the standard MCP
  authorization flow instead"_
  (`docs/extensions/auth/oauth-client-credentials.mdx:31`). **Relevant to our
  CLI only in unattended CI mode.** No refresh token — re-run the grant before
  expiry.
- **Enterprise-Managed Authorization** (stable): the client obtains an ID-JAG
  from the enterprise IdP and exchanges it for an access token, and explicitly
  _"**Do not** redirect the user to the MCP Authorization Server's authorization
  endpoint"_ (`enterprise-managed-authorization.mdx:115`). Requires persisting
  an SSO Identity Assertion and org-level IdP configuration. **Not needed for a
  general-purpose developer CLI.**

Selection guidance (`docs/extensions/auth/overview.mdx:52-59`): _"Standard
interactive user authorization → Core MCP spec (no extension needed)."_

### 5.5 The jagged edge, quantified

`docs/extensions/client-matrix.mdx` — read directly, and it is stark:

- 11 clients listed. **11/11 support MCP Apps. OAuth Client Credentials has zero
  checkmarks across all 11.** Enterprise Auth has exactly one (Archestra.AI).
- **There is no Tasks row or column at all** — the extension-overview table
  lists only three extensions and omits `io.modelcontextprotocol/tasks`, even
  though `docs/extensions/tasks/overview.mdx:264-274` points readers _at this
  matrix_ for task client support. The flagship extension has zero published
  adoption data.
- **Every listed client is a chat UI, an IDE chat panel, or a testing tool.**
  Claude Code, Codex, Gemini CLI, Cline, Zed, Continue, and Windsurf —
  essentially every terminal-native coding agent — are absent.
- It is community-maintained and unenforced; step 4 of "adding extension
  support" is literally "submit a pull request to update this matrix."
  SEP-2133:104: extension support _"is not required for 100% protocol
  conformance."_

So for a headless CLI the matrix says: nobody like you is on this list, and the
one extension everyone implements is the one you structurally cannot render.

---

## 6. The neglected primitives

Detailed derivation in the primitives research; the design-relevant extract:

### 6.1 Prompts

`prompts/list` is paginated **and** cacheable; the prompt set **MUST NOT** vary
per-connection but **MAY** vary by authorization (`prompts.mdx:57-64`).
`prompts/get` is **not** cacheable and **does** support MRTR (`prompts.mdx:165`)
— a prompt can trigger an elicitation before it resolves.

`PromptArgument extends BaseMetadata`, so **arguments carry a `title`** — a CLI
should label fields with `title ?? name`. Arguments are **string-only**
(`{[key: string]: string}`); there is no JSON Schema for them, which is
precisely why `completion/complete` exists.

`PromptMessage.content` is a **single** `ContentBlock` (not an array, unlike
`CallToolResult.content`), and `role` is `"user" | "assistant"` only — **there
is no system role**, so a client mapping prompts into a conversation must decide
where server instructions go.

The spec's own UX picture (`prompts.mdx:21-37`, with
`SPEC/server/slash-command.png` embedded) is: prompts are **user-controlled**
and "typically triggered through user-initiated commands... **for example, as
slash commands**," though the protocol mandates no interaction model. For a CLI
that is a direct mapping: `prompts/list` → slash-command registry;
`PromptArgument` → interactive arg prompts; `completion/complete` → tab
completion.

### 6.2 Resources

`resources/read` is the only non-list cacheable op, typically
`cacheScope: "private"`, and **also supports MRTR** (`resources.mdx:177`).
`contents` is an **array** — clients that take `contents[0]` are lossy.

`Resource.size` is documented as raw bytes before base64/tokenization, _"can be
used by Hosts to display file sizes and estimate context window usage"_
(`SCHEMA:1470-1476`). This is the field that should stop a CLI from inlining a
40 MB resource. Universally ignored.

`Annotations = { audience?: Role[], priority?: number (0..1), lastModified? }`
appear on resources, templates, **and all content blocks**. The spec states
directly what to do with them (`resources.mdx:360-364`): filter by audience,
prioritize context inclusion, sort by recency. `audience: ["user"]` content
belongs on the **terminal**, not in the model's context — that distinction is
free UX a CLI is uniquely positioned to honor.

Discriminate text vs binary on **which field is present** (`text` vs `blob`) —
`ResourceContents` has no `type` tag, unlike `ContentBlock`.

`ResourceLink` (a URI, contents not included) vs `EmbeddedResource` (inline
contents). Critically, _"resource links returned by tools are **not guaranteed
to appear** in the results of a `resources/list` request"_ (`tools.mdx:468-471`)
— so the client must be willing to `resources/read` a URI it never saw in a
listing.

Resource-not-found is now **`-32602`** with `data.uri`; clients **SHOULD** still
accept legacy `-32002`; servers **MUST NOT** return an empty `contents` array
for a nonexistent resource (`resources.mdx:402-426`).

Templates are RFC 6570, and their variables are completable via
`completion/complete` with `ref/resource` whose `uri` is **the template
itself**, not an expanded URI. A real client must implement RFC 6570 expansion
including `{+path}` and `{?query}` operators, not just `{var}`.

### 6.3 `completion/complete`

`{ ref: PromptReference | ResourceTemplateReference, argument: {name, value}, context?: { arguments?: {[k:string]: string} } }`
→ `{ completion: { values: string[] /* max 100 */, total?, hasMore? } }`.

**`context.arguments` is the most-skipped feature in MCP.** The spec's worked
example (`completion.mdx:96-131`): completing `framework` = `"fla"` with
`context.arguments = {language: "python"}` narrows to `["flask"]`. Clients that
fire per-field completions without threading previously-entered values get
garbage from any server implementing dependent completion — and server authors
then stop bothering. This is a two-sided market failure a maximal client can fix
unilaterally.

There is **no cursor** — completion is not paginated. `hasMore: true` means
"narrow your query," not "fetch page 2." Client obligations
(`completion.mdx:202-206`): debounce, cache locally (the result is _not_ a
`CacheableResult`), handle partial results gracefully. Gated by the
`completions` server capability; expect `-32601` if absent.

### 6.4 Tools

`Tool = { name, title?, icons?, description?, inputSchema, outputSchema?, annotations?, _meta? }`.
Display-name precedence for tools is uniquely three-level: `title` →
`annotations.title` → `name`.

Schemas are now full **JSON Schema 2020-12** (SEP-2106): any keyword may appear
alongside `type` at the root of `inputSchema` (which must still be
`type: "object"`), and `outputSchema` is unconstrained. Two new client MUSTs
(`basic/index.mdx:300-319`): implementations **MUST NOT** automatically
dereference `$ref` values resolving to a **network URI**; an opt-in fetch mode
**MUST** be off by default and **SHOULD** enforce a host allowlist, reject
loopback/link-local/private addresses, apply timeouts and size limits, and log
what it fetched. Schemas failing on an unresolved external `$ref` **SHOULD be
rejected**, not treated as permissive. Composition keywords **SHOULD** be
bounded (depth, subschema count, or time budget) against validator DoS.

**`ToolAnnotations` defaults are counter-intuitive and safety-critical**
(`SCHEMA:1912-1971`): `readOnlyHint` defaults **false**, but `destructiveHint`
defaults **true** and `openWorldHint` defaults **true**. **An unannotated tool
is assumed destructive and open-world.** A client building an auto-approve tier
must treat _absence_ of annotations as the unsafe case. And annotations are
hints from a possibly-untrusted server: `tools.mdx:304-307` — clients **MUST**
consider them untrusted unless the server is trusted.

**`isError` and SEP-1303.** Tool-originated errors — including **input
validation errors** (wrong date format, value out of range) — belong in the
result with `isError: true`, _not_ as a JSON-RPC error, so the model can see and
self-correct. Only unknown-tool / malformed-request / server failures are
protocol errors. Client obligation (`tools.mdx:784-785`): clients **SHOULD
provide tool execution errors to language models to enable self-correction.** A
client that swallows `isError: true` into a red banner and never shows the model
the text defeats the entire design.

Tool names (SEP-986, `tools.mdx:309-332`): 1–128 chars (the SEP says 64 — trust
the spec text), case-sensitive, `[A-Za-z0-9_.-]` only, unique **within a
server**; aggregating clients **SHOULD** prefix by server id, and
**`serverInfo.name` is not guaranteed unique and SHOULD NOT be used for
disambiguation**.

**Stateful tools** (`tools.mdx:683-736`, new non-normative section): with
sessions gone, cross-call state rides **server-minted handles** passed as
ordinary tool arguments. Guidance: authorize against the handle on every call;
treat it as a bearer token (high entropy, bounded lifetime); keep it opaque;
**document the retention policy in the creating tool's `description` so the
model can see it**; and return an expired/unknown handle as a **tool execution
error**, not a protocol error, so the model can recover. This is directly the
pattern a tool factory needs for build-session handles.

### 6.5 Elicitation

Two modes. **Form mode** (`mode: "form"`, or omitted): `requestedSchema` is a
restricted subset — **only top-level properties, no nesting**, values limited to
`StringSchema | NumberSchema | BooleanSchema | EnumSchema` (four enum variants
including titled and multi-select). All primitives support `default`, and
clients supporting defaults **SHOULD** pre-populate. **URL mode**
(`mode: "url"`) carries a `url` and no schema.

Hard safety split (`elicitation.mdx:26-38`): servers **MUST NOT** use form mode
for passwords, API keys, access tokens, or payment credentials, and **MUST** use
URL mode for those.

Capabilities are per-request: `{"elicitation": {"form": {}, "url": {}}}`; `{}`
means form-only for back-compat; a client declaring `elicitation` **MUST**
support at least one mode; servers **MUST NOT** send modes the client didn't
declare.

`ElicitResult = { action: "accept"|"decline"|"cancel", content? }`. `content`
values are `string | number | boolean | string[]` — the array arm exists solely
for multi-select enums. In URL mode `content` is **omitted** on accept.
`ElicitResult` has **no `resultType`** — it is a value nested in
`inputResponses`.

**Removed in this revision:** `notifications/elicitation/complete` and
`elicitationId` (`changelog.mdx:53-60`). Under MRTR the client learns the
outcome by retrying, so a server-initiated completion signal no longer fits.
**Servers correlate elicitations across retries by encoding their own identifier
in `requestState`.**

The URL-mode flow under MRTR (`elicitation.mdx:376-383`) contains a subtlety
worth highlighting: `action: "accept"` means _the user consented to the
interaction_, **not that the interaction completed**. The out-of-band flow
happens outside the client's view. When the client retries, the server may
block, return the final result, or return **another** `InputRequiredResult`.
Therefore clients **SHOULD provide manual retry/cancel controls** — a CLI needs
a visible "waiting for you to finish in the browser… [r]etry / [c]ancel"
affordance, not a spinner that hangs.

Client URL MUSTs (`elicitation.mdx:612-623`): **MUST NOT** pre-fetch the URL or
its metadata; **MUST NOT** open without explicit consent; **MUST** show the full
URL; **MUST** open in a surface the client and LLM cannot inspect; **SHOULD**
highlight the domain and warn on Punycode; **SHOULD NOT** render URLs clickable
anywhere except a URL-mode request's `url` field.

### 6.6 Progress and cancellation

`progressToken` in `params._meta` opts a request in. Tokens **MUST** be unique
across all active requests; `progress` **MUST** increase monotonically even when
`total` is unknown; notifications **MUST** stop after completion.

**Progress and log notifications ride the originating request's own SSE response
stream** (`streamable-http.mdx:130-134`) — never the listen stream. And a POSTed
request may return `application/json` **or** `text/event-stream`, and the client
**MUST** support both (`streamable-http.mdx:88-91`). A client that only handles
JSON bodies silently discards every progress notification it was sent.

Cancellation is **transport-dependent, and this is new**
(`cancellation.mdx:35-44`):

- **Streamable HTTP:** closing the SSE response stream **is** the cancellation
  signal. The server **MUST** treat client disconnect as cancellation. **No
  `notifications/cancelled` is required or expected.** Indeed the core protocol
  defines **no client-to-server notifications over Streamable HTTP at all**
  (`streamable-http.mdx:93-103`).
- **stdio:** no per-request stream, so the client **MUST** send
  `notifications/cancelled` with the request id.

**Server→client `notifications/cancelled` is now legal but tightly scoped**
(`cancellation.mdx:11-14`): a server **MUST** send it referencing a
`subscriptions/listen` request id when tearing that subscription down, and
**MUST NOT** send it for any other purpose. So inbound `cancelled` routes to
subscription bookkeeping, not to the request table.

Timeouts (`cancellation.mdx:46-64`): implementations **SHOULD** set per-request
timeouts, **MAY** reset the clock on progress, but **SHOULD always enforce a
maximum regardless**.

### 6.7 Pagination

Opaque cursors; page size is server-determined and clients **MUST NOT** assume a
fixed size. Paginated ops: `resources/list`, `resources/templates/list`,
`prompts/list`, `tools/list`.

The most-violated rule in the document (`pagination.mdx:102-107`): clients
**MUST NOT** make any determination from a cursor's value other than whether a
non-null value was provided — _"e.g. an empty string is a valid cursor and thus
MUST NOT be treated as the end of results."_ **`if (!nextCursor) break;` is
wrong.** Test for key presence. Invalid cursor → `-32602`.

---

## 7. Authorization

Applies to HTTP transports only. stdio implementations **SHOULD NOT** follow
this spec and instead take credentials from the environment
(`SPEC/basic/index.mdx:221-226`).

### 7.1 CIMD vs DCR

**Client ID Metadata Documents** are SHOULD-level for both parties
(`authorization/client-registration.mdx:22-24`). The mechanism: **the
`client_id` IS an HTTPS URL** pointing at a JSON document the client hosts.
Client MUSTs (`client-registration.mdx:36-42`): host over HTTPS at a URL **with
a path component**; include at least `client_id`, `client_name`,
`redirect_uris`; and **ensure `client_id` in the document matches the document
URL exactly**. The AS fetches it (after authenticating the user, as an SSRF
mitigation), validates the match, and validates presented redirect URIs against
the document.

Support is advertised by `client_id_metadata_document_supported: true` in AS
metadata; clients **SHOULD** check it and **MAY** fall back
(`client-registration.mdx:114-126`).

**Why it replaces DCR** (`seps/991`): DCR requires servers to maintain unbounded
client databases and trust self-asserted metadata; CIMD gives stable, auditable
identifiers and **cryptographically binds redirect URIs to the client identity
via HTTPS**. Decisive for us: **CIMD client IDs are portable across
authorization servers — no re-registration when the AS changes**
(`client-registration.mdx:199-202`).

**Registration priority order** (`client-registration.mdx:13-18`):
pre-registered → CIMD (if advertised) → DCR (if `registration_endpoint`) →
**prompt the user to enter client information**. That last step is a real UI
requirement, not a fallback to failure.

**DCR is Deprecated** (`SPEC/deprecated.mdx:29`), earliest removal _"first
revision released on or after 2027-07-28"_ — so a client shipping now still
needs it as fallback. Two DCR-specific MUSTs:

- **`application_type`** (SEP-837): clients **MUST** specify it; omitting it
  defaults to `"web"` under OIDC and breaks native redirect URIs. **CLI tools
  are explicitly enumerated as native** (`client-registration.mdx:165-167`).
  Clients **MUST** be prepared to handle registration failures from redirect-URI
  constraints.
- **Credential binding** (SEP-2352, `client-registration.mdx:183-191`): clients
  **MUST** key persisted credentials by the AS's `issuer` identifier, **MUST
  NOT** reuse credentials across authorization servers, and **MUST** re-register
  when the AS changes (detected via refreshed protected resource metadata).
  Tokens too: `authorization-server-discovery.mdx:31` requires separate
  registration state _and tokens_ per AS. **The credential store key is
  `(issuer, …)`, not `(server_url, …)`.**

### 7.2 RFC 9207 `iss` validation

`SPEC/basic/authorization/index.mdx:190-213`. Before redirecting, the client
**MUST record the validated `issuer`** alongside the PKCE verifier and `state`.
On the response, before transmitting the code to any token endpoint, the client
**MUST** apply this table:

| `authorization_response_iss_parameter_supported` | `iss` present | Action                                                                |
| ------------------------------------------------ | ------------- | --------------------------------------------------------------------- |
| `true`                                           | yes           | Compare to recorded issuer (RFC 3986 §6.2.1 simple string comparison) |
| `true`                                           | no            | **Reject the response**                                               |
| `false`/absent                                   | yes           | Compare to recorded issuer                                            |
| `false`/absent                                   | no            | Proceed                                                               |

And `index.mdx:211`: after form-decoding, clients **MUST NOT** apply scheme/host
case folding, default-port elision, trailing-slash, or percent-encoding
normalization before comparison — **byte-for-byte, no URL normalization
library**. On mismatch the client **MUST NOT** act on or display
`error`/`error_description`/ `error_uri`.

Practical trap flagged by SEP-2468: the loopback callback handler **must extract
`iss` from the query string alongside `code` and `state`**, or this check can't
run at all.

### 7.3 The discovery chain a CLI must walk

1. Unauthenticated request → parse `WWW-Authenticate` on 401. Clients **MUST**
   be able to (`authorization-server-discovery.mdx:49`).
2. Locate protected resource metadata (RFC 9728). Clients **MUST** support both
   mechanisms: the `resource_metadata` parameter in the header when present,
   otherwise fall back to well-known URIs **in order** — path-suffixed
   (`/.well-known/oauth-protected-resource/{path}`) then root.
3. Select an AS from `authorization_servers` (RFC 9728 §7.6), maintaining
   **separate credentials and tokens per AS**.
4. AS metadata discovery. Clients **MUST** attempt multiple well-known
   endpoints: issuer with a path →
   `/.well-known/oauth-authorization-server/{path}`, then
   `/.well-known/openid-configuration/{path}`, then
   `{path}/.well-known/openid-configuration`; issuer without a path → the first
   two forms only.
5. **Validate the metadata's `issuer` equals the issuer used to build the URL**;
   if they differ the client **MUST NOT** use the metadata.
6. **Verify PKCE support before proceeding.** Clients **MUST** implement PKCE
   with `S256` when capable, and **MUST refuse to proceed** if
   `code_challenge_methods_supported` is absent — _including on the OIDC path_,
   where that field is not part of standard OIDC metadata
   (`security-considerations.mdx:50-61`). Expect real providers to fail this.
7. Obtain a `client_id` via the priority order in §7.1.
8. Record the issuer, generate PKCE, build the authorization request.
9. **RFC 8707 `resource` indicator**: clients **MUST** include it in **both**
   authorization and token requests, identifying the MCP server by canonical URI
   — and **MUST send it regardless of whether the AS supports it**
   (`index.mdx:215-252`).
10. Open the browser — with MUSTs that specifically target CLIs
    (`docs/docs/2026-07-28/tutorials/security/security_best_practices.mdx:714-728`):
    only `http://` (loopback, dev) and `https://`; **MUST reject `javascript:`,
    `data:`, `file:`, `vbscript:`**; and **MUST NOT use shell commands to open
    URLs** — use a platform-specific non-shell mechanism.
11. Callback → validate `iss` and `state` → token request with `code_verifier`
    and `resource`.

Redirect URIs **MUST** be loopback or HTTPS
(`security-considerations.mdx:42-43`), **MUST** be registered, and the AS
**MUST** match them exactly. **Negative finding worth knowing: RFC 8252 is never
cited anywhere in the 2026-07-28 spec, and custom URI schemes (`myapp://`) are
never mentioned.** Use loopback HTTP.

### 7.4 Tokens

`Authorization: Bearer` header on **every** HTTP request; **MUST NOT** appear in
a query string. Clients **MUST NOT** send a token to any server other than one
issued by that server's AS. Servers **MUST NOT** pass through a received token
to upstream APIs. Refresh tokens: clients **MUST** keep them confidential,
**SHOULD** include `refresh_token` in `grant_types`, **MAY** add
`offline_access` only when AS metadata advertises it, and **MUST NOT** assume
one will be issued.

Note an obligation the spec implies but never states: authorization servers
**MUST** rotate refresh tokens for public clients
(`security-considerations.mdx:34`), and a CLI is a public client — so **the
client must persist the new refresh token atomically on every refresh** or it
will invalidate its own grant. Nothing tells you this; it just breaks.

On 403 `insufficient_scope`, clients **SHOULD** run a step-up flow: parse the
challenge, compute the **union** of previously requested and newly challenged
scopes, re-authorize, retry a bounded number of times, and track scope-upgrade
attempts per (resource, operation) to avoid elevation loops.

### 7.5 Sharp edges

1. **CIMD requires hosted HTTPS infrastructure** — a pure-local CLI cannot do
   CIMD without publishing a static JSON file somewhere (acknowledged in
   `seps/991`).
2. **Fixed-port loopback problem.** Exact redirect-URI matching + a static
   `redirect_uris` array in the CIMD document + **no RFC 8252 §7.3 port-variance
   exception anywhere in the spec** = you must pin ports (the spec's own example
   pins `:3000`) or enumerate a small range, and handle the port being occupied.
3. **CIMD does not authenticate your CLI.** Anyone can claim your `client_id`
   and bind a localhost port; all countermeasures are AS-side. `private_key_jwt`
   is the only client-side lever and it needs a backend.
4. **MUST-level client requirements live outside the spec directory** — the
   URL-scheme, no-shell-execution, and SSRF requirements appear only in
   `docs/docs/2026-07-28/tutorials/security/security_best_practices.mdx`, a
   "tutorial" path that nonetheless carries RFC 2119 MUSTs.

---

## 8. Deprecations — what a clean-break client should never implement

`SPEC/deprecated.mdx`. Deprecated features remain functional for a minimum
twelve-month window; new implementations **SHOULD NOT** adopt them.

| Feature                                                                | Deprecated in | Migration                                                               | Earliest removal              |
| ---------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------- | ----------------------------- |
| **Roots**                                                              | `2026-07-28`  | Pass directories/files via tool params, resource URIs, or server config | on/after 2027-07-28           |
| **Sampling**                                                           | `2026-07-28`  | Integrate directly with LLM provider APIs                               | on/after 2027-07-28           |
| **Logging** (`notifications/message` + the removed `logging/setLevel`) | `2026-07-28`  | `stderr` for stdio; **OpenTelemetry** for observability                 | on/after 2027-07-28           |
| **Dynamic Client Registration**                                        | `2026-07-28`  | CIMD                                                                    | on/after 2027-07-28           |
| `includeContext: "thisServer"` / `"allServers"`                        | `2025-11-25`  | Omit or use `"none"`                                                    | follows Sampling              |
| **HTTP+SSE transport**                                                 | `2025-03-26`  | Streamable HTTP                                                         | 3 months after SEP-2596 Final |

**Never implement (already removed from the wire in 2026-07-28):** `initialize`
/ `notifications/initialized`, `Mcp-Session-Id`, `ping`, `logging/setLevel`,
`notifications/roots/list_changed`, `resources/subscribe` /
`resources/unsubscribe`, the HTTP GET endpoint, `Last-Event-ID` / SSE
resumption, `tasks/result` / `tasks/list`, `notifications/elicitation/complete`,
`elicitationId`, and **server-initiated JSON-RPC requests of any kind**.

**Implement, deliberately, despite deprecation:** the MRTR _handling_ of
`CreateMessageRequest` and `ListRootsRequest` as `inputRequests` values. These
are one map entry each in the MRTR resolver, they are the only in-protocol route
for a server to reach the client's model or working directories, and they cost
nothing to keep. What you must not build is the removed server-initiated RPC
machinery.

**Deliberate non-goal:** DCR. Recommendation is to implement CIMD +
pre-registered credentials + the user-entry prompt (steps 1, 2, 4 of the
registration priority order) and skip step 3. This trades interoperability with
authorization servers that lack CIMD for not building a deprecated code path —
an acceptable trade for a client whose whole point is being a clean 2026-07-28
implementation, and one that should be revisited if a target server actually
requires DCR.

**Logging is a genuine judgment call.** `notifications/message` is deprecated
with OpenTelemetry named as the migration, and the OTel `_meta` keys
(`traceparent`, `tracestate`, `baggage`) are first-class in this revision. A CLI
that wires OTel trace-context propagation and ignores `notifications/message` is
following the spec's own stated direction. But
`io.modelcontextprotocol/logLevel` is a _non-deprecated_ per-request `_meta`
key, and servers **MUST NOT** emit `notifications/message` unless the request
carried it — so the cost of accepting log notifications is one optional key and
one notification handler on the per-request stream you already need for
progress. Suggest: accept and display them, do not build a logging _control
plane_ around them.

---

## 9. The full flex checklist

Every protocol feature a maximal 2026-07-28 client exercises, with what
exercising it means for a coding agent. Grouped by whether it is required for
conformance, required for "maximal," or an extension.

### Core — mandatory for any conformant client

| #   | Feature                                                                                                                         | What exercising it means here                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `_meta` protocol version + client capabilities on **every** request                                                             | Capabilities become a per-call decision: grant `sampling` to our own tool-factory server, withhold it from a third-party server, same turn |
| 2   | `io.modelcontextprotocol/clientInfo` on every request                                                                           | Identify the agent by name/version so servers can log and rate-limit us honestly                                                           |
| 3   | `resultType` dispatch, treating absent as `"complete"` and unrecognized as **invalid**                                          | The single decode branch every response passes through                                                                                     |
| 4   | `MCP-Protocol-Version` header matching the body                                                                                 | Or `400` + `HeaderMismatch` (`-32020`)                                                                                                     |
| 5   | `Mcp-Method` on all requests; `Mcp-Name` on `tools/call`/`resources/read`/`prompts/get`, Base64-sentinel-encoded when non-ASCII | Lets a gateway route tool calls without parsing bodies                                                                                     |
| 6   | Accept **both** `application/json` and `text/event-stream` on any POST response                                                 | Otherwise every progress notification is silently dropped                                                                                  |
| 7   | `UnsupportedProtocolVersionError` (`-32022`) and `MissingRequiredClientCapabilityError` (`-32021`) handling                     | `-32021`'s `data.requiredCapabilities` tells the agent exactly which capability to enable and retry with                                   |
| 8   | New error-code policy; `-32602` for resource-not-found with legacy `-32002` accepted                                            | Don't assume meaning for `-32000..-32019`                                                                                                  |
| 9   | `tools/list` + `tools/call`                                                                                                     | The floor. Everything below is what nobody else does                                                                                       |
| 10  | Opaque cursor pagination with key-presence testing                                                                              | `""` is a valid cursor; `if (!cursor) break` is a bug                                                                                      |
| 11  | Per-request timeouts, optionally reset by progress, always capped                                                               |                                                                                                                                            |
| 12  | Cancellation: **close the stream** on HTTP; `notifications/cancelled` on stdio only                                             | And route _inbound_ `cancelled` to subscription teardown, never to the request table                                                       |

### Core — the "maximal client" surface almost nobody implements

| #   | Feature                                                                                             | What exercising it means here                                                                              |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 13  | `server/discover` at connect, cached per its own `ttlMs`                                            | The only in-band way to learn server capabilities and extensions; also the stdio legacy-probe              |
| 14  | **MRTR on `tools/call`**                                                                            | A tool can ask the agent a question mid-call and get an answer without a session                           |
| 15  | **MRTR on `prompts/get`**                                                                           | A slash command can elicit missing arguments from the user before rendering                                |
| 16  | **MRTR on `resources/read`**                                                                        | Reading a resource can require consent or credentials first                                                |
| 17  | MRTR `inputRequests` → `elicitation/create` (form)                                                  | Terminal form rendering from a restricted flat schema, with `default` pre-population                       |
| 18  | MRTR `inputRequests` → `elicitation/create` (url)                                                   | Open browser with consent; show full URL; provide **manual retry/cancel** because `accept` ≠ complete      |
| 19  | MRTR `inputRequests` → `sampling/createMessage`                                                     | **The sampling replacement**: route the server's question to our own model, return the completion on retry |
| 20  | MRTR `inputRequests` → `roots/list`                                                                 | Answer with the workspace roots the agent is operating on                                                  |
| 21  | `requestState` echo, opaque, with a client-side size ceiling                                        | Never inspect it; never log it; never reuse it on a parallel request                                       |
| 22  | Bounded MRTR round loop with a new JSON-RPC id per retry                                            | Servers may loop `input_required` indefinitely; boundedness is our problem                                 |
| 23  | **`subscriptions/listen`** with an explicit filter                                                  | Without this the agent is deaf: no `list_changed`, ever                                                    |
| 24  | Ack diffing (requested vs acknowledged)                                                             | Degrade gracefully when the server honors only a subset                                                    |
| 25  | `subscriptionId` demultiplexing across concurrent subscriptions                                     | Required on stdio; good hygiene on HTTP                                                                    |
| 26  | Graceful-close vs abrupt-drop discrimination; reconnect + re-`listen` on stdio                      | Empty `complete` response = clean end, don't reconnect                                                     |
| 27  | SSE keep-alive comment tolerance                                                                    | Ignore `:`-prefixed lines                                                                                  |
| 28  | `toolsListChanged` → cache invalidation → refetch                                                   | **The tool factory's feedback loop**                                                                       |
| 29  | `resourceSubscriptions` on specific URIs                                                            | Watch a config or generated artifact the agent is iterating on                                             |
| 30  | `ttlMs` / `cacheScope` honored, keyed by method + params (+ cursor, + auth context for `"private"`) | Stop re-fetching `tools/list` every turn                                                                   |
| 31  | Never cache MRTR-retried results or `input_required` interims                                       |                                                                                                            |
| 32  | Per-page TTL, per-page cursor refetch, restart-from-scratch on cursor invalidation                  |                                                                                                            |
| 33  | Preserve server-provided tool ordering into the model prompt                                        | The prompt-cache payoff; do not re-sort                                                                    |
| 34  | `prompts/list` → slash-command registry                                                             | The spec's own UX picture, finally implemented                                                             |
| 35  | `prompts/get` → conversation seed, with the no-system-role decision made explicitly                 |                                                                                                            |
| 36  | `PromptArgument.title` used as the field label                                                      | `title ?? name`, not `name`                                                                                |
| 37  | `resources/list` + `resources/templates/list` → `@`-mention picker                                  |                                                                                                            |
| 38  | **RFC 6570 expansion** including `{+path}` and `{?query}`                                           | Not just `{var}`                                                                                           |
| 39  | `resources/read` handling the **full `contents` array**                                             | Not `contents[0]`                                                                                          |
| 40  | `Resource.size` as a context-budget gate                                                            | Refuse to inline the 40 MB file                                                                            |
| 41  | `annotations.audience` routing                                                                      | `["user"]` → terminal; `["assistant"]` → model context                                                     |
| 42  | `annotations.priority` as the context-eviction key                                                  | Drop `priority: 0.1` first when the budget is tight                                                        |
| 43  | `annotations.lastModified` for display/sort                                                         |                                                                                                            |
| 44  | `text` vs `blob` discrimination by field presence                                                   | Not by `mimeType`                                                                                          |
| 45  | `ResourceLink` followed on demand, even for URIs absent from `resources/list`                       | Tools return links to resources that were never listed                                                     |
| 46  | `EmbeddedResource` inlined without a second round trip                                              |                                                                                                            |
| 47  | **`completion/complete` with `context.arguments` threading**                                        | Tab-completion that actually narrows; the single highest-leverage neglected feature                        |
| 48  | Completion debouncing, local caching, `hasMore` affordance                                          | `hasMore` means "type more," not "page 2"                                                                  |
| 49  | Full JSON Schema 2020-12 validation of tool inputs                                                  | Composition and conditional keywords now legal                                                             |
| 50  | **`$ref` network-dereference prohibition**, off by default, allowlisted if ever on                  | A security MUST nobody implements                                                                          |
| 51  | Composition-keyword bounds (depth / subschema count / time budget)                                  | Validator-DoS defense                                                                                      |
| 52  | `outputSchema` validation of `structuredContent`                                                    | Catch a misbehaving tool before the model sees garbage                                                     |
| 53  | **`x-mcp-header` validation with invalid tools excluded from `tools/list`**                         | A hard client MUST, with a logged warning, without poisoning the rest                                      |
| 54  | `ToolAnnotations` with correct unsafe defaults, treated as untrusted                                | Absent annotations ⇒ destructive + open-world                                                              |
| 55  | **`isError: true` text fed back to the model**                                                      | SEP-1303: input validation errors are tool errors, and the model must see them to self-correct             |
| 56  | Tool name validation + client-side prefixing for multi-server aggregation                           | Never disambiguate on `serverInfo.name`                                                                    |
| 57  | Server-minted stateful-tool handles as ordinary arguments                                           | The tool factory's build-session pattern                                                                   |
| 58  | `progressToken` with unique tokens and per-request stream demultiplexing                            | Live build/test progress from the tool factory pipeline                                                    |
| 59  | `io.modelcontextprotocol/logLevel` per request                                                      | Scope debug verbosity to one tool call                                                                     |
| 60  | `traceparent` / `tracestate` / `baggage` propagation                                                | End-to-end tracing across the agent/server boundary, free                                                  |
| 61  | Icons with the security rules (HTTPS/`data:` only, no credentials, magic-byte validation)           | Mostly no-ops in a terminal, but the URI rejection rules still apply if we ever render                     |

### Auth (HTTP servers)

| #   | Feature                                                                         | Notes                                          |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| 62  | `WWW-Authenticate` parsing on 401                                               |                                                |
| 63  | PRM discovery: header param **and** both well-known fallbacks, in order         |                                                |
| 64  | AS metadata discovery: all 3 (or 2) well-known forms in priority order          |                                                |
| 65  | Metadata `issuer` === constructed issuer, else reject                           |                                                |
| 66  | PKCE `S256`, **refusing to proceed** without `code_challenge_methods_supported` | Including on the OIDC path                     |
| 67  | CIMD hosting + `client_id` === document URL                                     | Requires hosted HTTPS infrastructure           |
| 68  | Pre-registered credential support + user-entry prompt fallback                  |                                                |
| 69  | Credentials and tokens keyed by **issuer**, re-registered on AS change          |                                                |
| 70  | **RFC 9207 `iss` validation** with byte-exact comparison, no normalization      | Extract `iss` in the loopback callback handler |
| 71  | RFC 8707 `resource` on authorization **and** token requests, always             |                                                |
| 72  | Loopback redirect URI, pinned port(s), no custom scheme                         |                                                |
| 73  | Authorization URL scheme allowlist; **no shell execution to open it**           | Targets CLIs specifically                      |
| 74  | Bearer header on every request; never in a query string; never cross-server     |                                                |
| 75  | Refresh-token rotation persisted atomically                                     | Implied, never stated                          |
| 76  | 403 step-up with scope union and bounded retries                                |                                                |
| 77  | SSRF defenses on every OAuth URL fetched                                        | Especially if ever run server-side             |

### Extensions

| #   | Feature                                                                                       | Notes                                                                                                   |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 78  | `extensions` declared per-request; server's read from `server/discover`                       |                                                                                                         |
| 79  | Graceful degradation when the peer lacks an extension                                         |                                                                                                         |
| 80  | **Tasks**: handle an unsolicited `resultType: "task"` on any `tools/call`                     | Declaring the capability _is_ consenting to receive one                                                 |
| 81  | Tasks: `tasks/get` polling honoring `pollIntervalMs`, `ttlMs` as backstop                     |                                                                                                         |
| 82  | Tasks: `taskId` persisted to durable storage, resumable after crash                           | The right answer for a long build in the tool factory                                                   |
| 83  | Tasks: `input_required` → `tasks/update` with `inputResponses` (**not** a `tools/call` retry) | Distinct from MRTR; dedupe keys across consecutive polls                                                |
| 84  | Tasks: `tasks/cancel` (never `notifications/cancelled`), cooperative, eventually consistent   |                                                                                                         |
| 85  | Tasks: `Mcp-Name: {taskId}` on `tasks/*` over HTTP                                            | Load-balancer stickiness MUST                                                                           |
| 86  | Tasks: `subscriptions/listen` with `taskIds` as a polling alternative                         | And accept that progress notifications are forbidden for tasks                                          |
| 87  | **MCP Apps: deliberately not declared**                                                       | No headless story exists; optionally surface `_meta.ui.resourceUri` as a "graphical host required" hint |
| 88  | OAuth Client Credentials: CI/unattended mode only                                             |                                                                                                         |
| 89  | Enterprise-Managed Auth: out of scope for a general developer CLI                             |                                                                                                         |

**Score to beat.** Items 13–61 are the differentiator: they are core protocol,
they are mandatory-or-strongly-recommended, and per the client matrix and the
general state of the ecosystem essentially no shipping client implements more
than a handful. Items 1–12 plus 9 are what "supports MCP" means today.

---

## 10. Bonus: `mcp-effect-sdk` coverage

Audited the SDK at the repo root (not `references/`). Spot-verified the key
claims directly.

**Headline: this is already a 2026-07-28-native SDK, not a 2025-11-25 SDK
awaiting migration.** It targets `2026-07-28` exclusively (`src/McpModern.ts:12`
`MODERN_PROTOCOL_VERSION = "2026-07-28"`); all codecs are generated under
`src/generated/mcp/2026-07-28/`; no earlier revision string appears anywhere in
`src/`. `typescript-sdk/` is a gitignored upstream clone, not SDK surface.

**Implemented and wired end-to-end** (verified by reading call sites):

- **MRTR** — a real bounded loop, not just types: `src/McpClient.ts:1610`
  `sendWithMrtr`, with `maxRounds` (`:1637`), `requestState` echo (`:1641`,
  `:1669`), accumulated `inputResponses` (`:1662-1668`), and handlers for
  `sampling/createMessage` (`:1503`) and `roots/list` (`:1543`). Both automatic
  and manual input-required policies are exported.
- **`subscriptions/listen`** — `src/McpClient.ts:641`/`:1748`, filter opt-ins in
  `src/Subscription.ts:12-14`, client-side enforcement that the server only
  sends opted-in types (`:268-283`), `subscriptionId` correlation and validation
  (`src/internal/SubscriptionValidation.ts`), and graceful-vs-abrupt closure
  discrimination.
- **`server/discover`** — run at client construction, with version negotiation
  against `supportedVersions` (`src/McpClient.ts:1705-1709`).
- **All five stateless `_meta` keys** — `src/McpModern.ts:17-25`, injected on
  every outbound request (`src/McpClient.ts:144-147`).
- **`ttlMs`/`cacheScope`** — a real client cache in `src/McpCache.ts` keyed by
  method + params + `cacheScope` + protocol version + capabilities +
  authorization partition, with TTL honoring and epoch invalidation.
- **`Mcp-Method`/`Mcp-Name`/`MCP-Protocol-Version`/`x-mcp-header`** — emitted by
  `src/transport/HttpMetadata.ts`.
- **Extension capability plumbing** — `extensions` is carried separately from
  core capabilities so an extension cannot corrupt the core declaration
  (`src/McpClient.ts:499-500`, `:817-818`), with namespace validation.
- **Auth** — CIMD (`src/auth/client/registration.ts`), `iss` validation
  (`src/auth/client/transaction.ts:424-434`), DCR fallback, with a documented
  resolution order.
- **Legacy correctly absent** — `SERVER_REQUEST_METHODS = [] as const`; no
  `initialize`, `ping`, or `Mcp-Session-Id` (the only occurrence is a comment
  saying there isn't one); `Last-Event-ID` is explicitly `headers.delete(...)`.

**Gaps against the checklist above:**

1. **Tasks extension — schema only.** `src/experimental/tasks.ts` declares
   `tasks/get` (`:150`), `tasks/update` (`:182`), `tasks/cancel` (`:196`) as
   Effect Schemas over a pinned extension revision, and `docs/extensions.md`
   says plainly it _"does not implement task execution, storage, polling,
   subscriptions, or transport dispatch."_ No client method calls any of them.
   **Checklist items 80–86 are unmet.** This is the largest gap and the one most
   relevant to a tool factory doing long builds. The negotiation plumbing and
   schema overlay exist; only the runtime is missing.
2. **MCP Apps — absent entirely** (zero hits in `src/`). Per §5.3 this is
   arguably correct for a CLI, and `docs/feature-coverage.md:161` records it as
   an explicit Tier-1 exclusion. Item 87 is "deliberately not declared," so this
   is a non-gap — but it should be a _documented_ decision, not an omission.
3. **SSE resumption** — an explicit non-goal, and correct: the feature was
   removed from the spec.
4. Worth confirming during agent development, since I verified by reading source
   rather than running the conformance suite: items 50–53 (the `$ref`
   network-dereference prohibition, composition-keyword bounds, `outputSchema`
   validation of `structuredContent`, and `x-mcp-header` validation _with
   invalid tools excluded from `tools/list`_). The `x-mcp-header` machinery is
   present in `HttpMetadata.ts`; whether the exclusion-from-`tools/list` MUST is
   enforced is the specific thing to check.

**Net:** the SDK gets us items 1–49 and 62–79 largely for free. The agent-side
work is the _client behavior_ the SDK cannot supply — annotation-driven context
budgeting (41–43), completion context threading (47), `isError` routing to the
model (55), prompt-cache-stable tool serialization (33), and the slash-command /
`@`-mention UX (34–38) — plus the Tasks runtime if we want it.

---

## Appendix: known spec defects and ambiguities

| Location                                                           | Issue                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC/index.mdx:77-80`                                             | Says extensions are negotiated "during initialization" — no `initialize` exists in 2026-07-28. Stale.                                             |
| `seps/2133-extensions.md:113-186`                                  | Entire negotiation section written against `initialize` / `protocolVersion: "2025-06-18"`. Implement from `docs/extensions/overview.mdx` instead. |
| `seps/2663-tasks-extension.md:844`, `:868` vs `:340`               | Error-handling examples show `resultType: "task"` on `tasks/get` responses; normative text says it MUST be `"complete"`.                          |
| `seps/2663:175`                                                    | `pollIntervalMs` optional with no specified default and no guidance for its absence.                                                              |
| `seps/986:28` vs `tools.mdx:311`                                   | Tool name length: SEP says 64 chars, spec text says 128. Trust the spec text.                                                                     |
| `mrtr.mdx` (throughout)                                            | No bound specified on `requestState` size or `inputRequests` cardinality. Client-side DoS surface.                                                |
| `docs/extensions/apps/overview.mdx:64`                             | _"Web hosts typically render..."_ is the only acknowledgment non-web hosts exist; no fallback mechanism is defined.                               |
| `docs/extensions/overview.mdx:185`                                 | The "servers should still return meaningful text content" fallback is advisory prose, not a normative requirement.                                |
| `docs/extensions/client-matrix.mdx`                                | No Tasks row or column, despite `docs/extensions/tasks/overview.mdx:273` directing readers here for exactly that.                                 |
| (absent)                                                           | No per-response echo of server capabilities — a client that skips `server/discover` cannot learn them in band.                                    |
| `security-considerations.mdx:34`                                   | Refresh-token rotation is a MUST on the AS; the corresponding client obligation to persist the new token atomically is never stated.              |
| `security_best_practices.mdx`                                      | Carries RFC 2119 MUSTs for clients but lives under a `tutorials/` path outside the spec directory.                                                |
| `security-considerations.mdx:43` + `client-registration.mdx:62-63` | Exact redirect-URI matching with no RFC 8252 §7.3 loopback-port-variance exception forces pinned ports.                                           |
| `ext-apps`, `ext-tasks`, `ext-auth`                                | The normative text for all three extensions lives in separate repositories not present in this checkout.                                          |
