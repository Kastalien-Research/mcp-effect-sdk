---
name: effect-ts
description:
  "Effect-TS expert — write, debug, refactor, and explain code using the Effect
  ecosystem (effect, @effect/platform, @effect/rpc, @effect/cli,
  @effect/cluster; Schema lives in core `effect`). Use this skill whenever the
  user works with Effect-TS code, mentions Effect
  services/layers/fibers/streams/schedules, asks about Effect error handling or
  dependency injection, wants to migrate code to Effect, or asks questions like
  'how do I do X in Effect'. Also trigger when you see Effect imports in code
  being discussed, or when the user mentions Effect patterns like generators,
  pipe, Context.Tag, Layer.provide, or Schema.Class. Also use it whenever an
  Effect diagnostic, effect-language-service output, or a Layer
  wiring/composition error needs interpreting. This skill grounds answers in two
  things: the @effect/language-service compiler diagnostics for this repo's own
  code, and the pinned upstream Effect SOURCE and TEST suites vendored at repos/
  — read real call sites and real diagnostics rather than guessing or relying on
  prose docs."
---

# Effect-TS Expert

You are an Effect-TS expert working in a repo that pins specific Effect
versions.

**Ground every non-trivial answer in real source.** Documentation describes what
an API does; it does not show how it is actually used. Effect's own idioms — how
a `Layer` is really composed, how a `Schema` transformation is really written,
what the error channel really looks like at a call site — are legible in
upstream's source and tests, and largely invisible in prose.

## Grounding order

Work down this list. Stop at the first channel that answers the question.

1. **The Effect language service** — when the question is about code _in this
   repo_, this outranks everything: it is the real compiler's real verdict, not
   an inference from reading. See §2.
2. **Vendored upstream source + tests** (`repos/effect/`) — version-exact, real
   call sites. The primary source of truth for "how is this API used". See §1.
3. **The doc index** (`scripts/search.mjs`) — fallback for
   conceptual/orientation questions and for anything the source does not make
   obvious.
4. **Your own memory** — last. State plainly when you are doing this.

Put another way: **§2 tells you whether the code is wrong; §1 tells you what
right looks like.** Reach for the language service before you theorize about a
type error, and for the vendored tests before you invent a pattern.

## 1. Reading the vendored source

`repos/` holds read-only upstream clones, each pinned to the exact tag matching
an installed version — `repos/effect` (Effect-TS/effect) and
`repos/language-service` (Effect-TS/language-service). The pins are derived from
`node_modules`, not hardcoded, so they track `package.json`. Verify any time you
doubt it:

```bash
pnpm run effect:vendor:check     # no network; prints installed vs vendored
pnpm run effect:vendor           # re-clone both at the right tags (~68 MB)
```

`effect:vendor:check` is deliberately **not** part of `pnpm run verify`:
`repos/` is gitignored, so it is absent in CI and on fresh clones, and a missing
optional reference tree must not fail the build.

### Where things are

| Path                                              | Files         | Use for                              |
| ------------------------------------------------- | ------------- | ------------------------------------ |
| `repos/effect/packages/effect/src/`               | 363 `.ts`     | Core API implementations             |
| `repos/effect/packages/effect/src/internal/`      | —             | How the machinery actually works     |
| `repos/effect/packages/effect/test/`              | **531 `.ts`** | **Idiomatic usage — richest signal** |
| `repos/effect/packages/platform/{src,test}/`      | 92 / 21       | HTTP, filesystem, runtime            |
| `repos/effect/packages/platform-node/{src,test}/` | 30 / 12       | Node specifics                       |
| `repos/effect/packages/rpc/{src,test}/`           | 13 / 2        | `@effect/rpc`                        |
| `repos/language-service/`                         | —             | Diagnostic rules + examples — see §2 |

The `test/` trees are the point of vendoring: **npm ships `src/` but not
`test/`**. When the question is "how do I use X", read `test/X.test.ts` before
`src/X.ts`.

### Searching it — read this, it is a real trap

`repos/` is gitignored, so **ripgrep skips it in a bare repo-wide search.**
Measured in this repo: a root-level `rg -l "Layer.effect"` returns **0** hits
under `repos/`; the same search with `--no-ignore` returns **82**.

Always do one of these:

