# Effect v4 as an Agent Runtime — Source Investigation

**Subject:** `references/effect` @ `f4151e1` (2026-08-02),
`effect@4.0.0-beta.102` **Date:** 2026-08-02 **Purpose:** Map Effect's actual
primitives onto the design of an Effect-native, MCP-native CLI coding agent
powered by Inception Mercury 2 (OpenAI-compatible endpoint).

All paths are relative to `references/effect/` unless absolute. Absolute root:
`/Users/b.c.nims/dev/kastalien-research/effect-stuff/effect-mcp-sdk/mcp-effect-sdk/references/effect`

**Method note.** Eight parallel investigations read the source directly. Two of
them (concurrency, schema) additionally installed `effect@4.0.0-beta.102` and
executed probes; their behavioral claims are measured. The rest are
source-derived and are marked where a claim is inferred from types rather than
observed. The orchestrator independently re-verified the highest-leverage claims
(MCP protocol version, absence of an MCP client, MCP transports, `apiUrl`
override, `ExecutionPlan.make` / `Effect.withExecutionPlan`, `Effect.raceAll`)
by direct grep before publishing.

---

## 0. The headline: this is not the Effect you remember

Two structural facts reshape the entire design surface.

**Effect v4 is a monolith.** `@effect/cli`, `@effect/ai`, `@effect/schema`,
`@effect/opentelemetry`'s OTLP path, `@effect/experimental` — all folded into
the single `effect` package under `src/unstable/`. The subtree list
(`packages/effect/src/unstable/`):

```
ai  cli  cluster  devtools  encoding  eventlog  http  httpapi
observability  persistence  process  reactivity  rpc  schema  socket  sql  workers  workflow
```

Only provider adapters and platform bindings remain separate packages:
`packages/ai/{openai,openai-compat,anthropic,openrouter}`,
`packages/platform-node`, `packages/opentelemetry`, `packages/vitest`,
`packages/sql/*`, `packages/atom/*`.

**Effect already ships most of the agent.** `effect/unstable/ai` contains a
provider-agnostic `LanguageModel`, a schema-driven `Tool`/`Toolkit` system,
`Chat` with persistence, GenAI OpenTelemetry conventions, and a complete MCP
**server**. `effect/unstable/cli` is a full CLI framework with 13 interactive
prompts. `ExecutionPlan` is a first-class model-escalation primitive. The honest
framing of this project is therefore _not_ "build an agent runtime on Effect"
but "**assemble** an agent from Effect's parts, and build the four things it's
missing" (§9).

A `migration/v3-to-v4.md` exists in-tree and is authoritative on renames. It is
long (15k+ lines) but greppable, and it caught several errors the investigations
would otherwise have made from memory. **Treat any v3 recollection as wrong
until grepped.**

---

## 1. Fiber supervision & structured concurrency — parallel candidate rollouts

### 1.1 `Supervisor` is gone

`rg -n "Supervisor" packages/effect/src` → **zero matches**. Per
`migration/v3-to-v4.md:742` ("`effect/Supervisor`: No single module
replacement") and `:15248` ("Ambient fiber supervision was removed; use
structured concurrency or explicit FiberSet and FiberMap tracking"),
`Effect.supervised` → `FiberSet` (`:9752`).

Other removals that will bite: `Effect.either` → `Effect.result`
(`Effect.ts:2215`), `Effect.fork` → `forkChild` (`:8439`), `forkDaemon` →
`forkDetach` (`:8565`), `withFiberRuntime` → `Effect.withFiber` (`:1746`),
`Effect.withConcurrency` (ambient concurrency) removed entirely,
`Effect.validateAll` / `validateFirst` / `raceWith` gone.

### 1.2 `raceAll` is the primitive — not `Effect.all`

The critical distinction for best-of-N: **`Effect.all` short-circuits on first
_error_; `raceAll` waits for first _success_.**

| API                                              | Line in `Effect.ts` | Semantics                                                               |
| ------------------------------------------------ | ------------------- | ----------------------------------------------------------------------- |
| `all(arg, {concurrency, discard, mode})`         | 494                 | fails on first failure                                                  |
| `forEach(self, f, {concurrency, discard})`       | 779                 | **no `mode` option**; short-circuits on error                           |
| `validate(elements, f, {concurrency})`           | 623                 | runs all, accumulates `NonEmptyArray<E>`                                |
| `partition(elements, f, {concurrency})`          | 535                 | `[failures, successes]`, never fails                                    |
| `firstSuccessOf(effects)`                        | 4413                | **sequential** fallback chain, not a race                               |
| **`raceAll(all, {onWinner?})`**                  | **4678**            | **first success wins; failures don't end the race; losers interrupted** |
| `raceAllFirst`                                   | 4714                | first _settled_ wins (success or failure)                               |
| `race` / `raceFirst`                             | 4754 / 4811         | 2-ary sugar over `raceAll`                                              |
| `acquireRelease(acq, release, {interruptible?})` | 6496                | **`release` receives the `Exit`**                                       |
| `abortSignal: Effect<AbortSignal, never, Scope>` | 7351                | scope-managed AbortSignal for `spawn`/`fetch`                           |

`raceAll` explicitly ignores early failures (JSDoc `:4655-4660`). Pinned by the
library's own test, `packages/effect/test/Effect.test.ts:988-1005`: five
candidates, one fails immediately, `raceAll` returns the first _success_ (`100`)
and `interrupted` deep-equals `[500, 300, 200]`.

### 1.3 Cleanup on interruption is guaranteed and _awaited_

`internal/effect.ts:1461-1516` (verified byte-identical in the shipped
`dist/internal/effect.js`). On a winner:

```js
resume(
  fibers.size === 0
    ? exit
    : flatMap(uninterruptible(fiberInterruptAll(fibers)), () => exit)
)
```

and `fiberInterruptAll` (`internal/effect.ts:881-892`) ends in
`asVoid(fiberAwaitAll(fiberArr))`. **The winner's value is not delivered until
every loser has been interrupted and every loser finalizer has completed.**
Measured with a deliberately slow 150 ms loser finalizer:

```
   1ms acquire 1
   2ms acquire 2
 173ms RELEASED 2      <- winner's own scope
 324ms RELEASED 1      <- loser's slow finalizer completes
 324ms raceAll returned winner=2
```

This is exactly the property the rollout design needs: git worktrees and child
processes are reliably reaped before the harness proceeds.

### 1.4 Supervision modules (the `Supervisor` replacement)

- `FiberSet.ts:1-8` — "Manages many fibers together inside one scope" → the
  rollout supervisor.
- `FiberMap.ts:1-8` — same, keyed by `K` (start/replace/interrupt by rollout
  id).
- `FiberHandle.ts:1-9` — at most one fiber; setting a new one interrupts the old
  (restart-current-attempt).
- `Semaphore.make(n)` (`Semaphore.ts:353`) — concurrency bounding.
- `PartitionedSemaphore.ts:1-7` — shared permits with per-key fairness.
- `Pool.ts` — shares _scoped resources_, not a work scheduler. Do **not** use it
  to bound rollout concurrency.

### 1.5 The idiomatic shape (typechecks clean under strict; semantics measured)

```ts
import {
  Data,
  Deferred,
  Effect,
  Exit,
  FiberSet,
  Scope,
  Semaphore
} from "effect"

class VerifyFailed extends Data.TaggedError("VerifyFailed")<{
  readonly candidate: number
  readonly detail: string
}> {}

// (e) per-rollout resources. `release` receives the Exit, so the WINNER's worktree
//     survives and every loser's is deleted. Child process is always killed.
const rolloutScoped = (
  i: number
): Effect.Effect<Verified, VerifyFailed, Scope.Scope> =>
  Effect.gen(function* () {
    const wt = yield* Effect.acquireRelease(mkWorktree(i), (path, exit) =>
      Exit.isSuccess(exit) ? Effect.void : rmWorktree(path)
    )
    yield* Effect.acquireRelease(spawnAgent(wt), (proc) => killAgent(proc))
    return yield* verify(yield* sample(i, wt)) // (b) verification inside the rollout
  })

const rollout = (i: number) => Effect.scoped(rolloutScoped(i))

// (a)+(c) bounded fan-out; FIRST candidate that verifies wins; rest interrupted.
const firstVerified = (n: number, concurrency: number) =>
  Effect.gen(function* () {
    const gate = yield* Semaphore.make(concurrency)
    return yield* Effect.raceAll(
      Array.from({ length: n }, (_, i) => gate.withPermits(1)(rollout(i)))
    )
  })

// (d) run all to completion, pick BEST by score. `Effect.exit` defeats short-circuiting.
const bestOfN = (n: number, concurrency: number) =>
  Effect.gen(function* () {
    const exits = yield* Effect.forEach(
      Array.from({ length: n }, (_, i) => i),
      (i) => Effect.exit(rollout(i)),
      { concurrency }
    )
    const ok = exits.filter(Exit.isSuccess).map((e) => e.value)
    const head = ok[0]
    if (head === undefined)
      return yield* new VerifyFailed({ candidate: -1, detail: "none verified" })
    return ok.reduce((a, b) => (b.score > a.score ? b : a), head)
  })

// (d') same, keeping diagnostics — never fails
const bestOfNPartition = (n: number, c: number) =>
  Effect.partition(
    Array.from({ length: n }, (_, i) => i),
    rollout,
    { concurrency: c }
  )
```

**`Semaphore` + `raceAll` is the key trick.** `raceAll` forks all N fibers
immediately (`internal/effect.ts:1504-1512`) and has no concurrency option of
its own; gating each candidate on `sem.withPermits(1)` gives bounded concurrency
_and_ early cancellation. Candidates still queued on the permit are interrupted
**before doing any work** — measured with `n=4, concurrency=2`: candidates 3 and
4 never created a worktree or spawned a process. `withPermits` is interrupt-safe
(`Semaphore.ts:286-302`).

Measured end-to-end (candidate 1 fails verification, 2 passes, 3–4 slow):

```
winner dir: wt-2
    KILL proc-1 / RM wt-1 (failed)
    KILL proc-2 / KEEP wt-2
    KILL proc-3 / RM wt-3 (interrupted)
dirs surviving on disk: [ 'wt-2' ]
```

### 1.6 Concurrency gotchas (measured)

1. **`onWinner` fires _after_ the race's continuation has already run** (3/3
   reproductions). `internal/effect.ts:1494-1501` calls `resume(...)` and only
   then `options.onWinner(...)`; `resume` can drive the parent fiber
   synchronously. **Never use `onWinner` to identify the winner** — return the
   identity in the candidate's own success value.
2. **`raceAll` on an empty iterable never resumes.** Guard `n > 0`.
   (`firstSuccessOf` defects with an explicit message; `raceAll` has no such
   guard.)
3. **`Effect.forEach` has no `mode: "result"`** — only `Effect.all` does. Use
   `Effect.exit` per item, or `partition`/`validate`.
4. **`Cause.hasInterrupt` does not exist** — it is `Cause.hasInterrupts`
   (`Cause.ts:938`) and `Cause.hasInterruptsOnly` (`:624`). Distinguishing
   "loser interrupted" from "verification failed" inside a finalizer needs
   `Cause.hasInterrupts(exit.cause)`.
5. **A throwing finalizer is silently swallowed** — observed: the `rmSync`
   before the throw ran, the log after it didn't, and the program still reported
   success. Keep finalizers total.
6. **`FiberSet` propagates a member's non-interrupt failure** into the set's
   `Deferred` (`FiberSet.ts:334-349`) — `catchCause` per member, or one failed
   rollout tears down the set.
7. Pass `Effect.abortSignal` (`:7351`) into `spawn`/`fetch` so OS-level
   cancellation rides on the scope rather than depending on a finalizer alone.

---

## 2. Services & Layers — the harness

### 2.1 Service declaration: `Context.Service`

`Context.Tag` and `Effect.Service` are **both gone**
(`migration/v3-to-v4.md:9170`, `:9466`). V4 has one idiom (`Context.ts:203-267`,
JSDoc `:185-187`):

```ts
class Config extends Context.Service<Config, { port: number }>()("Config") {}
```

The class value **is** the key and **is** an `Effect<Shape, never, Self>`
(`Context.ts:65-71`), so `yield* MyService` works directly. Helpers on
`ServiceProto` (`:269-299`): `.of(shape)`, `.context(shape)`, `.use(f)`,
`.useSync(f)`.

