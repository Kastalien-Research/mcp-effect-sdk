# Official TypeScript SDK example parity

This report compares this repository's `src/examples/` with the cloned official
SDK at `typescript-sdk/examples/`.

- Upstream commit: `f4137630c05dc9a4fb14d4d3777f5cb167bd6313`
- Upstream describe: `@modelcontextprotocol/client@2.0.0-beta.4-3-gf4137630`
- Local target: MCP `2026-07-28`, stateless only
- Scope decision: port the modern arm of dual-era stories; do not add the 2025
  initialization/session/GET-SSE protocol back to this SDK.

The executable catalog is in
`src/examples/typescript-sdk-ports/diagnostics.ts`. It intentionally records
partial and blocked ports instead of hiding missing SDK seams behind example
workarounds.

## Upstream story comparison

| Upstream story | Modern disposition | Local evidence or diagnostic |
| --- | --- | --- |
| `bearer-auth` | Partial | `hosting.ts` composes a bearer gate around the fetch handler; verifier middleware and authenticated tool context are missing. |
| `bearer-auth-web` | Partial | Same Web-standard port; verification remains application code. |
| `caching` | Blocked | Cacheable results exist in the schema, but server hints are not configurable and the client has no cache store or `cacheMode`. |
| `cli-client` | Partial | `everything-client.ts` proves the protocol client/OAuth surface; the reference LLM host and MRTR driver are absent. |
| `client-quickstart` | Already covered | Minimal clients exist in `core-protocol-catalog.ts`. |
| `custom-methods` | Blocked | The generated RPC groups are closed; no arbitrary vendor method/notification registration API exists. |
| `custom-version` | Excluded | The upstream story is legacy-only. |
| `dual-era` | Modern arm covered | Its modern tool behavior maps to `primitives.ts`; dual-era routing is intentionally omitted. |
| `elicitation` | Blocked | Modern `inputRequired`, client fulfil/retry, and `requestState` hooks are incomplete. |
| `extension-capabilities` | Ported | `hosting.ts` advertises a namespaced extension through discovery. |
| `gateway` | Blocked | `McpClient.make` always discovers; it cannot accept a trusted prior discovery snapshot. |
| `hono` | Ported at the boundary | `hosting.ts` exports a Web-standard handler that Hono can mount; Hono is not added as a dependency. |
| `json-response` | Partial | A handler is present, but `enableJsonResponse` is currently a dead option and does not force JSON mode. |
| `legacy-routing` | Excluded | The story's purpose is mixed modern/sessionful routing. |
| `mrtr` | Blocked | `InputRequiredResult` cannot be returned through `registerTool`; request-state signing hooks are absent. |
| `oauth` | Partial | OAuth client logic exists; demo authorization-server/protected-resource middleware does not. |
| `oauth-client-credentials` | Partial | Client secret and private-key providers exist; the paired authorization server is outside the SDK. |
| `parallel-calls` | Ported | `interactions.ts` performs concurrent calls with Effect concurrency. |
| `prompts` | Ported | `primitives.ts` registers, completes, lists, and gets the prompt. |
| `repl` | Partial | The underlying client exists; no interactive shell is copied and several commands need blocked surfaces. |
| `resources` | Ported | Static, templated, mutable, completion, and modern listen behavior are represented in `primitives.ts`. |
| `sampling` | Blocked | The old server-request helper intentionally fails, while modern MRTR sampling cannot yet be returned/fulfilled. |
| `schema-validators` | Partial | Effect Schema works; Standard Schema libraries and direct `outputSchema` do not. |
| `scoped-tools` | Blocked | Tool handlers cannot read authenticated scopes and no per-tool scope hook exists. |
| `server-quickstart` | Already covered | Minimal servers exist in `core-protocol-catalog.ts`. |
| `shared` | Support code | Upstream argv/assert/OAuth/event-store scaffolding is not a story. |
| `sse-polling` | Excluded | Legacy-only sessionful SSE polling. |
| `standalone-get` | Excluded | Legacy-only GET stream; the stateless endpoint is POST-only. |
| `stateless-legacy` | Modern arm covered | Its modern greeting is an ordinary tool example. |
| `stickynotes` | Partial | `interactions.ts` ports mutable notes and list-change events; dynamic resource removal and MRTR-confirmed clear are missing. |
| `streaming` | Partial | Progress and logging are ported; the client cannot cancel a specific call through an `AbortSignal`/public request id. |
| `subscriptions` | Partial | `subscriptions/listen` and list-change publication exist; dynamic tool removal and a cross-request event bus do not. |
| `todos-server` | Partial | CRUD/progress primitives map; the reference story's MRTR, sampling, and dynamic-resource portions remain blocked. |
| `tools` | Partial | Typed inputs and structured content work; direct output schema, title, icons, and annotation-object ergonomics are missing. |

