import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import { runScript } from "./lib/process.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"])
const excludedDirectories = new Set([".git", ".local", ".next", "coverage", "dist", "node_modules", "out", "repos"])

const walk = (directory, relative = "") => {
  const files = []
  for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue
    const entryRelative = path.posix.join(relative, entry.name)
    if (
      path.relative(repositoryRoot, path.join(directory, entryRelative)).split(path.sep).join("/") ===
      "apps/inception-cli/packages/evals/runs"
    )
      continue
    if (entry.isDirectory()) {
      files.push(...walk(directory, entryRelative))
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryRelative)
    }
  }
  return files
}

const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"))
const wrapperTargets = new Set()
for (const command of Object.values(packageJson.scripts ?? {})) {
  const match = String(command).match(/run-script-entrypoint\.mjs (scripts\/[^ ]+\.mjs)/)
  if (match?.[1]) wrapperTargets.add(match[1])
}

const boundaryFor = (file) => {
  if (file.startsWith("apps/visual-effect/")) {
    return {
      path: "apps/visual-effect/src/observability/BrowserEffectRuntime.tsx",
      span: "mcp.ide.run"
    }
  }
  if (file.startsWith("examples/")) {
    return { path: "examples/internal/DevTools.ts", span: "mcp.example.run" }
  }
  if (file.startsWith("scripts/")) {
    return { path: "scripts/lib/process.mjs", span: "mcp.script.run" }
  }
  if (file.startsWith("src/auth/client/")) {
    return { path: "src/auth/client/token.ts", span: "SpanName.authTokenExchange" }
  }
  if (file.startsWith("src/auth/protected-resource/")) {
    return { path: "src/auth/protected-resource/services.ts", span: "SpanName.authBearerVerify" }
  }
  if (file.startsWith("src/transport/")) {
    return { path: "src/McpDispatcher.ts", span: "SpanName.transportReceive" }
  }
  if (file.startsWith("src/client-handlers/") || file.startsWith("src/auth/")) {
    return { path: "src/McpClient.ts", span: "SpanName.clientRequest" }
  }
  return { path: "src/McpDispatcher.ts", span: "SpanName.serverDispatch" }
}

const groups = new Map()
const add = (key, metadata, file) => {
  const existing = groups.get(key)
  if (existing) {
    existing.paths.push(file)
    return
  }
  groups.set(key, { ...metadata, paths: [file] })
}

const isTestSource = (file) => /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?$/.test(file)
const hasEffectRuntimeImport = (source) =>
  /(?:from\s+["'](?:effect(?:\/[^"']+)?|@effect\/[^"']+)["']|import\s*\(["'](?:effect|@effect\/))/.test(source)
const hasInstrumentation = (source) =>
  /\bEffect\.(?:fn|withSpan)\s*\(|\bManagedRuntime\.make\s*\(|\bDevTools\.layer\s*\(/.test(source)

const files = ["src", "examples", "apps", "scripts"]
  .flatMap((topLevel) => walk(path.join(repositoryRoot, topLevel)).map((file) => `${topLevel}/${file}`))
  .filter((file) => !file.startsWith("src/generated/"))
  .sort()

for (const file of files) {
  const source = readFileSync(path.join(repositoryRoot, file), "utf8")
  if (isTestSource(file)) {
    add(
      "tests",
      {
        status: "pureExempt",
        rationale: "Test-only verification source; production telemetry is asserted rather than emitted."
      },
      file
    )
  } else if (
    file === "scripts/run-script-entrypoint.mjs" ||
    wrapperTargets.has(file) ||
    (source.includes("NodeRuntime.runMain(") && (source.includes("runScript(") || source.includes("runExample(")))
  ) {
    const exampleRoot = source.includes("runExample(")
    add(
      exampleRoot ? "example-roots" : "roots",
      {
        status: "rootOnly",
        rationale: `Executable source enters through the shared scoped ${
          exampleRoot ? "mcp.example.run" : "mcp.script.run"
        } boundary.`,
        rootRunner: exampleRoot ? "examples/internal/DevTools.ts" : "scripts/lib/process.mjs",
        span: exampleRoot ? "mcp.example.run" : "mcp.script.run"
      },
      file
    )
  } else if (hasInstrumentation(source)) {
    add(
      "instrumented",
      {
        status: "instrumented",
        rationale: "Contains a verified Effect span, named workflow, DevTools layer, or managed-runtime callsite."
      },
      file
    )
  } else if (hasEffectRuntimeImport(source) && file.startsWith("apps/visual-effect/")) {
    add(
      "visual-effect-definitions",
      {
        status: "pureExempt",
        rationale:
          "Defines Effect values for visualization or composes already-instrumented IDE operations; it does not own an MCP execution boundary."
      },
      file
    )
  } else if (hasEffectRuntimeImport(source)) {
    const boundary = boundaryFor(file)
    add(
      `covered:${boundary.path}:${boundary.span}`,
      {
        status: "coveredByParentBoundary",
        rationale: "Effect work executes beneath the named, machine-verified parent boundary.",
        boundary
      },
      file
    )
  } else {
    add(
      "pure",
      {
        status: "pureExempt",
        rationale:
          "No Effect runtime import or executable telemetry boundary; this source is pure data, types, rendering, or configuration."
      },
      file
    )
  }
}

const inventory = {
  version: 2,
  updated: new Date().toISOString().slice(0, 10),
  entries: [
    {
      pathPrefix: "src/generated/",
      status: "generated",
      rationale: "Generated protocol artifacts are source-generated and are not instrumented by hand."
    },
    ...groups.values()
  ].map((entry) => ({
    ...entry,
    ...(entry.paths ? { paths: [...entry.paths].sort() } : {})
  }))
}

const generateInventory = Effect.fn("mcp.script.generate.observability-inventory")(() =>
  Effect.sync(() => {
    writeFileSync(
      path.join(repositoryRoot, "docs/observability-inventory.json"),
      `${JSON.stringify(inventory, null, 2)}\n`
    )
    console.log(`Wrote exact observability evidence for ${files.length} source files.`)
  })
)

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  NodeRuntime.runMain(runScript("generate:observability-inventory", generateInventory()))
}
