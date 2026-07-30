import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const version = process.argv[2]
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "")) {
  throw new Error("Usage: node scripts/extract-changelog-release.mjs <stable-version>")
}

const source = readFileSync(path.join(root, "CHANGELOG.md"), "utf8")
const startPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\] - (\\d{4}-\\d{2}-\\d{2})$`, "gm")
const matches = [...source.matchAll(startPattern)]
if (matches.length !== 1 || !isIsoDate(matches[0][1])) {
  throw new Error(`CHANGELOG.md must have one dated release section for ${version}`)
}
const start = matches[0]
const bodyStart = start.index + start[0].length
const next = /^## \[/m.exec(source.slice(bodyStart))
const end = next ? bodyStart + next.index : source.length
const body = source.slice(bodyStart, end).trim()
if (!body) throw new Error(`CHANGELOG.md release section ${version} is empty`)
process.stdout.write(`${body}\n`)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isIsoDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
