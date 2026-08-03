# inception-cli M0 (Mercury probes) + M1 core (eval spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empirically characterize Mercury 2 on agent-shaped calls (probes
P0–P6, results committed as fixtures) and stand up the eval spine's
probe-independent core: idempotent result store, case runner, `whole` +
`search-replace` edit-format arms, a 5-exercise TypeScript seed corpus, split
parse/apply metrics, and LangSmith tracing.

**Architecture:** A new `@inception-cli/evals` workspace package (plain
TypeScript + vitest + raw `fetch` — the Effect beta pin deliberately waits for
M2). Probes are thin scripts over a shared HTTP/report helper; the eval runner
is a pure function over an injected `chat` dependency so every harness behavior
is testable without the network. Per the ledger decision
`inception-cli-v1-edit-policy-exact-match-only`, the search-replace applier is
exact-match-or-fail with a uniqueness check — no fuzzy tiers.

**Tech Stack:** Node ≥ 22 (native fetch), pnpm workspace, tsx, vitest, ajv
(schema validation in probes), `langsmith` JS SDK (already a root dependency).

**Scope note:** M1 Phase B (udiff + grammar-constrained-patch arms, corpus
expansion, BFCL-style multi-turn tool eval, code-mode arm) is a separate
follow-up plan, gated on this plan's probe report — the arms depend on probe
outcomes (e.g., whether FIM/Edit endpoints exist). This is a deliberate
sequencing decision from the spec (§9, M0 exit criterion), not an omission.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-inception-cli-agent-design.md`.
  Decision ledger governs `apps/inception-cli` — before changing
  edit-application behavior, consult decision
  `inception-cli-v1-edit-policy-exact-match-only`.
- Package manager: pnpm. The repo hook **blocks bare `pnpm install`** — use
  `pnpm install --frozen-lockfile` for clean installs and `pnpm add <dep>` /
  `pnpm add -D <dep>` (which update the lockfile) to add dependencies.
- Node `>=22`. TypeScript strict. No new runtime deps beyond those named
  per-task.
- Env: `INCEPTION_API_KEY` (required, from repo-root `.env` — never print it),
  `INCEPTION_BASE_URL` (optional, default `https://api.inceptionlabs.ai/v1`),
  `LANGSMITH_*` (already in `.env`). `.env` is hook-protected: never edit it;
  read-only.
- Probes report **raw measurements only** (counts, timings, verbatim frames) —
  never `success`/`ok` booleans. Interpretation happens in the probe report doc,
  reviewed by a different actor (no-self-graded-verification).
- Pricing constants for cost math: input $0.25/M, output $0.75/M, cached input
  $0.025/M.
- Commit style: imperative, ≤72-char subject, one logical change. Work is not
  complete until pushed (branch `research/mcp-cli-agent` or a child branch —
  never main).
- Generated-code execution: eval cases run model-generated code via vitest in a
  child process in a temp workdir. This is local, single-trust-domain execution
  — same trust level as running any agent-written tests in this repo. Do not add
  network calls to corpus tests.

### Hub protocol (applies to every task)

The Claude Teams Hub runs at `http://localhost:1731` (start if down:
`cd claude-teams-hub && pnpm dev`). Workspace:
`4597102c-fbfe-406b-93ee-d27b661ec53a`. The orchestrator mirrors each task as a
hub problem and tells the implementer its `problemId`.

Each implementing subagent, once at start:

```bash
curl -s -X POST localhost:1731/hub/api -H 'Content-Type: application/json' -d '{
  "operation":"quick_join","name":"<task-N-short-name>",
  "workspaceId":"4597102c-fbfe-406b-93ee-d27b661ec53a","profile":"DEBUGGER"}'
# → record .agentId as HUB_AGENT_ID for this task
```

On completion (and on any surprising finding mid-task):

```bash
curl -s -X POST localhost:1731/hub/api -H 'Content-Type: application/json' -d '{
  "operation":"post_message","agentId":"'"$HUB_AGENT_ID"'",
  "workspaceId":"4597102c-fbfe-406b-93ee-d27b661ec53a",
  "problemId":"<problemId from orchestrator>",
  "content":"<what ran, raw result summary, files touched, anything surprising>"}'
```

Reports to the orchestrator carry raw measurements (test counts, verbatim tail
of typecheck output); the orchestrator re-runs verification before accepting.

---

### Task 1: Workspace package scaffold

**Files:**

- Modify: `pnpm-workspace.yaml` (add glob)
- Create: `apps/inception-cli/packages/evals/package.json`
- Create: `apps/inception-cli/packages/evals/tsconfig.json`
- Create: `apps/inception-cli/packages/evals/src/smoke.test.ts`
- Create: `apps/inception-cli/packages/evals/.gitignore`

**Interfaces:**

- Produces: workspace package `@inception-cli/evals`;
  `pnpm -F @inception-cli/evals test` and
  `pnpm -F @inception-cli/evals typecheck` as the verification commands every
  later task uses.

- [ ] **Step 1: Add the workspace glob**

In `pnpm-workspace.yaml`, extend `packages:`:

```yaml
packages:
  - "."
  - "test/conformance"
  - "apps/inception-cli/packages/*"
```

- [ ] **Step 2: Create the package**

`apps/inception-cli/packages/evals/package.json`:

```json
{
  "name": "@inception-cli/evals",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=22" }
}
```

`apps/inception-cli/packages/evals/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "probes", "corpus"]
}
```

`apps/inception-cli/packages/evals/.gitignore`:

```
runs/
```

- [ ] **Step 3: Add dev tooling**

```bash
pnpm -F @inception-cli/evals add -D vitest tsx typescript @types/node
```

