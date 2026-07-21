import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  collectSourceFiles,
  dependencyPolicyErrors,
  lockfileRuntimeErrors,
  sourcePolicyErrors,
  workflowPolicyErrors
} from "./effect-foundation-policy.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
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
  process.exit(1)
}

console.log("Effect 3 dependency, import, runtime, and Node matrix policies pass.")
