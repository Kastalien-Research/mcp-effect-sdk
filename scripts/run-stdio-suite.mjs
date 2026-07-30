import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { fileURLToPath } from "node:url"
import { runCommand, runScript } from "./lib/process.mjs"

const commands = [
  ["node", ["--test", "test/stdio/wp4-stdio.test.mjs"], "stdio.tests"],
  ["node", ["scripts/check-stdio-types.mjs"], "stdio.types"]
]

const runScriptSuite = Effect.gen(function* () {
  const failed = []
  for (const [command, args, label] of commands) {
    const status = yield* runCommand(command, args, undefined, { label })
    if (status !== 0) failed.push(`${command} ${args.join(" ")}`)
  }

  if (failed.length > 0) {
    console.error("Task 4C stdio suite failed:")
    for (const command of failed) console.error(`- ${command}`)
    yield* Effect.fail(new Error("Task 4C stdio suite failed"))
  }

  console.log("Task 4C stdio suite passed.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-stdio-suite", runScriptSuite))
}
