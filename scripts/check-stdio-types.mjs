import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const runTypecheck = () => {
  const command = ["pnpm", "exec", "tsc", "--project", "test/types/wp4-stdio/tsconfig.json"]
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    encoding: "utf8"
  })
  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    console.error("Task 4C public stdio type fixture failed to compile.")
    return Effect.fail(new Error("type-check failed"))
  }
  return Effect.sync(() => {
    console.log("Task 4C public stdio type fixture passes.")
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("scripts/check-stdio-types", () => runTypecheck()))
}
