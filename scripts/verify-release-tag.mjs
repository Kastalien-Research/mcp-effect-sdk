import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
if (typeof tag !== "string" || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
  throw new Error(`Release tag must be a stable vMAJOR.MINOR.PATCH tag; received ${String(tag)}`)
}

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const version = tag.slice(1)
if (packageJson.version !== version) {
  throw new Error(`Tag ${tag} does not match package.json version ${packageJson.version}`)
}

const head = git(["rev-parse", "HEAD"])
const tagCommit = gitOptional(["rev-list", "-n", "1", tag])
if (tagCommit === "") {
  throw new Error(`Release tag ${tag} does not resolve to a commit`)
}
if (head !== tagCommit) {
  throw new Error(`Tag ${tag} resolves to ${tagCommit}, not checked-out commit ${head}`)
}
const trackedChanges = git(["status", "--porcelain", "--untracked-files=no"])
if (trackedChanges !== "") {
  throw new Error(`Release tag ${tag} must be qualified from an unchanged checkout`)
}

const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8")
const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\] - (\\d{4}-\\d{2}-\\d{2})$`, "gm")
const matches = [...changelog.matchAll(heading)]
if (matches.length !== 1 || !isIsoDate(matches[0][1])) {
  throw new Error(`CHANGELOG.md needs a dated [${version}] heading before publication`)
}

console.log(`Release tag ${tag}, package ${version}, changelog, and commit ${head} agree.`)

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function gitOptional(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
  } catch {
    return ""
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isIsoDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
