// Hosts an MCP server in-process and exposes it to a language model as tools.
//
// The eval fixtures in examples/agent-facing-proof-servers.ts already model the
// affordance situations GR-AGENT-001/002/003 ask about — discovery, ambiguity,
// recovery, resource-before-action, prompt-vs-tool — and each carries an
// embedded brief resource stating its own task. Nothing drove them until now.
//
// Everything here goes through the dispatcher, i.e. real JSON-RPC messages, not
// the server's internals. That is deliberate: the eval only means something if
// the model sees exactly what a real MCP client would see, and a failure here is
// then a real SDK defect rather than a harness artifact.
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const PROTOCOL_VERSION = "2026-07-28"
const CLIENT_INFO = { name: "mcp-effect-sdk-agent-eval", version: "1" }

const distUrl = (relativePath) => new URL(`file://${path.join(repositoryRoot, relativePath)}`).href

/** The proof-server layers are Layers; McpServer.make wants an Effect. */
const handlersFromLayer = (layer) => Effect.scoped(Effect.asVoid(Layer.build(layer)))

let requestCounter = 0

const envelope = (method, params) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id: ++requestCounter,
  method,
  params: {
    ...params,
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
      "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION
    }
  }
})

/**
 * Boot one proof server and return a JSON-RPC `request` function over it.
 *
 * `timeoutMs` bounds a single dispatch so a hung handler fails the scenario
 * instead of the whole run.
 */
export async function hostProofServer(serverName, { timeoutMs = 5000 } = {}) {
  const [McpServer, proofServers] = await Promise.all([
    import(distUrl("dist/server.js")),
    import(distUrl("dist/examples/agent-facing-proof-servers.js"))
  ])
  const layer = proofServers[serverName]
  if (layer === undefined) {
    throw new Error(`Unknown proof server ${serverName}. Available: ${Object.keys(proofServers).join(", ")}`)
  }

  const server = await Effect.runPromise(
    McpServer.make({
      serverInfo: { name: serverName, version: "1" },
      handlers: handlersFromLayer(layer)
    })
  )

  const request = (method, params) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const terminal = yield* Deferred.make()
          const dispatcher = yield* McpServer.makeDispatcher({
            // Notifications are not part of a request/response turn; only the
            // terminal frame resolves the call.
            send: (frame) =>
              frame._tag === "Notification" ? Effect.void : Effect.asVoid(Deferred.succeed(terminal, frame)),
            transport: "stdio"
          }).pipe(Effect.provideService(McpServer.McpServer, server))
          yield* dispatcher.accept(envelope(method, params))
          return yield* Deferred.await(terminal).pipe(Effect.timeout(`${timeoutMs} millis`))
        })
      )
    )

  return { serverName, server, request }
}

/**
 * The affordance surface exactly as a client discovers it: names, descriptions,
 * and schemas, with no privileged knowledge of the implementation.
 */
export async function describeAffordances(host) {
  const [tools, resources, prompts] = await Promise.all([
    host.request("tools/list", {}),
    host.request("resources/list", {}),
    host.request("prompts/list", {})
  ])
  return {
    tools: tools.result?.tools ?? [],
    resources: resources.result?.resources ?? [],
    prompts: prompts.result?.prompts ?? []
  }
}

export async function readResource(host, uri) {
  const response = await host.request("resources/read", { uri })
  const contents = response.result?.contents ?? []
  return contents.map((entry) => entry.text ?? "").join("\n")
}

// The brief resources double as the fixtures' answer keys: they name the
// affordance that counts as correct, the arguments a retry must use, and so on.
// The harness reads those fields to score a trial, but the model must never see
// them — offering the answer key alongside the question would make every
// scenario measure reading comprehension instead of affordance salience.
const ANSWER_KEY_FIELDS = new Set([
  "expectedAffordance",
  "goodAffordance",
  "ambiguousAffordance",
  "distractors",
  "expectedRetry",
  "requiredToolArgument",
  "expectedToolArguments",
  "recorderTool",
  "traceResource"
])

/** Resource content as the model may see it, with answer keys withheld. */
export function withholdAnswerKeys(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return text
  const visible = Object.fromEntries(Object.entries(parsed).filter(([key]) => !ANSWER_KEY_FIELDS.has(key)))
  return JSON.stringify(visible, null, 2)
}

/**
 * The brief each fixture carries. Task text lives with the fixture rather than
 * in this harness, so adding a scenario upstream does not mean editing an eval.
 */
export async function readBrief(host, affordances) {
  const brief = affordances.resources.find((resource) => /brief|goal|case|policy/.test(resource.uri))
  if (brief === undefined) return undefined
  return { uri: brief.uri, name: brief.name, text: await readResource(host, brief.uri) }
}

/**
 * Records which affordances were offered, selected, ignored, retried, and
 * failed — the five paths GR-AGENT-003 requires. The proof servers already
 * define exactly this vocabulary (`TraceEventKind`), so the harness and the
 * fixtures speak the same language.
 */
