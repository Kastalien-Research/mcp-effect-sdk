---
title:
  "design: Quicksilver — an Effect-native CLI coding agent on mcp-effect-sdk"
type: design
date: 2026-08-02
status: proposed
---

# Quicksilver — an Effect-native CLI coding agent

A design for a new CLI agent, comparable to Claude Code, Codex CLI, or
DeepAgents, built on three pillars:

1. **`mcp-effect-sdk`** for 100% MCP `2026-07-28` client-side spec support — the
   agent is the SDK's first full-surface consumer.
2. **Effect-TS** as the runtime substrate: `@effect/cli` front end, structured
   concurrency for the agent loop, `@effect/experimental` DevTools, and a custom
   `@effect/ai` provider for **Mercury 2** (Inception API).
3. **LangSmith** tracing plus an eval-driven development loop that generalizes
   this repo's existing `eval:agent` evidence discipline into the agent's own
   release gate.

The working name is **Quicksilver** (liquid mercury; fast, flows into any
container). Alternatives if the name collides in the registry: `hermes-cli`,
`azoth`. A `/name` evaluation pass can settle this before the first tag.

## Verification statement

Per `verify-before-writing` and `probe-before-building`, every external
technical specific in this document was verified on 2026-08-02 against one of:
the live npm registry, extracted published package source, this repository's
source, or official vendor documentation (via search where direct fetch was
blocked). Facts that could not be fully verified are explicitly listed in
[Open unknowns](#open-unknowns-and-required-probes) with the probe that resolves
them, and are **not** load-bearing anywhere else in the design.

Verified version pins assumed throughout:

| Package                 | Version           | Note                                                                                                |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `effect`                | 3.22.1            | Schema is core `effect/Schema`; `@effect/schema` is deprecated — never depend on it                 |
| `@effect/cli`           | 0.77.0            | Prompt suite, shipped `wizard` mode, bash/fish/zsh completion generation                            |
| `@effect/platform`      | 0.97.1            | Matches the SDK's optional peer `^0.97.0`                                                           |
| `@effect/platform-node` | 0.108.1           | `NodeRuntime.runMain` entry boundary                                                                |
| `@effect/experimental`  | 0.61.1            | DevTools, Machine, EventLog, PersistedCache, Sse, key-based RateLimiter                             |
| `@effect/ai`            | 0.37.0            | Post-rename: `LanguageModel`, `Toolkit`, `Tool`, `Model`, `Chat`, `Prompt`, `Response`, `Telemetry` |
| `@effect/opentelemetry` | 0.64.0            | `NodeSdk.layer`                                                                                     |
| `mcp-effect-sdk`        | 1.0.0 (this repo) | peer `effect ^3.22.0`, optional peer `@effect/platform ^0.97.0`                                     |
| `inceptionai`           | 0.1.1             | Official Stainless-generated SDK — used as the **wire-shape reference**, not a runtime dependency   |
| `langsmith`             | 0.8.9             | Dev-only, in the evals package — never a runtime dependency                                         |
| Node                    | ^22 \|\| ^24      | Matches the SDK's engines                                                                           |

## Outcome

A user installs one package and gets:

- `qs` — an interactive terminal agent (REPL) over their repository, with the
  same core affordances as Claude Code: read/edit/search files, run commands,
  plan, and iterate — powered by Mercury 2's diffusion-speed generation.
- `qs run "<task>"` — headless one-shot mode with structured output, usable in
  CI and as a subagent substrate.
- `qs mcp …` — full MCP client management: add/list/remove servers (stdio +
  Streamable HTTP), OAuth login flows, resource/prompt/tool inspection.
- `qs serve` — the agent exposed **as** an MCP server (tools:
  `quicksilver_task`, `quicksilver_edit`), so any MCP host can drive it.
- `qs eval …` — **development-workspace only, not part of the installed
  package**: the eval harness that runs curated datasets against the agent,
  compares experiments, and gates releases on scored trajectories. It lives in
  the dev-only `@quicksilver/evals` package (which is where the `langsmith`
  dependency is allowed), so the published `quicksilver` CLI neither ships the
  subcommand nor depends on `langsmith`.

Every session is traced end-to-end (agent loop → provider → MCP transport) to
LangSmith and, optionally, live into Effect DevTools.

## Why these three pillars compose

- The SDK already emits backend-independent Effect spans
  (`mcp.client.tool.call`, one `mcp.client.dispatch` per MRTR round,
  `mcp.transport.send/receive`) with a strict safe-attribute policy. Any tracer
  the agent provides — LangSmith via OTLP, DevTools via WebSocket — sees MCP
  protocol activity with zero extra instrumentation.
- MCP `2026-07-28` made every client concern the agent has first-class:
  sampling, elicitation, and roots are no longer server-initiated callbacks but
  MRTR (`input_required`) rounds the client answers under an explicit policy —
  which is exactly an agent's permission/consent model.
- Effect's structured concurrency gives the agent loop the properties agent
  frameworks usually bolt on: cancellation as fiber interruption (which the SDK
  converts to `notifications/cancelled`), scoped resource cleanup (transports,
  subprocesses, subscriptions all close with their scope), typed errors, and
  `Redacted` secrets end-to-end.

---

## Part 1 — MCP `2026-07-28`: total client-surface consumption

The agent's contract: **every non-experimental client-side feature in
[`docs/feature-coverage.md`](../../feature-coverage.md) is exercised by a
shipping agent affordance** — not just supported, but reachable from the CLI.
This table is the completeness checklist; the eval harness (Part 4) pins each
row to a scenario.

| Spec surface                                 | SDK API                                                | Agent affordance                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/discover`                            | `McpClient.make` (implicit) + `client.discover()`      | `qs mcp show <server>`; auto-refresh on reconnect; discovery result drives capability-gated UI                                                                                                                                                                                  |
| `tools/list` + pagination                    | `client.listTools`                                     | Tools registered into the agent's `Toolkit` as `mcp__<server>__<tool>`; paginated fully at startup                                                                                                                                                                              |
| `tools/call`                                 | `client.callTool`                                      | Tool dispatch from the agent loop; structured content and `resultType` surfaced                                                                                                                                                                                                 |
| `resources/list`, `resources/templates/list` | `client.listResources`, `client.listResourceTemplates` | `@server:uri` mentions in the REPL; template expansion prompts                                                                                                                                                                                                                  |
| `resources/read`                             | `client.readResource`                                  | Mentioned resources injected into model context                                                                                                                                                                                                                                 |
| `prompts/list`, `prompts/get`                | `client.listPrompts`, `client.getPrompt`               | Server prompts become slash commands: `/mcp__<server>__<prompt>`                                                                                                                                                                                                                |
| `completion/complete`                        | `client.complete`                                      | Tab-completion for prompt arguments and resource-template variables in the REPL                                                                                                                                                                                                 |
| `subscriptions/listen`                       | `client.subscriptionsListen(filter)`                   | One scoped subscription per server; resource-update → context refresh hint; list-change → cache-epoch bump + toolkit re-registration                                                                                                                                            |
| Progress notifications                       | `ClientRequestOptions.progress`                        | Live progress rendering in the status line (request-owned, per spec)                                                                                                                                                                                                            |
| Cancellation                                 | Fiber interruption → `notifications/cancelled`         | `Esc` interrupts the current turn; the interrupt propagates through every in-flight MCP request                                                                                                                                                                                 |
| Result caching                               | `McpCache` (`ttlMs`, `cacheScope`, per-method epochs)  | Shared cache layer across sessions; `qs mcp show` displays cache state; epochs bumped by list-change notifications                                                                                                                                                              |
| MRTR: sampling                               | `InputRequiredPolicy` automatic `SamplingInputHandler` | Routed to the agent's own `LanguageModel` (Mercury) with a per-server permission gate and spend ceiling                                                                                                                                                                         |
| MRTR: elicitation                            | `ElicitationInputHandlers`                             | Rendered as `@effect/cli` `Prompt` forms (text/select/confirm/…) derived from the requested schema                                                                                                                                                                              |
| MRTR: roots                                  | `RootsInputHandler`                                    | Answers with the session's workspace roots (configured directories)                                                                                                                                                                                                             |
| MRTR bounds                                  | `maxRounds` / `maxRequestsPerRound` / `maxConcurrency` | Policy configured per server; exceeding bounds surfaces a typed error to the user, never a hang                                                                                                                                                                                 |
| Logging (deprecated, opt-in)                 | `ClientRequestOptions.logLevel`                        | `--mcp-log-level` flag per server for debugging sessions                                                                                                                                                                                                                        |
| Authorization                                | `mcp-effect-sdk/auth/client`                           | `qs mcp login <server>`: full PKCE flow (loopback redirect + browser open), pre-registered → stored → CIMD → DCR resolution order, step-up retry on `insufficient_scope`, tokens stored `Redacted` in the permissioned `SecretsStore` (0600/0700, see Sessions and persistence) |
| Transports                                   | `transport/stdio`, `transport/http`                    | `qs mcp add` accepts both; stdio subprocess lifecycle owned by the client scope                                                                                                                                                                                                 |
| Tasks (experimental)                         | `mcp-effect-sdk/experimental/tasks`                    | Behind `--experimental-tasks`; schema boundary only, mirroring the SDK's posture                                                                                                                                                                                                |

Design notes beyond the table:

- **Connection supervision.** Each configured server is a scoped child fiber
  owning its transport, client, subscription, and toolkit registration. A
  transport failure tears down only that server's scope; a `Schedule`-driven
  reconnect (exponential backoff, capped) rebuilds it and re-runs discovery.
  Server death never kills the session.
- **Tool identity and drift.** Tool schemas from `tools/list` are decoded once
  into `Tool.make` definitions. On `list_changed`, the toolkit diff is computed
  and the user is notified when a tool they've approved has changed its schema
  (re-approval required) — the same trust boundary Claude Code draws.
- **The sampling permission gate matters.** Under MRTR, a malicious server can
  request model calls on the user's dime. Default policy: sampling requires
  per-server opt-in, with a per-session token budget enforced by the handler
  before it touches the provider.
- **Elicitation schema mapping.** The elicitation request's schema decodes to a
  typed form model; primitive fields map to `Prompt.text` / `Prompt.select` /
  `Prompt.confirm` / `Prompt.integer` etc. and compose with `Prompt.all`.
  Unsupported schema shapes fall back to a JSON editor prompt with schema
  validation on submit — never silent acceptance.

## Part 2 — Effect architecture

### Process shape

One `NodeRuntime.runMain` boundary (the same ownership rule this repo's
`observability.md` enforces). The root layer graph, memoized by Effect's layer
construction so shared services build exactly once:

```
MainLive =
  CliConfigLive                      // ConfigProvider chain (flags > env > project file > user file)
  ├── ObservabilityLive              // OTEL NodeSdk layer (LangSmith exporter) + optional DevTools + Metrics
  ├── SecretsLive                    // Redacted credentials via Config.redacted (INCEPTION_API_KEY, LANGSMITH_API_KEY)
  ├── MercuryClientLive              // HttpClient → Inception API (Part 3)
  │     └── MercuryLanguageModelLive // provides LanguageModel + EditModel
  ├── McpFleetLive                   // supervised MCP server connections (Part 1)
  ├── NativeToolkitLive              // fs/search/shell tools over @effect/platform
  ├── SessionStoreLive               // KeyValueStore.layerFileSystem — transcripts, resume, approvals
  ├── SecretsStoreLive               // permissioned secret store (0600 files / 0700 dir) — OAuth grants
  ├── PermissionServiceLive          // tool approval policy engine
  └── AgentLoopLive                  // the turn engine
```

Services are defined with `Effect.Service` classes; every boundary that can fail
carries typed errors (`AgentError`, `ProviderError`, `PermissionDenied`,
`McpClientError` passed through) — `catchTag` at the presentation layer maps
each to a rendered message, and nothing user-facing is an unhandled defect.

### The agent loop as a Stream

The turn engine is a `Stream<AgentEvent>` — not a callback interface. One turn:

```
user input
  → context assembly (transcript + mentioned resources + system prompt)
  → LanguageModel.streamText(prompt, toolkit)
  → Stream<Response.StreamPart>                    // text deltas, tool-call parts, reasoning summaries
  → tool-call parts fanned to dispatch             // bounded concurrency via Semaphore
  → tool results appended, loop continues until a terminal assistant message
```

`AgentEvent` is the single vocabulary every consumer shares — the interactive
renderer, `qs run --json` (NDJSON via `@effect/platform` `Ndjson`), the
LangSmith trace annotator, and `qs serve`'s MCP progress notifications are all
sinks over the same stream. This is what keeps headless and interactive behavior
identical, and it is the seam the eval harness records.

Concurrency and interruption:

- Each turn runs in a child fiber under the session scope; `Esc` interrupts the
  fiber, which interrupts in-flight provider streams and MCP calls (emitting
  `notifications/cancelled` per the SDK) and runs all finalizers.
- Tool dispatch uses a `Semaphore` (default width 4) — parallel reads,
  serialized writes (writes take the full semaphore).
- Subagents (`qs` recursing on a scoped task) are child fibers with their own
  budget and a narrowed toolkit; structured concurrency guarantees no orphan
  subagent outlives its parent turn.
- Provider calls are wrapped in `Schedule`-based retry (jittered exponential
  backoff on 429/5xx, honoring `Retry-After`; never retrying 4xx logic errors)
  and a session-level key-based `RateLimiter` (`@effect/experimental`) in front
  of the Inception API.

### Native toolkit

Defined with `@effect/ai` `Tool.make` + `Toolkit.make`, handlers over
`@effect/platform` services (`FileSystem`, `Path`, `Command`, `Terminal`):

| Tool                                   | Backing                                                  | Notes                                                                                            |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `read_file`, `write_file`, `edit_file` | `FileSystem`                                             | `edit_file` has a Mercury-specific fast path (Part 3: `/v1/edit/completions`)                    |
| `glob`, `grep`                         | `FileSystem` walk + ripgrep via `Command` when available | capability-probed at startup, never assumed                                                      |
| `bash`                                 | `Command.make`                                           | scoped, interruptible child processes; workingDirectory pinned to workspace roots; env allowlist |
| `todo` / plan tools                    | `SessionStore`                                           | plan state rendered in the REPL                                                                  |

Permission model: every tool call passes through `PermissionService` first —
`allow` / `deny` / `ask` rules keyed by tool name + argument patterns, persisted
per project. `ask` renders an `@effect/cli` `Prompt.select` (once/always/never).
MCP tools get the same gate with per-server defaults. This is deliberately the
same UX contract as Claude Code's permission modes: it is the part of an agent
users must be able to trust first.

### Sessions and persistence

`KeyValueStore.layerFileSystem` under `~/.quicksilver/` (schema'd via
`KeyValueStore.layerSchema` + `effect/Schema`) for non-secret state:

- Transcript journal per session (append-only `AgentEvent` log) → `qs resume`,
  `qs --continue`, and eval-trajectory export come free from replay.
- Approval decisions and the MCP server registry.

**Secrets do not go through `layerFileSystem`.** Verified against
`@effect/platform` 0.97: `layerFileSystem` writes via `writeFileString` with no
mode option, so under a permissive umask credential files come out
world-readable (a `umask 000` run produces a 0666 file in a 0777 directory).
OAuth grants and any other stored credentials use a dedicated `SecretsStore`
service instead — the same `KeyValueStore` interface, but an implementation that
creates its directory with mode `0o700` and writes each entry with explicit mode
`0o600` (`FileSystem.writeFile` with `{ mode }`, plus a `chmod` after write to
correct any pre-existing file), stores values `Redacted`, and never widens
permissions on an existing path. A regression test runs the store under
`umask 000` and asserts the resulting directory and file modes — the
permissive-umask case is the test, not an assumption.

- Context compaction: when the assembled context exceeds the model window (128K
  for `mercury-2`), oldest turns are summarized by a dedicated compaction prompt
  (traced + eval'd like any other behavior) into a rolling summary block; the
  journal keeps the originals.

### Interactive front end

`@effect/cli` `Command.make("qs", …)` with subcommands `run`, `mcp`
(`add`/`remove`/`list`/`show`/`login`/`logout`), `serve`, `config`, `resume`;
the bare command enters the REPL. The `eval` subcommand is registered only by
the development workspace's entrypoint (which composes the published command
tree with `@quicksilver/evals`) and is absent from the published binary. The
REPL prompt itself is `Prompt.custom` (multi-line editing, history from
`SessionStore`, `@`-mention and `/`-command completion backed by
`completion/complete` for MCP-derived entries). `Command.wizard` and generated
shell completions come free from `@effect/cli`. DevTools note: the Effect
DevTools consumer is the `effectful-tech.effect-vscode` extension;
`qs --devtools` (or `QUICKSILVER_DEVTOOLS_URL`) enables `DevTools.layer()` —
same opt-in shape as this repo's `MCP_EFFECT_DEVTOOLS_URL`, `Layer.empty` when
unset.

---

## Part 3 — The Mercury 2 provider (`@quicksilver/ai-inception`)

### Why a custom provider (verified)

`@effect/ai-openai@0.41.0` targets OpenAI's **Responses API** (`/responses`,
`Generated.CreateResponse`) — not chat completions. The Inception API is
OpenAI-**chat-completions**-compatible (`POST /v1/chat/completions` on base
`https://api.inceptionlabs.ai`, verified from the official `inceptionai@0.1.1`
SDK source), with Inception-specific extensions that a stock OpenAI client
cannot type. So the provider is written against Inception's wire shape directly,
reusing the `@effect/ai-openai` _anatomy_ (verified from its source), with
`effect/Schema` codecs instead of a codegen'd client:

