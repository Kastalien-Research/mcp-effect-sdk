// Runs the @effect/language-service diagnostics that the editor shows, as a
// build gate.
//
// `tsc` alone cannot report these: a TypeScript language-service plugin is only
// loaded by an editor, so `pnpm run build` never sees them. The upstream
// alternative is `effect-language-service patch`, which rewrites the installed
// typescript package in node_modules. That is invisible to anyone reading the
// build and silently undone by a reinstall, so this repo runs the CLI instead.
//
// Error-severity diagnostics fail the gate unless they are listed in
// effect-lsp-baseline.json with a reason. Warnings and suggestions are printed
// but do not fail: they are editor guidance, not policy.
import { spawn } from "node:child_process"
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cli = path.join(root, "node_modules/@effect/language-service/cli.js")
const projects = ["tsconfig.json", "examples/tsconfig.json"]
const baselinePath = path.join(root, "effect-lsp-baseline.json")

const relative = (file) => path.relative(root, file).split(path.sep).join("/")

const collectDiagnosticsFor = (project) =>
  Effect.async((resume) => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "mcp-effect-lsp-"))
    const outputPath = path.join(outputDirectory, "diagnostics.json")
    const outputFd = openSync(outputPath, "w")
    const child = spawn(process.execPath, [cli, "diagnostics", "--project", project, "--format", "json"], {
      cwd: root,
      stdio: ["ignore", outputFd, "pipe"]
    })
    closeSync(outputFd)
    let stderr = ""
    let settled = false
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    const cleanOutput = () => {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
    child.once("error", (error) => {
      if (settled) return
      settled = true
      cleanOutput()
      resume(Effect.fail(new Error(`Effect diagnostics could not run for ${project}: ${error.message}`)))
    })
    child.once("close", (code) => {
      if (settled) return
      settled = true
      const stdout = readFileSync(outputPath, "utf8")
      cleanOutput()
      if (stdout.trim() === "") {
        if (code === 0) {
          resume(Effect.succeed([]))
          return
        }
        resume(Effect.fail(new Error(`Effect diagnostics could not run for ${project}: ${stderr || "empty output"}`)))
        return
      }
      try {
        const parsed = JSON.parse(stdout)
        resume(Effect.succeed(Array.isArray(parsed) ? parsed : (parsed.diagnostics ?? [])))
      } catch (error) {
        resume(
          Effect.fail(
            new Error(
              `Effect diagnostics returned invalid JSON for ${project}: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          )
        )
      }
    })
    return Effect.sync(() => {
      if (!settled && child.exitCode === null) child.kill("SIGTERM")
      cleanOutput()
    })
  })

const runCheckEffectLsp = Effect.gen(function* () {
  if (!existsSync(cli)) {
    yield* Effect.fail(new Error("@effect/language-service is not installed; run pnpm install"))
  }

  const all = yield* Effect.all(projects.map(collectDiagnosticsFor), { concurrency: 1 }).pipe(
    Effect.map((all) => all.flat())
  )
  const errors = all.filter((entry) => entry.severity === "error")
  const other = all.filter((entry) => entry.severity !== "error")

  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : { accepted: [] }
  // A baseline entry is matched by rule and file only, never by line, so that
  // editing unrelated code above an accepted diagnostic does not break the gate.
  const acceptedKeys = new Set(baseline.accepted.map((entry) => `${entry.rule}\u0000${entry.file}`))
  const accepted = []
  const unexpected = []
  for (const entry of errors) {
    const key = `${entry.name}\u0000${relative(entry.file)}`
    ;(acceptedKeys.has(key) ? accepted : unexpected).push(entry)
  }

  // An accepted entry that no longer fires is stale: the debt was paid, and the
  // baseline should shrink rather than quietly grow stale.
  const firing = new Set(errors.map((entry) => `${entry.name}\u0000${relative(entry.file)}`))
  const stale = baseline.accepted.filter((entry) => !firing.has(`${entry.rule}\u0000${entry.file}`))

  if (other.length > 0) {
    const counts = {}
    for (const entry of other) counts[entry.name] = (counts[entry.name] ?? 0) + 1
    const summary = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} x${count}`)
      .join(", ")
    console.log(`Effect diagnostics (non-blocking): ${summary}`)
  }

  if (unexpected.length > 0) {
    const lines = ["Effect language-service reported new error-severity diagnostics:"]
    for (const entry of unexpected) {
      lines.push(`- ${relative(entry.file)}:${entry.line}:${entry.column} ${entry.name}`)
      lines.push(`  ${entry.message.split("\n")[0]}`)
    }
    lines.push("")
    lines.push("Fix them, or add a reasoned entry to effect-lsp-baseline.json.")
    yield* Effect.fail(new Error(lines.join("\n")))
  }

  if (stale.length > 0) {
    const lines = ["effect-lsp-baseline.json lists diagnostics that no longer fire:"]
    for (const entry of stale) lines.push(`- ${entry.rule} in ${entry.file}`)
    lines.push("")
    lines.push("Remove these entries; the baseline must only record live debt.")
    yield* Effect.fail(new Error(lines.join("\n")))
  }

  console.log(`Effect language-service check passed (${accepted.length} baselined, 0 new).`)
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("check:effect-lsp", runCheckEffectLsp))
}
