import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { gunzipSync } from "node:zlib"

const tarBlockSize = 512
const githubPackagesMaximumBytes = 256 * 1024 * 1024

export const releaseFiles = [
  "dist",
  "!dist/examples",
  "README.md",
  "CHANGELOG.md",
  "DEPENDENCY_POLICY.md",
  "MAINTENANCE.md",
  "VERSIONING.md",
  "ROADMAP.md",
  "SECURITY.md",
  "scripts/release-via-tag.mjs",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
]

const credentialPatterns = [
  ["private key", /-----BEGIN[ A-Z]*PRIVATE KEY-----/],
  ["GitHub token", /\b(?:github_pat_|gh[opsu]_)[A-Za-z0-9_]+\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]+\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/]
]

const absoluteWorkspacePatterns = [/\/home\/codespace\b/, /\/workspaces\/mcp-effect-sdk\b/]
const forbiddenBasenames = new Set([
  ".env",
  ".gitignore",
  ".npmignore",
  ".npmrc",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "yarn.lock"
])

export function inspectReleaseArtifact(root, tarballPath, options = {}) {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const expectedName = options.name ?? packageJson.name
  const expectedPublishConfig = options.publishConfig ?? packageJson.publishConfig
  assert.deepEqual(packageJson.files, releaseFiles, "package.json files allowlist changed")

  const compressed = readFileSync(tarballPath)
  assert.ok(compressed.byteLength < githubPackagesMaximumBytes, "tarball exceeds GitHub Packages' 256 MB limit")
  const entries = readReleaseArtifactEntries(tarballPath)
  const files = entries.filter((entry) => entry.type === "file")
  assert.equal(files.length, entries.length, "release archive may contain regular files only")

  const actualNames = files.map((entry) => entry.name)
  assert.equal(new Set(actualNames).size, actualNames.length, "release archive contains duplicate paths")
  assert.deepEqual(actualNames.toSorted(), expectedArchiveFiles(root).toSorted(), "release archive file set changed")

  for (const entry of files) {
    assert.equal(entry.mode, 0o644, `${entry.name} must have mode 0644`)
    assert.equal(entry.name.startsWith("package/"), true, `${entry.name} must remain under package/`)
    assert.equal(entry.name.includes("\\"), false, `${entry.name} must use POSIX separators`)
    assert.equal(path.posix.isAbsolute(entry.name), false, `${entry.name} must be relative`)
    assert.equal(entry.name.split("/").includes(".."), false, `${entry.name} must not traverse directories`)
    assert.equal(entry.name.endsWith(".map"), false, `${entry.name} must not publish source maps`)
    for (const segment of entry.name.split("/")) {
      assert.equal(forbiddenBasenames.has(segment), false, `${entry.name} contains forbidden release metadata`)
    }

    const source = entry.content.toString("utf8")
    for (const [label, pattern] of credentialPatterns) {
      assert.doesNotMatch(source, pattern, `${entry.name} contains a ${label}`)
    }
    for (const pattern of absoluteWorkspacePatterns) {
      assert.doesNotMatch(source, pattern, `${entry.name} contains an absolute development path`)
    }
    if (entry.name !== "package/package.json") {
      const sourcePath = path.join(root, entry.name.slice("package/".length))
      assert.deepEqual(entry.content, readFileSync(sourcePath), `${entry.name} differs from the qualified checkout`)
    }
  }

  const packedPackage = JSON.parse(requireEntry(files, "package/package.json").content.toString("utf8"))
  for (const field of [
    "version",
    "type",
    "description",
    "exports",
    "main",
    "types",
    "keywords",
    "author",
    "license",
    "repository",
    "homepage",
    "bugs",
    "files",
    "engines",
    "dependencies",
    "peerDependencies",
    "peerDependenciesMeta"
  ]) {
    assert.deepEqual(packedPackage[field], packageJson[field], `packed package.json ${field} changed`)
  }
  assert.equal(packedPackage.name, expectedName)
  assert.deepEqual(packedPackage.publishConfig, expectedPublishConfig)
  assert.equal(packedPackage.license, "MIT")
  assert.deepEqual(packedPackage.files, releaseFiles)

  for (const [subpath, conditions] of Object.entries(packedPackage.exports ?? {})) {
    for (const [condition, target] of Object.entries(conditions)) {
      assert.equal(typeof target, "string", `${subpath} ${condition} target must be a string`)
      assert.equal(
        actualNames.includes(`package/${target.replace(/^\.\//, "")}`),
        true,
        `${subpath} ${condition} target is absent from the archive`
      )
    }
  }

  return {
    name: packedPackage.name,
    version: packedPackage.version,
    sha256: createHash("sha256").update(compressed).digest("hex"),
    compressedBytes: compressed.byteLength,
    unpackedBytes: files.reduce((total, entry) => total + entry.content.byteLength, 0),
    fileCount: files.length,
    exportCount: Object.keys(packedPackage.exports ?? {}).length
  }
}

