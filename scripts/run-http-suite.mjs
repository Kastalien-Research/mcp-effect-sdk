import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { fileURLToPath } from "node:url"
import { runCommand, runScript } from "./lib/process.mjs"

const commands = [
  [
    "node",
    [
      "--test",
      "test/http/wp4-http-metadata.test.mjs",
      "test/http/wp4-http-client.test.mjs",
      "test/http/wp4-http-server.test.mjs"
    ],
    "http.tests"
  ],
  ["node", ["scripts/check-http-metadata-types.mjs"], "http-metadata.types"],
  ["node", ["scripts/check-http-client-types.mjs"], "http-client.types"],
  ["node", ["scripts/check-http-server-types.mjs"], "http-server.types"]
]

const runHttpSuite = Effect.gen(function* () {
  const failed = []
  for (const [command, args, label] of commands) {
    const status = yield* runCommand(command, args, undefined, { label })
    if (status !== 0) failed.push(`${command} ${args.join(" ")}`)
  }

  if (failed.length > 0) {
    console.error("Cumulative Task 4D HTTP suite failed:")
    for (const command of failed) console.error(`- ${command}`)
    yield* Effect.fail(new Error("Cumulative Task 4D HTTP suite failed"))
  }

  console.log("Cumulative Task 4D HTTP suite passed.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-http-suite", runHttpSuite))
}