An optional `make` option exists, but **v4 no longer generates a `.Default`
layer or wires `dependencies`** (`migration:9466`). The in-repo idiom is a
static layer on the class (`ManagedRuntime.ts:257-265`,
`test/ExecutionPlan.test.ts:6-25`):

```ts
class Service extends Context.Service<Service>()("Service", {
  make: Effect.succeed({ ... })
}) {
  static A = Layer.effect(this, this.make)
  static B = Layer.succeed(Service, Service.of({ ... }))
}
```

`Context.Reference` (`:334-339`, ctor `:1325`) is a key with a lazily-computed
default — available without provision. This is how `ConfigProvider` works, and
it is the pattern to copy for defaulted knobs (verbosity, dry-run, max-turns).

### 2.2 `Layer.scoped` does not exist

`Layer.effect` absorbed it — `Scope` is stripped from the requirement channel
(`Layer.ts:1012-1019`, impl `:1073`
`fromBuildMemo((_, scope) => Scope.provide(effect, scope))`). An
`Effect.acquireRelease` inside `Layer.effect` is released when the layer scope
closes.

Combinator inventory (`Layer.ts`): `succeed` 805, `sync` 924, `effect` 1012,
`effectDiscard` 1104, `suspend` 1135, `unwrap` 1172, `mergeAll` 1244 (**built
concurrently**), `merge` 1297, `provide` 1430, `provideMerge` 1548 (both accept
a layer _or a tuple_), `flatMap` 1660, `tap`/`tapError`/`tapCause`
1699/1738/1778, `orDie` 1844, `catchTag` 1918, `catchCause` 2024,
`updateService` 2061, `fresh` 2158, `launch` 2205, **`mock` 2302**,
`span`/`withSpan` 2530/2651.

### 2.3 Memoization — how N rollouts share one HTTP client

This is the load-bearing mechanic and it is subtle.

**Memoization is keyed on `Layer` object identity**, in a `MemoMap`
(`Layer.ts:421-456`), with reference counting (`:241-250`, released at 0
observers `:401-409`). MemoMaps have parents and `get` falls through
(`:434-443`).

**`Effect.provide` shares by default; `{ local: true }` forks a fresh root map**
(`internal/layer.ts:8-22`):

```ts
options?.local
  ? Layer.buildWithMemoMap(layer, Layer.makeMemoMapUnsafe(), scope) // fresh ROOT map
  : Layer.buildWithScope(layer, scope) // forks ambient map
```

`Effect.ts:5757-5759` states it plainly: _"by default, layers are shared between
provide calls."_

Consequences:

- Build `HttpClientLive` / `ModelClientLive` once at the app boundary. Inside
  `Effect.forEach(rollouts, …, {concurrency: N})`, each rollout's
  `Effect.provide` resolves the HTTP client to the **single memoized instance**
  — _provided it is the same `Layer` value_ (module-level `const`, not a factory
  call per rollout). This is the single easiest thing to get wrong.
- For a genuinely per-rollout instance:
  `Effect.provide(eff, layer, { local: true })` or `Layer.fresh(layer)`
  (`:2158`). The `fresh` JSDoc (`:2126-2152`) is an executable demo.

### 2.4 `LayerMap` / `LayerRef`

- **`LayerMap`** (`LayerMap.ts`, 489 lines) — keyed scoped service families.
  `get(key): Layer`, `contextEffect(key)`, `invalidate(key)`, backed by
  `RcMap` + a **forked** memo map (`:165`), so keyed layers still reuse ambient
  shared deps. Options: `idleTimeToLive` (a duration **or a function of the
  key**), `preloadKeys`. Also `fromRecord` (`:242`) and
  `LayerMap.Service<Self>()(...)` (`:370-436`) generating
  `.layer`/`.get`/`.invalidate`. → **Right tool for one `LanguageModel` per
  `(provider, model)` pair, or per rollout.** Behavior pinned by
  `test/LayerMap.test.ts:19-108`.
- **`LayerRef`** (`LayerRef.ts`, `@since 4.0.0`) — the unkeyed counterpart:
  `get`, `invalidate`, `refresh`, plus `invalidationSchedule` (`:136-150`). →
  **Right tool for "rotate the API key / reconnect the model client mid-run"**
  without process restart. Documented caveat (`:88-91`): _"Invalidation does not
  revoke contexts already borrowed by active scopes."_

### 2.5 `ManagedRuntime` for the CLI process

`ManagedRuntime.make(layer, { memoMap? })` (`:285-296`). Interface `:112-228`:
`runFork`, `runSync`, `runPromise`, `runPromiseExit`, `dispose()`,
`[Symbol.asyncDispose]`, plus `memoMap` and `contextEffect`. Layer is built
lazily on first use and cached; a runtime cannot be reused after disposal. Its
exposed `memoMap` can be handed to `it.layer({ memoMap })` in tests.

### 2.6 Config is Schema-backed; `ConfigProvider` needs no provision

`Config<T> extends Effect<T, ConfigError>` (`Config.ts:107-110`) — yieldable in
`Effect.gen`, resolving the ambient provider automatically. Core constructor
`:854`: `schema<T>(codec: Schema.ConstraintCodec<T, unknown>, path?)`.
Everything else is a one-liner over it: `string` 1127, `nonEmptyString` 1148,
`number`/`finite`/`int` 1170/1191/1212, `boolean` 1313, `duration` 1355, `port`
1394, **`redacted` 1475**, `url` 1517, `Record` 995. Combinators: `map` 249,
`orElse` 339, `all` 397, `withDefault` 505, `option` 549, `nested` 1605.

`ConfigProvider` is a **`Context.Reference` defaulting to `fromEnv()`**
(`ConfigProvider.ts:341-344`) — nothing to provide in production. `fromEnv` path
semantics (`:840-852`): segments joined with `_`, names also split on `_` into a
trie, so `DATABASE_HOST` resolves at `["DATABASE_HOST"]` _and_
`["DATABASE","HOST"]`. Constructors: `fromUnknown` 779, `fromEnv` 888,
`fromDotEnv` 1163, `fromDir` 1234; `layer` 666, `layerAdd` 712 (compose rather
than replace, `{ asPrimary }`).

`Redacted` (`Redacted.ts`): `make` 187, `value` 245, `wipeUnsafe` 283.
`String(redacted)` → `"<redacted>"` across string, JSON, and inspection. The
HTTP layer unwraps only at the header boundary
(`packages/ai/openai-compat/src/OpenAiClient.ts:144-158`) and extends
`Headers.CurrentRedactedNames` so headers stay redacted in logs _and traces_
(`:106-109`).

**Gotcha on `withDefault`** (`Config.ts:479-485`): the default applies only when
the schema rejects `undefined` _and no relevant input was found_; validation
errors on partially-supplied groups still propagate.

### 2.7 The evals story: `@effect/vitest`

⚠️ **The README is stale.** It documents `it.scoped`/`it.scopedLive`, which **do
not exist** in v4. Per `migration/annotations/effect__vitest__index.yaml:1-6`:
_"V4 effect tests are scoped and provide the test environment. Replace
`it.scoped(...)` with `it.effect(...)`."_ The README also imports `TestClock`
from `"effect"`; the real path is **`effect/testing/TestClock`**.

Real API (`packages/vitest/src/index.ts`): `it` (`:248`), standalone `effect`
169, `live` 174, `layer` 216, `flakyTest` 231, `prop` 239, `describeWrapped`
258; `export * from "vitest"` (`:16`). `Tester<R>` (`:55-95`) gives
`.skip/.skipIf/.runIf/.only/.each/.fails/.prop` — and `.prop` accepts a
`Schema.Schema` directly as an arbitrary.

```ts
readonly layer: <R2, E>(layer: Layer.Layer<R2, E, R>, options?: {
  readonly memoMap?: Layer.MemoMap
  readonly timeout?: Duration.Input
  readonly excludeTestServices?: boolean
}) => { (f: (it: MethodsNonLive<R | R2>) => void): void
        (name: string, f: (it: MethodsNonLive<R | R2>) => void): void }
```

Mechanics (`packages/vitest/src/internal/internal.ts`):
`TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())` (`:44`);
`it.effect = makeTester(flow(Effect.scoped, Effect.provide(TestEnv)))` (`:356`);
`it.live = makeTester(Effect.scoped)` (`:357`). `layer(...)` builds **once** per
block (`:241-247`) into a scope closed in `afterAll`; nested `it.layer`
re-enters with `Layer.forkMemoMapUnsafe` (`:275`).

**The isolation guarantee an evals harness needs is pinned by a real test** —
`packages/vitest/test/isolation.test.ts:56-104` runs three sibling
`it.layer(inMemoryLayer)` blocks and asserts `observedStateIds === [1, 2, 3]` in
`afterAll`. Within a block the instance is shared; across sibling blocks it is
rebuilt fresh.

Test services: `TestClock.layer()` `:411`, `adjust` `:482`, `setTime` `:519`;
`TestConsole.layer` `:294`, `logLines` `:330`. Typed assertions in
`@effect/vitest/utils`: `deepStrictEqual` 41, `assertSuccess`/`assertFailure`
269/283, `assertExitSuccess`/`assertExitFailure` 315/301.

### 2.8 Three test-double patterns already in-tree

**(a) `Layer.mock`** (`Layer.ts:2302-2350`) — partial service;
`PartialEffectful<S>` (`:2228`) makes Effect/Stream/Channel members optional and
keeps plain data required. Unimplemented members are a Proxy that behaves as an
Effect/Stream/Channel _or_ a function returning one, all dying with
`UnimplementedError`. Exercised at `test/Layer.test.ts:367-449`.

**(b) A deterministic LanguageModel double already exists** —
`packages/effect/test/unstable/ai/utils.ts:6-68` defines `withLanguageModel`,
accepting an array, a function, or an Effect/Stream for
`generateText`/`streamText`. Used throughout
`test/unstable/ai/LanguageModel.test.ts`. **Copy this file's shape wholesale for
the eval harness.**

**(c) Swap the HTTP client, keep the real provider code** —
`packages/ai/openai-compat/test/OpenAiLanguageModel.test.ts:14-48` provides a
fake `HttpClient.HttpClient` under the real `OpenAiClient.layer`.
Highest-fidelity double: real request encoding and response decoding, fully
deterministic → golden-transcript replay for free.

---

## 3. Stream — token streaming, event bus, backpressure

### 3.1 v4 Stream is a Channel of _arrays_; `Chunk` is out of the stream path

`Stream.ts:122`:

```ts
export interface Stream<out A, out E = never, out R = never>
  extends Variance<A, E, R>,
    Pipeable {
  readonly channel: Channel.Channel<
    Arr.NonEmptyReadonlyArray<A>,
    E,
    void,
    unknown,
    unknown,
    unknown,
    R
  >
}
```

`Pull` (`Pull.ts:40`) is the new bottom layer — a pull step is an `Effect` that
signals end-of-stream **in the error channel** as `Cause.Done`. `Take`
(`Take.ts:30`) is now a bare union (`NonEmptyReadonlyArray<A> | Exit<Done, E>`),
no wrapper class.

Practical consequences: chunk boundaries survive from the SSE decoder downward
unless you rechunk/buffer; custom operators are cheap via `Stream.fromPull`
(554) / `transformPull` (576) / `pipeThroughChannel` (8799) — the library writes
`debounce` (7586) and `aggregateWithin` (8389) this way. `Streamable.Class` is
gone (use `Stream.suspend`). `Stream.async`/`asyncPush`/
`asyncScoped`/`asyncEffect` **all collapsed into `Stream.callback`** (`:694`).

### 3.2 The streaming call shape (openai-compat)

Raw client — `packages/ai/openai-compat/src/OpenAiClient.ts:48-56`:

```ts
readonly createResponseStream: (options: Omit<CreateResponseRequestJson, "stream" | "stream_options">) =>
  Effect.Effect<
    [response: HttpClientResponse.HttpClientResponse, stream: Stream.Stream<CreateResponse200Sse, AiError.AiError>],
    AiError.AiError
  >
```

Not a bare `Stream` — an `Effect` yielding a **tuple**, so you get
status/headers before consuming the body. Element type (`:1221`):
`ChatCompletionStreamEvent = ChatCompletionChunk | UnknownChatCompletionEvent | "[DONE]"`.
The literal `"[DONE]"` **is emitted as the last element** — use `takeUntil`, not
`takeWhile`.

