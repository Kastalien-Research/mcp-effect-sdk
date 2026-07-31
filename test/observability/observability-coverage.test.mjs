import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const inventory = JSON.parse(readFileSync(path.join(root, "docs/observability-inventory.json"), "utf8"))

const runGate = (fixtureRoot = root) =>
  spawnSync(process.execPath, ["scripts/check-observability-coverage.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      MCP_EFFECT_OBSERVABILITY_ROOT: fixtureRoot
    }
  })

const withFixture = (inventoryValue, files, verify) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "observability-coverage-"))
  try {
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true })
    writeFileSync(path.join(fixtureRoot, "docs/observability-inventory.json"), JSON.stringify(inventoryValue))
    for (const [relativePath, source] of Object.entries(files)) {
      const absolutePath = path.join(fixtureRoot, relativePath)
      mkdirSync(path.dirname(absolutePath), { recursive: true })
      writeFileSync(absolutePath, source)
    }
    verify(runGate(fixtureRoot))
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

test("observability coverage gate passes with exact repository evidence", () => {
  const result = runGate()
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(inventory.version, 2)
  assert.equal(
    inventory.entries.some((entry) => entry.status === "quarantined"),
    false,
    "active example trees must not remain quarantined"
  )
})

test("inventory broad rules are limited to generated code and static assets", () => {
  const allowed = new Set(["src/generated/", "apps/visual-effect/public/"])
  for (const entry of inventory.entries) {
    if (entry.pathPrefix !== undefined) {
      assert.equal(allowed.has(entry.pathPrefix), true, `unexpected broad rule ${entry.pathPrefix}`)
    }
    for (const exactPath of entry.paths ?? []) {
      assert.equal(exactPath.endsWith("/"), false, `classification must name an exact file: ${exactPath}`)
    }
  }
})

test("coverage gate rejects a broad runtime-source rule", () => {
  withFixture(
    {
      version: 2,
      entries: [{ pathPrefix: "src/", status: "pureExempt", rationale: "too broad" }]
    },
    { "src/value.ts": "export const value = 1" },
    (result) => {
      assert.equal(result.status, 1)
    }
  )
})

test("instrumented evidence requires a real instrumentation call expression", () => {
  withFixture(
    {
      version: 2,
      entries: [
        {
          paths: ["src/fake.ts"],
          status: "instrumented",
          rationale: "fixture"
        }
      ]
    },
    { "src/fake.ts": '// Effect.withSpan("mcp.fake")\nexport const value = 1' },
    (result) => {
      assert.equal(result.status, 1)
    }
  )
})

test("parent coverage requires the named span at the exact boundary file", () => {
  withFixture(
    {
      version: 2,
      entries: [
        {
          paths: ["src/worker.ts"],
          status: "coveredByParentBoundary",
          rationale: "fixture",
          boundary: { path: "src/boundary.ts", span: "mcp.expected" }
        },
        {
          paths: ["src/boundary.ts"],
          status: "pureExempt",
          rationale: "fixture boundary"
        }
      ]
    },
    {
      "src/worker.ts": 'import * as Effect from "effect/Effect"\nexport const work = Effect.void',
      "src/boundary.ts": 'export const note = "mcp.expected"'
    },
    (result) => {
      assert.equal(result.status, 1)
    }
  )
})

test("root evidence rejects nested Effect runtimes", () => {
  withFixture(
    {
      version: 2,
      entries: [
        {
          paths: ["scripts/root.mjs"],
          status: "rootOnly",
          rationale: "fixture",
          rootRunner: "scripts/lib/process.mjs",
          span: "mcp.script.run"
        },
        {
          paths: ["scripts/lib/process.mjs"],
          status: "instrumented",
          rationale: "fixture"
        }
      ]
    },
    {
      "package.json": JSON.stringify({ scripts: {} }),
      "scripts/root.mjs": [
        'import * as Effect from "effect/Effect"',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime"',
        "const runScript = effect => effect",
        "Effect.runPromise(Effect.void)",
        "NodeRuntime.runMain(runScript(Effect.void))"
      ].join("\n"),
      "scripts/lib/process.mjs":
        'import * as Effect from "effect/Effect"\nEffect.withSpan("mcp.script.run")(Effect.void)'
    },
    (result) => {
      assert.equal(result.status, 1)
    }
  )
})
