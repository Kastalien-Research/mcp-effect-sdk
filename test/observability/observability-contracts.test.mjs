import { accessSync, readFileSync, readdirSync } from "node:fs"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const packageJsonPath = path.join(root, "package.json")
const observabilityInventoryPath = path.join(root, "docs/observability-inventory.json")

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const inventory = JSON.parse(readFileSync(observabilityInventoryPath, "utf8"))

function hasStringRationale(entry) {
  return typeof entry?.rationale === "string" && entry.rationale.trim().length > 0
}

function requireRunScriptWrappedMain(source, target) {
  assert.equal(
    /NodeRuntime\.runMain\(\s*runScript\(/.test(source),
    true,
    `${target} must call runScript as the runMain program`
  )
}

// Scripts that legitimately violate one or more of the runScript /
// NodeRuntime.runMain / no-process.exit contracts asserted below. Each reason
// cites the test or doc that pins the violation, so a script can't gain an
// exemption without leaving evidence explaining why it's correct as written.
// `usesRunScript: false` means the script has no effect/NodeRuntime wiring at
// all (fully exempt from those two assertions); `usesRunScript: true` means
// it wires through runScript/runMain normally and is only exempt from the
// no-process.exit assertion specifically.
const SCRIPT_ENTRYPOINT_EXEMPTIONS = new Map([
  [
    "scripts/check-source-snapshots.mjs",
    {
      usesRunScript: false,
      reason:
        "copied alone into an isolated git-only workspace with no installed node_modules " +
        "(test/source-refresh.integration.test.mjs), so it must run on Node built-ins only " +
        "and cannot import effect/NodeRuntime"
    }
  ],
  [
    "scripts/release-via-tag.mjs",
    {
      usesRunScript: false,
      reason:
        "ships inside the published npm tarball and runs against the unpacked, uninstalled " +
        "package (test/packaging/wp5h-packed-core-consumer.test.mjs), so it must have zero " +
        "runtime dependencies, effect included"
    }
  ],
  [
    "scripts/run-conformance-authorization.mjs",
    {
      usesRunScript: true,
      reason:
        "uses runScript/NodeRuntime.runMain but supplies a custom teardown that calls " +
        "process.exit on every outcome, because its output-lifecycle matrix " +
        "(.superpowers/sdd/task-6f-output-lifecycle-matrix.md) requires an explicit exit " +
        "code even on success, which runMain's default teardown does not provide"
    }
  ]
])

function collectSources(baseDirectory, extensions = new Set([".mjs", ".mts", ".ts"])) {
  const sources = []
  for (const entry of readdirSync(baseDirectory, { withFileTypes: true })) {
    if (entry.name === "dist") continue
    const absolute = path.join(baseDirectory, entry.name)
    if (entry.isDirectory()) {
      sources.push(...collectSources(absolute, extensions))
      continue
    }
    if (!extensions.has(path.extname(entry.name))) continue
    sources.push(absolute)
  }
  return sources
}

test("observability dependency policy keeps @effect/experimental dev-only", () => {
  assert.equal(typeof packageJson.devDependencies, "object")
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.devDependencies, "@effect/experimental"), true)
  assert.equal(typeof packageJson.dependencies, "object")
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.dependencies, "@effect/experimental"), false)
})

test("observability inventory uses exact, evidence-bearing runtime classifications", () => {
  assert.equal(inventory.version, 2)
  assert.equal(Array.isArray(inventory.entries), true)
  const allowedBroadPrefixes = new Set(["src/generated/", "apps/visual-effect/public/"])
  for (const entry of inventory.entries) {
    assert.equal(hasStringRationale(entry), true)
    if (entry.pathPrefix !== undefined) {
      assert.equal(allowedBroadPrefixes.has(entry.pathPrefix), true)
    } else {
      assert.equal(Array.isArray(entry.paths) && entry.paths.length > 0, true)
    }
  }
})

test("observability inventory has no quarantined active example trees", () => {
  const quarantined = (inventory.entries ?? []).filter((entry) => entry.status === "quarantined")
  assert.deepEqual(quarantined, [])
})

test("observability inventory documents docs file and is JSON-valid", () => {
  assert.doesNotThrow(() => accessSync(path.join(root, "docs/observability.md")), "docs/observability.md missing")
  assert.equal(typeof inventory.updated, "string")
})

test("observability contract pins effect experimental baseline to 0.61.0", () => {
  const version = packageJson.devDependencies["@effect/experimental"]
  assert.equal(typeof version, "string")
  assert.equal(version, "0.61.0")
})