- [ ] **Step 4: Write the smoke test**

`src/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest"

describe("evals package", () => {
  it("runs under vitest", () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Verify both commands pass**

Run: `pnpm -F @inception-cli/evals test` → 1 passed. Run:
`pnpm -F @inception-cli/evals typecheck` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml apps/inception-cli
git commit -m "feat(evals): scaffold @inception-cli/evals workspace package"
```

---

### Task 2: Probe/report toolkit (env, HTTP, timing, fixture writer)

**Files:**

- Create: `apps/inception-cli/packages/evals/src/lib/env.ts`
- Create: `apps/inception-cli/packages/evals/src/lib/mercury.ts`
- Create: `apps/inception-cli/packages/evals/src/lib/report.ts`
- Test: `apps/inception-cli/packages/evals/src/lib/env.test.ts`
- Test: `apps/inception-cli/packages/evals/src/lib/report.test.ts`

**Interfaces:**

- Produces:
  - `loadEnv(root?: string): Record<string, string>` — parses a `.env` file
    (KEY="v" / KEY=v lines, `#` comments) into a record WITHOUT mutating
    `process.env`; `mercuryConfig(env): { apiKey: string; baseUrl: string }` —
    throws `Error("INCEPTION_API_KEY missing")` when absent; baseUrl defaults to
    `https://api.inceptionlabs.ai/v1`.
  - `mercuryFetch(cfg, path: string, body: unknown): Promise<Response>` — POST
    JSON with `Authorization: Bearer`, no retries (probes must see raw
    failures); `mercuryGet(cfg, path: string): Promise<Response>`.
  - `streamChat(cfg, body): Promise<StreamCapture>` where
    `StreamCapture = { ttfbMs: number; ttftMs: number | null; totalMs: number; rawFrames: string[]; text: string; toolCallFrames: unknown[]; finishReason: string | null; sawDoneSentinel: boolean; usage: unknown }`
    — POSTs `{...body, stream: true}` to `/chat/completions`, reads SSE
    line-by-line, records every `data:` line verbatim into `rawFrames`, marks
    `sawDoneSentinel` when the literal `[DONE]` frame arrives, `ttftMs` = first
    frame containing non-empty `choices[0].delta.content` or a `tool_calls`
    delta.
  - `writeProbeReport(name: string, data: unknown): string` — writes
    `fixtures/probes/<name>.json` (creating dirs) as
    `{ probe, capturedAt, baseUrlHost, data }` with `capturedAt` an ISO
    timestamp and `baseUrlHost` the hostname only (never the key); returns the
    path.

- [ ] **Step 1: Write failing tests for env + report**

`src/lib/env.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadEnv, mercuryConfig } from "./env.js"

describe("loadEnv", () => {
  it("parses quoted and bare values, skips comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"))
    writeFileSync(join(dir, ".env"), '# c\nA="x y"\nB=plain\n\n')
    expect(loadEnv(dir)).toEqual({ A: "x y", B: "plain" })
  })
})

describe("mercuryConfig", () => {
  it("throws without INCEPTION_API_KEY", () => {
    expect(() => mercuryConfig({})).toThrow("INCEPTION_API_KEY missing")
  })
  it("defaults the base URL", () => {
    expect(mercuryConfig({ INCEPTION_API_KEY: "k" }).baseUrl).toBe(
      "https://api.inceptionlabs.ai/v1"
    )
  })
})
```

`src/lib/report.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { writeProbeReport } from "./report.js"

describe("writeProbeReport", () => {
  it("writes name, timestamp, host — and never the API key", () => {
    const p = writeProbeReport("unit-test-probe", { n: 1 })
    const parsed = JSON.parse(readFileSync(p, "utf8"))
    expect(parsed.probe).toBe("unit-test-probe")
    expect(parsed.data).toEqual({ n: 1 })
    expect(JSON.stringify(parsed)).not.toContain("sk_")
    expect(typeof parsed.capturedAt).toBe("string")
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**
      (`pnpm -F @inception-cli/evals test` → module not found)

- [ ] **Step 3: Implement `env.ts`, `report.ts`, `mercury.ts`**

`src/lib/env.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"

export function loadEnv(root = process.cwd()): Record<string, string> {
  let text: string
  try {
    text = readFileSync(join(root, ".env"), "utf8")
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq < 1) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}

export interface MercuryConfig {
  apiKey: string
  baseUrl: string
}

export function mercuryConfig(
  env: Record<string, string | undefined>
): MercuryConfig {
  const apiKey = env["INCEPTION_API_KEY"]
  if (!apiKey) throw new Error("INCEPTION_API_KEY missing")
  return {
    apiKey,
    baseUrl: env["INCEPTION_BASE_URL"] ?? "https://api.inceptionlabs.ai/v1"
  }
}
```

`src/lib/report.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

export function writeProbeReport(
  name: string,
  data: unknown,
  host = "api.inceptionlabs.ai"
): string {
  const path = join(pkgRoot, "fixtures", "probes", `${name}.json`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      {
        probe: name,
        capturedAt: new Date().toISOString(),
        baseUrlHost: host,
        data
      },
      null,
      2
    )
  )
  return path
}
```

`src/lib/mercury.ts` (no unit test — exercised by probes; keep it thin):

```ts
import type { MercuryConfig } from "./env.js"

export function mercuryGet(
  cfg: MercuryConfig,
  path: string
): Promise<Response> {
  return fetch(`${cfg.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` }
  })
}

export function mercuryFetch(
  cfg: MercuryConfig,
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })
}

