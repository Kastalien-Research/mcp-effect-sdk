import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []
const manifestPath = "sources/manifest.json"
const requiredSources = new Map([
  ["mcp-core", { repository: "modelcontextprotocol/modelcontextprotocol", revision: "26897cc322f356487da89113451bd16b520b9288" }],
  ["mcp-conformance", { repository: "modelcontextprotocol/conformance", revision: "ce25103b1baa6e0653e0b7bf4f79de385ea7a116", version: "0.2.0-alpha.9" }],
  ["tasks", { repository: "modelcontextprotocol/ext-tasks", revision: "2c1425d9a288b9b1f489430fe1e00bb392b47e48" }],
  ["apps-stable", { repository: "modelcontextprotocol/ext-apps", revision: "ca1d29894fabbd1558885a9ec8620dcb01d7457e", version: "2026-01-26 / @modelcontextprotocol/ext-apps@1.7.4" }],
  ["apps-preview", { repository: "modelcontextprotocol/ext-apps", revision: "2ca6a59d2f493b227a83a2e3ce0396db4705621a" }],
  ["typescript-sdk-v2", { repository: "modelcontextprotocol/typescript-sdk", revision: "e81758caed29f6568ce8873f7f9a3bd65b017d9c", version: "2.0.0-beta.4" }]
])
const requiredCoreHashes = new Map([
  ["schema/draft/schema.ts", "c56f0ad2395f9f7109a903a304344a61c65555cb0b2d28c1635cc32497221c87"],
  ["schema/draft/schema.json", "9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708"]
])

const manifest = readJson(manifestPath)
if (manifest) {
  if (manifest.schemaVersion !== 1) failures.push("sources/manifest.json schemaVersion must be 1")
  if (manifest.protocolVersion !== "2026-07-28") {
    failures.push("sources/manifest.json protocolVersion must be 2026-07-28")
  }
  if (!Array.isArray(manifest.sources)) {
    failures.push("sources/manifest.json sources must be an array")
  } else {
    const actualIds = new Set(manifest.sources.map((source) => source.id))
    for (const id of requiredSources.keys()) {
      if (!actualIds.has(id)) failures.push(`sources/manifest.json missing source ${id}`)
    }
    for (const source of manifest.sources) validateSource(source)
    const recordedFiles = new Set(manifest.sources.flatMap((source) =>
      Array.isArray(source.files) ? source.files.map((file) => file.vendoredPath) : []
    ))
    for (const vendoredPath of walkFiles("sources/vendor")) {
      if (!recordedFiles.has(vendoredPath)) failures.push(`Unrecorded vendored file ${vendoredPath}`)
    }
  }
}

const packageJson = readJson("package.json")
if (packageJson) {
  const scripts = packageJson.scripts ?? {}
  if (scripts["sources:check"] !== "node scripts/check-source-snapshots.mjs") {
    failures.push("package.json must expose sources:check")
  }
  if (scripts["sources:refresh"] !== "node scripts/refresh-source-snapshot.mjs") {
    failures.push("package.json must expose sources:refresh")
  }
}
const verifySource = readFile("scripts/verify.mjs")
if (verifySource && !verifySource.includes("sources:check")) failures.push("verify must run sources:check")

const refreshSource = readFile("scripts/refresh-source-snapshot.mjs")
if (refreshSource) {
  for (const marker of ["--source", "--revision", "semanticDiff", "oldRevision", "newRevision", "reconciliationFile", "fixturePaths", "--apply"]) {
    if (!refreshSource.includes(marker)) failures.push(`refresh tooling missing marker ${marker}`)
  }
}

const conformancePackage = readJson("test/conformance/package.json")
if (conformancePackage?.devDependencies?.["@modelcontextprotocol/conformance"] !== "0.2.0-alpha.9") {
  failures.push("test/conformance must pin @modelcontextprotocol/conformance@0.2.0-alpha.9")
}

