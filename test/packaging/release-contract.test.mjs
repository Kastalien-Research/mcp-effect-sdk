import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { releaseFiles } from "../../scripts/lib/release-artifact.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")
const packageJson = JSON.parse(read("package.json"))
const targets = JSON.parse(read(".github/release-targets.json"))
const releaseWorkflow = read(".github/workflows/release.yml")
const publishedAuditWorkflow = read(".github/workflows/published-release-audit.yml")
const verifyWorkflow = read(".github/workflows/verify.yml")

test("npm publication uses an exact package allowlist and the inspected tarball", () => {
  assert.deepEqual(packageJson.files, releaseFiles)
  assert.deepEqual(packageJson.publishConfig, { access: "public", provenance: true })
  assert.deepEqual(targets.npm, {
    status: "active",
    packageName: packageJson.name,
    registry: "https://registry.npmjs.org",
    provenance: true
  })
  assert.match(releaseWorkflow, /node scripts\/check-release-artifact\.mjs "\$release_tarball"/)
  assert.equal(packageJson.scripts.prepublishOnly, "node scripts/release-via-tag.mjs")
  assert.match(releaseWorkflow, /MCP_RELEASE_CHANNEL: github-actions-tag/)
  assert.match(releaseWorkflow, /npm publish "\$release_tarball" --provenance --access public/)
  assert.ok(
    releaseWorkflow.indexOf("node scripts/check-release-artifact.mjs") <
      releaseWorkflow.indexOf('npm publish "$release_tarball"')
  )
})

test("direct npm publication fails closed outside the qualified tag workflow", () => {
  const direct = runReleaseGuard({
    npm_lifecycle_event: "prepublishOnly",
    npm_package_version: packageJson.version
  })
  assert.equal(direct.status, 1)
  assert.match(`${direct.stdout}\n${direct.stderr}`, /Direct publication is disabled;/)
})

