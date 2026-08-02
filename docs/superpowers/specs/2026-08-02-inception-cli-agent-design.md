# Inception CLI Agent — Design

**Date:** 2026-08-02 **Status:** Draft for review **Name:** `inception-cli`
(lives at `apps/inception-cli/`) **Inputs:** the five research reports in
`docs/research/` (Effect runtime, MCP 2026-07-28 surface, OpenCode teardown,
CLI-agent survey, MCP possibility space). Claims below that cite evidence are
sourced there.

---

## 1. Product definition

An Effect-native CLI coding agent that is a clean-break client for MCP
2026-07-28 (the stateless spec), powered by Inception's Mercury 2 diffusion
reasoning model on 100% of turns. Open source. The same harness is usable three
ways: interactive CLI, headless (`--output-format stream-json`), and — after v1
— a programmatic SDK, all driving one core through one event stream.

**v1 success criterion:** glassBead daily-drives it on real work.

**Secondary goal:** the first public client to exercise the full 2026-07-28
protocol surface (the "full flex checklist," items 13–61 plus the Tasks
extension, per `docs/research/mcp-2026-07-28-full-surface.md` §9).

### Non-goals for v1

- **MCP Apps capability** — not declared. `_meta.ui.resourceUri` is surfaced
  only as a "this tool wants a graphical host" hint. The spec has no headless
  story.
- **Dynamic Client Registration** — deprecated in-spec. We implement CIMD +
  pre-registered credentials + the user-entry prompt, and skip DCR until a
  target server actually requires it.
- **Legacy spec fallback** — a 2026-07-28-only client cannot talk to 2025-11-25
  servers (both mixed pairs fail). This is a deliberate product decision; an
  `auto`-negotiation mode is a roadmap item, not v1.
- **Rich TUI** — v1 renders with a minimal frame loop (streaming text, status
  line, prompts). No layout engine, no alternate screen.
- **Multi-model routing** — the architecture is model-agnostic (`ExecutionPlan`
  is the escalation primitive) but v1 ships with Mercury alone. A second model
  is introduced only when a concrete, observed need justifies it — case-by-case,
  never in principle.
- **Aider-style repo map** — valuable but large; deferred until evals show
  context selection is the bottleneck.

---

## 2. Design thesis: the model designs, the harness executes

Mercury 2 is fast (~1000 tok/s), cheap ($0.25/$0.75 per M, $0.025 cached),
strong at reasoning/infilling/structured output — and weak at long-horizon
multi-turn tool orchestration (Tau2 52.9; independent ACL 2026 evaluation of
open dLLMs measured 0% multi-turn tool-calling success, with retry loops and
schema drift as the named failure modes). The architecture therefore assigns
roles by measured strength:

| Role                                 | Owner                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Planning, tool design, decomposition | Mercury (`reasoning_effort: medium+`)                                            |
| Tool selection from a large catalog  | Mercury (low effort)                                                             |
| History/memory compression           | Mercury (dLLMs beat AR peers here)                                               |
| Edit generation (infill-shaped)      | Mercury                                                                          |
| Sequencing N-step tool workflows     | **Harness** (deterministic, or one authored code block)                          |
| Tool-call repair                     | **Harness** (deterministic ladder; dLLMs are bad tool-call editors)              |
| Pass/fail verdicts                   | **Deterministic verifiers** (typecheck, tests, lint) — never the producing model |

Context economics (128K window, ~2.6x output verbosity) are treated as a forcing
function: aggressive context hygiene is a feature of the design, not an
optimization.

---

## 3. Architecture

Five pillars. Each is independently testable and communicates with the others
through typed events and services.

### 3.1 The deterministic loop

The agent loop is an explicit state machine owned by the harness, not the model.
Effect's `LanguageModel` is single-turn by design;
`disableToolCallResolution: true` returns decoded `tool-call` parts without
executing anything — the harness dispatches, records, and decides continuation.

