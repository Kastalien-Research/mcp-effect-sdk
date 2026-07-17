import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const positive = run("test/types/tsconfig.json")
if (positive.status !== 0) {
  process.stdout.write(positive.stdout)
  process.stderr.write(positive.stderr)
  console.error("Effect 3 public type fixture failed to compile.")
  process.exit(1)
}

const negative = run("test/types/negative/tsconfig.json")
const diagnostics = `${negative.stdout}${negative.stderr}`
const removedApiName = "register" + "Toolkit"
if (negative.status === 0 || !diagnostics.includes(removedApiName)) {
  process.stdout.write(negative.stdout)
  process.stderr.write(negative.stderr)
  console.error("Removed Effect AI API negative fixture did not fail with the expected diagnostic.")
  process.exit(1)
}

console.log("Effect 3 positive and removed-API negative type fixtures pass.")

function run(project) {
  return spawnSync("pnpm", ["exec", "tsc", "--project", project], {
    cwd: root,
    encoding: "utf8"
  })
}