Pipeline (`:205-226`): `Stream.decodeText()` →
`Stream.pipeThroughChannel(Sse.decode())` → `flatMap(parse)` →
`takeUntil(e => e === "[DONE]")` → `catchTags`.

**SSE parsing lives in core**, not the AI package:
`effect/unstable/encoding/Sse.ts` (675 lines), `decode()` at `:102-109`, plus
`decodeSchema` (175) and `decodeDataSchema` (209). Own line splitting;
`maxEventSize` defaults to 10 MiB.

The layer you actually want — `LanguageModel.streamText`
(`LanguageModel.ts:158`, `:1792`) — returns
`Stream<Response.StreamPart<Tools>, ...>`. **The discriminant is `type`, not
`_tag`.** 18 variants (`Response.ts:305-323`): `text-start/delta/end`,
`reasoning-*`, `tool-params-*`, `tool-call`, `tool-result`,
`tool-approval-request`, `file`, `source`, `response-metadata`, `finish`,
`error`. `TextDeltaPart` carries `{ id, delta }` (`:693-702`).

Canonical consumption, from the repo's own runnable docs
(`ai-docs/src/71_ai/10_language-model.ts:124-133`):

```ts
LanguageModel.streamText({ prompt }).pipe(
  Stream.filter(
    (part): part is Response.TextDeltaPart => part.type === "text-delta"
  ),
  Stream.map((part) => part.delta),
  Stream.provide(launchPlanModel)
)
```

`streamText` opens `Effect.makeSpanScoped` internally but is wrapped in
`Stream.unwrap`, so **the returned Stream does not require `Scope` in `R`.**

**Robustness gotchas in the compat client:** malformed JSON is _silently
dropped_ (`:1223-1229` returns `undefined`, flatMap emits empty);
schema-mismatched-but-valid JSON becomes `UnknownChatCompletionEvent` and passes
through, then is dropped by the LanguageModel layer; an SSE `retry:` directive
becomes a **defect** via `Stream.die`; the pipeline ends in `as any` (`:224`) so
error elimination is _asserted_, not typed. **Most important: if a provider
never sends `data: [DONE]`, no `finish` part is ever emitted** — the entire
end-of-stream flush is keyed off it (`OpenAiLanguageModel.ts:1166-1221`). Worth
probing against Mercury on day one.

### 3.3 Event bus: `PubSub.bounded` is the only primitive with real backpressure

| ctor               | line | strategy              | behavior                                |
| ------------------ | ---- | --------------------- | --------------------------------------- |
| `PubSub.bounded`   | 334  | BackPressure          | **publisher suspends**                  |
| `PubSub.dropping`  | 381  | Dropping              | `publish` returns `false`, message lost |
| `PubSub.sliding`   | 427  | Sliding               | oldest evicted                          |
| `PubSub.unbounded` | 467  | Dropping (never full) | never drops, never blocks               |

`BackPressureStrategy.handleSurplus` (`:2357+`) parks the value with a
`Deferred` completed only by `onPubSubEmptySpaceUnsafe`, which runs **when a
subscriber consumes**. So a bounded PubSub gives genuine end-to-end backpressure
— and the **slowest subscriber throttles the publisher**. That is right for the
render path and wrong for the log sink.

⚠️ **The trap: publishing with zero subscribers silently discards.**
`BoundedPubSubArb.publish` (`PubSub.ts:1537-1553`) stores the value only
`if (this.subscriberCount !== 0)` — **and returns `true` regardless**. Same in
the unbounded impl (`:1925-1942`) and `publishAll` (`:1555`). Every agent event
emitted before the TUI/tracer/log-sink subscribe is gone. Mitigation: the
`replay: n` option, threaded through every constructor; the replay buffer is
written _before_ the subscriber check, so replay does capture pre-subscription
events.

`Stream.broadcast` (`:8637`) is literally
`Effect.map(toPubSubTake(self, options), fromPubSubTake)`. `broadcastN`
(`:8520`) returns a fixed tuple. `share` (`:8718`) is
`RcRef.make({acquire: broadcast, idleTimeToLive})` — reference-counted
multicast, right when consumers come and go. `makePubSub` (`:8600-8620`):
`strategy: "suspend"` (or omitted) → `PubSub.bounded`. Removed in v4:
`broadcastDynamic`, `broadcastedQueues*`, `distributedWith*`.

`SubscriptionRef` (`:37`, `make` at `:111`) is `PubSub.unbounded({replay: 1})` +
a semaphore — writers never block and never drop; new subscribers immediately
get the latest value. **Use it for TUI view-model state (spinner, token count,
active tool), never for the event log.**

### 3.4 Rendering without blocking the model fiber

`Stdio` (`Stdio.ts:63`) exposes `stdout(opts?)`/`stderr(opts?)` as **Sinks** and
`stdin` as a Stream. The Node impl honors `drain`: `NodeSink.pullIntoWritable`
(`platform-node-shared/src/NodeSink.ts:76-95`) parks the fiber via
`writable.once("drain", ...)` when `write()` returns `false`. **That
backpressure propagates straight up the Channel into the HTTP body pull,
throttling the model fiber.** This is the exact failure mode to design against.

Decoupling levers:

1. **`Stream.buffer` capacity is in ELEMENTS; `Stream.bufferArray` capacity is
   in CHUNKS.** The delegation looks inverted but is correct: `Stream.buffer`
   (4569) → `Channel.bufferArray` (6972) which flattens arrays into a queue of
   elements; `Stream.bufferArray` (4621) → `Channel.buffer` (6906) which queues
   whole arrays and preserves chunking. Both take
   `{capacity, strategy?: "dropping"|"sliding"|"suspend"}`, default `"suspend"`.
2. **`Stream.groupedWithin(chunkSize, duration)`** (`:7958`) — the single
   highest-leverage combinator for a 1000 tok/s stream. One
   `process.stdout.write` per ~16 ms frame instead of ~16 writes. Implemented as
   `aggregateWithin(self, Sink.take(n), Schedule.spaced(d))`.
3. **`Stream.throttle`** (`:7865`):
   `{cost, units, duration, burst?, strategy: "enforce"|"shape"}` — `"shape"`
   delays (backpressures), `"enforce"` drops. `Stream.debounce` (7586) keeps
   only the latest — right for a status line, wrong for tokens.
4. **Full decoupling:** `Stream.toQueue(stream, {capacity, strategy})`
   (`:11393`) + a forked render fiber on `Stream.fromQueue` (`:1132`).
5. **`Stream.tap` runs INLINE — it is not a fork** (`:2011-2036`,
   `tap = mapEffect(...)`). Publishing into a PubSub from a tap is fine (cheap);
   writing to stdout from a tap is what blocks the model fiber.
6. `Stream.mergeAll` (`:3154`) defaults `bufferSize = 16` and allocates
   `Queue.bounded` (`Channel.ts:6157`) — merging is backpressured with a
   16-element window per merge point.

### 3.5 Recommended shape

```
OpenAiClient.layer({...}) ⟵ FetchHttpClient.layer
  └─ OpenAiLanguageModel.layer({model}) ⟶ LanguageModel

LanguageModel.streamText({prompt, toolkit})
  ├─ Stream.tap(part => PubSub.publish(bus, toAgentEvent(part)))   // bus: bounded({capacity:256, replay:64})
  └─ Stream.runDrain                                               // forked model fiber

TUI:     Stream.fromSubscription(sub) |> filter(text-delta) |> groupedWithin(256,"16 millis")
                                      |> map(join) |> Stream.run(stdio.stdout())
tracer / log sink: same, each behind Stream.buffer({capacity:1024, strategy:"dropping"})
TUI state: SubscriptionRef + .changes
```

Bus `bounded` + `replay` keeps the durable record lossless; put the _lossy_
buffer on the render branch only.

**Unverified (types only, no probe):** (a) that a bounded PubSub with one slow
subscriber actually suspends `publish` end-to-end through `Stream.tap`; (b) that
`replay: n` captures pre-subscription events; (c) that
`Stream.run(s, stdio.stdout())` visibly throttles upstream on a slow pipe. All
three are ~20-line probes. **No example in the entire repo pipes a Stream to
stdout** — the `ai-docs` streaming example stops at `Stream<string>` and never
renders it.

---

## 4. Schema — tool I/O, JSON Schema, codecs

### 4.1 JSON Schema derivation

**One entry point:** `Schema.toJsonSchemaDocument(schema, options?)` (verified
by enumerating `Object.keys(Schema)`). It **always** emits draft-2020-12. Other
dialects are post-hoc conversions in `JsonSchema.ts`: `toDocumentDraft07` 556,
`toDocumentDraft04` 600, `toMultiDocumentOpenApi3_1` 807; inbound `fromSchema*`
318/424/467/509; `resolveTopLevel$ref` 1096. `Dialect` (`:57`) =
`"draft-04"|"draft-07"|"draft-2020-12"| "openapi-3.1"|"openapi-3.0"`.

⚠️ **`SCHEMA.md` is wrong at line 5138**: it shows the document key as
`"source"`. The actual runtime key is **`dialect`** (verified output; the doc
contradicts itself at `:5262`). Anything keying off `document.source` silently
gets `undefined`.

Options (`ToJsonSchemaOptions`, `Schema.ts:14816`) — only three knobs:
`additionalProperties` (default `false`), `generateDescriptions` (synthesizes
`description` from each check's `expected`), `includeAnnotationKey` (whitelist
for `x-*`; the docs warn against `() => true`).

Three things to internalize from verified output:

1. **Checks land in `allOf`, not inline.** `Schema.isMinLength(1)` →
   `allOf: [{minLength: 1}]`. Many consumers (notably OpenAI strict mode) reject
   `allOf` — hence the provider rewriters.
2. **`optionalKey` vs `optional` differ materially.** `optionalKey(Int)` →
   simply absent from `required`. `optional(Boolean)` → absent from `required`
   **and** `anyOf: [T, null]`, because `Schema.optional` means `T | undefined`.
   **For tool parameters you almost always want `optionalKey`.**
3. **Brands are erased** — a branded `FilePath` is just `{"type":"string"}` plus
   the check.

Nothing throws for exotic types — they route through the JSON canonical codec:
`Symbol` → `{"type":"string","allOf":[{"pattern":"^Symbol\\((.*)\\)$"}]}`,
`BigInt` → string with a digit pattern, `Date` → `{"type":"string"}`,
`Uint8Array` → `{"type":"string","format":"byte","contentEncoding":"base64"}`,
`Unknown`/`Any` → `{}`, `Never` → `{"not":{}}`.

Recursion works and emits proper `$defs` — but **`$defs` live in
`document.definitions`, not inside `document.schema`**.
`Tool.getJsonSchemaFromSchemaWith` (`Tool.ts:1690-1694`) merges them back
manually.

### 4.2 Decode API and error formatting

`decodeUnknownEffect` **does** exist — declared with `export function`, which is
why an `^export const` grep misses it. Full surface (`Schema.ts`):
`decodeUnknownEffect` 1475, `decodeEffect` 1506, `decodeUnknownExit` 1582,
`decodeUnknownOption` 1656, `decodeUnknownResult` 1720, `decodeUnknownPromise`
1788, `decodeUnknownSync` 1867 (+ `encode*` mirrors 1967–2302). A second
lower-level tier in `SchemaParser.ts` carries `SchemaIssue.Issue` **directly**
rather than wrapped in `SchemaError`.

**`SchemaError.message` is already a pre-formatted, path-annotated multi-line
string.** No formatter call needed:

```
Expected a value with a length of at least 1, got ""
  at ["path"]
```

**Critical for repair prompts: pass `{ errors: "all" }`** — the default reports
only the first failure. Nested paths render as index chains:
`at ["files"][1]["p"]`.

**There is no tree formatter in v4** — v3's `TreeFormatter` is gone. Two
formatters (`SchemaIssue.ts`): `makeFormatterDefault()` (1099, singleton
`defaultFormatter` 1107) producing the string above, and
**`makeFormatterStandardSchemaV1()`** (992) producing
`{issues: [{message, path}]}` — **the better repair-prompt payload** because
`path` is structured. Both accept `leafHook` (858) / `checkHook` (933).
Per-schema override via a `message` annotation (`findMessage` `:1110-1139`).
`SchemaIssue.redact(issue)` (1153) strips actual values if inputs may contain
secrets.

