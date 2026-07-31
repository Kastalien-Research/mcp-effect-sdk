import path from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import { packageManagerPath, runCommand, runScript } from "./lib/process.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runCheckTaskRuntime = Effect.fn("mcp.script.check.task-runtime")(function* () {
  const exitCode = yield* runCommand(packageManagerPath(), ["run", "test:tasks-schema"], repositoryRoot, {
    label: "test:tasks-schema"
  })
  if (exitCode !== 0) {
    return yield* Effect.fail(new Error(`Task extension checks exited with code ${exitCode}`))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  NodeRuntime.runMain(runScript("check:tasks", runCheckTaskRuntime()))
}
