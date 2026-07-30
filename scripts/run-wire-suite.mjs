import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { fileURLToPath } from "node:url"
import { runCommand, runScript } from "./lib/process.mjs"

const commands = [
  ["node", ["--test", "test/wire/wp4-wire.test.mjs"], "wire.tests"],
  ["node", ["scripts/check-wire-types.mjs"], "wire.types"]
]

const runScriptSuite = Effect.gen(function* () {
  const failed = []
  for (const [command, args, label] of commands) {
    const status = yield* runCommand(command, args, undefined, { label })
    if (status !== 0) failed.push(`${command} ${args.join(" ")}`)
  }

  if (failed.length > 0) {
    console.error("Task 4A wire suite failed:")
    for (const command of failed) console.error(`- ${command}`)
    yield* Effect.fail(new Error("Task 4A wire suite failed"))
  }

  console.log("Task 4A wire suite passed.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-wire-suite", runScriptSuite))
}