```
MercuryClient  (Context.Tag "@quicksilver/ai-inception/MercuryClient")
  make({ apiKey: Redacted, apiUrl?, transformClient? })
    → HttpClient.mapRequest(prependUrl + bearerToken + acceptJson)
    → createChatCompletion(request)          Effect<ChatCompletion, ProviderError>
    → createChatCompletionStream(request)    Stream<ChatCompletionChunk, ProviderError>
         // SSE via Stream.decodeText → pipeThroughChannel(Sse.makeChannel())
         // → Schema.decode per event; undecodable frames logged and skipped
    → createEditCompletion / createFimCompletion
    → listModels                             // GET /v1/models — capability discovery
  layer / layerConfig                        // Config-based env wiring

MercuryLanguageModel
  model(name, config?) → Model<"inception", LanguageModel, MercuryClient>
  make → LanguageModel.make({ generateText, streamText })
         // chat-completions wire ↔ @effect/ai Prompt/Response mapping:
         // messages, tools [{type:"function",…}], tool_choice "auto"|"required",
         // response_format json_schema for generateObject,
         // stream tool-call index-deltas → Response.StreamPart tool-call parts
```

### Inception-specific surface (verified from `inceptionai@0.1.1` source)

Typed as a `MercuryConfig` service (per-call overridable, mirroring
`OpenAiLanguageModel`'s config pattern):

| Param                                         | Values                                                                                                            | Agent use                                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reasoning_effort`                            | `"instant" \| "low" \| "medium" \| "high"` (Inception's own enum — `"instant"` does not exist upstream at OpenAI) | Effort routing: `instant` for classification/compaction, `high` for planning turns                                                                                                                                       |
| `diffusing`                                   | boolean                                                                                                           | Streams intermediate denoising blocks (unbilled). Rendered as a distinct "diffusion shimmer" in the REPL; **must** be stripped before transcript/trace storage — a bespoke `StreamPart` variant, never plain text deltas |
| `realtime`                                    | boolean                                                                                                           | Low-TTFT mode for the REPL's inline completions                                                                                                                                                                          |
| `reasoning_summary`, `reasoning_summary_wait` | boolean                                                                                                           | Response carries `reasoning_summary` → mapped to reasoning parts, shown in verbose mode, attached to traces                                                                                                              |
| `tool_choice`                                 | `"auto" \| "required"` **only** (no `"none"`, no named-tool variant)                                              | The agent never emits unsupported `tool_choice` values; forced-tool flows use `required` + single-tool toolkits                                                                                                          |

Additional lanes beyond chat:

- **Edit lane**: `POST /v1/edit/completions` (`mercury-edit-2`) with
  `<|code_to_edit|>` / `<|cursor|>` / `<|current_file_content|>` tags — no
  streaming, no tools. Backs the `edit_file` fast path: targeted edits skip the
  full agent loop round-trip. Exposed as `EditModel` service.
- **FIM lane**: `POST /v1/fim/completions` — prefix/suffix infill for
  inline-completion UX later; schema'd now, shipped behind a flag.
- **Capability discovery**: provider startup calls `GET /v1/models` and
  validates the configured model ID against the live roster (the
  `Model.supported_sampling_parameters` field exists for exactly this); unknown
  params are dropped with a warning rather than sent blind. No hardcoded model
  enum — `mercury-2` and `mercury-edit-2` are defaults, not a closed union.

Pricing/limits context (verified): `mercury-2` is 128K context, $0.25/M in,
$0.75/M out; a `Metric` pair (tokens in/out) and a derived cost gauge feed the
status line and LangSmith metadata. Rate limits are undocumented → probe P3.

Provider conformance is pinned by a **recorded-wire test suite**: golden
request/response fixtures for every capability (streaming tool-call deltas,
`json_schema` mode, `diffusing` frames, 429 handling), replayed against the
Schema codecs in CI without network — the provider's analogue of this repo's
conformance discipline.

---

## Part 4 — LangSmith tracing and eval-driven development

### Tracing: pure OTEL at runtime, `langsmith` SDK only in dev

Verified (2026-08-02, from `langsmith@0.8.9` installed source and the current
`langchain-ai/docs` markdown): LangSmith ingests raw OTLP directly — endpoint
`https://api.smith.langchain.com/otel/v1/traces` (regional and self-hosted
variants exist), headers `x-api-key: <LANGSMITH_API_KEY>` and optional
`Langsmith-Project: <project>`; standard `OTEL_EXPORTER_OTLP_ENDPOINT` /
`OTEL_EXPORTER_OTLP_HEADERS` / `OTEL_SERVICE_NAME` are honored. It maps
`langsmith.*` attributes (`langsmith.trace.name`, `langsmith.span.kind` ∈
llm/chain/tool/retriever/embedding/prompt/parser, `langsmith.metadata.{key}`)
and the GenAI semantic conventions (`gen_ai.system`, `gen_ai.operation.name`,
`gen_ai.prompt.{n}.role|content` / `gen_ai.completion.{n}.*`,
`gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.tool.name`) into first-class
LLM runs.

