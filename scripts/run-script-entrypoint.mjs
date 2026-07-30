import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { runScript } from "./lib/process.mjs"

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const targetArg = process.argv[2]
const requestedLabel = process.argv[3]

if (!targetArg) {
  throw new Error(
    "run-script-entrypoint requires a target script path.\n" +
      "Usage: node scripts/run-script-entrypoint.mjs <script> [label]"
  )
}

const targetPath = path.resolve(scriptRoot, "..", targetArg)
const explicitLabel = requestedLabel?.startsWith("--") === false ? requestedLabel : undefined
const scriptLabel = explicitLabel ?? path.parse(path.basename(targetPath)).name

const offset = explicitLabel ? 4 : 3
process.argv = [process.argv[0], targetPath, ...process.argv.slice(offset)]

NodeRuntime.runMain(
  runScript(
    scriptLabel,
    Effect.promise(() => import(pathToFileURL(targetPath).href))
  )
)
