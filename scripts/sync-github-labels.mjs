import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { githubLabelNameSet, indexGitHubLabels, normalizeGitHubLabelName } from "./lib/github-labels.mjs"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runSyncGithubLabels = Effect.gen(function* () {
  if (!process.argv.includes("--apply")) {
    console.error("Refusing to mutate GitHub labels without --apply.")
    yield* Effect.fail(new Error("Refusing to mutate GitHub labels without --apply."))
  }

  const repository = process.env.GITHUB_REPOSITORY
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    console.error("GITHUB_REPOSITORY must identify the exact owner/repository.")
    yield* Effect.fail(new Error("GITHUB_REPOSITORY must identify the exact owner/repository."))
  }

  const desired = JSON.parse(readFileSync(path.join(root, ".github/labels.json"), "utf8"))
  const desiredNames = githubLabelNameSet(desired)
  if (desired.length !== 12 || desiredNames.size !== 12) {
    yield* Effect.fail(new Error(".github/labels.json must contain exactly 12 unique labels"))
  }

  const pages = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repository}/labels?per_page=100`]))
  const current = pages.flat()
  const currentByName = indexGitHubLabels(current)

  for (const label of desired) {
    const existing = currentByName.get(normalizeGitHubLabelName(label.name))
    if (existing) {
      gh([
        "api",
        "--method",
        "PATCH",
        `repos/${repository}/labels/${encodeURIComponent(existing.name)}`,
        "-f",
        `new_name=${label.name}`,
        "-f",
        `color=${label.color}`,
        "-f",
        `description=${label.description}`
      ])
    } else {
      gh([
        "api",
        "--method",
        "POST",
        `repos/${repository}/labels`,
        "-f",
        `name=${label.name}`,
        "-f",
        `color=${label.color}`,
        "-f",
        `description=${label.description}`
      ])
    }
  }

  for (const label of current) {
    if (!desiredNames.has(normalizeGitHubLabelName(label.name))) {
      gh(["api", "--method", "DELETE", `repos/${repository}/labels/${encodeURIComponent(label.name)}`])
    }
  }

  console.log(`Synchronized exactly ${desired.length} labels for ${repository}.`)
})

function gh(args) {
  return execFileSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("sync-github-labels", runSyncGithubLabels))
}