The catch, and the design decision it forces: generic OTEL spans (what
`@effect/opentelemetry` emits by default) land as correctly-nested but _plain_
runs — LLM rendering (prompt/completion panels, token usage, cost) appears only
when spans carry those attributes. So:

- **Runtime = pure OTEL, no `langsmith` dependency.** `ObservabilityLive` wires
  `@effect/opentelemetry` `NodeSdk.layer` with an OTLP exporter pointed at
  LangSmith. One span tree covers everything: agent turn → provider call → MCP
  `mcp.client.tool.call` → `mcp.transport.send` — the SDK's spans nest in for
  free.
- **The Mercury provider annotates its own spans** with the GenAI conventions —
  the exact pattern `@effect/ai-openai` uses internally
  (`annotateRequest(options.span, …)` setting GenAI semconv attributes, verified
  from its source). The kernel additionally sets `langsmith.span.kind` (`llm` on
  provider spans, `tool` on dispatch spans, `chain` on turns) and
  `langsmith.metadata.*` (session id, model, `reasoning_effort`, git branch).
- **Content policy.** The MCP SDK's safe-attribute rule (no bodies, no
  arguments) stays absolute for `mcp.*` spans. Provider spans are the one place
  prompt/completion content belongs — gated by config
  (`observability.content: full | redacted | none`, default `full` for personal
  projects, `none` inherited for `qs serve` mode), because eval curation (below)
  is impossible without content.