export interface StreamCapture {
  ttfbMs: number
  ttftMs: number | null
  totalMs: number
  rawFrames: string[]
  text: string
  toolCallFrames: unknown[]
  finishReason: string | null
  sawDoneSentinel: boolean
  usage: unknown
}

export async function streamChat(
  cfg: MercuryConfig,
  body: Record<string, unknown>
): Promise<StreamCapture> {
  const t0 = performance.now()
  const res = await mercuryFetch(cfg, "/chat/completions", {
    ...body,
    stream: true
  })
  const ttfbMs = performance.now() - t0
  if (!res.ok || !res.body)
    throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  const cap: StreamCapture = {
    ttfbMs,
    ttftMs: null,
    totalMs: 0,
    rawFrames: [],
    text: "",
    toolCallFrames: [],
    finishReason: null,
    sawDoneSentinel: false,
    usage: null
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += value
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      cap.rawFrames.push(payload)
      if (payload === "[DONE]") {
        cap.sawDoneSentinel = true
        continue
      }
      try {
        const json = JSON.parse(payload)
        const delta = json.choices?.[0]?.delta
        if (json.usage) cap.usage = json.usage
        if (json.choices?.[0]?.finish_reason)
          cap.finishReason = json.choices[0].finish_reason
        if (delta?.tool_calls) cap.toolCallFrames.push(delta.tool_calls)
        if (typeof delta?.content === "string" && delta.content.length > 0)
          cap.text += delta.content
        if (
          cap.ttftMs === null &&
          (delta?.tool_calls || (delta?.content ?? "") !== "")
        ) {
          cap.ttftMs = performance.now() - t0
        }
      } catch {
        /* keep raw frame; parse failures are data, not errors */
      }
    }
  }
  cap.totalMs = performance.now() - t0
  return cap
}
```

- [ ] **Step 4: Run tests, verify pass; run typecheck**
      (`pnpm -F @inception-cli/evals test && pnpm -F @inception-cli/evals typecheck`)

- [ ] **Step 5: Commit**
      (`git add apps/inception-cli && git commit -m "feat(evals): probe toolkit — env, SSE capture, fixture writer"`)

---

### Task 3: P0+P1 — model inventory and latency profile

**Files:**

- Create: `apps/inception-cli/packages/evals/probes/p0-models.ts`
- Create: `apps/inception-cli/packages/evals/probes/p1-latency.ts`
- Create: `apps/inception-cli/packages/evals/src/lib/constants.ts`

**Interfaces:**

- Consumes: Task 2 toolkit.
- Produces: `fixtures/probes/p0-models.json`, `fixtures/probes/p1-latency.json`;
  `constants.ts` exporting `MERCURY_MODEL` (set from observed P0 output) and
  `PRICING = { inputPerM: 0.25, outputPerM: 0.75, cachedInputPerM: 0.025 }`.

- [ ] **Step 1: Write `p0-models.ts`**

```ts
import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { mercuryGet } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })
const res = await mercuryGet(cfg, "/models")
const body = await res.json().catch(async () => ({ raw: await res.text() }))
console.log(JSON.stringify(body, null, 2))
console.log(
  "report:",
  writeProbeReport("p0-models", { status: res.status, body })
)
```

Run: `cd apps/inception-cli/packages/evals && pnpm exec tsx probes/p0-models.ts`
Expected: HTTP 200 and a model list. **Record the exact chat-model id.**

- [ ] **Step 2: Write `constants.ts` with the OBSERVED model id**

```ts
// MERCURY_MODEL comes from fixtures/probes/p0-models.json — verified, not guessed.
export const MERCURY_MODEL = "<observed id from P0>"
export const PRICING = {
  inputPerM: 0.25,
  outputPerM: 0.75,
  cachedInputPerM: 0.025
}
```

(Replace the placeholder with the real id in the same edit that lands the P0
fixture — the file must never ship with the angle-bracket value. If `/models`
fails, stop and escalate; do not guess an id.)

- [ ] **Step 3: Write `p1-latency.ts`**

Cells: `reasoning_effort` ∈ `["instant","low","medium","high"]` × prompt shape ∈
`short` (~60 tokens), `long` (~30k tokens of synthetic file content), `tools`
(short prompt + 8 tool schemas, `tool_choice: "auto"`); 3 repetitions per cell,
sequential, so later reps expose provider-side prefix caching.

```ts
import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { streamChat } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })
const filler = "export const x = 1; // synthetic line of code padding\n".repeat(
  3000
)
const tools = Array.from({ length: 8 }, (_, i) => ({
  type: "function",
  function: {
    name: `tool_${i}`,
    description: `Synthetic tool number ${i} for schema-weight testing`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        count: { type: "integer" },
        mode: { type: "string", enum: ["a", "b"] }
      },
      required: ["path"]
    }
  }
}))
const shapes: Record<string, Record<string, unknown>> = {
  short: {
    messages: [
      {
        role: "user",
        content: "Summarize what a git rebase does in two sentences."
      }
    ]
  },
  long: {
    messages: [
      { role: "user", content: `Given this code:\n${filler}\nName one export.` }
    ]
  },
  tools: {
    messages: [
      { role: "user", content: "Read ./a.ts using an appropriate tool." }
    ],
    tools,
    tool_choice: "auto"
  }
}
const samples: unknown[] = []
for (const effort of ["instant", "low", "medium", "high"]) {
  for (const [shape, base] of Object.entries(shapes)) {
    for (let rep = 0; rep < 3; rep++) {
      const cap = await streamChat(cfg, {
        model: MERCURY_MODEL,
        reasoning_effort: effort,
        max_tokens: 300,
        ...base
      })
      const rec = {
        effort,
        shape,
        rep,
        ttfbMs: Math.round(cap.ttfbMs),
        ttftMs: cap.ttftMs && Math.round(cap.ttftMs),
        totalMs: Math.round(cap.totalMs),
        usage: cap.usage,
        finishReason: cap.finishReason,
        sawDone: cap.sawDoneSentinel,
        frames: cap.rawFrames.length
      }
      samples.push(rec)
      console.log(JSON.stringify(rec))
    }
  }
}
console.log(
  "report:",
  writeProbeReport("p1-latency", { model: MERCURY_MODEL, samples })
)
```

- [ ] **Step 4: Run P1** (`pnpm exec tsx probes/p1-latency.ts`; 36 calls, expect
      a few minutes). Spot-check: every sample has `totalMs`; note any cell
      where `ttftMs` approaches the published 12.7s figure.

- [ ] **Step 5: Commit fixtures + scripts**
      (`git add apps/inception-cli && git commit -m "feat(evals): P0/P1 probes — model inventory and latency profile"`)

---

### Task 4: P2+P3 — stream termination and tool-call fragment shapes

**Files:**

- Create: `apps/inception-cli/packages/evals/probes/p2-termination.ts`
- Create: `apps/inception-cli/packages/evals/probes/p3-tool-fragments.ts`

**Interfaces:**

- Consumes: Task 2 toolkit, Task 3 `MERCURY_MODEL`.
- Produces: `fixtures/probes/p2-termination.json` (tails of raw frame logs
  across 5 runs, `sawDoneSentinel` per run),
  `fixtures/probes/p3-tool-fragments.json` (verbatim `tool_calls` delta
  sequences for forced single and multi tool calls).

- [ ] **Step 1: `p2-termination.ts`** — 5 short streamed completions; record for
      each: last 6 `rawFrames` verbatim, `sawDoneSentinel`, `finishReason`,
      whether `usage` arrived. Write one report.

```ts
import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { streamChat } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })
const runs: unknown[] = []
for (let i = 0; i < 5; i++) {
  const cap = await streamChat(cfg, {
    model: MERCURY_MODEL,
    max_tokens: 60,
    messages: [{ role: "user", content: `Say "run ${i} ok" and nothing else.` }]
  })
  runs.push({
    i,
    sawDone: cap.sawDoneSentinel,
    finishReason: cap.finishReason,
    hasUsage: cap.usage !== null,
    tailFrames: cap.rawFrames.slice(-6)
  })
}
console.log(
  "report:",
  writeProbeReport("p2-termination", { model: MERCURY_MODEL, runs })
)
```

- [ ] **Step 2: `p3-tool-fragments.ts`** — two scenarios, 3 reps each: (a)
      `tool_choice: {type:"function", function:{name:"read_file"}}` forcing one
      call; (b) a prompt asking to read two files with `tool_choice: "auto"` to
      see whether parallel/multiple `tool_calls` appear. Record the full
      `toolCallFrames` array verbatim per run (this is the fixture the M2
      provider client will be written against), plus `finishReason`.

Tool schema for both:

```ts
const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the workspace",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer" }
        },
        required: ["path"]
      }
    }
  }
]
```

- [ ] **Step 3: Run both, eyeball frames** (verify fragments captured, not
      empty), commit:
      `git commit -m "feat(evals): P2/P3 probes — stream termination and tool-call wire shapes"`

---

### Task 5: P4 — schema-constrained output round trip

**Files:**

- Create: `apps/inception-cli/packages/evals/probes/p4-structured.ts`

**Interfaces:**

- Consumes: toolkit; `ajv` (add: `pnpm -F @inception-cli/evals add ajv@8.20.0` —
  pin to the root repo's version).
- Produces: `fixtures/probes/p4-structured.json` — per variant: raw response
  text/args, `jsonParsed` boolean, `schemaValid` boolean, ajv error list.

- [ ] **Step 1: Write the probe.** Three variants × 3 reps, all non-streamed
      (`mercuryFetch` to `/chat/completions`):
  1. `response_format: { type: "json_schema", json_schema: { name: "extract", strict: false, schema: SCHEMA } }`
  2. Same with `strict: true` (record whether the API rejects it or degrades),
  3. Forced tool call whose `parameters` is `SCHEMA` — validate the arguments
     string.

`SCHEMA` (moderately nasty on purpose — nested object, enum, array, optional):

```ts
const SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          action: { type: "string", enum: ["create", "modify", "delete"] },
          hunks: { type: "integer" }
        },
        required: ["path", "action"]
      }
    },
    summary: { type: "string" },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["files", "summary"]
} as const
```

Prompt: "Plan edits to rename function `foo` to `bar` across src/a.ts and
src/b.ts; respond per the schema." Validate each response with ajv
(`allErrors: true`); record raw text + booleans + errors. No verdicts.

- [ ] **Step 2: Run, commit** —
      `git commit -m "feat(evals): P4 probe — schema-constrained output round trip"`

---

### Task 6: P5 — tool-call reliability sample

**Files:**

- Create: `apps/inception-cli/packages/evals/probes/p5-reliability.ts`

**Interfaces:**

- Consumes: toolkit, ajv, P4's `SCHEMA` pattern.
- Produces: `fixtures/probes/p5-reliability.json` — 20 records:
  `{ rep, httpStatus, argsRaw, jsonParsed, schemaValid, ajvErrors, usage }` and
  nothing aggregated beyond `counts: { jsonParsed, schemaValid }` (raw tallies).

- [ ] **Step 1: Write the probe** — 20 sequential non-streamed calls, forced
      tool call (`tool_choice` naming the tool), tool `parameters` = a 3-level
      schema:
      `apply_edit({ file: { path, language∈enum }, edit: { kind∈["insert","replace"], anchor: string, lines: string[] }, dryRun?: boolean })`
      with `required` at each level. Prompt varies per rep (template over 5
      small code snippets × 4 instructions) so reps aren't cache-identical.
      Validate `arguments` with ajv; tally.

- [ ] **Step 2: Run, commit.** These raw counts are the direct evidence for
      ledger assumption `08dca5e2` (anchor-reproduction reliability); do not
      editorialize in the fixture.
      `git commit -m "feat(evals): P5 probe — 20-call tool reliability sample"`

---

### Task 7: P6 — FIM/Edit endpoint existence

**Files:**

- Create: `apps/inception-cli/packages/evals/probes/p6-fim.ts`

**Interfaces:**

- Consumes: toolkit.
- Produces: `fixtures/probes/p6-fim.json` — per candidate endpoint: status
  code + first 500 chars of body.

- [ ] **Step 1: Write the probe.** Candidates (from dllm-agent prior art +
      OpenAI conventions):
  - `POST /completions` with
    `{ model, prompt: "function add(", suffix: ") { return a + b }", max_tokens: 20 }`
    (OpenAI FIM convention via suffix)
  - `POST /fim/completions` same body
  - `POST /edits` with
    `{ model, input: "const x=1", instruction: "rename x to y" }`
  - `GET /models` output re-scanned for edit/coder-suffixed model ids (from the
    P0 fixture, no new call)

  Record status + body snippet for each; 404s are findings, not failures.

- [ ] **Step 2: Run, commit** —
      `git commit -m "feat(evals): P6 probe — FIM/edit endpoint existence"`

---

### Task 8: Probe report + ledger outcome (orchestrator task — not delegated)

**Files:**

- Create: `docs/research/mercury-2-probe-report.md`

**Interfaces:**

- Consumes: all `fixtures/probes/*.json`.
- Produces: the M0 exit artifact; design deltas (if any) applied to the spec;
  hub ledger updated.

- [ ] **Step 1: Write the report** — one section per probe: methodology (2
      lines), the fixture's key numbers in a table, and an explicit "design
      consequence" line each (e.g., P2 → whether Effect's `[DONE]`-keyed finish
      path works unmodified; P1 → whether TTFT forces loop-shape changes; P5 →
      whether the exact-match bet's assumption survives first contact).
- [ ] **Step 2: Record raw outcome against the ledger decision** (data = counts
      only, verdict = categorical):

```bash
curl -s -X POST localhost:1731/hub/api -H 'Content-Type: application/json' -d '{
  "operation":"record_outcome","agentId":"c041060f-fc0e-49bc-8e04-40388e65119e",
  "decisionId":"897ad11b-0913-4427-8806-c2916f114088",
  "data":{"p5_json_parsed":"<n>/20","p5_schema_valid":"<n>/20","fixtures":"apps/inception-cli/packages/evals/fixtures/probes/"},
  "expectationAssessment":"<met|not-met|unclear>"}'
```

If P5's counts undermine assumption `08dca5e2-5686-4f02-973d-474fe7f24a97`,
additionally `challenge_assumption` with the fixture path as `evidenceRefs` —
the health flag then follows the decision everywhere.

- [ ] **Step 3: Apply spec deltas** (if probes contradict the spec, edit the
      spec in the same commit and say so in the report), post a workspace
      summary to the hub, commit + push:
      `git commit -m "docs: Mercury 2 probe report (M0 exit)"`

**M0 gate: user reviews the probe report before M1 tasks 10+ run against the
live model.** (Tasks 9–13 are network-free and may proceed in parallel with M0.)

---

### Task 9: Idempotent result store

**Files:**

- Create: `apps/inception-cli/packages/evals/src/harness/results.ts`
- Test: `apps/inception-cli/packages/evals/src/harness/results.test.ts`

**Interfaces:**

- Produces:
  - `interface CaseKey { exercise: string; format: string; model: string; attempt_budget: number }`
  - `interface CaseResult { key: CaseKey; tests_outcomes: boolean[]; parse_error: boolean; apply_error: boolean; prompt_tokens: number; completion_tokens: number; cost_usd: number; duration_ms: number; commit: string; error?: string }`
  - `caseId(key: CaseKey): string` —
    `${exercise}--${format}--${model}--r${attempt_budget}` sanitized to
    `[A-Za-z0-9._-]`
  - `loadOrRun(runDir: string, key: CaseKey, run: () => Promise<CaseResult>): Promise<{ result: CaseResult; cached: boolean }>`
    — if `<runDir>/<caseId>.json` exists AND parses AND its `key` deep-equals,
    return it (`cached: true`); on missing OR unparseable, execute `run`, write
    atomically (`tmp` + rename), return (`cached: false`).

- [ ] **Step 1: Write failing tests** — four cases: (1) miss → runs and writes;
      (2) hit → returns cached without calling `run` (spy); (3) corrupt JSON on
      disk → re-runs and overwrites; (4) `caseId` sanitizes `/` in exercise
      names.

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { caseId, loadOrRun, type CaseKey, type CaseResult } from "./results.js"

const key: CaseKey = {
  exercise: "luhn",
  format: "whole",
  model: "m",
  attempt_budget: 2
}
const mkResult = (): CaseResult => ({
  key,
  tests_outcomes: [false, true],
  parse_error: false,
  apply_error: false,
  prompt_tokens: 10,
  completion_tokens: 20,
  cost_usd: 0.001,
  duration_ms: 5,
  commit: "abc"
})

describe("loadOrRun", () => {
  it("runs and persists on miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "res-"))
    const { result, cached } = await loadOrRun(dir, key, async () => mkResult())
    expect(cached).toBe(false)
    expect(
      JSON.parse(readFileSync(join(dir, `${caseId(key)}.json`), "utf8")).key
        .exercise
    ).toBe("luhn")
    expect(result.tests_outcomes).toEqual([false, true])
  })
  it("short-circuits on hit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "res-"))
    await loadOrRun(dir, key, async () => mkResult())
    const spy = vi.fn(async () => mkResult())
    const { cached } = await loadOrRun(dir, key, spy)
    expect(cached).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })
  it("re-runs on corrupt record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "res-"))
    writeFileSync(join(dir, `${caseId(key)}.json`), "{not json")
    const { cached } = await loadOrRun(dir, key, async () => mkResult())
    expect(cached).toBe(false)
  })
  it("caseId is filesystem-safe", () => {
    expect(caseId({ ...key, exercise: "a/b" })).not.toContain("/")
  })
})
```

- [ ] **Step 2: Verify fail → implement → verify pass** (implementation is ~40
      lines following the interface above; atomic write = write `<path>.tmp`,
      `renameSync`).
- [ ] **Step 3: Commit** —
      `git commit -m "feat(evals): idempotent per-case result store"`

---

### Task 10: Edit-format arms — `whole` and `search-replace`

**Files:**

- Create: `apps/inception-cli/packages/evals/src/harness/formats/types.ts`
- Create: `apps/inception-cli/packages/evals/src/harness/formats/whole.ts`
- Create:
  `apps/inception-cli/packages/evals/src/harness/formats/search-replace.ts`
- Test: `apps/inception-cli/packages/evals/src/harness/formats/whole.test.ts`
- Test:
  `apps/inception-cli/packages/evals/src/harness/formats/search-replace.test.ts`

**Interfaces:**

- Produces:

```ts
// types.ts — the contract every arm implements, and the parse/apply SPLIT the metrics need
export interface FileMap {
  [path: string]: string
}
export interface EditFormat {
  name: string
  /** Instructions appended to the system prompt describing exactly how to emit edits. */
  formatInstructions: string
  /** Render current file contents into the user prompt. */
  renderFiles(files: FileMap): string
  /** Throws ParseError on malformed output; returns parsed edits otherwise. */
  parse(response: string): ParsedEdit[]
  /** Throws ApplyError when a parsed edit cannot be applied; returns new FileMap. */
  apply(edits: ParsedEdit[], files: FileMap): FileMap
}
export interface ParsedEdit {
  path: string
  payload: unknown
}
export class ParseError extends Error {
  readonly kind = "parse"
}
export class ApplyError extends Error {
  readonly kind = "apply"
}
```

- `whole`: model emits, per file, a line with the path followed by a fenced
  block containing the complete new content. Parse: scan for
  `^(\S+\.\w+)\n```[a-z]*\n([\s\S]*?)\n```` blocks; zero blocks → `ParseError`. Apply: replace file wholesale (unknown path = new file; apply never fails → `ApplyError`
  unreachable for this arm, which is exactly why the metric split matters).
- `search-replace`: aider-style conflict blocks; **exact-match-or-fail with
  uniqueness** per ledger decision:

```
path/to/file.ts
<<<<<<< SEARCH
(old text, verbatim)
=======
(new text)
>>>>>>> REPLACE
```

    Parse errors: missing path line, missing `=======`, unterminated block. Apply errors: SEARCH not found; SEARCH found more than once (ambiguous — report count); empty SEARCH on an existing file is "create" only when the file does not exist, else `ApplyError`.

- [ ] **Step 1: Write failing tests.** `search-replace.test.ts` must cover:
      happy path; multi-block; create-new-file via empty SEARCH; parse error on
      missing divider (asserted `instanceof ParseError`); apply error on
      non-match (`instanceof ApplyError`, message contains the path); apply
      error on ambiguous match (message contains occurrence count); CRLF input
      normalized to `\n` before matching. `whole.test.ts`: single file replace,
      two files, new file, `ParseError` when no fenced block found, fence
      language tag optional.

Representative test bodies:

```ts
it("fails apply, not parse, when SEARCH text is absent", () => {
  const edits = searchReplace.parse(block("src/a.ts", "NOT PRESENT", "x"))
  expect(() =>
    searchReplace.apply(edits, { "src/a.ts": "const a = 1\n" })
  ).toThrow(ApplyError)
})
it("rejects ambiguous SEARCH with occurrence count", () => {
  const edits = searchReplace.parse(block("src/a.ts", "dup()", "one()"))
  expect(() =>
    searchReplace.apply(edits, { "src/a.ts": "dup()\ndup()\n" })
  ).toThrow(/2 occurrences/)
})
```

(`block(path, search, replace)` is a local test helper assembling the wire
format.)

- [ ] **Step 2: Verify fail → implement both arms → verify pass.**
      `formatInstructions` strings are part of the implementation — write them
      tersely and imperatively (≤15 lines each); they are executor prompts, per
      the spec's stripped-executor principle.
- [ ] **Step 3: Typecheck + commit** —
      `git commit -m "feat(evals): whole and search-replace edit-format arms (exact-match per ledger)"`

---

### Task 11: Seed corpus (5 TypeScript exercises)

**Files:**

- Create, per exercise `E` in {`run-length-encoding`, `luhn`, `clock`,
  `flatten-array`, `matching-brackets`}:
  - `apps/inception-cli/packages/evals/corpus/ts/E/instructions.md`
  - `apps/inception-cli/packages/evals/corpus/ts/E/src/index.ts` (stub: exported
    signature, body `throw new Error("implement me")`)
  - `apps/inception-cli/packages/evals/corpus/ts/E/tests/index.test.ts`
- Create: `apps/inception-cli/packages/evals/src/harness/corpus.ts`
- Test: `apps/inception-cli/packages/evals/src/harness/corpus.test.ts`

**Interfaces:**

- Produces: `listExercises(): Promise<Exercise[]>` with
  `Exercise = { name: string; instructions: string; files: FileMap; testFiles: FileMap }`
  — `files` is what the model may edit (`src/`), `testFiles` is pristine and
  re-copied before every test run (models must not be able to alter tests).

- [ ] **Step 1: Author the five exercises.** Standard exercism-style specs; each
      `instructions.md` states the task in ≤10 lines; each test file is 6–10
      `expect` cases via vitest. Example — `luhn`:

`instructions.md`:

```markdown
# Luhn

