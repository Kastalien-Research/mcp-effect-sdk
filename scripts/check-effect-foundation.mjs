import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import {
  collectSourceFiles,
  dependencyPolicyErrors,
  lockfileRuntimeErrors,
  sourcePolicyErrors,
  workflowPolicyErrors
} from "./effect-foundation-policy.mjs"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runCheckEffectFoundation = Effect.gen(function* () {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const lockfile = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8")
  const workflow = readFileSync(path.join(root, ".github/workflows/verify.yml"), "utf8")

  const errors = [
    ...dependencyPolicyErrors(packageJson),
    ...sourcePolicyErrors(collectSourceFiles(root)),
    ...lockfileRuntimeErrors(lockfile),
    ...workflowPolicyErrors(workflow)
  ]

  if (errors.length > 0) {
    console.error("Effect 3 foundation policy failed:")
    for (const error of errors) console.error(`- ${error}`)
    yield* Effect.fail(new Error("Effect 3 foundation policy failed."))
  }

  console.log("Effect 3 dependency, import, runtime, and Node matrix policies pass.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("check-effect-foundation", runCheckEffectFoundation))
}
