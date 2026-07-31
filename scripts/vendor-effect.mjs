#!/usr/bin/env node
/**
 * vendor-effect.mjs
 *
 * Clones Effect upstream repositories into `repos/`, each pinned to the exact
 * tag matching the version this repo has installed.
 *
 *   repos/effect            Effect-TS/effect           pinned to installed `effect`
 *   repos/language-service  Effect-TS/language-service pinned to installed
 *                           `@effect/language-service`
 *
 * Why this exists: npm ships `effect`'s `src/` but not its `test/` trees, and
 * the tests are where the idiomatic usage patterns live. Coding agents learn
 * from real call sites, not from prose docs, so we keep a read-only copy of
 * upstream on disk for them to read. The language-service clone serves the same
 * role for diagnostics: each rule's implementation explains what the rule
 * actually means, which its short diagnostic message does not.
 *
 * Why it derives pins instead of hardcoding them: upstream `main` for
 * Effect-TS/effect is 4.x, a different major than the 3.x this repo builds
 * against. Vendoring the wrong major is worse than vendoring nothing — the
 * agent reads APIs that confidently do not compile here. Reading tags from
 * `node_modules` means the vendored trees track `package.json` automatically.
 *
 * Usage: node scripts/vendor-effect.mjs [--check] [--only <name>]
 *
 *   --check        Verify vendored trees match installed versions; exit non-zero
 *                  on drift. No network access.
 *   --only <name>  Operate on one repo only: `effect` or `language-service`.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Each repo declares how to derive its tag from an installed package, and which
 * packages inside the clone must mirror node_modules.
 *
 * `tag` is a function of the version so the two repos' differing tag
 * conventions (`effect@3.22.0` vs `@effect/language-service@0.87.1`) stay
 * declarative rather than special-cased below.
 */
const REPOS = [
  {
    name: "effect",
    remote: "https://github.com/Effect-TS/effect.git",
    dest: join(ROOT, "repos", "effect"),
    pinFrom: "effect",
    tag: (v) => `effect@${v}`,
    tracked: [
      ["effect", "packages/effect"],
      ["@effect/platform", "packages/platform"],
      ["@effect/platform-node", "packages/platform-node"],
      ["@effect/rpc", "packages/rpc"]
    ]
  },
  {
    name: "language-service",
    remote: "https://github.com/Effect-TS/language-service.git",
    dest: join(ROOT, "repos", "language-service"),
    pinFrom: "@effect/language-service",
    tag: (v) => `@effect/language-service@${v}`,
    tracked: [["@effect/language-service", "packages/language-service"]]
  }
]

const argv = process.argv.slice(2)
const checkOnly = argv.includes("--check")
const onlyIdx = argv.indexOf("--only")
const only = onlyIdx !== -1 ? argv[onlyIdx + 1] : null

function run(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim()
}

function installedVersion(pkg) {
  const p = join(ROOT, "node_modules", pkg, "package.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")).version : null
}

function vendoredVersion(dest, pkgDir) {
  const p = join(dest, pkgDir, "package.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")).version : null
}

/**
 * Report raw measurements; the caller decides pass/fail. Never returns a
 * self-graded verdict — see .claude/rules/no-self-graded-verification.md.
 */
function measure(repo) {
  return repo.tracked.map(([pkg, dir]) => ({
    pkg,
    installed: installedVersion(pkg),
    vendored: vendoredVersion(repo.dest, dir)
  }))
}

function reportTable(rows) {
  for (const r of rows) {
    const mark = r.installed === r.vendored ? "ok   " : "DRIFT"
    console.log(`  ${mark} ${r.pkg.padEnd(26)} installed=${String(r.installed).padEnd(12)} vendored=${r.vendored}`)
  }
  return rows.filter((r) => r.installed !== r.vendored)
}

function selectRepos() {
  if (!only) return REPOS
  const found = REPOS.filter((r) => r.name === only)
  if (found.length === 0) {
    console.error(`Unknown --only "${only}". Use: ${REPOS.map((r) => r.name).join(" | ")}`)
    process.exit(1)
  }
  return found
}

function checkRepo(repo) {
  console.log(`${repo.name}:`)
  if (!existsSync(repo.dest)) {
    console.log(`  MISSING  ${repo.dest}`)
    return ["missing"]
  }
  return reportTable(measure(repo))
}

function vendorRepo(repo) {
  const version = installedVersion(repo.pinFrom)
  if (!version) {
    console.error(`${repo.pinFrom} is not installed. Run \`pnpm install\` first.`)
    process.exit(1)
  }
  const tag = repo.tag(version)

  // Clone beside the existing tree and swap only on success. Deleting first
  // meant a refresh that lost the network also lost the usable pinned clone,
  // leaving no reference source until a full clone succeeded again.
  const staging = `${repo.dest}.incoming`
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })

  // Shallow + single-branch keeps effect at ~50 MB on disk instead of the
  // ~129 MB packed full history. `--branch` accepts a tag name. `git clone`
  // creates missing parent directories, so `repos/` need not exist yet.
  console.log(`Cloning ${repo.remote} at ${tag}...`)
  try {
    run(["clone", "--depth", "1", "--single-branch", "--branch", tag, repo.remote, staging])
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (existsSync(repo.dest)) {
      console.error(`Clone failed; the existing ${repo.name} clone was left in place.`)
    }
    throw error
  }

  if (existsSync(repo.dest)) rmSync(repo.dest, { recursive: true, force: true })
  renameSync(staging, repo.dest)

  console.log(`\n${repo.name}: vendored ${tag}`)
  return reportTable(measure(repo))
}

function main() {
  const repos = selectRepos()
  let drifted = 0

  for (const repo of repos) {
    const bad = checkOnly ? checkRepo(repo) : vendorRepo(repo)
    drifted += bad.length
    console.log("")
  }

  if (drifted > 0) {
    console.error(
      checkOnly
        ? `${drifted} mismatch(es). Run \`pnpm run effect:vendor\` to re-pin.`
        : `${drifted} package(s) do not match node_modules. Each repo tags all its\n` +
            `packages from one commit, so a mismatch means the installed set spans\n` +
            `releases. Read those packages from node_modules instead.`
    )
    process.exit(1)
  }
  console.log("Vendored trees match installed versions.")
}

main()