- **Known OTLP gotchas, designed around**: ingestion is async (immediate 200,
  background materialization) and a child whose parent span never arrives is
  silently dropped — therefore no partial-trace sampling: sampling decisions are
  per-trace at the root. Mixing SDK-created runs and OTLP spans in one tree
  requires manual `langsmith.span.id`/`parent_id` stitching (8-byte OTLP ids vs
  run UUIDs) — avoided entirely by keeping the runtime pure-OTEL.
- DevTools and LangSmith are independent sinks over the same tracer state; their
  composition order is probe P6.

### Eval-driven development

The `langsmith` SDK (0.8.9) lives only in `@quicksilver/evals` (dev-only).
Verified surface used: `evaluate()` (`data`, `evaluators`, `experimentPrefix`,
`numRepetitions`, `maxConcurrency`), `evaluateComparative()` for pairwise
experiments, `Client.createDataset` / `createExamples` (bulk), annotation
queues + automation rules (filter + sampling → add-to-dataset / annotation queue
/ online evaluator), and the real `langsmith/vitest` exports (`ls.describe`,
`ls.test`, `ls.logFeedback`, `ls.wrapEvaluator`, reporter at
`langsmith/vitest/reporter`; `LANGSMITH_TEST_TRACKING=false` for offline runs).