test("publication guard accepts only a matching GitHub Actions tag identity", () => {
  const authorized = {
    npm_lifecycle_event: "prepublishOnly",
    npm_package_version: packageJson.version,
    MCP_RELEASE_CHANNEL: "github-actions-tag",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: `v${packageJson.version}`,
    GITHUB_REF: `refs/tags/v${packageJson.version}`,
    GITHUB_REPOSITORY: "Kastalien-Research/mcp-effect-sdk",
    GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
    GITHUB_RUN_ID: "123456789",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/example"
  }
  const accepted = runReleaseGuard(authorized)
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`)

  const mismatched = runReleaseGuard({ ...authorized, GITHUB_REF_NAME: "v1.0.1" })
  assert.equal(mismatched.status, 1)

  const explicitEnvironment = { ...authorized }
  delete explicitEnvironment.npm_lifecycle_event
  delete explicitEnvironment.npm_package_version
  const explicit = runReleaseGuard(explicitEnvironment, ["--workflow-version", packageJson.version])
  assert.equal(explicit.status, 0, `${explicit.stdout}\n${explicit.stderr}`)
})

test("pull requests and both supported Node lines run the deterministic release-artifact gate", () => {
  assert.match(verifyWorkflow, /pull_request:/)
  assert.match(verifyWorkflow, /node-version: 22/)
  assert.match(verifyWorkflow, /node-version: 24/)
  assert.equal((verifyWorkflow.match(/pnpm run check:release-artifact/g) ?? []).length, 2)
})

test("stable GitHub tags qualify one commit before npm and GitHub Release mutation", () => {
  assert.deepEqual(targets.githubRelease, {
    status: "active",
    tagPrefix: "v",
    attachesTarball: true
  })
  assert.match(releaseWorkflow, /push:\s+tags:\s+- "v\*"/)
  assert.match(releaseWorkflow, /node scripts\/verify-release-tag\.mjs "\$\{GITHUB_REF_NAME\}"/)
  assert.match(releaseWorkflow, /^ {2}contents: write$/m)
  assert.match(releaseWorkflow, /^ {2}id-token: write$/m)
  assert.match(releaseWorkflow, /gh release create "\$\{GITHUB_REF_NAME\}" "\$release_tarball"/)
  assert.match(releaseWorkflow, /--verify-tag/)
  assert.ok(
    releaseWorkflow.indexOf("node scripts/verify-release-tag.mjs") <
      releaseWorkflow.indexOf('npm publish "$release_tarball"')
  )
  assert.equal(
    (releaseWorkflow.match(/node scripts\/release-via-tag\.mjs --workflow-version "\$version"/g) ?? []).length,
    2
  )
  assert.match(
    releaseWorkflow,
    /node scripts\/release-via-tag\.mjs --workflow-version "\$version"\s+npm publish "\$github_packages_tarball"/
  )
  assert.match(
    releaseWorkflow,
    /node scripts\/release-via-tag\.mjs --workflow-version "\$version"\s+npm publish "\$release_tarball"/
  )
})

test("GitHub Packages target is scoped, linked, requalified, and published by the tag workflow", () => {
  const githubPackages = targets.githubPackages
  assert.match(githubPackages.packageName, /^@[a-z0-9-]+\/[a-z0-9-]+$/)
  assert.equal(githubPackages.registry, "https://npm.pkg.github.com")
  assert.equal(githubPackages.repository, "Kastalien-Research/mcp-effect-sdk")
  assert.equal(githubPackages.authentication, "GITHUB_TOKEN")
  assert.equal(githubPackages.requiredPermission, "packages: write")
  assert.equal(githubPackages.artifactStrategy, "scoped-repack-requiring-requalification")

  assert.equal(githubPackages.status, "active")
  assertGithubPackagesWorkflow(githubPackages, releaseWorkflow)
})

test("published conformance fixtures are complete and preserve pnpm runtime provenance", () => {
  for (const workflow of [releaseWorkflow, publishedAuditWorkflow]) {
    assert.match(workflow, /"@effect\/experimental@0\.61\.0"/)
    assert.match(workflow, /cp dist\/examples\/internal\/DevTools\.js "\$published_root\/internal\/DevTools\.js"/)
    assert.match(workflow, /pnpm run verify:conformance -- --published/)
  }
})

test("published release recovery is manual, immutable, and re-runs registry and Tier evidence", () => {
  assert.match(publishedAuditWorkflow, /workflow_dispatch:/)
  assert.match(publishedAuditWorkflow, /ref: \$\{\{ inputs\.tag \}\}/)
  assert.match(publishedAuditWorkflow, /node scripts\/verify-release-tag\.mjs "\$MCP_RELEASE_TAG"/)
  assert.match(publishedAuditWorkflow, /cmp "\$release_tarball" "\$registry_tarball"/)
  assert.match(publishedAuditWorkflow, /npm audit signatures --prefix "\$published_root"/)
  assert.match(publishedAuditWorkflow, /pnpm run verify:published-package "\$MCP_RELEASE_VERSION"/)
  assert.match(publishedAuditWorkflow, /run: pnpm run verify/)
  assert.match(publishedAuditWorkflow, /pnpm run verify:conformance -- --published/)
  assert.match(publishedAuditWorkflow, /conformance tier-check/)
  assert.match(publishedAuditWorkflow, /pnpm run check:sdk-readiness/)
})

function assertGithubPackagesWorkflow(target, workflow) {
  assert.equal(target.status, "active")
  assert.match(workflow, /packages: write/)
  assert.match(workflow, new RegExp(target.registry.replaceAll(".", "\\.")))
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.match(workflow, new RegExp(target.packageName.replace("/", "\\/")))
  assert.match(workflow, /node scripts\/build-github-packages-artifact\.mjs "\$release_tarball" \.local\/release/)
  assert.match(
    workflow,
    /node scripts\/check-release-artifact\.mjs "\$github_packages_tarball" --target github-packages/
  )
  assert.match(workflow, /MCP_PUBLISHED_PACKAGE_NAME: "@kastalien-research\/mcp-effect-sdk"/)
  assert.match(
    workflow,
    new RegExp(`npm publish "\\$github_packages_tarball" --registry "${target.registry.replaceAll(".", "\\.")}"`)
  )
}

function runReleaseGuard(environment, args = []) {
  return spawnSync(process.execPath, ["scripts/release-via-tag.mjs", ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8"
  })
}