test("visual-effect app dependencies are planned-effect aligned", () => {
  const visualEffectPackagePath = path.join(root, "apps/visual-effect/package.json")
  const visualEffectPackage = JSON.parse(readFileSync(visualEffectPackagePath, "utf8"))

  const visualDependencies = visualEffectPackage.dependencies ?? {}
  const visualDevDependencies = visualEffectPackage.devDependencies ?? {}

  assert.equal(visualDependencies.effect, "3.22.0")
  assert.equal(visualDependencies["@effect/platform-node"], undefined)

  assert.equal(visualDevDependencies["@effect/experimental"], "0.61.0")
  assert.equal(visualDevDependencies["@effect/platform"], "0.97.0")
  assert.equal(visualDevDependencies["@effect/platform-node"], "0.108.0")
})

test("StreamableHttpServerTransport options include runtime/instrumentation wiring", () => {
  const sourcePath = path.join(root, "src/transport/StreamableHttpServerTransport.ts")
  const source = readFileSync(sourcePath, "utf8")

  assert.equal(source.includes("readonly runtimeLayer?:"), true)
  assert.equal(source.includes("readonly instrumentation?"), true)
  assert.equal(source.includes("toWebHandler ="), true)
})

test("resolved example trees have exact classifications", () => {
  const classifiedPaths = new Set(inventory.entries.flatMap((entry) => entry.paths ?? []))
  assert.equal(classifiedPaths.has("examples/task-heavy/index.ts"), true)
  assert.equal(classifiedPaths.has("examples/typescript-sdk-ports/smoke.ts"), true)
})