**The target under eval is the shipped artifact**: `qs run --json` (headless
NDJSON of `AgentEvent`s) — never a reimplemented harness. A dataset example is
`{ input: task + fixture repo, reference: expected outcome }`; the target
function materializes the fixture, runs the agent, and returns the final message
plus the full `AgentEvent` trajectory. Interactive and headless behavior share
one code path by construction (Part 2), so what's evaluated is what users run.

**Grading obeys `no-self-graded-verification`.** Three grader tiers, in strict
preference order:

1. **Deterministic outcome graders** (default): plain code asserting measurable
   facts — target file contents/diffs, fixture test-suite exit codes, typecheck
   exit codes. The agent reports nothing about its own success; the grader
   re-derives everything from the artifact.
2. **Deterministic trajectory graders**: assertions over the `AgentEvent`
   journal using the `agent-evidence` vocabulary (offered / selected / ignored /
   retried / failed) — "the MCP resource was read before the edit", "no tool
   outside the approved set", "≤ N provider calls", "cancellation produced
   `notifications/cancelled`". These pin the Part 1 spec-coverage table: every
   MCP surface has at least one trajectory scenario, seeded from this repo's six
   proof servers (`examples/agent-facing-proof-servers.ts`) run as real fixture
   servers.
3. **LLM-as-judge** (`ls.wrapEvaluator`, so judge calls trace separately): only
   for properties with no deterministic form (explanation quality, plan
   coherence). The judge is a **different model invocation than the actor** — by
   default a different provider entirely (configurable), never the same session,
   and judge prompts live in the dataset repo under version control.

