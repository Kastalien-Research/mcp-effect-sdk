import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { fileURLToPath } from "node:url"
import { runCommand, runScript } from "./lib/process.mjs"

const commands = [
  ["node", ["--test", "test/http/wp4-http-client.test.mjs"], "http-client.tests"],
  ["node", ["scripts/check-http-client-types.mjs"], "http-client.types"]
]

const runHttpClientSuite = Effect.gen(function* () {
  const failed = []
  for (const [command, args, label] of commands) {
    const status = yield* runCommand(command, args, undefined, { label })
    if (status !== 0) failed.push(`${command} ${args.join(" ")}`)
  }

  if (failed.length > 0) {
    console.error("Task 4D HTTP client suite failed:")
    for (const command of failed) console.error(`- ${command}`)
    yield* Effect.fail(new Error("Task 4D HTTP client suite failed"))
  }

  console.log("Task 4D HTTP client suite passed.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-http-client-suite", runHttpClientSuite))
}
