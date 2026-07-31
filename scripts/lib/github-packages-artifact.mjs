import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { inspectReleaseArtifact, readReleaseArtifactEntries } from "./release-artifact.mjs"

export function buildGitHubPackagesArtifact(root, sourceTarball, destination, target) {
  assert.equal(target.status, "active")
  assert.match(target.packageName, /^@[a-z0-9-]+\/[a-z0-9-]+$/)
  assert.equal(target.registry, "https://npm.pkg.github.com")
  assert.equal(target.artifactStrategy, "scoped-repack-requiring-requalification")

  const temporary = mkdtempSync(path.join(tmpdir(), "mcp-effect-sdk-github-package-"))
  const packageRoot = path.join(temporary, "package")
  try {
    for (const entry of readReleaseArtifactEntries(sourceTarball)) {
      assert.equal(entry.type, "file", `${entry.name} must be a regular file`)
      assert.equal(entry.name.startsWith("package/"), true, `${entry.name} must remain under package/`)
      const relative = entry.name.slice("package/".length)
      assert.equal(relative.split("/").includes(".."), false, `${entry.name} must not traverse directories`)
      const destinationPath = path.join(packageRoot, relative)
      mkdirSync(path.dirname(destinationPath), { recursive: true })
      writeFileSync(destinationPath, entry.content, { mode: 0o644 })
    }

    const manifestPath = path.join(packageRoot, "package.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    manifest.name = target.packageName
    manifest.publishConfig = {
      access: "public",
      registry: target.registry
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    mkdirSync(destination, { recursive: true })
    execFileSync("npm", ["pack", packageRoot, "--pack-destination", destination], {
      cwd: root,
      stdio: "inherit"
    })
    const filename = `${target.packageName.slice(1).replace("/", "-")}-${manifest.version}.tgz`
    const tarball = path.join(destination, filename)
    const report = inspectReleaseArtifact(root, tarball, {
      name: target.packageName,
      publishConfig: manifest.publishConfig
    })
    return { tarball, report }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
