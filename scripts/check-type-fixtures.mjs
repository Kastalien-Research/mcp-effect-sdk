import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runCheckTypeFixtures = Effect.gen(function* () {
  const positive = yield* Effect.sync(() => run("test/types/tsconfig.json"))
  if (positive.status !== 0) {
    process.stdout.write(positive.stdout)
    process.stderr.write(positive.stderr)
    console.error("Effect 3 public type fixture failed to compile.")
    yield* Effect.fail(new Error("Effect 3 public type fixture failed to compile."))
  }

  const negative = yield* Effect.sync(() => run("test/types/negative/tsconfig.json"))
  const diagnostics = `${negative.stdout}${negative.stderr}`
  const removedApiName = "register" + "Toolkit"
  if (negative.status === 0 || !diagnostics.includes(removedApiName)) {
    process.stdout.write(negative.stdout)
    process.stderr.write(negative.stderr)
    console.error("Removed Effect AI API negative fixture did not fail with the expected diagnostic.")
    yield* Effect.fail(new Error("Removed Effect AI API negative fixture did not fail with the expected diagnostic."))
  }

  const templateNegative = yield* Effect.sync(() => run("test/types/negative-template/tsconfig.json"))
  const templateDiagnostics = `${templateNegative.stdout}${templateNegative.stderr}`
  if (templateNegative.status === 0 || !templateDiagnostics.includes("not assignable to type 'string'")) {
    process.stdout.write(templateNegative.stdout)
    process.stderr.write(templateNegative.stderr)
    console.error("Decoded resource-template parameter negative fixture did not fail with the expected diagnostic.")
    yield* Effect.fail(
      new Error("Decoded resource-template parameter negative fixture did not fail with the expected diagnostic.")
    )
  }

  console.log("Effect 3 positive and negative public type fixtures pass.")
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("check-type-fixtures", runCheckTypeFixtures))
}

function run(project) {
  return spawnSync("pnpm", ["exec", "tsc", "--project", project], {
    cwd: root,
    encoding: "utf8"
  })
}