**The progressive-tuning loop** — how "optimize for what we want" actually runs:

1. Every candidate change to prompts, effort routing, compaction, permission
   defaults, or toolkit descriptions is a named experiment (`experimentPrefix`)
   against the seed datasets, `numRepetitions ≥ 3` (diffusion models are fast
   and cheap — $0.25/M in — so repetition is affordable; variance is reported,
   not hidden).
2. `evaluateComparative` ranks candidate vs baseline pairwise where absolute
   scores are noisy (e.g. plan quality).
3. CI gate (`qs eval ci`, vitest + LangSmith reporter): deterministic tiers 1–2
   on the core datasets must not regress; judge-tier metrics are report-only,
   never blocking (a judge is not a gate — same rule, applied to CI).
4. Production traces feed back: automation rules sample traces (by error, by
   user thumbs-down feedback, by `langsmith.metadata` facets) into annotation
   queues; reviewed items are promoted to datasets via `createExamples`. Online
   LLM-as-judge evaluators run on sampled live traces with the documented spend
   cap, as drift alarms, not gates.
5. Failures found anywhere become permanent dataset examples first, fixes second
   — the eval suite is append-mostly, mirroring how this repo accretes
   conformance evidence.

Env contract: `LANGSMITH_API_KEY` (Redacted via `Config`), `LANGSMITH_PROJECT`,
standard `OTEL_*` overrides; `qs` never requires LangSmith — absent a key,
`ObservabilityLive` degrades to `Layer.empty` exactly like this repo's DevTools
convention.