export function createAffordanceRecorder(affordances) {
  const offered = [
    ...affordances.tools.map((tool) => ({ kind: "tool", name: tool.name })),
    ...affordances.resources.map((resource) => ({ kind: "resource", name: resource.uri })),
    ...affordances.prompts.map((prompt) => ({ kind: "prompt", name: prompt.name }))
  ]
  const selected = []
  const failed = []
  const retried = []
  const seen = new Map()

  return {
    offered,
    /**
     * Called once per affordance invocation. `input` is retained because the
     * fixtures declare exact expected arguments (`requiredToolArgument`,
     * `expectedRetry`, `expectedToolArguments`), so scoring can compare against
     * them rather than asking a model whether the run looked right.
     */
    record(kind, name, { isError = false, input } = {}) {
      const key = `${kind}:${name}`
      const priorCount = seen.get(key) ?? 0
      seen.set(key, priorCount + 1)
      selected.push({ kind, name, isError, input, order: selected.length })
      if (isError) failed.push({ kind, name })
      // A second invocation of something that already failed is a retry, which
      // is the recovery path the fixtures are built to exercise.
      if (priorCount > 0 && failed.some((entry) => entry.kind === kind && entry.name === name)) {
        retried.push({ kind, name })
      }
    },
    snapshot() {
      const selectedKeys = new Set(selected.map((entry) => `${entry.kind}:${entry.name}`))
      const ignored = offered.filter((entry) => !selectedKeys.has(`${entry.kind}:${entry.name}`))
      return {
        offered,
        selected,
        ignored,
        retried,
        failed,
        counts: {
          offered: offered.length,
          selected: selected.length,
          ignored: ignored.length,
          retried: retried.length,
          failed: failed.length
        }
      }
    }
  }
}

/**
 * Convert the server's tools into Anthropic tool definitions whose `run`
 * proxies straight back to `tools/call`. MCP input schemas are already JSON
 * Schema, so no schema translation (and no Zod dependency) is needed.
 */
export function toAnthropicTools(host, affordances, recorder, betaTool) {
  return affordances.tools.map((tool) =>
    betaTool({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      run: async (input) => {
        const response = await host.request("tools/call", { name: tool.name, arguments: input ?? {} })
        const result = response.result ?? {}
        const isError = result.isError === true || response.error !== undefined
        recorder.record("tool", tool.name, { isError, input: input ?? {} })
        if (response.error !== undefined) {
          return `Error ${response.error.code}: ${response.error.message}`
        }
        return (result.content ?? []).map((block) => block.text ?? JSON.stringify(block)).join("\n")
      }
    })
  )
}

/**
 * Resources and prompts are affordances too, and an agent that never reads the
 * policy it was told to check has failed the resource-first scenario. Exposing
 * them as tools is how a real client surfaces them to a model.
 */
export function resourceAndPromptTools(host, affordances, recorder, betaTool) {
  const tools = []
  if (affordances.resources.length > 0) {
    tools.push(
      betaTool({
        name: "read_resource",
        description: `Read an MCP resource. Available URIs: ${affordances.resources
          .map((resource) => `${resource.uri} (${resource.name ?? "unnamed"})`)
          .join(", ")}`,
        inputSchema: {
          type: "object",
          properties: { uri: { type: "string", description: "The resource URI to read" } },
          required: ["uri"]
        },
        run: async ({ uri }) => {
          try {
            const text = withholdAnswerKeys(await readResource(host, uri))
            recorder.record("resource", uri, { isError: false, input: { uri } })
            return text
          } catch (error) {
            recorder.record("resource", uri, { isError: true, input: { uri } })
            return `Error reading ${uri}: ${String(error)}`
          }
        }
      })
    )
  }
  if (affordances.prompts.length > 0) {
    tools.push(
      betaTool({
        name: "get_prompt",
        description: `Retrieve an MCP prompt template. Available prompts: ${affordances.prompts
          .map((prompt) => `${prompt.name} (${prompt.description ?? "no description"})`)
          .join(", ")}`,
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "The prompt name" } },
          required: ["name"]
        },
        run: async ({ name }) => {
          const response = await host.request("prompts/get", { name, arguments: {} })
          const isError = response.error !== undefined
          recorder.record("prompt", name, { isError, input: { name } })
          if (isError) return `Error ${response.error.code}: ${response.error.message}`
          return (response.result?.messages ?? [])
            .map((message) => message.content?.text ?? JSON.stringify(message.content))
            .join("\n")
        }
      })
    )
  }
  return tools
}

export const PROOF_SERVER_NAMES = [
  "discoverAndChooseEvalServer",
  "ambiguousAffordanceServer",
  "recoveryEvalServer",
  "resourceFirstTaskServer",
  "promptOrToolChoiceServer",
  "observabilityTraceServer"
]
