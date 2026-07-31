import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildGitHubPackagesArtifact } from "./lib/github-packages-artifact.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceTarball = process.argv[2]
const destination = process.argv[3]
if (sourceTarball === undefined || destination === undefined) {
  throw new Error("Usage: node scripts/build-github-packages-artifact.mjs <npm-tarball> <destination>")
}

const targets = JSON.parse(readFileSync(path.join(root, ".github/release-targets.json"), "utf8"))
const result = buildGitHubPackagesArtifact(
  root,
  path.resolve(root, sourceTarball),
  path.resolve(root, destination),
  targets.githubPackages
)
console.log(`GitHub Packages artifact verification passed: ${JSON.stringify(result.report)}`)