---

## Repository and packaging

Incubation has already begun on `main` as **`apps/inception-cli/`** (probe
toolkit, eval corpus, and LangSmith campaign harness landed via the
`research/mcp-cli-agent` branch), so this design adopts that path rather than
the originally proposed `apps/cli-agent/`. The app has its own `package.json`,
lockfile, and toolchain — the exact precedent `apps/visual-effect` set; `apps/`
is excluded from the published package and `pnpm run build`. One caveat the
precedent makes explicit: `verify` runs root ESLint/Prettier over the whole
tree, and `eslint.config.mjs` ignored only `apps/visual-effect/` — so incubation
requires one root change, adding `apps/inception-cli/` to that ignore list
(Prettier already ignores all of `apps/`), mirroring how `visual-effect` was
excluded. That ignore-list addition ships with this document. Proposed workspace
layout inside `apps/inception-cli/`:

```
packages/
  ai-inception/     @quicksilver/ai-inception — Mercury provider (no MCP, no CLI deps)
  kernel/           @quicksilver/kernel — AgentLoop, toolkit, permissions, sessions (no CLI deps)
  cli/              quicksilver — @effect/cli front end, REPL, `qs` binary
  evals/            @quicksilver/evals — datasets, graders, LangSmith harness (dev-only)
```

The provider and kernel are publishable independently; the provider in
particular is useful to any Effect user and is a natural upstream contribution
candidate (`@effect/ai-inception`) once stable. Graduation to a standalone
repository happens when the SDK ships `v1.0.0` on npm and the agent can depend
on the published artifact instead of the workspace.

## Scope guardrails

- The agent consumes `mcp-effect-sdk` only through its published entrypoints —
  no `src/` deep imports, no `internal/`. Gaps discovered become SDK issues (and
  eval scenarios), not workarounds; the agent is the SDK's first full-surface
  consumer and its feedback loop.
- No changes to the root SDK package, its dependencies, or `verify` gates — with
  the single scoped exception named above: adding `apps/inception-cli/` to the
  root lint ignore lists, exactly as `apps/visual-effect/` already is.
- The `inceptionai` npm SDK is a wire-shape reference only, never a runtime
  dependency — the provider's only HTTP surface is `@effect/platform`
  `HttpClient`.
- Secrets (`INCEPTION_API_KEY`, `LANGSMITH_API_KEY`, OAuth grants) are
  `Redacted` from `Config` to storage to trace attributes; the SDK's
  safe-attribute policy extends to every agent span.
- MRTR sampling is opt-in per server with an enforced budget — never silently
  auto-approved.
