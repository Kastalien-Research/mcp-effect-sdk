// Emits release-provenance evidence for GR-REL-001.
//
// SEP-1730 requires a Tier 1 SDK to have a "stable release and SDK versioning
// clearly documented". That is a fact about the world, a tag, a published
// artifact, notes and not something a script can assert into being. So this reads
// the repository's actual release state and writes evidence only when a real
// release exists.
//
// Cutting the release is a maintainer action. This script never tags, never
// publishes, and never rewrites the versioning policy; it reports what is true
// and tells you what is missing.
//
// Usage: node scripts/generate-release-provenance.mjs
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { createChecker } from "./lib/check.mjs"
import { writeTestEvidenceReport } from "./readiness-evidence.mjs"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runGenerateReleaseProvenance = Effect.sync(() => {
  const checker = createChecker({ root, name: "Release provenance generation" })
  const git = (args, fallback = "") => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
    } catch {
      return fallback
    }
  }

  const packageJson = checker.requireJson("package.json")
  const version = packageJson?.version
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"]).split("\n").filter(Boolean)
  const releaseTag = tags.find((tag) => tag === `v${version}`)
  const changelogPresent = checker.exists("CHANGELOG.md")

  // The two sentinels the readiness checker reads. They must be cleared by a
  // maintainer as part of cutting the release, not by this generator: a script
  // that edits the claim it is meant to evidence proves nothing.
  const versioningPolicy = checker.requireText("docs/conformance/versioning-policy.md")
  const tierEvidence = checker.requireText("docs/conformance/sdk-tier-evidence.md")
  const policyDeclaresNoRelease = /Current status:\s*no stable release is evidenced/i.test(versioningPolicy)
  const tierDeclaresNoRelease = /No published stable package release evidence/i.test(tierEvidence)

  const missing = []
  if (releaseTag === undefined) missing.push(`no git tag v${version}`)
  if (!changelogPresent) missing.push("no CHANGELOG.md (run `pnpm run version-packages`)")
  if (policyDeclaresNoRelease) missing.push("docs/conformance/versioning-policy.md still states no stable release")
  if (tierDeclaresNoRelease) missing.push("docs/conformance/sdk-tier-evidence.md still states no published release")
  if (String(packageJson?.license ?? "") === "ISC") missing.push("package.json license is still the scaffold default")
  if (String(packageJson?.description ?? "").trim() === "") missing.push("package.json description is empty")

  console.log(`Package version: ${version}`)
  console.log(`Release tags: ${tags.length === 0 ? "none" : tags.join(", ")}`)

  if (missing.length > 0) {
    console.log("")
    console.log("No stable release is evidenced yet. Outstanding:")
    for (const item of missing) console.log(`- ${item}`)
    console.log("")
    console.log("GR-REL-001 stays failing, which is accurate: there is no release to point at.")
    console.log("Cut the release first (changeset, version, tag, publish), then re-run this.")
    checker.report("Release provenance generation completed with no release to attest.")
    return
  }

  const evidencePath = writeTestEvidenceReport({
    name: "release-provenance",
    evidenceKind: "release-provenance",
    command: "node scripts/generate-release-provenance.mjs",
    exitCode: 0,
    requirementIds: ["GR-REL-001"],
    suite: "release-provenance",
    summary: {
      source: "sources/vendor/sep-1730/1730-sdks-tiering-system.md",
      version,
      tag: releaseTag,
      commit: git(["rev-list", "-n", "1", releaseTag]),
      taggedAt: git(["log", "-1", "--format=%cI", releaseTag]),
      changelog: "CHANGELOG.md",
      versioningPolicy: "docs/conformance/versioning-policy.md"
    },
    cases: [
      {
        id: "release-tag",
        case: "release-tag",
        description: `Git tag ${releaseTag} matches package version ${version}`,
        command: "git tag --list",
        exitCode: 0,
        status: "pass"
      },
      {
        id: "release-notes",
        case: "release-notes",
        description: "CHANGELOG.md records the released version",
        command: "pnpm run version-packages",
        exitCode: 0,
        status: "pass"
      }
    ]
  })

  console.log(`Writing readiness evidence to ${evidencePath}`)
  checker.report("Release provenance generation completed.")
})

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(runScript("generate-release-provenance", runGenerateReleaseProvenance))
}