Implement `valid(digits: string): boolean` — the Luhn checksum. Strings of
length ≤ 1, or containing non-digit non-space characters, are invalid. Spaces
are allowed and ignored. Double every second digit from the right; subtract 9
when a doubled digit exceeds 9; valid iff the sum % 10 === 0.
```

`src/index.ts`:

```ts
export function valid(digits: string): boolean {
  throw new Error("implement me")
}
```

`tests/index.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { valid } from "../src/index.js"

describe("luhn", () => {
  it("valid canonical number", () =>
    expect(valid("4539 3195 0343 6467")).toBe(true))
  it("invalid when checksum off by one", () =>
    expect(valid("8273 1232 7352 0569")).toBe(false))
  it("single digit invalid", () => expect(valid("1")).toBe(false))
  it("letters invalid", () => expect(valid("055a 444 285")).toBe(false))
  it("zero string of length 2 is valid", () => expect(valid("00")).toBe(true))
  it("punctuation invalid", () => expect(valid("055-444-285")).toBe(false))
})
```

The other four follow the same shape (encode/decode for RLE;
`new Clock(h,m).toString()` + `.add(min)` wrap-around; `flatten(nested)`
dropping null/undefined; `matched(s: string): boolean` for `()[]{}` pairs). The
implementer writes real tests for each — 6+ cases per exercise covering the
happy path, one boundary, and one invalid input.

- [ ] **Step 2: TDD `corpus.ts`** — test asserts: five exercises load; `files`
      contains `src/index.ts`; `testFiles` contains `tests/index.test.ts`;
      instructions non-empty.
- [ ] **Step 3: Sanity: the stubs FAIL their own tests** — run
      `pnpm exec vitest run corpus/ts/luhn` and confirm failures ("implement
      me"): a corpus whose stubs pass is measuring nothing.
- [ ] **Step 4: Commit** —
      `git commit -m "feat(evals): five-exercise TypeScript seed corpus"`

---

### Task 12: Case runner (network-free, chat injected)

**Files:**

- Create: `apps/inception-cli/packages/evals/src/harness/runner.ts`
- Create: `apps/inception-cli/packages/evals/src/harness/testExec.ts`
- Test: `apps/inception-cli/packages/evals/src/harness/runner.test.ts`
- Test: `apps/inception-cli/packages/evals/src/harness/testExec.test.ts`

**Interfaces:**

- Consumes: Tasks 9–11 (`EditFormat`, `Exercise`, `CaseResult`, `loadOrRun`).
- Produces:
  - `type ChatFn = (messages: Array<{role: string; content: string}>) => Promise<{ text: string; promptTokens: number; completionTokens: number }>`
  - `runCase(opts: { exercise: Exercise; format: EditFormat; chat: ChatFn; workRoot: string; attemptBudget: number; model: string; commit: string }): Promise<CaseResult>`
  - `runTests(workdir: string): Promise<{ passed: boolean; output: string }>` in
    `testExec.ts` — spawns `pnpm exec vitest run --root <workdir>` with a 60s
    timeout, returns exit-code-derived `passed` and combined output with timings
    scrubbed (`/in \d+m?s/` → removed) so feedback prompts stay cache-stable.

  Runner algorithm (mirrors aider's two-attempt loop):
  1. Materialize workdir: copy `files` + pristine `testFiles`.
  2. Attempt loop up to `attemptBudget`: build prompt (system = terse executor
     preamble + `format.formatInstructions`; user = instructions +
     `format.renderFiles(currentFiles)` + on attempt >1 the scrubbed failing
     test output with the fixed feedback line "The tests are correct; do not
     modify tests. Fix the code."); call `chat`; `format.parse` (ParseError →
     record `parse_error = true`, feed the error message back, next attempt);
     `format.apply` (ApplyError → `apply_error = true`, feed back, next
     attempt); **re-copy pristine testFiles**; `runTests`; push outcome into
     `tests_outcomes`; stop early on pass.
  3. Cost from token totals × `PRICING`.

- [ ] **Step 1: Write failing runner tests with a SCRIPTED ChatFn** (no network,
      no real vitest — inject a fake `runTests` too via an optional
      `opts.testRunner` parameter defaulting to the real one):
  - scripted chat returns a correct `whole` response → `tests_outcomes: [true]`,
    no error flags
  - scripted chat returns garbage then a correct response → `parse_error: true`,
    `tests_outcomes: [true]` (attempt 2), and the second prompt contains the
    parse error message
  - scripted chat returns a non-matching search/replace twice →
    `apply_error: true`, `tests_outcomes: []` is NOT allowed — assert
    `tests_outcomes: [false, false]` is also wrong: define and assert the real
    semantics: a failed apply consumes the attempt WITHOUT a test run, so
    `tests_outcomes` stays shorter than attempts; document this in the
    `CaseResult` doc comment
  - test-feedback path: scripted chat wrong-then-right implementation →
    `tests_outcomes: [false, true]` and attempt-2 prompt contains scrubbed test
    output
- [ ] **Step 2: `testExec` test** — run against a temp workdir containing one
      trivially passing vitest file → `passed: true`; one failing file →
      `passed: false` and output mentions the test name; timing strings
      scrubbed.
- [ ] **Step 3: Verify fail → implement → verify pass → typecheck.**
- [ ] **Step 4: Commit** —
      `git commit -m "feat(evals): case runner with injected chat and split error accounting"`

---

### Task 13: Metrics + variants guard + campaign CLI

**Files:**

- Create: `apps/inception-cli/packages/evals/src/harness/metrics.ts`
- Create: `apps/inception-cli/packages/evals/src/harness/campaign.ts`
- Test: `apps/inception-cli/packages/evals/src/harness/metrics.test.ts`

**Interfaces:**

- Consumes: `CaseResult` records from a run dir.
- Produces:
  - `aggregate(results: CaseResult[]): Summary` with
    `Summary = { byFormat: Record<string, { cases: number; pass_rate_1: number; pass_rate_2: number; parse_error_rate: number; apply_error_rate: number; well_formed_rate: number; mean_cost_usd: number; mean_duration_ms: number }> }`
    — `pass_rate_k` = fraction of cases with
    `tests_outcomes.slice(0, k).some(Boolean)`; `parse_error_rate` /
    `apply_error_rate` are per-case booleans (the split aider conflates);
    `well_formed_rate` = neither flag set.
  - `variants(results: CaseResult[]): { models: string[]; commits: string[]; mixed: boolean }`
    — `mixed` when either has >1 distinct value; campaign CLI prints it in red
    and exits 1 unless `--allow-mixed`.
  - `campaign.ts`:
    `tsx src/harness/campaign.ts --run <runId> --formats whole,search-replace --budget 2`
    — iterates exercises × formats through `loadOrRun` with the REAL Mercury
    `ChatFn` (thin adapter over `mercuryFetch` using `MERCURY_MODEL`,
    `reasoning_effort: "low"`, temperature 0.2), prints the summary table,
    writes `runs/<runId>/summary.json`.

- [ ] **Step 1: TDD `aggregate` + `variants`** from hand-built `CaseResult[]`
      fixtures: pass_rate_1 vs pass_rate_2 divergence; parse vs apply
      attribution; mixed-commit detection.
- [ ] **Step 2: Implement campaign CLI** (no unit test — it is composition; its
      verification is Task 14's live run). Include `--dry-run` flag that swaps
      in a scripted ChatFn returning a fixed correct solution for `luhn` only,
      as the offline end-to-end check.
- [ ] **Step 3: Run `--dry-run`, verify: luhn passes, others fail, summary table
      renders, second invocation is 100% cached.** Commit —
      `git commit -m "feat(evals): metrics with parse/apply split, variants guard, campaign CLI"`

---

### Task 14: LangSmith tracing + first live campaign (orchestrator-gated)

**Files:**

- Create: `apps/inception-cli/packages/evals/src/harness/tracing.ts`
- Modify: `apps/inception-cli/packages/evals/src/harness/campaign.ts` (wrap
  runner + chat)
- Create: `docs/research/m1a-first-campaign.md`

**Interfaces:**

- Consumes: root `langsmith` dependency
  (`pnpm -F @inception-cli/evals add langsmith`), `LANGSMITH_*` env from `.env`.
- Produces: `traced<T extends (...a: any[]) => any>(name: string, fn: T): T` —
  wraps with LangSmith `traceable` when `LANGSMITH_TRACING === "true"`, identity
  otherwise (unit-testable without network: assert identity path returns the
  same function result and that the wrapper never throws when env is unset).
  Campaign wraps: the campaign (chain root), each case, each chat call (`llm`
  run type with token usage attached).

- [ ] **Step 1: TDD the identity path** of `traced` (env unset → passthrough).
- [ ] **Step 2: Wire into campaign; run ONE traced live case**
      (`--formats whole --only luhn`) after the M0 gate has passed; verify in
      LangSmith UI that the run appears with token counts (this settles probe
      P7). Record what rendered (or didn't) in the campaign doc.
- [ ] **Step 3: Run the full campaign live**: 5 exercises × 2 formats × budget 2
      (≤20 Mercury calls). Write `docs/research/m1a-first-campaign.md`: summary
      table verbatim, cost total, LangSmith project link, and the first real
      `parse_error_rate` / `apply_error_rate` numbers for the two arms.
- [ ] **Step 4: Ledger + hub**: `record_outcome` on decision
      `897ad11b-0913-4427-8806-c2916f114088` with the observed
      `apply_error_rate` (raw numbers); post the summary to the hub workspace;
      commit + push everything.

```bash
git add apps/inception-cli docs/research/m1a-first-campaign.md
git commit -m "feat(evals): LangSmith tracing and first live two-arm campaign"
git push
```

---

## Self-review notes (run before handoff)

- Spec coverage: M0 = spec §8 P1–P6 (P0 added for verify-before-writing; P7
  folded into Task 14; P8 deferred to M2 where the event bus exists — recorded
  here as a deliberate deferral). M1 core = spec §6 items 2 (two of four arms),
  5 (LangSmith); §6 items 1, 3, 4 and the remaining arms are M1 Phase B by the
  scope note.
- The ledger decision (exact-match, uniqueness, no fuzzy) is enforced in Task
  10's tests, not just prose.
- Type consistency: `CaseKey`/`CaseResult`/`EditFormat`/`ChatFn` names match
  across Tasks 9–14.