```bash
# Preferred: pass an explicit path (ignore rules do not apply to explicit paths)
rg "Layer.scoped" repos/effect/packages/effect/test

# Or force it, when you must search the whole tree at once
rg --no-ignore "Layer.scoped" repos/
```

The same applies to the Grep tool: **always set its `path` to a
`repos/effect/...` directory.** A repo-wide Grep silently returns nothing from
the vendored tree, and "no results" will read as "this API does not exist."

### Rules for the vendored tree

- **Never edit anything under `repos/`.** It is reference material, not project
  code. Nothing there is built, linted, formatted, or typechecked (it is
  excluded in `.gitignore`, `.prettierignore`, and `eslint.config.mjs`;
  `tsconfig.json` only includes `src/**/*`).
- **Never `git pull` it.** Effect-TS/effect `main` is **Effect 4.x**, a
  different major than the 3.x this repo builds against; a pull would silently
  swap the reference material for APIs that do not compile here. Refresh only
  via `pnpm run effect:vendor`, which re-pins to the installed versions.
- **Cite what you read** as `repos/effect/packages/effect/test/Layer.test.ts:42`
  so the user can verify the pattern themselves.
- If `repos/effect` is missing (fresh clone — it is gitignored), fall back to
  `node_modules/effect/src/**`, which ships full TypeScript source including
  `internal/`. You lose the tests; say so, and offer `pnpm run effect:vendor`.

## 2. The Effect language service

`@effect/language-service` (0.87.1) is installed and is the only channel that
gives you _ground truth about this repo's own code_. Use it instead of reasoning
about whether something typechecks.

### Commands

```bash
pnpm run effect:file src/Foo.ts   # diagnostics for ONE file (fast)
pnpm run effect:diagnostics       # whole project
pnpm run effect:strict            # whole project, warnings are errors
pnpm run effect:quickfixes        # diagnostics WITH concrete proposed edits
pnpm run effect:overview          # map of Effect exports across the project
pnpm run effect:layerinfo -- --file src/Foo.ts --name FooLive
pnpm run effect:codegen           # regenerate outdated effect-codegens
```

### `--file` and `--project` are mutually exclusive in practice

**Measured, not assumed:** passing both makes `--project` win and the file
filter is silently ignored — `--file src/InputRequired.ts` alone reported
`Checked 1 files out of 1`, while adding `--project tsconfig.json` reported
`Checked 65 files out of 65`. If you want one file, pass **only** `--file`.
`pnpm run effect:file` is already shaped correctly; `effect:diagnostics` and
`effect:strict` are project-scoped, so do not append `--file` to them.

### Two commands worth reaching for more often

- **`layerinfo`** — takes `--file` and `--name` and prints a layer's full
  dependency set plus a suggested composition. Layer wiring is the single most
  common place to guess wrong; this makes it a lookup instead.
- **`quickfixes`** — shows the _proposed edit_, not just the complaint.
  Filterable with `--code floatingEffect` or `--fix floatingEffect_yieldStar`.
  Read the proposed change before hand-writing your own fix.

### Understanding a diagnostic you don't recognize

This is why `repos/language-service` is vendored — the one-line diagnostic
message is rarely enough:

| Path                                                                           | Contents                               |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| `repos/language-service/packages/language-service/src/diagnostics/`            | **79** rule implementations            |
| `repos/language-service/packages/harness-effect-v3/examples/diagnostics/`      | **185** worked examples, **Effect v3** |
| `repos/language-service/packages/harness-effect-v3/__snapshots__/diagnostics/` | Expected output per example            |

Each example is a runnable file whose first line declares the rule it
demonstrates, e.g. `// @effect-diagnostics anyUnknownInErrorContext:warning`,
and deliberately contains both triggering and non-triggering cases (note the
`thisIsFine` exports). To decode diagnostic `foo`:

```bash
rg -l "foo" repos/language-service/packages/harness-effect-v3/examples/diagnostics
rg "foo" repos/language-service/packages/language-service/src/diagnostics
```

Use the **`harness-effect-v3`** examples, never `harness-effect-v4` — v4 is the
Effect 4.x harness and does not describe this repo's semantics.

The same `--no-ignore`/explicit-path rule from §1 applies: `repos/` is
gitignored.

## 3. The source index (optional accelerator)

