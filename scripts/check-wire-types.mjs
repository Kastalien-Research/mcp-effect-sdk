import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runCheckWireTypes = Effect.gen(function* () {
  const result = yield* Effect.sync(() =>
    spawnSync("pnpm", ["exec", "tsc", "--project", "test/types/wp4-wire/tsconfig.json"], {
      cwd: root,
      encoding: "utf8"
    })
  )
  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    console.error("Task 4A public wire type fixture failed to compile.")
    yield* Effect.fail(new Error("Task 4A public wire type fixture failed to compile."))
  }
  console.log("Task 4A public wire type fixture passes.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("check-wire-types", runCheckWireTypes))
}