- Tasks stay experimental behind a flag, mirroring the SDK's posture.

## Open unknowns and required probes

Per `probe-before-building`, each probe is a throwaway script run **before** the
design element it gates is implemented:

| #   | Unknown                                                                                                                                                                                                                   | Probe                                                                                                | Gates                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------- |
| P1  | Exact `diffusing: true` chunk framing (how denoising blocks interleave with final deltas)                                                                                                                                 | Live streamed call with a real `INCEPTION_API_KEY` (10M free tokens on signup), print raw SSE frames | Provider stream decoder       |
| P2  | Stock-OpenAI-compat details: correct `apiUrl` is host-only with `/v1` in paths (per SDK source) — confirm against live API; confirm `tool_choice` union and `json_schema` behavior                                        | Same probe session as P1                                                                             | Provider request codecs       |
| P3  | Inception rate limits (RPM/TPM, `429` header shape)                                                                                                                                                                       | Read `X-RateLimit-*` headers during P1                                                               | Retry/RateLimiter tuning      |
| P4  | Live model roster (`mercury-coder` line status post-Mercury-2)                                                                                                                                                            | `GET /v1/models` during P1                                                                           | Model-selection UX defaults   |
| P5  | LangSmith OTLP live-fire: endpoint/headers/attribute mapping are doc-verified but no real POST was executed; `Langsmith-Project` header casing and rendering fidelity of Effect-emitted `gen_ai.*` spans unconfirmed live | Export one synthetic annotated trace via `@effect/opentelemetry`, inspect in LangSmith UI            | Part 4 tracing wiring         |
| P6  | DevTools layer ordering relative to the OTEL tracing layer (docs page unreachable this session; spans+metrics wiring itself is source-verified)                                                                           | 10-line scratch with both layers, confirm spans appear in both sinks                                 | ObservabilityLive composition |
| P7  | Effect Layer memoization of the shared `HttpClient` across provider + MCP layers (long-standing semantics, unverified this session)                                                                                       | Scratch: count constructions with a probe layer                                                      | MainLive graph                |

## Implementation sequence

1. **Probes P1–P7** (one afternoon, free-tier key + LangSmith account); fix this
   document where reality disagrees, then delete the scratches.
2. **Contracts doc** (`docs/quicksilver-contracts.md`) pinning every
   cross-package interface — `AgentEvent`, `Tool` naming, `MercuryClient`
   service shape, span/metric names, eval dataset schema — probe-verified per
   the `parallel-subagent-integration` rule, so implementation can fan out.
3. **`@quicksilver/ai-inception`**: Schema codecs from recorded P1/P2 wire
   fixtures → `MercuryClient` → `MercuryLanguageModel` → recorded-wire test
   suite. First integration proof: `LanguageModel.streamText` with a one-tool
   toolkit round-trips against the live API.
4. **`@quicksilver/kernel`**: `AgentEvent` + turn engine over a mock
   `LanguageModel` (executable spec, no network) → native toolkit → permissions
   → sessions. The mock-model harness is the kernel's acceptance spec, reused by
   evals.
5. **MCP fleet**: supervised connections, toolkit bridging, subscriptions,
   caching, MRTR policy (elicitation forms, sampling gate, roots), OAuth login
   flow — validated against this repo's `everything-server` example and the six
   `agent-facing-proof-servers`.
6. **`quicksilver` CLI**: REPL, rendering, `run --json`, `mcp` subcommands,
   `serve` (agent-as-MCP-server via `mcp-effect-sdk/server`).
7. **Observability + evals** (Part 4): OTLP export, DevTools opt-in, metric
   catalog; eval harness, seed datasets, graders, CI gate.
8. **Hardening**: compaction, resume, subagents, rate-limit tuning from P3.

Each step lands with its tests green and `tsc` clean under the integration gate
(the `type-fix-the-fast-lane` lesson: suite-green ≠ typecheck-clean).

## Acceptance

- Every row of the Part 1 spec table demonstrably reachable from the CLI, each
  pinned by at least one eval scenario or integration test driving the real
  dispatcher (the `agent-evidence` discipline, generalized).
- Provider recorded-wire suite green offline; one live smoke lane.
- A full session trace visible in LangSmith with correct span hierarchy (agent
  turn → provider call → MCP tool call → transport) and in DevTools.
- Eval gate wired into CI with deterministic graders separated from the acting
  agent (`no-self-graded-verification`).
- `qs` completes the six proof-server scenarios end-to-end as a real MCP client.
