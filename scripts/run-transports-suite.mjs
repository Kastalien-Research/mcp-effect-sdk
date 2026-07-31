import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { fileURLToPath } from "node:url"
import { runCommand, runScript } from "./lib/process.mjs"

const commands = [
  [
    "node",
    [
      "--test",
      "test/transports/wp4-transports.test.mjs",
      "test/packaging/wp4-package-boundary.test.mjs",
      "test/packaging/wp4-governance.test.mjs"
    ],
    "transports.tests"
  ],
  ["pnpm", ["exec", "tsc", "-p", "test/types/wp4-transports/tsconfig.json", "--noEmit"], "transports.types"],
  ["pnpm", ["exec", "tsc", "-p", "test/types/wp4-package-boundary/tsconfig.json", "--noEmit"], "package-boundary.types"]
]

const runTransportsSuite = Effect.gen(function* () {
  const failed = []
  for (const [command, args, label] of commands) {
    const status = yield* runCommand(command, args, undefined, { label })
    if (status !== 0) failed.push(`${command} ${args.join(" ")}`)
  }

  if (failed.length > 0) {
    console.error("Cumulative Task 4D transport/package suite failed:")
    for (const command of failed) console.error(`- ${command}`)
    yield* Effect.fail(new Error("Cumulative Task 4D transport/package suite failed"))
  }

  console.log("Cumulative Task 4D transport/package suite passed.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-transports-suite", runTransportsSuite))
}
