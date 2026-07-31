import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"

import { inspectReleaseArtifact } from "./lib/release-artifact.mjs"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const checkReleaseArtifact = Effect.sync(() => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const args = process.argv.slice(2)
  const targetIndex = args.indexOf("--target")
  const targetName = targetIndex === -1 ? "npm" : args[targetIndex + 1]
  if (targetIndex !== -1) args.splice(targetIndex, 2)
  if (targetName !== "npm" && targetName !== "github-packages") {
    throw new Error(`Unknown release artifact target: ${String(targetName)}`)
  }
  const suppliedTarball = args[0]
  const temporary =
    suppliedTarball === undefined ? mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-release-")) : undefined

  try {
    if (temporary !== undefined) {
      execFileSync("pnpm", ["pack", "--pack-destination", temporary], { cwd: root, stdio: "inherit" })
    }
    const tarball =
      suppliedTarball === undefined
        ? path.join(temporary, `${packageJson.name}-${packageJson.version}.tgz`)
        : path.resolve(root, suppliedTarball)
    const targets = JSON.parse(readFileSync(path.join(root, ".github/release-targets.json"), "utf8"))
    const options =
      targetName === "github-packages"
        ? {
            name: targets.githubPackages.packageName,
            publishConfig: {
              access: "public",
              registry: targets.githubPackages.registry
            }
          }
        : undefined
    const report = inspectReleaseArtifact(root, tarball, options)
    console.log(`Release artifact verification passed: ${JSON.stringify(report)}`)
  } finally {
    if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true })
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  NodeRuntime.runMain(runScript("check:release-artifact", checkReleaseArtifact))
}