test("repository scripts should not call process.exit directly", () => {
  const scriptRoot = path.join(root, "scripts")
  const scriptFiles = collectSources(scriptRoot)
  const visualScriptFiles = collectSources(
    path.join(root, "apps", "visual-effect", "scripts"),
    new Set([".mts", ".ts", ".tsx"])
  )

  for (const file of scriptFiles) {
    const source = readFileSync(file, "utf8")
    const relative = path.relative(root, file)
    if (SCRIPT_ENTRYPOINT_EXEMPTIONS.has(relative)) continue
    assert.equal(/process\.exit\(/.test(source), false, `${relative} must not call process.exit`)
    assert.equal(/process\.exitCode/.test(source), false, `${relative} must not set process.exitCode`)
  }

  for (const file of visualScriptFiles) {
    const source = readFileSync(file, "utf8")
    const relative = path.relative(root, file)
    assert.equal(/process\.exit\(/.test(source), false, `${relative} must not call process.exit`)
    assert.equal(/process\.exitCode/.test(source), false, `${relative} must not set process.exitCode`)
  }
})

test("package scripts route script entrypoints through Effect-native execution", () => {
  const packageScriptsPath = path.join(root, "package.json")
  const packageScripts = JSON.parse(readFileSync(packageScriptsPath, "utf8")).scripts ?? {}

  for (const [name, command] of Object.entries(packageScripts)) {
    const nodeIndex = command.indexOf("node ")
    if (nodeIndex === -1) continue
    if (command.includes(" --test ")) continue

    const tokens = command
      .slice(nodeIndex + 4)
      .split(" ")
      .filter((token) => token.length > 0)
    const scriptTargets = tokens.filter((token) => token.endsWith(".mjs"))
    if (scriptTargets.length === 0) continue

    const primary = scriptTargets[0]
    const secondary = scriptTargets[1]

    if (primary === "scripts/run-script-entrypoint.mjs" && secondary !== undefined) {
      continue
    }

    if (!primary.startsWith("scripts/") || !primary.endsWith(".mjs")) {
      continue
    }

    const exemption = SCRIPT_ENTRYPOINT_EXEMPTIONS.get(primary)
    if (exemption !== undefined && exemption.usesRunScript === false) continue

    const targetSource = readFileSync(path.join(root, primary), "utf8")
    assert.equal(
      /NodeRuntime\.runMain\(/.test(targetSource),
      true,
      `package script ${name} (${primary}) should execute as an Effect root via NodeRuntime.runMain`
    )
  }
})

test("direct package script entrypoints must share runScript boundary", () => {
  const packageScripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts ?? {}
  const directEntrypoints = new Set()

  for (const [, command] of Object.entries(packageScripts)) {
    const nodeIndex = typeof command === "string" ? command.indexOf("node ") : -1
    if (nodeIndex === -1) continue
    if (command.includes(" --test ")) continue

    const tokens = command
      .slice(nodeIndex + 4)
      .split(" ")
      .filter((token) => token.length > 0)
    const [primary] = tokens.filter((token) => token.endsWith(".mjs"))
    if (!primary || !primary.startsWith("scripts/") || primary === "scripts/run-script-entrypoint.mjs") continue
    directEntrypoints.add(primary)
  }

  for (const target of directEntrypoints) {
    const source = readFileSync(path.join(root, target), "utf8")
    const exemption = SCRIPT_ENTRYPOINT_EXEMPTIONS.get(target)
    if (exemption !== undefined && exemption.usesRunScript === false) continue
    assert.equal(
      source.includes("NodeRuntime.runMain("),
      true,
      `${target} must use NodeRuntime.runMain as process root`
    )
    assert.equal(source.includes("runScript("), true, `${target} must route through shared runScript boundary`)
    requireRunScriptWrappedMain(source, target)
    if (exemption === undefined) {
      assert.equal(source.includes("process.exit("), false, `${target} must not call process.exit directly`)
    }
  }
})

test("all script-style entrypoints that call NodeRuntime.runMain must route through runScript", () => {
  const scriptRoot = path.join(root, "scripts")
  const scriptFiles = collectSources(scriptRoot)

  for (const file of scriptFiles) {
    const source = readFileSync(file, "utf8")
    const relative = path.relative(root, file)

    if (!/NodeRuntime\.runMain\(/.test(source)) continue

    requireRunScriptWrappedMain(source, relative)
  }

  const visualScriptFiles = collectSources(
    path.join(root, "apps", "visual-effect", "scripts"),
    new Set([".mts", ".ts"])
  )
  for (const file of visualScriptFiles) {
    const source = readFileSync(file, "utf8")
    const relative = path.relative(root, file)

    if (!/NodeRuntime\.runMain\(/.test(source)) continue

    requireRunScriptWrappedMain(source, relative)
  }
})

test("observability helper modules export deterministic DevTools API surface", () => {
  const exampleDevToolsSource = readFileSync(path.join(root, "examples/internal/DevTools.ts"), "utf8")
  const scriptDevToolsSource = readFileSync(path.join(root, "scripts/lib/observability.mjs"), "utf8")

  for (const marker of [
    "export const validateDevToolsUrl",
    "export const makeDevToolsRuntimeLayer",
    "export const isDevToolsEnabled"
  ]) {
    assert.equal(exampleDevToolsSource.includes(marker), true, `examples/internal/DevTools.ts missing ${marker}`)
    assert.equal(scriptDevToolsSource.includes(marker), true, `scripts/lib/observability.mjs missing ${marker}`)
  }

  assert.equal(
    exampleDevToolsSource.includes("MCP_EFFECT_DEVTOOLS_URL"),
    true,
    "example helper should read MCP_EFFECT_DEVTOOLS_URL"
  )
  assert.equal(
    scriptDevToolsSource.includes("MCP_EFFECT_DEVTOOLS_URL"),
    true,
    "script helper should read MCP_EFFECT_DEVTOOLS_URL"
  )
  assert.equal(
    scriptDevToolsSource.includes("DevTools.layer"),
    true,
    "script helper should build a DevTools layer when enabled"
  )
})

test("scripts/lib/process.mjs stays cancellation-aware and uses Effect exit boundaries", () => {
  const source = readFileSync(path.join(root, "scripts/lib/process.mjs"), "utf8")
  assert.equal(source.includes("export const runCommand"), true, "runCommand should be exported")
  assert.equal(source.includes("Effect.async"), true, "runCommand should be async via Effect.async")
  assert.equal(source.includes("return () =>"), true, "runCommand should return a cleanup callback for cancellation")
  assert.equal(source.includes('child.kill("SIGTERM")'), true, "runCommand cleanup should request SIGTERM")
  assert.equal(source.includes('child.kill("SIGKILL")'), true, "runCommand cleanup should fallback to SIGKILL")
  assert.equal(source.includes("export const runScript"), true, "runScript should be exported")
  assert.equal(
    source.includes("const exit = yield* Effect.exit(program)"),
    true,
    "runScript should inspect Effect.exit(program)"
  )
  assert.equal(source.includes("yield* Effect.fail"), true, "runScript should fail on non-success Effect.exit result")
})

test("visual-effect app keeps bun lockfile as the package tooling baseline", () => {
  readFileSync(path.join(root, "apps/visual-effect/package.json"), "utf8")
  const source = readFileSync(path.join(root, "apps/visual-effect/bun.lock"), "utf8")
  assert.equal(source.length > 0, true, "apps/visual-effect/bun.lock should exist and not be empty")
})