`Formatter.ts` and `ErrorReporter.ts` are **unrelated** to schema errors
(generic value inspection and a Cause-level telemetry sink respectively).

### 4.3 OpenAI strict mode is fully handled — do not rebuild it

Two core modules: `unstable/ai/OpenAiStructuredOutput.ts` → `toCodecOpenAI`
(`:58`) and `AnthropicStructuredOutput.ts` → `toCodecAnthropic`.

```ts
export function toCodecOpenAI<T, E, RD, RE>(
  schema: Schema.ConstraintCodec<T, E, RD, RE>
): {
  codec: Schema.ConstraintCodec<T, unknown, RD, RE>
  jsonSchema: JsonSchema.JsonSchema
}
```

The design is exactly right: **the JSON Schema is deliberately lossy; the
returned codec stays authoritative.** Module doc (`:29-31`): _"the provider JSON
Schema can be a lossy, less restrictive representation when OpenAI cannot
express an Effect Schema constraint."_ Dropped constraints are still enforced at
decode time.

Verified transformation: all properties forced into `required`; optional →
nullable (`internal/structured-output.ts:278`); `additionalProperties: false`
enforced (`:90`); **`allOf` eliminated** with the constraint demoted into a
`description` the model can read (`normalizeAllOf` 129, `appendDescription`
170); `oneOf` → `anyOf` (`:44`); keyword whitelist (271) with unsupported
`format` values turned into prose; tuples → objects with numeric string keys and
index-signature objects → `[key,value]` pair arrays (133/199); throws if the
root isn't `type: "object"`. **And the round trip works** — decoding
`{path:"/a",mode:"append",count:null,tags:null}` through the returned codec
yields `{"path":"/a","mode":"append"}`; injected nulls are stripped back to
genuinely-absent keys.

The seam is `LanguageModel.CodecTransformer` (`LanguageModel.ts:211`, default
pass-through `:237`). Providers install their own:
`packages/ai/openai/src/OpenAiLanguageModel.ts:635` and
`packages/ai/openai-compat/src/OpenAiLanguageModel.ts:624`. Per-tool resolution
(`compat :1504`): `Tool.getStrictMode(tool) ?? config.strictJsonSchema ?? true`.

**One schema, three renderings:**

```ts
Tool.getJsonSchema(tool) // raw 2020-12 — correct for MCP
Tool.getJsonSchema(tool, { transformer: toCodecOpenAI }) // strict-safe for function calling
toCodecOpenAI(schema) // + the decoding codec, for structured output
```

### 4.4 Transform/codec patterns

`SchemaTransformation.transformOrFail({decode, encode})` is literally a pair of
`SchemaGetter`s (`:286-294`). Use `SchemaTransformation.*` for the common case;
drop to `SchemaGetter` when the two directions differ (e.g. `withDefault` on
decode, `passthrough` on encode).

**The failure channel must be a `SchemaIssue.Issue`, not an `Error`** —
construct with `new SchemaIssue.InvalidValue(Option.some(value), { message })`
(`SchemaIssue.ts:539-564`).

**Encoded-side annotation gotcha** (`SCHEMA.md:5241-5295`): JSON Schema derives
from the **encoded** side; `.annotate()` on a transformation annotates the
**decoded** side and will not appear in output. Use
`Schema.annotateEncoded({...})` or annotate the source before `decodeTo`.

---

## 5. Tracing — LangSmith over OTLP

### 5.1 Core ships a dependency-free OTLP exporter. You do not need the OTel JS SDK.

`unstable/observability/OtlpTracer.ts:125-141`:

```ts
export const layer: (options: {
  readonly url: string
  readonly resource?: { serviceName?; serviceVersion?; attributes? }
  readonly headers?: Headers.Input
  readonly exportInterval?: Duration.Input // default 5s
  readonly maxBatchSize?: number // default 1000
  readonly context?: <X>(primitive, span) => X
  readonly shutdownTimeout?: Duration.Input // default 3s
}) => Layer.Layer<
  Exporter.Flusher,
  never,
  OtlpSerialization | HttpClient.HttpClient
>
```

Two requirements, both satisfied by core: `OtlpSerialization.layerJson`
(`:37-41`) and `FetchHttpClient.layer`. Applied to LangSmith:

```ts
OtlpTracer.layer({
  url: "https://api.smith.langchain.com/otel/v1/traces",
  headers: { "x-api-key": apiKey, "Langsmith-Project": project },
  resource: { serviceName: "cli-agent", serviceVersion: "1.0.0" }
}).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
)
```

Confirmed by the repo's own doc example
(`ai-docs/src/08_observability/20_otlp-tracing.ts:36-39`) and test
(`packages/effect/test/Tracer.test.ts:117-128`). Only sampled spans are exported
(`:91-94`).

Conveniences: `Otlp.layerJson({baseUrl, headers})` (`Otlp.ts:129-146`) bundles
traces+logs+metrics, deriving `/v1/{traces,logs,metrics}`.
`OtlpTracer.layerFromConfig` / `Otlp.layerFromConfig` (`:149-194`) read standard
env vars (`OTEL_SDK_DISABLED`, `OTEL_EXPORTER_OTLP_*_ENDPOINT`,
`OTEL_EXPORTER_OTLP_*_HEADERS`, `OTEL_BSP_*`).

Exporter robustness (`OtlpExporter.ts`): retries transient failures with 429
`retry-after` (`:29-45`), **disables itself for 60s after an unhandled failure
and drops the buffer** (`:204-209`), flushes on scope close (`:222-233`), and
wraps its own HTTP calls in `Effect.withTracerEnabled(false)` (`:201`) so
exporting doesn't self-trace.

### 5.2 GenAI conventions are free — but only via the provider packages

`unstable/ai/Telemetry.ts` is types + helpers; it applies nothing on its own.
The wiring: `LanguageModel.make` creates the spans
(`Effect.useSpan("LanguageModel.generateText")` `:792`, `generateObject` `:852`,
`makeSpanScoped("LanguageModel.streamText")` `:931`; also `EmbeddingModel.embed`
and `Chat.*`), and the **provider adapters** write the attributes —
`packages/ai/openai-compat/src/OpenAiLanguageModel.ts:1337-1386` calls
`addGenAIAnnotations` on request, response, and stream finish (same in
openai/anthropic/openrouter).

Attributes (`Telemetry.ts:64-179`, camel→snake with prefix): `gen_ai.system`,
`gen_ai.operation.name` (`chat`|`embeddings`|`text_completion`),
`gen_ai.request.{model,temperature,top_k,top_p,max_tokens,stop_sequences,frequency_penalty, presence_penalty,seed,encoding_formats}`,
`gen_ai.response.{id,model,finish_reasons}`,
`gen_ai.usage.{input_tokens,output_tokens}`, `gen_ai.token.type`, plus OpenAI
extras (`OpenAiTelemetry.ts:119-160`). Nullish values are skipped; the helper
**mutates the span in place**. `Telemetry.CurrentSpanTransformer` (`:540-542`)
is a per-call hook receiving the full response parts — the free seam for custom
attributes.

⚠️ **Tool calls do not get their own spans.** `Toolkit.handle` calls
`Effect.annotateCurrentSpan({tool: name, parameters: params})`
(`Toolkit.ts:276-279`) — it annotates the _enclosing_ span, and the call sites
in `LanguageModel.ts` (1519, 2037, 2150, 2176) do not wrap it. **With concurrent
tool calls all annotations collide on one span.** Add `Effect.withSpan` per tool
call yourself. Same for candidate rollouts.

### 5.3 What a span actually costs, and how to turn it off

`withSpan` options (`Tracer.ts:255-275`):
`attributes, links, parent, root, annotations, kind, sampled, level` +
`captureStackTrace`.

Per enabled span (`internal/effect.ts:5674-5736`, `OtlpTracer.ts:229-261`):
several `fiber.getRef` lookups; a links array copy (allocated **every** span
even when empty, `:5707-5709`); a `currentTimeNanosUnsafe()` bigint; the span
object; **two `Math.random()` hex loops building a 32-char traceId and 16-char
spanId one character at a time** (traceId skipped when parented); a `new Map()`
for attributes; an events array; `Object.entries` per attribute. On end, the
full OTLP JSON object graph. **Spans are not lazy — everything is built eagerly
at creation.**

`captureStackTrace` is a separate cost and is **on by default**:
`addSpanStackTrace` (`internal/tracer.ts:9-25`) constructs `new Error()` on
every `withSpan` (formatting is lazy and cached, the allocation is not). Core
itself passes `captureStackTrace: false` on hot paths
(`LanguageModel.ts:831, 911`; `Chat.ts:447`).

Levers, cheapest first:

1. **`References.TracerEnabled = false`** (`References.ts:391`;
   `Effect.withTracerEnabled` `:7853`) — the real off switch. `makeSpanUnsafe`
   short-circuits to a shared-prototype `noopSpan`
   (`internal/effect.ts:5639-5698`): no clock read, no random IDs, no per-span
   Map.
2. **`Tracer.MinimumTraceLevel`** (`Tracer.ts:591`) with `CurrentTraceLevel`
   (`:562`) — raising it forces `sampled: false`; the span is still fully
   allocated but dropped at export. **This is the only sampling knob — there is
   no probabilistic sampler in core.** Sampling is inherited.
3. `Effect.withTracerTiming(false)` (`:7877`) — skips the clock read.
4. Per-span `{sampled: false}` / `{captureStackTrace: false}`.

### 5.4 Logs carry span context automatically

`OtlpLogger.ts:228-231` stamps `traceId`/`spanId` onto every log record from
`options.fiber.currentSpan`. Log annotations become attributes, plus `fiberId`,
`logSpan.<label>` timings, and `log.error` with a pretty-printed Cause
(`:196-214`). `OtlpMetrics.layer` (`:462-475`) takes `exportInterval` and
`temporality`; **no exemplar/span linkage found**. All three signals share one
`OtlpExporter.Flusher` registry so a single `flush` drains everything
(`:92-134`).

### 5.5 DevTools

`unstable/devtools/DevTools.ts:65-68` — one line, no requirements:

```ts
export const layer = (url = "ws://localhost:34437"): Layer.Layer<never> =>
  layerWebSocket(url).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal)
  )
```

**WebSocket, default `ws://localhost:34437`, NDJSON.** It installs a Tracer that
**wraps** the current tracer rather than replacing it
(`DevToolsClient.ts:180-211`) — so it composes with `OtlpTracer`, but only if
`OtlpTracer` is already in context when the DevTools layer builds (it does
`yield* Effect.tracer`). **Layer order matters.** Also pings every 3s and serves
metric snapshots. Protocol (`DevToolsSchema.ts:489,532`): Request =
`Ping|Span|SpanEvent|MetricsSnapshot`.

### 5.6 What `@effect/opentelemetry` adds (and why we probably don't need it)

`NodeSdk.layer(config)` (`NodeSdk.ts:109-154`) takes
`spanProcessor`/`metricReader`/ `logRecordProcessor` — **you construct the OTel
exporter objects yourself**. Peer deps are all `optional: true`:
`@opentelemetry/api ^1.9`, `sdk-trace-base ^2.0.0`, `sdk-trace-node ^2.0.0`,
`resources ^2.0.0`, `sdk-metrics ^2.0.0`, `semantic-conventions ^1.33.0`.

What it buys: **real OTel context interop** (`OtelTracer.ts:94-119` makes Effect
spans the active OTel context, so auto-instrumented libraries nest under your
spans); global tracer provider registration; **any** OTel exporter
(gRPC/Jaeger/Zipkin/Prometheus); **OTel samplers** via `tracerConfig`;
`traceFlags`/`traceState` preservation the native path doesn't model.

**Recommendation: core-only.** A CLI agent with no third-party
auto-instrumentation needs none of it, and skipping it removes ~9 peer
dependencies.

**Unverified:** whether LangSmith's OTLP ingestion actually renders `gen_ai.*`
spans as LLM runs. The attributes match the semconv spec, but that's LangSmith's
behavior, not this repo's.

---

## 6. CLI & platform-node

Import specifier: **`effect/unstable/cli`**. Barrel exports 12 namespaces:
`Argument, CliConfig, CliError, CliOutput, Command, Completions, Flag, GlobalFlag, HelpDoc, Param, Primitive, Prompt`.
**`internal/` is not exported** — `internal/ansi.ts` is `@internal`, so its ANSI
helpers are not importable.