- **Tool-call lifecycle** is a tagged union of distinct states with distinct
  payloads (gemini-cli's seven-state machine as the model), with transitions
  centralized and illegal transitions unrepresentable.
- **Retry-loop detection**: three consecutive identical actions break the loop —
  the documented dLLM failure signature, cheap to detect.
- **Steering is durable**: mid-turn user input lands in a `session_input` table
  with `steer | queue` delivery; a per-session coalescing run coordinator
  collapses input bursts into a single successor turn (OpenCode V2's mechanism).
  Steering promotes into the transcript at turn start and refreshes the step
  budget.
- **Compaction re-entry** is a typed result (`Turn.Result | Turn.Restart`), not
  a thrown defect.
- **Turn budgets**: bounded steps per turn, bounded MRTR rounds per request,
  bounded empty-response retries (empty assistant turns are retried without
  being persisted).

### 3.2 MCP-only effectors

The agent's only way to act on the world is MCP, via `mcp-effect-sdk` (this repo
— already verified 2026-07-28-native: MRTR loop, `subscriptions/listen`,
`server/discover`, cacheable-list client cache, CIMD auth).

**Built-in tools are an in-process MCP server.** Read/edit/bash/search are
served by our own server implementation over an in-memory duplex transport —
goose's one-server/three-deployment-modes pattern, expressed as an Effect
`Transport` service with three layers (in-process duplex, stdio child,
Streamable HTTP). The same built-ins can therefore be exposed to other clients
unchanged, and the agent dogfoods the SDK's client _and_ server on every turn.

**The tool factory is an MCP server** whose tools are meta-tools (`design_tool`,
`build_tool`, `list_built_tools`, `inspect_tool_source`, `retire_tool`). The
pipeline is deterministic: scaffold → typecheck → test → eval-gate → register.
Mercury writes the spec and the implementation draft; the pipeline decides
acceptance (no self-graded verification). Long builds run under the **Tasks
extension** (`resultType: "task"`, `tasks/get` polling, durable client-side
taskId ledger) — this requires building the Tasks runtime the SDK currently
lacks (schemas exist; polling/storage/dispatch do not). Cross-call build state
uses server-minted handles passed as ordinary tool arguments, per the spec's
stateful-tools pattern.

**Registration is append-only.** The factory's `tools/list` returns tools in
insertion order, never re-sorted, so the serialized tool block is a stable
prompt prefix and a new tool invalidates only the tail. The client likewise
never re-sorts or re-keys tool lists.

**The self-extension loop** is protocol-native: factory registers →
`notifications/tools/list_changed` on the agent's open subscription → cache
invalidation → refetch → the new tool is in context. Every existing tool-factory
experiment is bottlenecked on clients that don't refresh tool lists; this client
is the one that does.

**MRTR resolver** (client side):

- `elicitation/create` (form) → rendered through the permission/prompt system;
  (url) → browser open with explicit consent, full URL shown, and manual
  retry/cancel controls (accept ≠ complete).
- `sampling/createMessage` → routed to Mercury; the reply returns on retry.
  Sampling is deprecated as an RPC but load-bearing as an MRTR request type.
- `roots/list` → answered with the workspace roots.
- `requestState` is an opaque branded newtype (uninspectable at the type level),
  never logged, subject to a client-side size ceiling, and pending rounds are
  durably parked so a CLI restart survives them.
- Rounds are bounded; exhaustion is a distinct typed error, not a hang.

**Capabilities are per-request trust decisions.** The client declares `sampling`
when calling its own factory server and withholds it from third-party servers in
the same turn.

**Client behaviors from the full-flex checklist** owned by the agent (the SDK
cannot supply them): `isError: true` text fed back to the model for
self-correction; `annotations.audience` routing (user → terminal, assistant →
context) and `annotations.priority` as the context-eviction key; `Resource.size`
as a context-budget gate; prompts → slash commands with `completion/complete`
tab-completion including `context.arguments` threading; unannotated tools
treated as destructive + open-world.

**Elicitation correlation**: outbound requests carry session id and
tool-call-request id in `_meta`; inbound elicitations route by reading them
back, with an explicit error (never a guess) when multiple calls are in flight
and the id is absent.

### 3.3 Execution surface: code mode and direct calls, eval-decided

Two execution surfaces behind one interface:

- **Direct**: the model emits tool calls; the harness validates and dispatches.
- **Code mode**: the model writes a program against typed tool signatures; an
  Effect-native tree-walking interpreter executes it (OpenCode's `codemode` as
  the base — no `eval`, no `vm`; isolation by
  nothing-nameable-that-wasn't-seeded).

Code mode is the presumptive default (goose measured +6.7 points on
terminal-bench-2; codex ships frontier models as code-mode-only; it collapses
the N-step sequential orchestration Mercury is worst at into one authored
program) — but it gets an eval arm, not an assumption.

Required changes to the OpenCode base:

1. **Validate MCP tool inputs.** Decode each tool's JSON Schema into Effect
   Schema and validate at the call boundary; reject servers whose schemas can't
   be decoded. (OpenCode renders schemas but never validates.)
2. **Spans inside the interpreter.** Each in-interpreter tool call is an
   ordinary Effect and gets its own span — this is what keeps trajectory evals
   alive under code mode.
3. Token-budgeted catalog with round-robin namespace fairness and a `search`
   discovery tool (copy nearly verbatim).
4. Known limitation, documented not solved in v1: wall-clock timeout only — no
   memory/CPU budget. Acceptable for a local single-user CLI.

Tool schemas pass through goose-style **normalization at the listing boundary**
(collapse `$ref`/`oneOf`-of-consts to `enum`, fold descriptions, inline trivial
`$defs`; conservative bail-outs) — measured up to ~9x context saving on schemas.

### 3.4 Best-of-N rollouts with deterministic verification

The primary quality mechanism: sample N candidates in parallel, verify each
deterministically, keep the winner. At Mercury prices, compute substitutes for
single-shot intelligence.

- **Fan-out**: `Semaphore.withPermits(1)` gating each candidate inside
  `Effect.raceAll` — bounded concurrency, first verified success wins, losers
  interrupted with finalizers awaited (measured semantics; worktrees and child
  processes are reliably reaped). Best-by-score variants use `Effect.exit` per
  candidate.
- **Isolation**: one git worktree per rollout via `acquireRelease` keyed on the
  `Exit` — the winner's worktree survives, losers' are removed.
- **Verifiers**: typecheck (real exit code from a spawned `tsc`, stdout and
  stderr drained concurrently, `forceKillAfter` set), tests, and tree-sitter
  ERROR-node lint. Verifier failures are a domain error type kept **out of the
  model-escalation `ExecutionPlan`** — failing tests must never trigger a
  provider switch.
- **Grace-period termination**: a budget-exhausted rollout gets one final forced
  "finish now" turn so it returns a usable partial answer instead of nothing.

**Edit policy** (the inversion the research supports): v1 ships
exact-match-or-fail plus the `isDisproportionateMatch` hard-abort guard, and
nothing else — under best-of-N, a failed edit-apply is a cheap dead rollout, not
a turn-destroying event, so fuzzy repair starts unjustified. A deterministic
repair ladder (whitespace-flexible line match → whitespace-weighted Levenshtein
with whitespace errors nearly free → Unicode punctuation normalization) is added
**only if the eval spine shows apply-failures dominating the rollout budget**,
tier by tier. An LLM parameter-corrector may follow the ladder, **off by
default**, single-call, its output re-entering the deterministic ladder — the
model repairs parameters, never the file. Never last-resort similarity matching
(aider tried it and killed it).

**Edit format is an eval outcome, not an opinion.** Four arms: whole-file ×
search/replace × unified diff × grammar-constrained patch (codex's Lark CFG —
raw text under a grammar, eliminating JSON-escaping failures). Plus a fifth
probe-dependent arm if Mercury 2 exposes FIM/Edit endpoints.

**Repair messages** follow aider's shape: greppable error tag, "did you mean"
with ±5 lines of real file content, idempotence check ("already applied"), and
partial-success accounting ("the other N applied; don't re-send"). Malformed
tool arguments return as tool results, not protocol errors, so the model can
self-correct.

### 3.5 Observability and evals, native

- **Tracing**: Effect core's dependency-free OTLP exporter → LangSmith
  (`OtlpTracer.layer` with the LangSmith OTLP endpoint and API-key header).
  `gen_ai.*` semantic conventions on every model span (free from the provider
  adapter). Added by us: a span per tool call and per rollout (Effect annotates
  only the enclosing span — concurrent calls would collide), and
  `traceparent`/`tracestate` propagation through MCP `_meta` so traces cross the
  agent/server boundary.
- **Event log is the source of truth.** Every agent event lands in a durable
  SQLite event log; the live SSE/PubSub stream is for rendering and may drop
  under pressure (bounded bus with `replay`; lossy buffers only on the render
  branch). Evals and tracing read the log, never the live stream.
- **One public event stream** at the AgentEvent altitude. Lower-level model
  events stay internal and unexported (the codex/gemini two-vocabulary mistake,
  avoided by construction).
- **Evals drive the same headless path as any consumer**:
  `--output-format stream-json` NDJSON whose terminal `complete` event carries
  token counts and cost is the integration contract the eval harness consumes.
- **Eval harness** (built before the agent, §6): per-case idempotent result JSON
  (existing parseable result short-circuits the case — resume, live stats, and
  the format×model grid fall out); metrics split `parse_error_rate` from
  `apply_error_rate` and are attributed to the **executor** role (aider's
  architect-mode 100%-well-formed bug, not reproduced); a `variants` guard flags
  result directories mixing more than one model/format/commit; per-language
  signals have explicit "unsupported" states, never silent zeros.

---

## 4. Package layout

```
apps/inception-cli/
  packages/core     # the harness: loop, MCP client wiring, permissions,
                    # rollouts, code-mode interpreter, event log. No UI.
                    # Real `exports` map from commit one.
  packages/cli      # terminal frontend: rendering, prompts, args.
                    # Imports core only through its public exports.
  packages/evals    # the harness-as-consumer eval spine (§6).
  packages/factory  # the tool-factory MCP server (also runnable standalone).
```

The SDK surface comes after v1 via the one-contract-two-transports pattern: a
single `HttpApi` contract, served over the network _and_ wrapped by
`HttpRouter.toWebHandler` injected as the `fetch` of the same generated client —
in-process and remote use are the same client with different transports.
Approvals are id-correlated inbound submissions (serializable, no closures) so
the same core hosts TUI, headless, HTTP, and MCP-server frontends without
special cases.

Effect is pinned to an exact 4.0.0 beta (no `^`), with a `patches/` directory
expected (OpenCode carries patches against the same betas).

---

## 5. Model integration

- **Client**: `@effect/ai-openai-compat` with `apiUrl` from
  `INCEPTION_BASE_URL`, defaulting to `https://api.inceptionlabs.ai/v1`,
  `apiKey: Config.redacted("INCEPTION_API_KEY")`. Unknown config keys pass
  through to the request body verbatim, so Inception-specific parameters need no
  adapter.
- **`strictJsonSchema: false`** (defaults true; Mercury is not OpenAI strict
  mode). Structured output goes through the codec-transformer seam: lossy
  provider schema, authoritative Effect Schema decode with `{ errors: "all" }`
  feeding repair prompts.
- **`reasoning_effort` by role**: planner medium/high; executor and formatters
  low/instant; summarizer low. Every call site names a _job_ (gemini-cli's alias
  indirection), never a model — swapping a role's model or effort is a one-line
  config change, and every call carries a role tag for trace attribution.
- **Escalation**: `ExecutionPlan` with Mercury as the only v1 step. Known
  semantics respected: `while: false` escalates rather than aborts (so
  non-retryable authority errors like `ContentPolicyError` are filtered before
  the plan); only the last failure survives (per-step logging via
  `Schedule.tap`); `preventFallbackOnPartialStream: true` so a mid-stream
  failure never replays tokens the user already saw.
- **Retry**: transport-level `HttpClient.retryTransient` under the provider
  layer, semantic-level retry in the plan — never both on the same 429. Retry on
  _content_ (empty or undecodable responses) as well as status. `retry-after`
  honored via `Schedule.modifyDelay`.
- **Error policy**: `catchReasons` over the `AiError` taxonomy as the policy
  dispatcher. `StructuredOutputError` (carries the raw bad text) → bounded
  re-prompt; `ToolNotFoundError`/`ToolParameterValidationError` → re-prompt with
  the correction; quota/auth/content-policy → hard stop. Fail closed on
  authority (policy, safety), fail open on quality (a summarizer/corrector
  failure returns its un-improved input) — encoded in the types as
  `Effect<A, PolicyError>` vs `Effect<A, never>`.
- **Token accounting**: observed provider usage (captured per call) feeds the
  compaction threshold; the `length/4` estimate is only a pre-first-response
  seed. No local tokenizer in v1; revisit after the probe if usage data proves
  insufficient.

**Context management**: goose-style compaction — visibility-flipping (the user's
transcript keeps everything; the model's context doesn't), a typed structured
summary whose field order degrades gracefully under truncation, gemini's
two-pass self-critique and inflation check (a failed compression permanently
falls back to truncation-only). The system prompt is pinned by a context epoch:
mid-session changes inject as delta messages, never rewrites of the cached
prefix. Prompt assembly orders stable blocks first with ≤3 cache breakpoints.
Oversized tool results spill to files with a grep-this-pointer replacement.

---

## 6. Eval spine (built before the agent)

`packages/evals` exists and runs before the loop does. Contents:

1. **The Mercury probe** (§8, P1–P6) as executable scripts whose outputs are
   committed as fixtures.
2. **Edit-format benchmark**: aider's harness shape (pristine corpus,
   two-attempt loop with test feedback, re-copied test files, scrubbed output)
   over the four-arm format matrix, reporting `pass_rate_1/2`,
   `parse_error_rate`, `apply_error_rate`, tokens, wall-clock.
3. **Multi-turn tool-calling eval** (BFCL-style) — closes the gap between the
   bitter-lesson results (open 7–8B dLLMs) and Mercury 2 specifically, before
   the loop architecture is frozen.
4. **Code-mode-vs-direct arm** on the same tasks.
5. LangSmith wiring: every eval run is a traced session; datasets curate from
   traces.

Test doubles come from Effect's own patterns: the deterministic `LanguageModel`
double for loop logic; a fake `HttpClient` under the real provider layer for
golden-transcript replay; `it.layer` block isolation for suite-level services.
Cross-SDK interop tests run our client against the reference go/python servers
(the spec's own SDKs shipped a mutually-incompatible `DiscoverResult` once; pin
against final schemas and test against implementations).

---

## 7. Permissions

- **Policy engine first**: a declarative rule set evaluated to a three-way ADT
  (`Allow | Deny | AskUser`) before any tool-level confirmation logic runs. Tier
  dominance is structural (`tier + priority/1000`, priority capped). Mandatory
  narrowing for sensitive tools — a wildcard grant on `bash`/`edit` without a
  pattern is skipped with a warning. Safety checkers run after the decision and
  fail closed.
- **Suspension**: `Deferred` in a pending map with scope finalizers (a dying
  session fails outstanding asks; no hung tools). `ask` (non-blocking verdict)
  split from `assert` (blocking), interruption masked only around the await.
- **Bash**: tree-sitter parsed; every command in pipes/`&&`/subshells is
  extracted. The ask shows literal text; "always allow" stores an
  arity-generalized prefix (`git commit -m foo` grants `git commit *`). Approval
  keys are canonicalized (`bash -lc "ls"` ≡ `ls`).
- **Persistence**: saved allows in SQLite per-project; config `deny` always wins
  over saved allows. Extension/server management is always-ask.
- **MCP integration**: MRTR elicitation renders through this same system;
  unannotated tools are treated as destructive and open-world; a `deny *` hides
  the tool from the model entirely.

---

## 8. Risks and probes

Per `probe-before-building`: these run as throwaway scripts against the live API
before the affected component is designed further. P1–P6 block M0 exit.

| #   | Probe                                                                                                                                                                              | Blocks                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| P1  | TTFT and throughput on agent-shaped calls (long cached input, tool schemas attached, short output) at each `reasoning_effort` — resolves the 1.7s-vs-12.7s published contradiction | loop shape, UX        |
| P2  | Does the stream terminate with `data: [DONE]`? (Effect's finish event depends on it)                                                                                               | streaming path        |
| P3  | Streaming tool-call fragment shape (OpenAI-style? `name: null` fragments?)                                                                                                         | provider client       |
| P4  | `strictJsonSchema: false` round trip for tool params and structured output                                                                                                         | tool dispatch         |
| P5  | Tool-calling reliability: ~20 forced calls against a moderately complex schema; malformed-rate                                                                                     | division of labor     |
| P6  | Do Mercury 2 FIM/Edit endpoints exist (dllm-agent used Mercury-1-era ones)?                                                                                                        | fifth edit-format arm |
| P7  | LangSmith OTLP ingestion renders `gen_ai.*` spans as LLM runs                                                                                                                      | tracing layer         |
| P8  | Bounded PubSub backpressure end-to-end through `Stream.tap`; `replay` capturing pre-subscription events; stdout backpressure throttling upstream                                   | event bus, renderer   |

Standing risks:

- **Effect 4 is beta.** Pin exact versions; budget for carrying patches; treat
  any v3 API recollection as wrong until grepped.
- **Tau2-class orchestration risk** is the central bet. Mitigations are the
  architecture itself (§2, §3.3, §3.4); the BFCL-style eval (§6.3) is the
  early-warning instrument.
- **Clean-break reach**: v1 talks only to 2026-07-28 servers — today that is
  mostly servers we run ourselves. Accepted; `auto` negotiation is the roadmap
  answer.
- **Single-vendor dependence on Inception.** Hedge: DiffusionGemma (Apache-2.0,
  same generation profile) can run the diffusion-specific eval arms locally
  behind the same interface.
- **`requestState` size** is an unspecified client-side DoS surface — we impose
  our own ceiling and never log the value.

---

## 9. Sequencing

| Milestone                 | Contents                                                                                                                                         | Exit criterion                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **M0 Probe**              | P1–P6 scripts, results committed as fixtures                                                                                                     | probe report merged; design deltas applied              |
| **M1 Eval spine**         | `packages/evals`: harness, edit-format matrix, multi-turn tool eval, LangSmith wiring                                                            | edit format and code-mode default chosen from data      |
| **M2 Walking skeleton**   | deterministic loop over `disableToolCallResolution`; built-ins as in-process MCP server; event log; OTLP spans from first turn; minimal renderer | end-to-end task on a real repo, fully traced            |
| **M3 Permissions + MRTR** | policy engine, elicitation (form+url), durable steering, compaction                                                                              | **daily-drivable: v1**                                  |
| **M4 Tool factory**       | factory server, Tasks runtime on the SDK, subscriptions loop, append-only registration                                                           | agent builds, registers, and uses a tool in one session |
| **M5 Full flex + SDK**    | remaining checklist behaviors (completions UX, annotations routing, resource templates), `HttpApi` contract + generated SDK                      | checklist audit green; SDK consumer example             |

Each milestone gets its own implementation plan; this document is the shared
design they implement against.
