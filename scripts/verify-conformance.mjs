import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { readinessEvidencePath, runtimeEvidenceName } from "./readiness-evidence.mjs"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runVerifyConformance = Effect.gen(function* () {
  const publishedArtifact = process.argv.includes("--published")
  if (process.argv.slice(2).some((argument) => argument !== "--published")) {
    yield* Effect.fail(new Error("Usage: node scripts/verify-conformance.mjs [--published]"))
  }
  const evidencePrefix = publishedArtifact ? "published-" : ""
  const evidenceTargets = [
    readinessEvidencePath(publishedArtifact ? runtimeEvidenceName("published-conformance") : "conformance"),
    readinessEvidencePath(runtimeEvidenceName(`${evidencePrefix}conformance-client`)),
    readinessEvidencePath(runtimeEvidenceName(`${evidencePrefix}conformance-client-auth`)),
    readinessEvidencePath(`${evidencePrefix}conformance-composite`)
  ]
  for (const target of evidenceTargets) rmSync(target, { force: true })

  const sourceCommands = [
    ["pnpm", ["run", "conformance:run"]],
    ["pnpm", ["run", "conformance:client"]],
    ["pnpm", ["run", "conformance:client-auth"]]
  ]
  const commands = publishedArtifact
    ? [
        [process.execPath, ["scripts/run-conformance-suite.mjs"]],
        [process.execPath, ["scripts/run-conformance-client.mjs"]],
        [process.execPath, ["scripts/run-conformance-client-auth.mjs"]]
      ]
    : sourceCommands
  const childEnvironment = publishedArtifact
    ? { ...process.env, MCP_CONFORMANCE_EVIDENCE_VARIANT: "published" }
    : process.env

  const failed = []
  for (const [command, args] of commands) {
    const result = yield* Effect.sync(() => spawnSync(command, args, { env: childEnvironment, stdio: "inherit" }))
    if (result.status !== 0) failed.push(`${command} ${args.join(" ")}`)
  }

  if (failed.length > 0) {
    console.error("\nAuthoritative conformance failed gates:")
    for (const command of failed) console.error(`- ${command}`)
    yield* Effect.fail(new Error(`Authoritative conformance failed gates: ${failed.join(", ")}`))
  }

  const compositeResult = yield* Effect.sync(() =>
    spawnSync(
      process.execPath,
      ["scripts/generate-conformance-composite.mjs", ...(publishedArtifact ? ["--published"] : [])],
      {
        cwd: root,
        env: childEnvironment,
        stdio: "inherit"
      }
    )
  )
  if (compositeResult.status !== 0) {
    console.error("\nAuthoritative conformance failed to produce a same-commit composite.")
    yield* Effect.fail(new Error("Authoritative conformance failed to produce a same-commit composite."))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("verify-conformance", runVerifyConformance))
}