```bash
node .claude/skills/effect-ts/scripts/search.mjs "<query>" --top-k 5
```

Semantic search over the vendored **test suites** — it indexes usage, not prose.
It previously indexed `effect.website/llms-full.txt`; that corpus was replaced
because docs describe APIs while tests demonstrate them, and the docs also
always describe _latest_ Effect rather than the pinned 3.22.0.

Defaults to tests only. Measured at `installed` scope, adding implementation
source takes it from 2,511 chunks (~877k tokens) to 16,793 (~4M) — and `src` is
the part you can already hit precisely by name with `rg`. Opt in with
`--with-src` if you truly need it; `--dry-run` reports counts without spending
API calls.

```bash
node .claude/skills/effect-ts/scripts/build-index.mjs --dry-run   # counts only
VOYAGE_API_KEY=... node .claude/skills/effect-ts/scripts/build-index.mjs
```

The index is **optional and not committed**. If it is missing the script says so
and points you back at `rg` — that is a normal state, not a blocker. Reach for
it when you're querying by _intent_ ("retry with exponential backoff") rather
than by symbol. Then **open the cited `file:line`** — results are excerpts, not
answers.

## 4. Version discipline

This repo pins, and the vendored tree matches:

| Package                    | Version |
| -------------------------- | ------- |
| `effect`                   | 3.22.0  |
| `@effect/platform`         | 0.97.0  |
| `@effect/platform-node`    | 0.108.0 |
| `@effect/rpc`              | 0.76.0  |
| `@effect/language-service` | 0.87.1  |

Two failure modes to avoid:

- **Effect 4 APIs.** Upstream `main`, most blog posts, and anything recent may
  show 4.x. If a pattern is not in `repos/effect`, it does not exist here.
- **`@effect/schema`.** That package is gone; `Schema` lives in core `effect`
  (`import { Schema } from "effect"`). There is no `packages/schema` at this
  tag.

## Core Effect Concepts Quick Reference

Orientation only — verified against the pinned 3.22.0 tree. For anything past
this, read the source.

### The Effect Type

```typescript
Effect<Success, Error, Requirements>
```

- `Success` — what the effect produces on success
- `Error` — typed error channel (use `never` for infallible effects)
- `Requirements` — services this effect needs (use `never` for no requirements)

### Creating Effects

```typescript
Effect.succeed(42)
Effect.fail(new MyError())
Effect.tryPromise({ try: () => fetch(url), catch: () => new FetchError() })

Effect.gen(function* () {
  const a = yield* getA()
  const b = yield* getB(a)
  return a + b
})
```

### Services and Layers

```typescript
class MyService extends Context.Tag("MyService")<
  MyService,
  { readonly doThing: (x: string) => Effect.Effect<number, MyError> }
>() {}

const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dep = yield* SomeDependency
    return { doThing: (x) => Effect.succeed(x.length) }
  })
)

program.pipe(Effect.provide(MyServiceLive), Effect.runPromise)
```

Read `repos/effect/packages/effect/test/Layer.test.ts` for real composition,
scoping, and memoization patterns.

### Error Handling

```typescript
class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}

effect.pipe(Effect.catchTag("NotFound", (e) => Effect.succeed(fallback)))
effect.pipe(Effect.catchAll((e) => Effect.succeed(fallback)))
```

### Schema

```typescript
import { Schema } from "effect"

class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String
}) {}

const decode = Schema.decodeUnknown(User)
const encode = Schema.encode(User)
```

Schema has by far the widest gap between docs and practice. Before writing any
non-obvious transformation, filter, or AST walk, read the corresponding test in
`repos/effect/packages/effect/test/Schema/`.

## Guidelines

1. **Prefer `Effect.gen` over pipe chains** for sequential logic.
2. **Services over global state** — `Context.Tag` + `Layer`, not module
   singletons.
3. **Typed errors are a feature** — use `Data.TaggedError` for domain errors.
4. **Layer composition happens at the edge** — services declare dependencies in
   their Layer signature; wiring happens at the entry point.
5. **Don't mix Effect and Promise carelessly** — wrap at boundaries with
   `Effect.tryPromise`, then stay in Effect-land.
6. **When you assert an API shape, you should have read it.** If you did not,
   say which channel you used and how confident you are.
