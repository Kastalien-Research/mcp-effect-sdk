import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const visualEffectRoot = path.join(root, "apps/visual-effect")
const readSource = (relativePath) => readFileSync(path.join(visualEffectRoot, relativePath), "utf8")

test("verify-mcp-ide.mts preserves fixed gate contract and evidence publication behavior", () => {
  const source = readSource("scripts/verify-mcp-ide.mts")

  assert.equal(source.includes("export function mcpIdeGateDefinitions"), true)
  assert.equal(source.includes("export function parseMcpIdeArguments"), true)
  assert.equal(source.includes("export async function runMcpIdeVerification"), true)
  assert.equal(source.includes("export function resolveFixtureHashes"), true)
  assert.equal(source.includes("export function resolveFixtureIntegrity"), true)

  const gateIdMatches = source.matchAll(/id:\s*"([^"]+)"/g)
  const gateIds = [...gateIdMatches].map((match) => match[1])
  const expectedGateIds = ["scoped-biome", "typecheck", "mcp-ide-tests", "build"]
  for (const expected of expectedGateIds) {
    assert.equal(gateIds.includes(expected), true, `expected fixed gate ${expected} in verify-mcp-ide`)
  }

  assert.equal(source.includes("stdoutLog"), true, "verification should persist stdout logs")
  assert.equal(source.includes("stderrLog"), true, "verification should persist stderr logs")
  assert.equal(source.includes("mcp-ide.json"), true, "verification should persist evidence report")
  assert.equal(
    source.includes("validateExternalArtifactDirectory"),
    true,
    "artifact directory should validate CLI boundary"
  )

  assert.equal(source.includes("process.exitCode"), false, "verify-mcp-ide should avoid process.exitCode")
  assert.equal(source.includes("process.exit("), false, "verify-mcp-ide should avoid direct process.exit")
})

test("generate-og-images script exposes per-example async children and font-load behavior", () => {
  const source = readSource("scripts/generate-og-images.tsx")

  assert.equal(
    source.includes("async function generateOGImages"),
    true,
    "script should have an explicit generation entrypoint"
  )
  assert.equal(
    source.includes("const imagePromises = examplesManifest.map"),
    true,
    "script should spawn one async child per example id"
  )
  assert.equal(source.includes("Promise.allSettled"), true, "script should await all per-example generation tasks")
  assert.equal(source.includes("interBoldPath"), true, "script should load bold font resource")
  assert.equal(source.includes("interRegularPath"), true, "script should load regular font resource")
})

test("app runtime entrypoint should initialize BrowserEffectRuntime before rendering IDE", () => {
  const source = readSource("app/ClientAppContent.tsx")
  const hasRuntimeImport =
    source.includes('from "../src/observability/BrowserEffectRuntime"') ||
    source.includes("from '../src/observability/BrowserEffectRuntime'")
  const wrapsIde = /<BrowserEffectRuntime[^>]*>\s*<McpIdeApp/.test(source)

  assert.equal(source.includes("BrowserEffectRuntime"), true, "ClientAppContent should reference BrowserEffectRuntime")
  assert.equal(source.includes("<McpIdeApp"), true, "ClientAppContent should mount IDE app content")
  assert.equal(
    hasRuntimeImport,
    true,
    "ClientAppContent should import BrowserEffectRuntime from apps/visual-effect/src/observability"
  )
  assert.equal(wrapsIde, true, "ClientAppContent should render McpIdeApp inside BrowserEffectRuntime")
})
