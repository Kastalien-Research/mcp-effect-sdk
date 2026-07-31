import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8")
const readExampleSources = () => {
  const files = []
  const walk = (folder) => {
    const entries = readdirSync(path.join(root, folder), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === "dist") continue
      const full = `${folder}/${entry.name}`
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(full)
      }
    }
  }
  walk("examples")
  return files
}

const findModuleLoadServerConstruction = (source) => source.includes("Effect.runSync(McpServer.make")

const assertSingleRunMainBoundary = (source, fileName) => {
  const matches = source.match(/NodeRuntime\.runMain\(/g) ?? []
  assert.equal(matches.length, 1, `${fileName} should define one runMain boundary`)
}

const assertNoProcessExit = (source, fileName) => {
  assert.equal(/process\.exit\(/.test(source), false, `${fileName} should not call process.exit`)
}

const assertHasRuntimeLayer = (source, fileName, marker) => {
  assert.equal(source.includes(marker), true, `${fileName} should pass runtimeLayer to toWebHandler`)
}

test("everything-server.ts uses NodeRuntime.runMain and no process exit", () => {
  const source = readSource("examples/everything-server.ts")
  assertSingleRunMainBoundary(source, "examples/everything-server.ts")
  assertNoProcessExit(source, "examples/everything-server.ts")
  assert.equal(source.includes("makeScopedHandler"), true, "everything-server should use the owning scoped handler")
  assert.equal(
    source.includes("Runtime.runPromise(runtime)"),
    true,
    "everything-server should execute requests on its captured owning Effect runtime"
  )
  assert.equal(source.includes("toWebHandler"), false, "everything-server should not create a private handler runtime")
  assert.equal(
    source.includes("Effect.runSync(McpServer.make"),
    false,
    "everything-server should not build MCP server with runSync at module load"
  )
  assert.equal(source.includes("Effect.scoped("), true, "everything-server should expose an Effect program boundary")
})

test("everything-client.ts uses NodeRuntime.runMain and no process exit", () => {
  const source = readSource("examples/everything-client.ts")
  assertSingleRunMainBoundary(source, "examples/everything-client.ts")
  assertNoProcessExit(source, "examples/everything-client.ts")
  assert.equal(
    source.includes("makeEverythingClient") || source.includes("runEverythingClient"),
    true,
    "everything-client should keep scenario execution in a named root effect"
  )
  assert.equal(
    source.includes("Effect.runPromise("),
    false,
    "everything-client should not invoke intermediate Effect.runPromise roots"
  )
})

test("example transport handlers wire optional devtools runtime layer", () => {
  assertHasRuntimeLayer(
    readSource("examples/core-protocol-catalog.ts"),
    "examples/core-protocol-catalog.ts",
    "runtimeLayer: makeDevToolsRuntimeLayer()"
  )
  assertHasRuntimeLayer(
    readSource("examples/typescript-sdk-ports/hosting.ts"),
    "examples/typescript-sdk-ports/hosting.ts",
    "runtimeLayer: makeDevToolsRuntimeLayer()"
  )
  const smoke = readSource("examples/typescript-sdk-ports/smoke.ts")
  assert.equal(
    smoke.includes("Runtime.runPromise(runtime)"),
    true,
    "typescript-sdk-ports smoke should reuse its captured runExample runtime"
  )
})

test("core-protocol-catalog avoids module-load MCP server construction", () => {
  const source = readSource("examples/core-protocol-catalog.ts")
  assert.equal(
    source.includes("Effect.runSync(McpServer.make"),
    false,
    "core-protocol-catalog should not construct McpServer with runSync at module load"
  )
})

test("core-protocol-catalog exports expected workflow entrypoints", () => {
  const source = readSource("examples/core-protocol-catalog.ts")
  const requiredExports = [
    "export const runMinimalStdioClient",
    "export const runStreamableHttpClient",
    "export const runLoggingProgressCancellationClient",
    "export const runCompletionClient",
    "export const makeInputRequiredApprovalPolicy",
    "inputRequiredApprovalLayer"
  ]
  for (const marker of requiredExports) {
    assert.equal(
      source.includes(marker),
      true,
      `core-protocol-catalog should include ${marker} as an example workflow boundary`
    )
  }
})

test("typescript-sdk-ports/smoke.ts uses runMain and no process exit", () => {
  const source = readSource("examples/typescript-sdk-ports/smoke.ts")
  assertSingleRunMainBoundary(source, "examples/typescript-sdk-ports/smoke.ts")
  assertNoProcessExit(source, "examples/typescript-sdk-ports/smoke.ts")
  assert.equal(
    source.includes("runModernParitySmoke"),
    true,
    "typescript-sdk-ports/smoke.ts should keep logic in a named root effect"
  )
  assert.equal(
    source.includes("Effect.runPromise("),
    false,
    "typescript-sdk-ports/smoke.ts should not invoke runPromise at top level entrypoint"
  )
})

test("example modules are free of module-load McpServer.make via runSync", () => {
  for (const relativePath of readExampleSources()) {
    const source = readSource(relativePath)
    assert.equal(
      findModuleLoadServerConstruction(source),
      false,
      `${relativePath} should not build McpServer with runSync at module load`
    )
  }
})