### 6.1 A working CLI (from the shipped runnable doc, `ai-docs/src/70_cli/10_basics.ts`)

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

const workspace = Flag.string("workspace").pipe(
  Flag.withAlias("w"),
  Flag.withDescription("Workspace"),
  Flag.withDefault("personal")
)

const tasks = Command.make("tasks").pipe(
  Command.withSharedFlags({
    workspace,
    verbose: Flag.boolean("verbose").pipe(Flag.withAlias("v"))
  }),
  Command.withDescription("Track and manage tasks")
)

const create = Command.make(
  "create",
  {
    title: Argument.string("title"),
    priority: Flag.choice("priority", ["low", "normal", "high"]).pipe(
      Flag.withDefault("normal")
    )
  },
  Effect.fn(function* ({ title, priority }) {
    const root = yield* tasks // parent config via `yield*` on the parent Command
    yield* Console.log(
      `Created "${title}" in ${root.workspace} with ${priority}`
    )
  })
)

tasks.pipe(
  Command.withSubcommands([create, list]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
```

- **A `Command` is itself an `Effect`** (`Command.ts:119-125`) — that's the
  whole mechanism for a subcommand reading its parent's flags.
- Handler signature (`:624-628`): `(config) => Effect<void, E, R>`. Must return
  `void`.
- `Command.run` (`:1734`) pulls argv from `Stdio`;
  **`Command.runWith(cmd, config)` (`:1816`) returns
  `(argv) => Effect<void, ...>` — your test/embedding seam.**
- Required context (`:390`):
  `FileSystem | Path | Terminal | ChildProcessSpawner | Stdio`.
  `NodeServices.layer` (`platform-node/src/NodeServices.ts:32-50`) provides all
  five plus `Crypto`. **`NodeContext` does not exist in v4** — `NodeServices`
  replaced it.
- Command-level DI: `Command.provide(layer | (input) => layer, {local?})`
  (`:1442-1550`) — layers parameterized by parsed flags.

Free from `GlobalFlag.BuiltIns` (`:298-305`): `--help/-h`, `--version/-v`,
**`--wizard`** (a full interactive flag-filling wizard that reconstructs argv,
`internal/wizard.ts`, 283 lines), `--completions <bash|zsh|fish|sh>` (**three
shells only**, `Completions.ts:19`), `--log-level` (wired to
`References.MinimumLogLevel`), and did-you-mean suggestions.

### 6.2 Flags/Arguments

Constructors (`Flag.ts:57-441`):
`string, boolean, integer, float, date, choice, choiceWithValue, path, file, directory, redacted, fileText, fileParse, fileSchema, keyValuePair, none`.
`Argument.ts` has the same minus `boolean`/`keyValuePair`, plus `variadic`.

- **Path existence checks are real**: `Flag.path(name, {pathType, mustExist})`
  (`:211`), `file`/`directory` (`:238`/`:263`) — impl resolves to absolute,
  calls `fs.exists` and `fs.stat` (`Primitive.ts:479-520`).
- **Boolean negation is automatic**: any `--no-<name>` on a boolean flag
  (`internal/parser.ts:361-368`); completions emit `--no-*` in all three shells.
- Optionality (`Param.ts`): `optional` → `Option<A>` (1260); `withDefault`
  (1324); **`withFallbackConfig(Config.Config<B>)`** (1372) — falls back to
  Effect `Config` only on missing-option/argument;
  **`withFallbackPrompt(prompt)`** (1431) — prompts interactively when a
  required param is missing.
- **Schema integrates**: `Param.withSchema` (1803) / `Flag.withSchema` (1110)
  accept `Schema.ConstraintCodec`; `Flag.fileSchema` (388) decodes a JSON/YAML
  file into a schema type.
- Errors (`CliError.ts:74-82`): tagged union, all `Schema.TaggedErrorClass`.
  `ShowHelp` is control-flow. **A `QuitError` from a prompt converts to
  `Effect.interrupt`** (`:1936-1942`) → exit 130, not 1.
- Output (`CliOutput.ts`): `defaultFormatter({colors?})` (298) auto-detects
  `stdout.isTTY` and honors **`NO_COLOR=1`** (`:302-309`). Override wholesale
  with `CliOutput.layer`. `HelpDoc` (`:65`) is plain data — renderable yourself.

### 6.3 The 13 prompts (complete list)

`Prompt<A>` is itself an
`Effect<A, Terminal.QuitError, FileSystem | Path | Terminal>` (`:51-71`), so
`yield*` works; `Prompt.run` (1088) is sugar acquiring one shared input queue
for a chain.

| Constructor    | Line | Output          | Notes                                           |
| -------------- | ---- | --------------- | ----------------------------------------------- |
| `text`         | 1256 | `string`        | `validate?: (v) => Effect<string, string>`      |
| `password`     | 1072 | `Redacted`      | echoes `*`                                      |
| `hidden`       | 988  | `Redacted`      | renders nothing                                 |
| `list`         | 1041 | `Array<string>` | `delimiter?` (default `","`)                    |
| `confirm`      | 742  | `boolean`       | custom labels/placeholders                      |
| `toggle`       | 1267 | `boolean`       | `active`/`inactive` labels                      |
| `integer`      | 1003 | `number`        | `min/max/incrementBy/decrementBy`               |
| `float`        | 950  | `number`        | + `precision?` (2)                              |
| `date`         | 837  | `Date`          | `dateMask?`, `locales?`                         |
| `select`       | 1133 | `A`             | `choices`, `maxPerPage?` (10)                   |
| `autoComplete` | 1169 | `A`             | type-to-filter select                           |
| `multiSelect`  | 1208 | `Array<A>`      | `selectAll/selectNone/inverseSelection/min/max` |
| `file`         | 875  | `string`        | **a real interactive FS browser**               |

Plus `succeed` 1242, `map` 1052, `flatMap` 920, `all` 690 (**sequential only**),
`custom` 787. **Not present:** `number`, `path`/`directory` (use
`file({type})`), `editor`, `search`, `form`, spinner.

**`Prompt.custom` is the TUI extension point.** `Handlers<State, Output, Input>`
(`:124-148`) =
`{render(state, action), process(input, state), clear(state, action)}` returning
`Action = Beep | NextFrame{state} | Submit{value}`. Crucially, a **3-arg
overload** `custom(state, events: Queue.Dequeue<A>, handlers)` (`:787-814`)
whose loop **races a keystroke against your external event queue**
(`:1381-1389`) — that is the hook for streaming LLM tokens into a live redrawing
region. Test: `test/unstable/cli/Prompt.test.ts:519-560`. The `Action`
constructor isn't exported; rebuild with
`Data.taggedEnum<Prompt.ActionDefinition>()`.

Gotchas: `Prompt.all` is strictly sequential; `Prompt.select` **throws
synchronously** (not an Effect failure) if >1 choice has `selected: true`
(`:1111`); `Prompt.date` mutates `initial` in place; supplying your own
`validate` to `integer`/`float` **silently replaces** the built-in min/max check
(spread order, `:967`, `:1019`).

### 6.4 ChildProcess — the verification step

`import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"`.

**A `Command` is an Effect** (`ChildProcess.ts:42-53`):
`StandardCommand extends Effect<ChildProcessHandle, PlatformError, ChildProcessSpawner | Scope>`.
`yield* ChildProcess.make(...)` == spawn. `make` (`:595-614`) has 4 overloads
incl. template-literal. Combinators: `setCwd` 784, `setEnv` 823, `pipeTo` 685,
`prefix` 719.

`CommandOptions` (`:374-482`): `cwd`, `env`, **`extendEnv` (default `false` —
without it the child loses `PATH`**, documented at `:388-391`), `shell`,
`detached` (default true off-Windows), `stdin/stdout/stderr`
(`"pipe"|"inherit"|"ignore"|"overlapped"` or a Stream/Sink), `killSignal`
(default `"SIGTERM"`), **`forceKillAfter?` (default undefined = never
escalates)**.

`ChildProcessHandle` (`ChildProcessSpawner.ts:79-197`): `pid`,
`exitCode: Effect<ExitCode, PlatformError>`, `isRunning`, `kill`, `stdin: Sink`,
`stdout/stderr/all: Stream<Uint8Array>`. Service conveniences (`:252-296`):
`spawn`, `exitCode`, `string`, `lines`, `streamString`, `streamLines` — but
`string`/`lines` **discard the exit code**, so use `spawn` for `tsc`.

**Nonzero exit is a plain value, not a failure.** `exitCode` fails only on
signal death (`code === null`) — `NodeChildProcessSpawner.ts:531-540`.

**Interruption kills the child, with a caveat.** Interrupt during spawn →
hard-coded `SIGTERM` (`:345-347`). After spawn → the `acquireRelease` finalizer
(`:473-506`) kills the **process group** (`process.kill(-pid, signal)`, `:368`;
`taskkill /T /F` on Windows), then **awaits actual exit** (`:497-501`). ⚠️
**Without `forceKillAfter`, a child that traps SIGTERM makes scope-close hang
forever** — release runs uninterruptibly and awaits exit. The repo's own test
pins the fix (`test/unstable/process/ChildProcessSpawnerTest.ts:509-545`). ⚠️
Second: **draining stdout fully then stderr deadlocks** — read concurrently
(test comment at `:316`).

```ts
export const typecheck = Effect.fn("typecheck")(function* (cwd: string) {
  const handle = yield* ChildProcess.make("tsc", ["--noEmit"], {
    cwd,
    env: { FORCE_COLOR: "0" },
    extendEnv: true, // REQUIRED or the child has no PATH
    stdout: "pipe",
    stderr: "pipe",
    killSignal: "SIGTERM",
    forceKillAfter: "5 seconds" // else scope-close can hang
  })
  const [stdout, stderr] = yield* Effect.all(
    [collect(handle.stdout), collect(handle.stderr)],
    { concurrency: "unbounded" } // sequential draining deadlocks
  )
  return { exitCode: yield* handle.exitCode, stdout, stderr }
}, Effect.scoped) // closing this scope kills the child, incl. on interrupt
```

Because `detached` defaults true off-Windows, grandchildren (e.g. vitest
workers) are reaped too (test `:921`).

### 6.5 Terminal / Stdio / runtime / FS

- **`Terminal`** (`Terminal.ts:31-55`) — five members: `columns`, `rows`,
  `readInput: Effect<Queue.Dequeue<UserInput, Cause.Done>, never, Scope>`,
  `readLine: Effect<string, QuitError>`, `display(text)`.
  `UserInput = {input: Option<string>, key: {name, ctrl, meta, shift}}`. Error
  is **`QuitError`**, not v3's `QuitException`.
- **`NodeTerminal`** (`platform-node-shared/src/NodeTerminal.ts:53-86`): raw
  mode set on acquire, restored on release, guarded by `stdin.isTTY`, held in an
  `RcRef` so concurrent readers share it. Ctrl-C/Ctrl-D **end the queue** rather
  than failing (`:173-177`).
- **`NodeRuntime.runMain`** (`platform-node-shared/src/NodeRuntime.ts:36-59`):
  takes `Effect<A, E>` with `R = never` — **no default layers**. SIGINT/SIGTERM
  call `fiber.interruptUnsafe` (not `process.exit`), so finalizers run and raw
  mode is restored on Ctrl-C. Exit codes (`Runtime.ts:108-115`): success → 0,
  **interrupts-only → 130**, else 1.
- **`FileSystem.makeTempDirectoryScoped({directory?, prefix?})`**
  (`FileSystem.ts:176-214`) — `acquireRelease` + recursive remove. ⚠️
  **`makeTempFileScoped` removes the file's entire parent directory
  recursively** (`NodeFileSystem.ts:408-417`).

### 6.6 TUI verdict

**You must build your own renderer.** No TUI layer, no live region, no spinner,
no progress bar anywhere in the repo (grepped `spinner|progressbar|progress bar`
across `packages/*/src` — the only hit is an unrelated HTTP-API HTML blob). No
layout engine, no widget tree, no diffing.

What exists is a **single erase-and-redraw loop inside Prompt**
(`Prompt.ts:1368-1410`). Clearing is manual arithmetic against
`terminal.columns`: `eraseText` (`:1417-1428`) counts wrapped rows and emits N×
`ESC[2K` + `ESC[1A`; every prompt re-renders itself in `{plain: true}` mode
purely to measure unstyled width. A finalizer always restores `Ansi.cursorShow`.

- **Free:** parsing, subcommand tree, help/usage, three-shell completions,
  `--wizard`, did-you-mean, colorized errors, TTY/`NO_COLOR` detection, raw-mode
  lifecycle, Ctrl-C → interrupt → finalizers → exit 130, 13 prompts, and
  `Prompt.custom`'s keystroke-vs-event race.
- **Must build:** persistent multi-region layout, streaming-token rendering,
  spinners/progress, scrollback, alternate screen buffer, mouse, correct
  wide/CJK/emoji width measurement (`eraseText`'s `line.length / columns` is
  wrong for those), readline history/editing.
- **Pragmatic path:** reuse `Prompt.custom`'s 3-arg overload as the frame loop
  (it already gives keystroke/event racing, cursor hide/show, clean teardown)
  and write your own `render`/`clear` with your own ANSI constants (~15 escape
  codes, trivial, since `internal/ansi.ts` isn't exported).

Test harness to copy: `test/unstable/cli/Command.test.ts:1-40` drives the whole
CLI through `Command.runWith` + `MockTerminal` + `Stdio.layerTest({})` +
`CliOutput.defaultFormatter({colors: false})`. A full worked CLI fixture is at
`test/unstable/cli/fixtures/ComprehensiveCli.ts`.

---

## 7. Errors, retries, escalation

### 7.1 Typed errors

Three tiers; the AI layer uses the third.

- `Data.TaggedError("Tag")<Fields>` (`Data.ts:761-765`) — plain, in-process
  control flow.
- `Schema.ErrorClass<Self>("Id")({...})` (`Schema.ts:14392`) — you supply `_tag`
  yourself.
- **`Schema.TaggedErrorClass<Self>()("Tag", fields)`** (`Schema.ts:14453`) —
  `_tag` auto-populated. Note the **double call with an empty first arg**.
  **There is no `Schema.TaggedError`.**

Every AI error is `Schema.ErrorClass` with an explicit `Schema.tag(...)` field
(`AiError.ts:79-86`). **Recommendation: `Schema.TaggedErrorClass` for domain
errors** (serializable across subprocess/RPC boundaries — needed for tool
results and run ledgers), `Data.TaggedError` for purely in-process control flow.

### 7.2 `Cause` is flat now

`Cause<E> = { reasons: ReadonlyArray<Reason<E>> }` (`Cause.ts:75-78`) — **not a
tree**. Variants `Fail` (`.error`), `Die` (`.defect`), `Interrupt` (`.fiberId`).

**`isInterrupted` does not exist.** The real API: `hasFails` 761, `hasDies` 865,
**`hasInterrupts` 938**, `hasInterruptsOnly` 624,
`isFailReason`/`isDieReason`/`isInterruptReason` 170/196/222, `findError` 815,
`findDefect` 917, **`pretty` 1115**, `prettyErrors` 1068, `squash` 736,
`interruptors` 993.

Design note: all three of "network died" / "bad model output" / "tests failed"
should be typed **`Fail`s**. Reserve `Die` for genuine bugs — `Cause.hasDies` on
an agent step means _your_ code broke and no retry/escalation policy should
fire.

### 7.3 Renamed error combinators

| v3               | **v4**                                                    | `Effect.ts` |
| ---------------- | --------------------------------------------------------- | ----------- |
| `catchAll`       | **`Effect.catch`**                                        | 2634        |
| `catchAllCause`  | `catchCause`                                              | 3199        |
| `catchAllDefect` | `catchDefect`                                             | 3252        |
| `catchSome`      | `catchFilter`                                             | 3359        |
| `catchTag`       | `catchTag` (also accepts an **array** of tags + `orElse`) | 2684        |
| —                | **`catchReason` (new)**                                   | 2896        |
| —                | **`catchReasons` (new)**                                  | 2993        |
| `either`         | **`Effect.result`** → `Result`                            | 2215        |
| `orElse`         | **`Effect.catch`**                                        | —           |
| `orElseFail`     | **`Effect.mapError`**                                     | 3541        |
| `sandbox`        | `sandbox` → `Effect<A, Cause<E>, R>`                      | 4145        |
| `retry`          | `retry` (Schedule **or** options object)                  | 4029        |

**`Effect.catchReason` is purpose-built for the `{_tag, reason}` shape `AiError`
uses**, and is the most important combinator for the policy engine. Doctested at
`Effect.ts:2861-2886`:

```ts
Effect.catchReason("AiError", "RateLimitError", (reason) =>
  Effect.succeed(`Retry after ${reason.retryAfter}s`)
)
```

It handles one nested reason and **leaves the parent error in the channel** for
unmatched reasons. `catchReasons` (`:2993`) takes a `{[reasonTag]?: handler}`
record plus an `orElse` — an exhaustive policy table keyed by reason tag. **That
is the policy dispatcher.**

`Retry.Options<E>` (`:3970-3975`): `{while?, until?, times?, schedule?}`. Note
(`:3995-3999`): _"The source effect is always evaluated once before any retry
policy is applied… Defects and interruptions are not retried."_

### 7.4 `Schedule` was gutted and rebuilt

The type gained a param:
**`Schedule<out Output, in Input = unknown, out Error = never, out Env = never>`**
(`Schedule.ts:53-55`).

Constructors: `exponential(base, factor=2)` 850, `fibonacci` 882, `spaced` 1198,
`fixed` 933, `windowed` 1410, `recurs` 1169, `forever` 1447, `duration` 720,
`during` 750, `cron` 678, `fromStep` 250. Combinators: `addDelay` 465,
`modifyDelay` 1043, `jittered` 1093, `map` 987, `tap` 1234, `passthrough` 1125,
`andThen` 500, **`max([...])` 618**, **`min([...])` 783**, **`upTo` 1294**,
**`while` 1376**.

Renames memory will get wrong (migration `:13101-13260`):

- **`intersect` → `Schedule.max([a,b])`**; **`union` → `Schedule.min([a,b])`**;
  `either`/`eitherWith` → `min`; `intersectWith` → `max`.
- **`compose` → gone.** `zipLeft`/`zipRight`/`zipWith` → gone.
- `recurUpTo` → `Schedule.during`; **the new `upTo({duration?, times?})` is a
  different API**.
- `whileInput`/`whileOutput`/`untilInput`/`untilOutput`/`check`/`checkEffect` →
  **all collapse into `Schedule.while(metadata => boolean | Effect<boolean>)`**.
- `jitteredWith` → `modifyDelay`; **`Schedule.jittered` is fixed at 0.8–1.2**
  (`:1086`).
- `CurrentIterationMetadata` → **`Schedule.CurrentMetadata`**;
  `IterationMetadata` → **`Metadata`**.
- `ScheduleDecision`/`ScheduleInterval`/`ScheduleIntervals`/`ScheduleDriver` all
  **removed**.

`Metadata` (`:63-81`) — what every predicate/delay callback receives:
`{input, attempt, start, now, elapsed, elapsedSincePrevious, output, duration}`.
**`attempt` is 1-based.**

**Verified recipe — 3 attempts, jittered exponential, retryable only:**

```ts
Effect.retry(callModel, {
  schedule: Schedule.jittered(Schedule.exponential("500 millis", 2)),
  times: 2, // 2 retries + 1 initial = 3 executions
  while: (e: AiError.AiError) => e.isRetryable
})
```

`times: 2`, not 3 — `Effect.ts:3995-3997`: _"The source effect is always
evaluated once before any retry policy is applied."_ Desugaring at
`internal/schedule.ts:223-248`. Delay math is exact: `exponential` →
`base * factor^(attempt-1)` (`:856`); `jittered` → `d*0.8*(1-r) + d*1.2*r`
(`:1096-1100`).

**Honor `retry-after`** by composing `modifyDelay`:

```ts
Schedule.exponential("500 millis").pipe(
  Schedule.jittered,
  Schedule.modifyDelay(
    ({
      input,
      duration
    }: Schedule.Metadata<Duration.Duration, AiError.AiError>) =>
      Effect.succeed(input.retryAfter ?? duration)
  ),
  Schedule.upTo({ times: 2 })
)
```

### 7.5 `ExecutionPlan` — the escalation primitive

`ExecutionPlan.ts` (374 lines), runtime `internal/executionPlan.ts` (121 lines).
Both read in full.

**The step option bag is exactly four keys** (`:217-222`):

```ts
export type Step = {
  readonly provide: Context.Context<any> | Layer.Any
  readonly attempts?: number | undefined
  readonly while?:
    | ((input: any) => boolean | Effect.Effect<boolean, any, any>)
    | undefined
  readonly schedule?: Schedule.Schedule<any, any, any> | undefined
}
```

**`while` receives the ERROR**, not a value (`Effect.ts:4295` types it
`<A, E extends Input, R>`).

API: `make(...steps)` (`:167`, **throws eagerly** if `attempts < 1`,
`:182-184`); `merge(...plans)` (`:332`); `plan.captureRequirements` (`:285-295`)
— an **Effect** yielding a requirement-free plan by baking ambient context into
each step's Layer; `ExecutionPlan.CurrentMetadata` (`:369-374`) =
`{attempt, stepIndex}`. Execution: `Effect.withExecutionPlan` (`Effect.ts:4289`)
— **the plan removes `Provides` from the requirement channel** — and
`Stream.withExecutionPlan` (`Stream.ts:5933`) with
`{preventFallbackOnPartialStream?}`.

**Non-obvious semantics derived from the runtime:**

1. **`attempts: N` means N total executions of that step**, uniformly. Step 0
   gets `times: N-1` (the effect runs once before the schedule); later steps get
   `times: N` because the first schedule tick is consumed replaying the previous
   step's stored failure (`effect.fromResult(result!)`), which does _not_ run
   the effect.
2. **A step with no `schedule` and no `attempts` runs exactly once.**
3. ⚠️ **`while` returning `false` does NOT abort the plan** — it only terminates
   _that step's_ retry schedule; the loop then advances to the **next
   provider**. So `while: e => e.isRetryable` means _"stop hammering this
   provider, escalate now"_. A `ContentPolicyError` will silently escalate to
   your expensive model unless filtered out.
4. ⚠️ **Only the last failure survives.** `result` is overwritten each step. If
   provider A fails with `RateLimitError` and B with `AuthenticationError`, the
   caller sees only B's. **Log per-step with `Schedule.tap`/`tapError` if you
   need the trail.**
5. **`CurrentMetadata.attempt` is plan-global, not per-step** — a single
   monotonic counter; `stepIndex` tells you which provider. Pinned by
   `test/ExecutionPlan.test.ts`:
   `[{attempt:1,stepIndex:0},{attempt:2,stepIndex:1},{attempt:3,stepIndex:2}]`.

⚠️ **Stream fallback duplicates output by default.**
`test/ExecutionPlan.test.ts:81-96`: a stream that emits `[1,2,3]` then fails
still falls back, so the consumer observes `[1,2,3,1,2,3]`. With
`{preventFallbackOnPartialStream: true}` (`:98-115`) output is `[1,2,3]` and the
result is `Exit.fail("Partial")`. **For a CLI agent streaming tokens to a
terminal, set this to `true`** — otherwise a mid-stream provider failure replays
the whole answer and the user sees it twice.

**The repo's own escalation example**
(`ai-docs/src/71_ai/10_language-model.ts:45-56, 97-100`):

```ts
const DraftPlan = ExecutionPlan.make(
  { provide: OpenAiLanguageModel.model("gpt-5.2"), attempts: 3 },
  { provide: AnthropicLanguageModel.model("claude-opus-4-6"), attempts: 2 }
)
// ...
const draftsModel = yield * DraftPlan.captureRequirements
// ...
Effect.withExecutionPlan(draftsModel)
```

`provide` accepts the model directly because `Model extends Layer`
(`Model.ts:34-52`).

Applied here — Mercury as the cheap tier, escalating on repeated failure:

```ts
const EscalationPlan = ExecutionPlan.make(
  {
    provide: MercuryModel,
    attempts: 3,
    schedule: backoff,
    while: (e: AiError.AiError) => e.isRetryable
  },
  {
    provide: MercuryLargeModel,
    attempts: 2,
    schedule: backoff,
    while: (e: AiError.AiError) => e.isRetryable
  },
  { provide: StrongFallback, attempts: 2, schedule: backoff }
)
```

Then layer the _semantic_ policy on top with `catchReasons` — which runs
**after** the plan is exhausted and sees only the final failure.

### 7.6 `AiError` taxonomy

One wrapper `AiError` (`AiError.ts:1442-1474`) carrying a `reason` from an
18-member union (`:1355-1393`), with `isRetryable` and `retryAfter` accessors
and `message = "${module}.${method}: ${reason.message}"`. HTTP mapper
`reasonFromHttpStatus` (`:1579-1606`).

| Reason                         | line | retryable                     | notable fields                          | agent policy                               |
| ------------------------------ | ---- | ----------------------------- | --------------------------------------- | ------------------------------------------ |
| `NetworkError`                 | 79   | `reason === "TransportError"` | `reason`, `request`                     | **RETRY** if transport; else your bug      |
| `RateLimitError`               | 372  | **true**                      | `retryAfter?: Duration`                 | **RETRY, honor `retryAfter`**              |
| `QuotaExhaustedError`          | 423  | false                         | `resetAt?`                              | **HARD STOP** (billing)                    |
| `AuthenticationError`          | 476  | false                         | `kind`                                  | **HARD STOP**                              |
| `ContentPolicyError`           | 534  | false                         | `description`                           | **HARD STOP**, do not escalate             |
| `InvalidRequestError`          | 587  | false                         | `parameter?`, `constraint?`             | **YOUR BUG**                               |
| `InternalProviderError`        | 644  | **true**                      | `description`                           | **RETRY then ESCALATE** (5xx)              |
| `InvalidOutputError`           | 695  | **true**                      | `description`, `usage?`                 | provider wire-decode failed                |
| **`StructuredOutputError`**    | 772  | **true**                      | **`responseText: string`**              | **RE-PROMPT — carries the raw bad output** |
| `UnsupportedSchemaError`       | 851  | false                         |                                         | **ESCALATE** to a capable model            |
| `UnknownError`                 | 901  | false                         |                                         | fatal                                      |
| `ToolNotFoundError`            | 958  | **true**                      | `availableTools[]`                      | **RE-PROMPT** with the list                |
| `ToolParameterValidationError` | 1012 | **true**                      | `toolName`, `toolParams`, `description` | **RE-PROMPT**                              |
| `InvalidToolResultError`       | 1066 | false                         |                                         | your bug                                   |
| `ToolResultEncodingError`      | 1119 | false                         |                                         | your bug                                   |
| `ToolConfigurationError`       | 1172 | false                         |                                         | your bug                                   |
| `ToolkitRequiredError`         | 1223 | false                         | `pendingApprovals[]`                    | **HUMAN-IN-THE-LOOP**                      |
| `InvalidUserInputError`        | 1276 | false                         |                                         | **ASK THE USER**                           |

**The three-way distinction:**

- _network died_ → `NetworkError{TransportError}` and `InternalProviderError`.
  Both retryable.
- _bad model output_ → **`StructuredOutputError`** (model's structured output
  failed to decode — carries `responseText`) vs `InvalidOutputError` (the
  _provider's wire response_ failed to decode). Verified at distinct call sites:
  `LanguageModel.ts:2239, 2251` use `StructuredOutputError` inside
  `generateObject`; `:828, 908, 981` use `InvalidOutputError.fromSchemaError`.
  **Only `StructuredOutputError` is genuinely "the model got it wrong"** —
  that's the re-prompt trigger.
- _tests failed_ → **not in this taxonomy at all.** Define your own
  `Schema.TaggedErrorClass<TestsFailed>()(...)` and **keep it out of the
  `ExecutionPlan`** — per semantic #3, any typed failure escaping a step
  advances to the next provider, and a failing test suite must never trigger
  model escalation.

⚠️ **`isRetryable` is a provider-transience signal, not an escalation signal.**
`StructuredOutputError.isRetryable === true` means "sample again", not "switch
providers".

### 7.7 Rate limits: providers do not retry internally

Grepped `packages/ai/openai/src/` and `anthropic/src/` for
`Effect.retry`/`HttpClient.retry`/ `Schedule.` → **zero hits outside generated
code.** They only _classify_: `parseRateLimitHeaders`
(`openai/src/internal/errors.ts:170-190`) reads `retry-after` and
`x-ratelimit-*`; 429 splits two ways (`:324-345`) — `insufficient_quota` →
`QuotaExhaustedError`, else `RateLimitError`. Tests pin it
(`openai/test/OpenAiClient.test.ts:315, 329`).

**So retry/backoff is entirely yours.** Two places:

- **Transport:**
  `HttpClient.retryTransient({retryOn?, while?, schedule?, times?})`
  (`unstable/http/HttpClient.ts:892-982`), plus `HttpClient.withRateLimiter`
  (`:1000+`) with header-driven limit updates. Attach to the
  `FetchHttpClient.layer` beneath the provider clients.
- **Semantic:** the `ExecutionPlan` step `schedule`/`while`.

**Don't double-retry the same 429 at both layers.**

---

## 8. `effect/unstable/ai` and the MCP situation

### 8.1 Mercury wiring — verified

`OpenAiClient.Options` (`packages/ai/openai-compat/src/OpenAiClient.ts:93-99`)
includes **`apiUrl?: string`**, defaulting to `https://api.openai.com/v1` via
`HttpClientRequest.prependUrl(options.apiUrl ?? ...)` (`:143`, independently
verified). Two layer constructors: `layer(options)` (`:294`) and
`layerConfig({apiKey: Config, apiUrl: Config, ...})` (`:318-348`), both
`Layer<OpenAiClient, _, HttpClient>`. Only two endpoints:
`POST /chat/completions` (`:185, 231`) and `POST /embeddings` (`:257`).

```ts
const MercuryClient = OpenAiClient.layerConfig({
  apiKey: Config.redacted("INCEPTION_API_KEY"),
  apiUrl: Config.string("INCEPTION_BASE_URL")
}).pipe(Layer.provide(FetchHttpClient.layer))

const MercuryModel = OpenAiLanguageModel.model("mercury-coder", {
  temperature: 0.2,
  strictJsonSchema: false, // see below
  diffusion_steps: 16 // ← ANY unknown key passes through verbatim
})

const program = LanguageModel.generateText({
  prompt,
  toolkit: MyToolkit,
  toolChoice: "auto"
}).pipe(
  Effect.provide(MercuryModel),
  Effect.provide(MyToolkitLayer),
  Effect.provide(MercuryClient)
)
```

**The arbitrary-params passthrough is the killer feature for Mercury.**
`ModelConfig` has an index signature (`OpenAiLanguageModel.ts:101`) and
`extractCustomRequestProperties` (`:1604-1612`) copies every key not in the
26-entry known set straight into the request body. **Any Inception-specific
parameter works with zero adapter code.** Pinned by
`packages/ai/openai-compat/test/OpenAiLanguageModel.test.ts:96-143`.

⚠️ **`strictJsonSchema` defaults to `true`** (`:1504, 1521, 1932`). Mercury
almost certainly does not honor OpenAI's strict structured-outputs contract.
**Set it to `false`.**

⚠️ **Model-name heuristics**: `getModelCapabilities(modelId)` (`:1949-1984`)
prefix-matches `o1`/`o3`/`gpt-5`/`codex-mini`. For `mercury-*` everything
resolves to `false` with `systemMessageMode: "system"` — which is what we want,
but note the code branches on model _name_, not declared capability.

**`openai-compat` is unambiguously the right base.** It is the only provider
package with no generated OpenAPI client (1247 hand-written lines vs 35,774 for
`openai`), and it is tolerant by construction: response schemas use
`optionalKey`/`NullOr` throughout (`:1086-1160`), it accepts
`reasoning`/`reasoning_content` fields OpenAI doesn't emit (`:1116-1117`), and
it has an explicit workaround for Fireworks sending `name: null` on streaming
tool-call fragments (`:1091-1097`).

If a custom adapter were ever needed, the contract is tiny —
`LanguageModel.make({generateText, streamText, codecTransformer?})`
(`LanguageModel.ts:748-767`), two functions over `ProviderOptions`.

### 8.2 The tool loop is single-turn — the agent loop is ours

**The framework does NOT run a multi-turn tool loop.** Verified three ways: (a)
`rg "maxSteps|stopWhen|stepCount"` over `unstable/ai` → **zero hits**; (b) the
complete options bag (`LanguageModel.ts:245-291`) is
`{prompt, toolkit?, toolChoice?, concurrency?, disableToolCallResolution?}` — no
loop knob; (c) `generateContent` (`:988-1215`) calls `params.generateText(...)`
exactly once at `:1187`, resolves tool calls, and returns.

The framework _does_ execute your handlers and return `tool-result` parts — it
just doesn't feed them back. The only documented loop is hand-written and
**unbounded** (`ai-docs/src/71_ai/30_chat.ts:119-138`):

```ts
while (true) {
  const response = yield * session.generateText({ prompt: [], toolkit: tools })
  if (response.toolCalls.length > 0) continue
  return response.text
}
```

**Four clean interception seams — good news for a deterministic harness:**

1. **`disableToolCallResolution: true`** (`:290, :1175-1185`) — tool definitions
   go to the model, `tool-call` parts come back decoded, **nothing executes**.
   You run the tools. This is the seam.
2. **`streamText` emits `tool-call` BEFORE executing the handler** — ordering
   pinned as `["tool-call","tool-result","finish"]`
   (`test/unstable/ai/LanguageModel.test.ts:119-163`), with `finish` deferred
   until all handler fibers drain (`:1544-1580`).
3. **Approval gating** — `needsApproval` (which may be a **predicate on
   params**) causes a `tool-approval-request` part _instead of_ running the
   handler (`:1502-1517`); resume by replaying the assistant message plus a
   `tool-approval-response`. Test `:1184-1260`.
4. **`concurrency`** bounds parallel handler execution within a step
   (`:1493-1495`); `1` serializes.

### 8.3 Tool / Toolkit idiom

```ts
const SearchProducts = Tool.make("SearchProducts", {
  description: "Search the product catalog by keyword",
  parameters: Schema.Struct({ query: Schema.String.annotate({ description: "..." }) }),
  success: Schema.Array(Product),
  failureMode: "error"          // "error" | "return"
})

const kit = Toolkit.make(SearchProducts, GetInventory)
const kitLayer = kit.toLayer({
  SearchProducts: ({ query }) => Effect.succeed([...]),
  GetInventory:   ({ productId }) => Effect.succeed({ productId, available: 42 })
})
```

`Tool.make` at `Tool.ts:1204-1278`; handler signature
`(params, ctx: HandlerContext) => Effect<Success, ...>` where
`ctx.preliminary(x)` streams a progress update (`Toolkit.ts:112-126, 171-180`).
**`toolkit.handle` returns a Stream, not an Effect** (`:188-224`). Parameters
are **validated automatically before the handler runs**, and the schema message
is carried verbatim inside `ToolParameterValidationError` — directly usable as a
repair prompt.

⭐ **`Tool.dynamic`** (`Tool.ts:1326-1382`) accepts a **raw JSON Schema** for
`parameters`, passing it through to the provider untouched. Its own doc example
is literally named `McpTool`. Verified end-to-end through openai-compat
(`test/OpenAiLanguageModel.test.ts:504-530`): the raw schema arrives
byte-identical in the request body. **This is the intended MCP bridge.**

MCP-facing annotations (`Tool.ts:1697+`): `Title`, `Meta`, `Readonly` (default
`false`), **`Destructive` (default `true`)**, `Idempotent` (`false`),
**`OpenWorld` (default `true`)**, `Strict`. **Annotate your safe tools
explicitly** or they advertise as destructive.

⚠️ **Toolkits are immutable and statically constructed** — only
`Toolkit.make(...)` and `Toolkit.merge(...)` (last-wins on name conflict). For
runtime MCP tool discovery you rebuild the toolkit + handler layer and swap.
Three gotchas: handler lookup does `services.mapUnsafe.get(tool.id)!` with a
**non-null assertion** (`Toolkit.ts:252`) — an unregistered tool throws a raw
`TypeError`, not a clean error; ids derive from names, so two MCP servers
exposing the same tool name **collide** (namespace them yourself); the schema
cache is a `WeakMap` keyed by tool object identity.

### 8.4 `Chat` and the context-hygiene gap

Stateful service (`Chat.ts:85-87`); history is a **publicly exposed
`Ref<Prompt.Prompt>`** (`:128`). Constructors: `empty` 532, `fromPrompt` 594,
`fromExport` 647, `fromJson` 681. Persistence: `Chat.layerPersisted({storeId})`
(`:964`) over `BackingPersistence`, with `getOrCreate(chatId, {timeToLive?})`
and auto-save via `Effect.ensuring` on every method (`:849-872`).

⚠️ **Context hygiene: nothing is provided.** Grepped
`compact|trim|summar|window|prune|truncate|budget|evict|maxTokens|maxHistory`
across `Chat.ts` → **zero matches**. History grows monotonically via
`Prompt.concat`. The only related API is `Tokenizer.truncate`
(`Tokenizer.ts:162-187`), which **`Chat.ts` does not import** and which walks
backwards from the newest message — it will happily discard your system prompt.
**Compaction is 100% ours.**

Also note: **no provider ships a `Tokenizer`** — openai-compat's
`modelWithTokenizer` is commented out (`OpenAiLanguageModel.ts:540-549`).

Two real bugs found in `Prompt.ts` worth knowing: `prependSystem`/`appendSystem`
build a merged system message but **don't remove the original**, duplicating it;
and `fromResponseParts` (`:2027-2138`) **silently drops** file, source,
response-metadata, finish, and error parts — so model-returned files never enter
Chat history. Also `Prompt.RawInput` array input goes through
`Schema.decodeSync` and **throws** rather than failing the Effect.

### 8.5 ⚠️ MCP: server only, and one spec revision behind our target

**Independently verified by the orchestrator.**

**Protocol version: exactly one — `"2025-06-18"`**
(`McpProtocol.ts:11, 17, 35`). The architecture is pluggable-adapter based
(registry at `internal/mcpProtocolRegistry.ts:29-70`), so another revision
_could_ be added, but only this one ships.

**This directly conflicts with the project brief's "2026-07-28 stateless spec
only" target.** It is the single most consequential finding for scope: either we
implement the newer revision as a second protocol adapter, or we accept
2025-06-18 semantics.

**There is no MCP client.** No `McpClient.ts` exists; the barrel exports only
`McpProtocol`, `McpSchema`, `McpServer`. The five `McpClient` hits repo-wide are
a private RcMap cache key class inside `McpServer.ts:419-422`. The only
`RpcClient`s constructed are **reverse channels** bound to an already-connected
inbound peer (`:502-527` — `send` is `protocol.send(clientId, …)`, it cannot
dial out), typed over
`ServerRequestRpcs = {Ping, CreateMessage, ListRoots, Elicit}`
(`McpSchema.ts:2383-2388`) — the four server→client requests, not `tools/call`.

**Strongest evidence:** to test their own server, the Effect authors
hand-assembled a raw client from `McpSchema` — `RpcClient.layerProtocolHttp` +
`RpcClient.make(McpSchema.ClientRpcs)`
(`test/unstable/ai/McpServer/McpServer.test.ts:107-118`). No shipped client
existed for them to use.

Reusable for a client: `McpSchema.ClientRpcs` (`:2358`), `ClientRequestRpcs`
(`:2306-2320`), `ClientNotificationRpcs` (`:2337`),
`FromClientEncoded`/`FromServerEncoded`. **The schemas are complete.** Missing:
transport dialing, stdio child-process spawn, initialize handshake,
session/header management, capability tracking.

**Transports (verified):** `McpServer.layer` (`:869`), **`layerStdio`**
(`:1016`, NDJSON, requires `Stdio`), **`layerHttp`** (`:1048`, requires
`HttpRouter`). The HTTP transport registers **only POST** (`:1094`); everything
else returns 405. `text/event-stream` appears **once** in the whole source — as
an Accept-header check returning 406 (`:1119`). **No SSE, no WebSocket.**
Consequence: server→client requests (sampling/elicitation/roots) work **over
stdio only** — roots refresh explicitly bails on HTTP (`:690-692`) and
`resources/subscribe` is disabled there (`:1946-1948`).

Feature matrix: tools ✅ (`registerToolkit` 1249, `McpServer.toolkit` 1337),
resources + templates ✅ (1580), prompts ✅ (1778), completions ✅ (357-376,
capped at 100), elicitation ✅ (`McpServer.elicit` 1816), logging ✅,
list_changed ✅ (debounced), cancellation ✅ (maps to fiber interrupt). ⚠️
sampling — schema + reverse RPC only, no exported helper. ⚠️ roots —
auto-refreshes then **discards the result** (`:686-706`, `Effect.asVoid`); no
accessor. ⚠️ progress — schema only, inbound is a literal no-op (`:2052`). ❌
**pagination — cursor fields exist in the schema but are never populated**
(`rg "cursor" McpServer.ts` → zero hits).

`McpServer.toolkit(kit)` (`:1331-1346`) bridges an AI `Toolkit` to MCP wire
tools, mapping annotations to MCP `ToolAnnotations`/`_meta`. **No reverse
bridge** — you cannot consume a remote MCP server's tools as a Toolkit, which
follows from there being no client.

⚠️ `MCP.md` contains two mutually inconsistent stdio wiring examples and
inconsistent `Schema` import paths. Trust the source.

---

## 9. Package inventory and what's actually missing

### Packages we should know about

| Package / module                                               | Relevance                                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **`effect/unstable/ai`**                                       | LanguageModel, Tool/Toolkit, Chat, MCP server, GenAI telemetry                                                                |
| **`@effect/ai-openai-compat`**                                 | **the Mercury path** — arbitrary `apiUrl`, arbitrary param passthrough                                                        |
| `@effect/ai-{openai,anthropic,openrouter}`                     | escalation targets; `openrouter` is a second OpenAI-compatible adapter worth reading                                          |
| **`effect/unstable/cli`**                                      | full CLI framework + 13 prompts                                                                                               |
| **`effect/unstable/observability`**                            | **native dependency-free OTLP exporter** (traces/logs/metrics)                                                                |
| **`effect/ExecutionPlan`**                                     | model escalation as a first-class value                                                                                       |
| **`effect/unstable/process`**                                  | ChildProcess — the verification step                                                                                          |
| `effect/unstable/encoding` (`Sse.ts`)                          | SSE decoding lives in core                                                                                                    |
| `effect/unstable/devtools`                                     | WebSocket span streaming, composes with OTLP                                                                                  |
| `effect/unstable/persistence`                                  | backs `Chat.layerPersisted`                                                                                                   |
| **`effect/unstable/workflow`**                                 | Activity, DurableClock/Deferred/Queue, WorkflowEngine — **unexamined; potentially relevant to durable multi-step agent runs** |
| `effect/unstable/rpc`, `socket`, `http`, `httpapi`             | transport substrate                                                                                                           |
| `effect/unstable/cluster`, `eventlog`, `reactivity`, `workers` | not investigated                                                                                                              |
| `effect/LayerMap`, `LayerRef`                                  | per-key / swappable service instances                                                                                         |
| `@effect/vitest`                                               | the evals harness (README is stale)                                                                                           |
| `effect/testing/{TestClock,TestConsole,TestSchema,FastCheck}`  | deterministic test services                                                                                                   |
| `packages/atom/*`                                              | reactive state (react/solid/vue) — likely irrelevant to a TUI                                                                 |

### The five things we must build

1. **The agent loop.** No `maxSteps`, no `stopWhen`, no step budget. The docs
   hand you a naked `while(true)`. Given the deterministic-harness goal, use
   `disableToolCallResolution: true` and own tool execution entirely.
2. **An MCP client**, targeting the 2026-07-28 spec — which also means **a
   second `McpProtocol` adapter**, since core implements only 2025-06-18.
   Schemas are reusable; transport, handshake, session management, and
   capability tracking are not present.
3. **Context compaction.** Zero support. `Chat` history grows forever;
   `Tokenizer.truncate` is unwired and drops oldest-first including system
   prompts.
4. **A Tokenizer for Mercury.** No provider ships one.
5. **The TUI renderer** — multi-region layout, streaming-token rendering,
   spinners, correct width measurement. `Prompt.custom`'s 3-arg overload is a
   usable frame loop underneath it.

Plus two smaller gaps: **per-tool-call and per-rollout spans** (§5.2), and
**runtime toolkit rebuild-on-discovery** with name namespacing (§8.3).

### What we get free

Provider abstraction with swappable models; tool schema → JSON Schema (MCP _and_
OpenAI strict dialects); automatic tool parameter validation with model-readable
error messages; parallel handler execution with bounded concurrency;
preliminary/streaming tool results; approval gating with resume; structured
output with schema validation and provider-specific dialect rewriting; SSE
streaming with typed delta parts; an 18-member error taxonomy with retryability
and `retry-after`; GenAI OTel conventions on every model call; native OTLP
export; chat persistence with TTL; `ExecutionPlan` multi-provider escalation;
embeddings with automatic request batching; a complete MCP server; a full CLI
with help, completions, and 13 prompts; guaranteed-cleanup structured
concurrency with first-success racing.

---

## 10. Consolidated gotcha list

**Concurrency:** `onWinner` fires after the continuation (never use it to
identify the winner); `raceAll([])` hangs; `Effect.forEach` has no
`mode: "result"`; `Cause.hasInterrupts` not `isInterrupted`; throwing finalizers
are silently swallowed; `FiberSet` propagates member failures.

**Layers:** memoization keys on `Layer` _object identity_ — a factory call per
rollout silently defeats HTTP-client sharing; `Layer.scoped` doesn't exist;
`Effect.Service` and auto-`.Default` are gone.

**Testing:** `@effect/vitest` README is stale (`it.scoped` doesn't exist;
`TestClock` is at `effect/testing/TestClock`).

**Streams:** `PubSub.publish` with zero subscribers **discards and returns
`true`** — use `replay`; `Stream.buffer` counts elements, `bufferArray` counts
chunks; `Stream.tap` is inline, not forked; stdout backpressure propagates into
the model fiber.

**Schema:** `SCHEMA.md:5138` says `source`, the real key is **`dialect`**;
checks land in `allOf`; `optional` injects a `null` union, `optionalKey`
doesn't; decode with `{errors: "all"}` for repair prompts; JSON Schema derives
from the **encoded** side so `.annotate()` on a transformation is invisible.

**Tracing:** tool calls share the enclosing span (concurrent calls collide);
`captureStackTrace` allocates an `Error` per span by default; there is no
probabilistic sampler.

**CLI/process:** `extendEnv: true` or the child has no `PATH`; `forceKillAfter`
or scope-close can hang forever; read stdout and stderr **concurrently** or
deadlock; nonzero exit is a value, only signal-death is a failure;
`makeTempFileScoped` removes the parent directory recursively.

**Errors:** `Effect.either` → `result`; `catchAll` → `catch`;
`Schedule.intersect` → `max`, `union` → `min`, `compose` gone;
`Schema.TaggedError` → `TaggedErrorClass<Self>()(...)`.

**ExecutionPlan:** `while: false` **escalates**, it doesn't abort; only the last
failure survives; `attempt` is plan-global; **Stream fallback duplicates output
unless `preventFallbackOnPartialStream: true`**.

**AI:** `strictJsonSchema` defaults to `true` (turn it off for Mercury); no
`[DONE]` from the provider means no `finish` part ever;
`Tool.Destructive`/`OpenWorld` default to `true`; unregistered tool handlers
throw a raw `TypeError`; `Prompt.prependSystem`/`appendSystem` duplicate the
system message; `Prompt.fromResponseParts` silently drops file/source/metadata
parts.

---

## 11. Recommended first probes

Per `.claude/rules/probe-before-building.md`, these are the load-bearing shape
assumptions that were _not_ runtime-verified and that the design rests on:

1. **Mercury SSE termination** — does the endpoint send `data: [DONE]`? If not,
   no `finish` part is ever emitted and the whole stream-completion path breaks
   (`OpenAiLanguageModel.ts:1166-1221`).
2. **Mercury tool-call shape** — does it emit OpenAI-style streaming tool-call
   fragments, and does it send `name: null` like Fireworks (the compat client
   handles that, `:1091-1097`)?
3. **`strictJsonSchema: false` round trip** — confirm tool params and structured
   output decode correctly with strict off.
4. **Bounded `PubSub` backpressure end-to-end** through `Stream.tap`, and
   `replay: n` capturing pre-subscription events (§3.3 — both types-only).
5. **`Stream.run(s, stdio.stdout())` throttling upstream** on a slow pipe (§3.4
   — no example exists anywhere in the repo).
6. **LangSmith OTLP ingestion** — do `gen_ai.*` spans render as LLM runs?