for (const runnerPath of [
  "scripts/run-conformance-suite.mjs",
  "scripts/run-conformance-client-auth.mjs",
  "scripts/run-conformance-authorization.mjs"
]) {
  const source = readFile(runnerPath)
  if (!source) continue
  if (source.includes("MCP_CONFORMANCE_SPEC_VERSION")) {
    failures.push(`${runnerPath} must not allow a spec-version override`)
  }
  if (!/"--spec-version",\s*"2026-07-28"/.test(source)) {
    failures.push(`${runnerPath} must pass literal --spec-version 2026-07-28`)
  }
}

if (failures.length > 0) {
  console.error("Source snapshot check failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Source snapshot check passed (${manifest.sources.length} pinned sources).`)

function validateSource(source) {
  const required = requiredSources.get(source.id)
  if (!required) {
    failures.push(`sources/manifest.json has unexpected source ${String(source.id)}`)
    return
  }
  for (const [field, expected] of Object.entries(required)) {
    if (source[field] !== expected) failures.push(`${source.id}.${field} must be ${expected}`)
  }
  for (const field of ["role", "license", "licenseFile", "refreshCommand", "reconciliationFile"]) {
    if (typeof source[field] !== "string" || source[field].length === 0) {
      failures.push(`${source.id}.${field} must be a non-empty string`)
    }
  }
  const expectedRefresh = `env CI=true corepack pnpm run sources:refresh -- --source ${source.id} --revision <new-revision>`
  if (source.refreshCommand !== expectedRefresh) {
    failures.push(`${source.id}.refreshCommand must select only that source`)
  }
  if (!Array.isArray(source.files) || source.files.length === 0) {
    failures.push(`${source.id}.files must contain at least one vendored file`)
    return
  }
  for (const file of source.files) {
    if (!isSafeRelative(file.upstreamPath) || !isSafeRelative(file.vendoredPath)) {
      failures.push(`${source.id} contains an unsafe source path`)
      continue
    }
    if (!/^sources\/vendor\//.test(file.vendoredPath)) {
      failures.push(`${source.id} vendored path must be under sources/vendor/`)
    }
    if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) {
      failures.push(`${source.id}:${file.vendoredPath} must record a SHA-256 hash`)
      continue
    }
    const contents = readFile(file.vendoredPath)
    if (!contents) continue
    const actual = createHash("sha256").update(contents).digest("hex")
    if (actual !== file.sha256) failures.push(`${file.vendoredPath} hash mismatch: expected ${file.sha256}, got ${actual}`)
    const requiredCoreHash = source.id === "mcp-core" ? requiredCoreHashes.get(file.upstreamPath) : undefined
    if (requiredCoreHash && file.sha256 !== requiredCoreHash) {
      failures.push(`${source.id}:${file.upstreamPath} must retain the authorized pinned hash ${requiredCoreHash}`)
    }
  }
  if (source.licenseFile && !existsSync(path.join(root, source.licenseFile))) {
    failures.push(`Missing ${source.licenseFile}`)
  }
  if (source.reconciliationFile && !existsSync(path.join(root, source.reconciliationFile))) {
    failures.push(`Missing ${source.reconciliationFile}`)
  }
}

function readJson(relativePath) {
  const source = readFile(relativePath)
  if (!source) return undefined
  try {
    return JSON.parse(source)
  } catch (error) {
    failures.push(`${relativePath} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function readFile(relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`Missing ${relativePath}`)
    return undefined
  }
  return readFileSync(absolutePath)
}

function isSafeRelative(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..")
}

function walkFiles(relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot)
  if (!existsSync(absoluteRoot)) return []
  const files = []
  const visit = (absoluteDirectory) => {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const absolute = path.join(absoluteDirectory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else files.push(path.relative(root, absolute).split(path.sep).join("/"))
    }
  }
  visit(absoluteRoot)
  return files.sort()
}
