import { accessSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

function assertExists(relativePath) {
  const absolutePath = path.join(root, relativePath)
  assert.doesNotThrow(() => accessSync(absolutePath), `missing required path: ${relativePath}`)
}

test("observability artifact files exist", () => {
  assertExists("docs/observability.md")
  assertExists("docs/observability-inventory.json")
  assertExists("examples/internal/DevTools.ts")
  assertExists("scripts/lib/observability.mjs")
  assertExists("scripts/run-script-entrypoint.mjs")
  assertExists("apps/visual-effect/src/observability/BrowserEffectRuntime.tsx")
})
