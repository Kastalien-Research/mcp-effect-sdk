import type { PortDiagnostic } from "./shared.js"

/** Snapshot that was compared, so future upstream churn is detectable. */
export const upstreamSnapshot = {
  repository: "modelcontextprotocol/typescript-sdk",
  commit: "f4137630c05dc9a4fb14d4d3777f5cb167bd6313",
  describe: "@modelcontextprotocol/client@2.0.0-beta.4-3-gf4137630",
  protocol: "2026-07-28"
} as const

/**
 * One entry for every top-level directory in the cloned upstream `examples/`
 * tree. "Problems" are parity findings, not promises that a partial port is
 * production-ready.
 */
export const portDiagnostics = [
  {
    story: "bearer-auth",
    upstream: "typescript-sdk/examples/bearer-auth",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/hosting.ts",
    demonstrates: ["HTTP bearer gate", "401 with WWW-Authenticate", "authenticated tool call"],
    problems: ["No token-verifier middleware abstraction", "AuthInfo is not exposed to the tool handler"]
  },
  {
    story: "bearer-auth-web",
    upstream: "typescript-sdk/examples/bearer-auth-web",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/hosting.ts",
    demonstrates: ["Web-standard bearer gate", "fetch handler composition"],
    problems: ["Bearer verification must be hand-written outside the MCP handler"]
  },
  {
    story: "caching",
    upstream: "typescript-sdk/examples/caching",
    status: "blocked",
    demonstrates: ["cache hints", "client response cache", "refresh mode"],
    problems: [
      "Server list/read cache hints are fixed to conservative defaults",
      "No per-registration or per-operation cache hint options",
      "McpClient has no cache store or cacheMode argument"
    ]
  },
  {
    story: "cli-client",
    upstream: "typescript-sdk/examples/cli-client",
    status: "partial",
    local: "src/examples/everything-client.ts",
    demonstrates: ["reference host", "tool loop", "resources", "prompts", "OAuth"],
    problems: ["No LLM-provider host application has been ported", "Modern MRTR auto-fulfilment is missing"]
  },
  {
    story: "client-quickstart",
    upstream: "typescript-sdk/examples/client-quickstart",
    status: "already-covered",
    local: "src/examples/core-protocol-catalog.ts",
    demonstrates: ["minimal client", "stdio", "tool listing and calling"],
    problems: []
  },
  {
    story: "custom-methods",
    upstream: "typescript-sdk/examples/custom-methods",
    status: "blocked",
    demonstrates: ["vendor request methods", "vendor notifications"],
    problems: ["Client and server are closed over the generated protocol RPC groups", "No public arbitrary-method registration API"]
  },
  {
    story: "custom-version",
    upstream: "typescript-sdk/examples/custom-version",
    status: "excluded-legacy",
    demonstrates: ["legacy protocol version negotiation"],
    problems: ["The story is intentionally 2025-era only"]
  },
  {
    story: "dual-era",
    upstream: "typescript-sdk/examples/dual-era",
    status: "already-covered",
    local: "src/examples/typescript-sdk-ports/primitives.ts",
    demonstrates: ["one server factory used by modern and legacy clients"],
    problems: ["Only the modern tool behavior is in scope; dual-era routing is intentionally omitted"]
  },
  {
    story: "elicitation",
    upstream: "typescript-sdk/examples/elicitation",
    status: "blocked",
    demonstrates: ["modern form and URL MRTR", "multi-step input", "requestState"],
    problems: [
      "registerTool cannot return InputRequiredResult",
      "McpClient does not auto-fulfil inputRequests and retry",
      "No requestState mint/verify seam"
    ]
  },
  {
    story: "extension-capabilities",
    upstream: "typescript-sdk/examples/extension-capabilities",
    status: "ported",
    local: "src/examples/typescript-sdk-ports/hosting.ts",
    demonstrates: ["namespaced capabilities.extensions advertisement"],
    problems: []
  },
  {
    story: "gateway",
    upstream: "typescript-sdk/examples/gateway",
    status: "blocked",
    demonstrates: ["discovery result reuse", "zero-round-trip worker connect"],
    problems: ["McpClient.make always performs discovery", "No connect prior/discovery snapshot option"]
  },
  {
    story: "guides",
    upstream: "typescript-sdk/examples/guides",
    status: "partial",
    local: "src/examples/core-protocol-catalog.ts",
    demonstrates: ["documentation snippets across the complete SDK surface"],
    problems: ["Framework, middleware, custom transport, custom method, MRTR, caching, and legacy snippets do not all have local equivalents"]
  },
  {
    story: "hono",
    upstream: "typescript-sdk/examples/hono",
    status: "ported",
    local: "src/examples/typescript-sdk-ports/hosting.ts",
    demonstrates: ["mounting a web-standard MCP fetch handler"],
    problems: [
      "The port stays framework-neutral because Hono is not a project dependency",
      "The header-enforcing modern transport path loses registered capabilities during discovery"
    ]
  },
  {
    story: "json-response",
    upstream: "typescript-sdk/examples/json-response",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/hosting.ts",
    demonstrates: ["single JSON response mode"],
    problems: ["enableJsonResponse exists in the option type but is not read by the transport implementation"]
  },
  {
    story: "legacy-routing",
    upstream: "typescript-sdk/examples/legacy-routing",
    status: "excluded-legacy",
    demonstrates: ["modern and sessionful legacy endpoints on one port"],
    problems: ["Legacy routing is intentionally outside the stateless-only scope"]
  },
  {
    story: "mrtr",
    upstream: "typescript-sdk/examples/mrtr",
    status: "blocked",
    demonstrates: ["write-once MRTR", "signed requestState", "form and URL input"],
    problems: ["InputRequiredResult cannot cross the registerTool result type/runtime", "No requestState codec hooks"]
  },
  {
    story: "oauth",
    upstream: "typescript-sdk/examples/oauth",
    status: "partial",
    local: "src/examples/core-protocol-catalog.ts",
    demonstrates: ["authorization_code client", "protected resource", "demo authorization server"],
    problems: ["OAuth client flow exists", "No authorization-server or protected-resource middleware toolkit"]
  },
  {
    story: "oauth-client-credentials",
    upstream: "typescript-sdk/examples/oauth-client-credentials",
    status: "partial",
    local: "src/auth/providers.ts",
    demonstrates: ["client_credentials", "client secret", "private_key_jwt"],
    problems: ["Client providers exist", "The paired authorization server must be built outside the SDK"]
  },
  {
    story: "parallel-calls",
    upstream: "typescript-sdk/examples/parallel-calls",
    status: "ported",
    local: "src/examples/typescript-sdk-ports/interactions.ts",
    demonstrates: ["concurrent calls", "ordered result collection"],
    problems: []
  },
  {
    story: "prompts",
    upstream: "typescript-sdk/examples/prompts",
    status: "ported",
    local: "src/examples/typescript-sdk-ports/primitives.ts",
    demonstrates: ["prompt registration", "argument completion", "prompt retrieval"],
    problems: ["registerPrompt's completion generic expects schema objects; the Layer helper has the correct value type"]
  },
  {
    story: "repl",
    upstream: "typescript-sdk/examples/repl",
    status: "partial",
    local: "src/examples/everything-client.ts",
    demonstrates: ["interactive protocol playground"],
    problems: ["No interactive readline shell was copied", "Several REPL commands target unsupported legacy or MRTR surfaces"]
  },
  {
    story: "resources",
    upstream: "typescript-sdk/examples/resources",
    status: "ported",
    local: "src/examples/typescript-sdk-ports/primitives.ts",
    demonstrates: ["static resources", "templates", "mutable resource", "subscriptions/listen"],
    problems: []
  },
  {
    story: "sampling",
    upstream: "typescript-sdk/examples/sampling",
    status: "blocked",
    demonstrates: ["sampling request carried through modern inputRequired"],
    problems: ["McpServer.sample intentionally fails", "Modern InputRequiredResult return and client fulfilment are missing"]
  },
  {
    story: "schema-validators",
    upstream: "typescript-sdk/examples/schema-validators",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/primitives.ts",
    demonstrates: ["multiple Standard Schema libraries", "outputSchema"],
    problems: ["Registration accepts Effect Schema fields only", "No direct outputSchema option", "ArkType, Valibot, and Zod are not accepted"]
  },
  {
    story: "scoped-tools",
    upstream: "typescript-sdk/examples/scoped-tools",
    status: "blocked",
    demonstrates: ["per-tool OAuth scopes", "authenticated request context"],
    problems: ["AuthInfo does not reach registerTool handlers", "No per-tool scope declaration/enforcement hook"]
  },
  {
    story: "server-quickstart",
    upstream: "typescript-sdk/examples/server-quickstart",
    status: "already-covered",
    local: "src/examples/core-protocol-catalog.ts",
    demonstrates: ["minimal tool server"],
    problems: []
  },
  {
    story: "shared",
    upstream: "typescript-sdk/examples/shared",
    status: "support-code",
    demonstrates: ["upstream argv, assertion, OAuth, and event-store scaffolding"],
    problems: ["Not an independently runnable example story"]
  },
  {
    story: "sse-polling",
    upstream: "typescript-sdk/examples/sse-polling",
    status: "excluded-legacy",
    demonstrates: ["sessionful SSE polling and resumption"],
    problems: ["The story is legacy-only"]
  },
  {
    story: "standalone-get",
    upstream: "typescript-sdk/examples/standalone-get",
    status: "excluded-legacy",
    demonstrates: ["standalone GET stream"],
    problems: ["The stateless draft rejects non-POST MCP endpoint requests"]
  },
  {
    story: "stateless-legacy",
    upstream: "typescript-sdk/examples/stateless-legacy",
    status: "already-covered",
    local: "src/examples/typescript-sdk-ports/primitives.ts",
    demonstrates: ["one minimal endpoint exercised in modern and legacy modes"],
    problems: ["Only its modern greet behavior is in scope"]
  },
  {
    story: "stickynotes",
    upstream: "typescript-sdk/examples/stickynotes",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/interactions.ts",
    demonstrates: ["mutable tools", "per-note resources", "listChanged"],
    problems: ["No dynamic resource unregister/list support", "The MRTR-confirmed remove_all path is blocked"]
  },
  {
    story: "streaming",
    upstream: "typescript-sdk/examples/streaming",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/interactions.ts",
    demonstrates: ["progress", "logging", "cancellation"],
    problems: ["callTool has no AbortSignal option or exposed request id, so a client cannot target cancellation ergonomically"]
  },
  {
    story: "subscriptions",
    upstream: "typescript-sdk/examples/subscriptions",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/interactions.ts",
    demonstrates: ["subscriptions/listen", "tools listChanged"],
    problems: ["No public dynamic tool unregister API or cross-instance ServerEventBus equivalent"]
  },
  {
    story: "todos-server",
    upstream: "typescript-sdk/examples/todos-server",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/interactions.ts",
    demonstrates: ["reference server with CRUD, progress, sampling, MRTR, and subscriptions"],
    problems: ["CRUD/progress primitives map", "Sampling, MRTR, and dynamic resource parity remain blocked"]
  },
  {
    story: "tools",
    upstream: "typescript-sdk/examples/tools",
    status: "partial",
    local: "src/examples/typescript-sdk-ports/primitives.ts",
    demonstrates: ["typed inputs", "structured output", "tool metadata"],
    problems: ["No direct outputSchema, title, icons, or ergonomic annotation-object options"]
  }
] as const satisfies ReadonlyArray<PortDiagnostic>

export const modernParitySummary = portDiagnostics.reduce(
  (summary, entry) => ({
    ...summary,
    [entry.status]: (summary[entry.status] ?? 0) + 1
  }),
  {} as Partial<Record<PortDiagnostic["status"], number>>
)