export function readReleaseArtifactEntries(tarballPath) {
  return parseTar(gunzipSync(readFileSync(tarballPath)))
}

function expectedArchiveFiles(root) {
  const dist = walkFiles(path.join(root, "dist"))
    .filter((relative) => relative !== "examples" && !relative.startsWith("examples/"))
    .map((relative) => `package/dist/${relative}`)
  const topLevel = releaseFiles
    .filter((relative) => relative !== "dist" && !relative.startsWith("!"))
    .map((relative) => `package/${relative}`)
  return ["package/package.json", ...dist, ...topLevel]
}

function walkFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) return walkFiles(path.join(directory, entry.name), relative)
    assert.equal(entry.isFile(), true, `${relative} must be a regular build output`)
    return [relative]
  })
}

function requireEntry(entries, name) {
  const entry = entries.find((candidate) => candidate.name === name)
  assert.ok(entry, `${name} is absent from the release archive`)
  return entry
}

function parseTar(buffer) {
  const entries = []
  let offset = 0
  while (offset + tarBlockSize <= buffer.byteLength) {
    const header = buffer.subarray(offset, offset + tarBlockSize)
    if (header.every((byte) => byte === 0)) break

    const storedChecksum = readOctal(header, 148, 8)
    let calculatedChecksum = 0
    for (let index = 0; index < header.byteLength; index++) {
      calculatedChecksum += index >= 148 && index < 156 ? 0x20 : header[index]
    }
    assert.equal(calculatedChecksum, storedChecksum, `invalid tar checksum at byte ${offset}`)

    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const fullName = prefix === "" ? name : `${prefix}/${name}`
    const size = readOctal(header, 124, 12)
    const mode = readOctal(header, 100, 8)
    const typeFlag = readString(header, 156, 1)
    const contentStart = offset + tarBlockSize
    const contentEnd = contentStart + size
    assert.ok(contentEnd <= buffer.byteLength, `${fullName} extends beyond the tar archive`)

    entries.push({
      name: fullName,
      mode,
      type: typeFlag === "" || typeFlag === "0" ? "file" : typeFlag,
      content: buffer.subarray(contentStart, contentEnd)
    })
    offset = contentStart + Math.ceil(size / tarBlockSize) * tarBlockSize
  }
  assert.ok(entries.length > 0, "release archive is empty")
  return entries
}

function readString(buffer, offset, length) {
  const value = buffer.subarray(offset, offset + length)
  const end = value.indexOf(0)
  return value.subarray(0, end === -1 ? value.byteLength : end).toString("utf8")
}

function readOctal(buffer, offset, length) {
  const value = readString(buffer, offset, length).trim()
  assert.match(value, /^[0-7]+$/, `invalid tar octal field ${JSON.stringify(value)}`)
  return Number.parseInt(value, 8)
}
