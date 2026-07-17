import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const refreshScript = path.join(root, "scripts/refresh-source-snapshot.mjs")
const newRevision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

test("refresh apply fails before reconciliation names both revisions", () => {
  const fixture = setupFixture()
  try {
    const before = readManifest(fixture.workspace)
    const result = runRefresh(fixture)
    assert.notEqual(result.status, 0, result.output)
    assert.match(result.output, /must name old revision/)
    assert.deepEqual(readManifest(fixture.workspace), before)
  } finally {
    fixture.cleanup()
  }
})

test("refresh apply fails while a declared fixture remains unchanged", () => {
  const fixture = setupFixture({ reconciled: true })
  try {
    const result = runRefresh(fixture)
    assert.notEqual(result.status, 0, result.output)
    assert.match(result.output, /required fixtures are unchanged/)
  } finally {
    fixture.cleanup()
  }
})

test("refresh apply updates only one current pin and preserves its audited baseline", () => {
  const fixture = setupFixture({ reconciled: true, fixtureUpdated: true })
  try {
    const before = readManifest(fixture.workspace)
    const originalTasks = before.sources.find(({ id }) => id === "tasks")
    const untouchedBefore = before.sources.filter(({ id }) => id !== "tasks")

    const result = runRefresh(fixture)
    assert.equal(result.status, 0, result.output)

    const after = readManifest(fixture.workspace)
    const refreshedTasks = after.sources.find(({ id }) => id === "tasks")
    assert.equal(refreshedTasks.revision, newRevision)
    assert.equal(refreshedTasks.auditedBaseline.revision, originalTasks.revision)
    assert.deepEqual(after.sources.filter(({ id }) => id !== "tasks"), untouchedBefore)

    const refreshedSpec = readFileSync(path.join(fixture.workspace, "sources/vendor/tasks/tasks.md"))
    const manifestSpec = refreshedTasks.files.find(({ upstreamPath }) => upstreamPath.endsWith("tasks.md"))
    assert.equal(manifestSpec.sha256, sha256(refreshedSpec))
    assert.match(refreshedSpec.toString("utf8"), /synthetic refresh revision/i)

    const historyPath = path.join(
      fixture.workspace,
      "sources/refresh-history/tasks",
      `${originalTasks.revision}..${newRevision}.json`
    )
    assert.equal(existsSync(historyPath), true)
    const history = JSON.parse(readFileSync(historyPath, "utf8"))
    assert.equal(history.oldRevision, originalTasks.revision)
    assert.equal(history.newRevision, newRevision)
    assert.equal(history.files.find(({ upstreamPath }) => upstreamPath.endsWith("tasks.md")).semanticDiff.changed, true)

    const vendorStatus = git(fixture.workspace, ["status", "--porcelain", "--", "sources/vendor"]).stdout.trim().split("\n").filter(Boolean)
    assert.equal(vendorStatus.every((line) => line.includes("sources/vendor/tasks/")), true, vendorStatus.join("\n"))
    assert.match(result.output, /Source snapshot check passed/)
  } finally {
    fixture.cleanup()
  }
})

function setupFixture({ reconciled = false, fixtureUpdated = false } = {}) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "mcp-source-refresh-"))
  const workspace = path.join(temporary, "workspace")
  const upstream = path.join(temporary, "upstream")
  mkdirSync(workspace, { recursive: true })

  cpSync(path.join(root, "sources"), path.join(workspace, "sources"), { recursive: true })
  copyFile("package.json")
  copyFile("scripts/verify.mjs")
  copyFile("scripts/check-source-snapshots.mjs")
  copyFile("scripts/refresh-source-snapshot.mjs")
  copyFile("scripts/run-conformance-suite.mjs")
  copyFile("scripts/run-conformance-client-auth.mjs")
  copyFile("scripts/run-conformance-authorization.mjs")
  copyFile("test/conformance/package.json")
  copyFile("docs/conformance/extension-reconciliation.md")
  copyFile("docs/conformance/source-provenance.md")

  const fixturePath = "test/fixtures/tasks.snapshot"
  writeWorkspace(fixturePath, "baseline fixture\n")
  const manifest = readManifest(workspace)
  const tasks = manifest.sources.find(({ id }) => id === "tasks")
  tasks.fixturePaths = [tasks.reconciliationFile, fixturePath]
  writeWorkspace("sources/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`)

  git(workspace, ["init"])
  git(workspace, ["config", "user.email", "fixture@example.test"])
  git(workspace, ["config", "user.name", "Refresh Fixture"])
  git(workspace, ["add", "."])
  git(workspace, ["commit", "-m", "fixture baseline"])

  if (reconciled) {
    const reconciliationPath = tasks.reconciliationFile
    const current = readFileSync(path.join(workspace, reconciliationPath), "utf8")
    writeWorkspace(reconciliationPath, `${current}\nRefresh fixture: ${tasks.revision} -> ${newRevision}\n`)
  }
  if (fixtureUpdated) writeWorkspace(fixturePath, "updated fixture for synthetic refresh revision\n")

  for (const file of tasks.files) {
    const upstreamPath = path.join(upstream, tasks.repository, newRevision, file.upstreamPath)
    mkdirSync(path.dirname(upstreamPath), { recursive: true })
    const original = readFileSync(path.join(workspace, file.vendoredPath))
    const contents = file.upstreamPath.endsWith("tasks.md")
      ? Buffer.concat([original, Buffer.from("\nSynthetic refresh revision.\n")])
      : original
    writeFileSync(upstreamPath, contents)
  }

  return {
    workspace,
    upstream,
    cleanup: () => rmSync(temporary, { recursive: true, force: true })
  }

  function copyFile(relativePath) {
    const destination = path.join(workspace, relativePath)
    mkdirSync(path.dirname(destination), { recursive: true })
    cpSync(path.join(root, relativePath), destination)
  }

  function writeWorkspace(relativePath, contents) {
    const destination = path.join(workspace, relativePath)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, contents)
  }
}

function runRefresh(fixture) {
  const result = spawnSync(process.execPath, [
    refreshScript,
    "--root",
    fixture.workspace,
    "--fetch-root",
    fixture.upstream,
    "--source",
    "tasks",
    "--revision",
    newRevision,
    "--apply"
  ], {
    cwd: root,
    encoding: "utf8"
  })
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

function readManifest(workspace) {
  return JSON.parse(readFileSync(path.join(workspace, "sources/manifest.json"), "utf8"))
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`)
  return result
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