## Upstream guide-snippet comparison

The upstream `guides/` directory is documentation support rather than runnable
story pairs. Its modern snippets divide as follows:

| Guide family | Local state |
| --- | --- |
| Get started, basic connect/call, tools, prompts, resources, completion, stdio, raw HTTP, Web-standard serving | Represented by `core-protocol-catalog.ts` and the ports. |
| Wire schemas and protocol version constants | Represented by generated `McpSchema`/`McpProtocol` modules. |
| OAuth and machine authentication | Client side represented; serving middleware and auth context are partial. |
| Logging, progress, cancellation, notifications, subscriptions | Logging/progress/listen represented; targeted cancellation and dynamic registries are partial. |
| Input-required, elicitation, sampling | Blocked at the tool-result and client fulfil/retry boundary. |
| Caching and gateway prior-connect | Blocked at the high-level client API. |
| Custom methods and low-level extension routing | Blocked by closed generated RPC groups. |
| Express, Fastify, Hono adapters | A Web-standard handler exists; framework-specific convenience packages do not. |
| Sessions, scaling session state, legacy clients | Intentionally excluded by the stateless-only scope. |
| Testing and troubleshooting | This repo uses its own build, readiness, E2E, and conformance scripts rather than upstream's example runner. |

## Local examples that upstream does not have

| Local example | Difference |
| --- | --- |
| `everything-server.ts` / `everything-client.ts` | Package-specific self-hosted draft E2E and conformance scenarios, including this SDK's OAuth-provider surface. |
| `core-protocol-catalog.ts` | One compile-checked catalog instead of one runnable story per directory. |
| `agent-facing-proof-servers.ts` | Agent affordance-selection and recovery eval servers; these are product/evaluation examples rather than protocol tutorials. |
| `task-heavy/` | Historical task-runtime examples. They are excluded from TypeScript compilation because core tasks left the 2026-07-28 protocol and are intended to become an opt-in extension. |

## Diagnostic problems found while porting

1. `McpServer.registerPrompt` types completion callbacks as arrays of schema
   objects, while `McpServer.prompt` correctly types arrays of decoded values.
   The prompt port therefore has to use the Layer helper.
2. `StreamableHttpServerTransportOptions.enableJsonResponse` is declared but
   never read, so the advertised JSON-response mode cannot be selected.
3. The generated schema contains `InputRequiredResult`, but the high-level tool
   registration result type and resolver reject it. Modern MRTR examples stop
   at that boundary.
4. `McpServer.sample`, `elicit`, and `listRoots` correctly reject the removed
   server-initiated-request model, but no modern high-level replacement closes
   the loop.
5. Setting `modern: true` on the HTTP server transport intercepts
   `server/discover` before the registered `McpServer` and advertises only
   extensions. Tools, resources, and prompts consequently appear unsupported.
   The runnable ports follow the same non-intercepted core stateless path as
   the existing Everything example; full draft HTTP-header enforcement remains
   blocked until discovery uses the live registry.
6. Cache metadata is present in generated result types, but policy cannot be
   authored at server registrations and is not consumed by `McpClient`.
7. The local package currently depends on `effect@4.0.0-beta.36`; ports follow
   the live repository API rather than assuming Effect 3.
8. `pnpm run check:ts-sdk-parity` still requires 2025-era client methods
   (`ping`, `logging/setLevel`, resource subscribe/unsubscribe) and
   server-initiated sampling/elicitation. It therefore fails the explicitly
   stateless-only scope and needs a separate modernization pass.

## Running the ports

The ports are ordinary exported registration layers and client scenarios. They
are transport-neutral unless a story specifically demonstrates HTTP hosting.

```bash
pnpm run build
node dist/examples/typescript-sdk-ports/smoke.js
```

The build is the first parity gate: every exported port must typecheck against
the public local SDK. Runtime client/server pairs should be added to the
self-verifying example runner once the blocked high-level seams are resolved.
