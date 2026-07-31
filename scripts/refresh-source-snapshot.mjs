import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import { runScript } from "./lib/process.mjs"

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runRefreshSourceSnapshot = Effect.gen(function* () {
  const options = parseArgs(process.argv.slice(2))
  const root = options.root ? path.resolve(options.root) : DEFAULT_ROOT
  const manifestPath = path.join(root, "sources/manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

  if (options.help) {
    console.log(
      [
        "Usage: pnpm run sources:refresh -- --source <id> --revision <full-sha>",
        "  [--path-migration <old-upstream-path>=<new-upstream-path>]... [--apply]"
      ].join("\n")
    )
    return
  }

  if (!options.source || !options.revision) fail("Both --source and --revision are required.")
  if (!/^[0-9a-f]{40}$/.test(options.revision)) {
    fail("--revision must be a full lowercase 40-character Git SHA.")
  }

  const source = manifest.sources.find((candidate) => candidate.id === options.source)
  if (!source) {
    fail(`Unknown source ${options.source}. Choose one of: ${manifest.sources.map(({ id }) => id).join(", ")}`)
  }
  if (source.revision === options.revision) {
    fail(`${source.id} is already pinned to ${source.revision}.`)
  }
  const pathMigrations = parsePathMigrations(options.pathMigrations, source.files, source.id)

  const stageRoot = path.join(root, ".local", "source-refresh", `${source.id}-${options.revision}`)
  const stagedFiles = []
  for (const file of source.files) {
    const oldUpstreamPath = file.upstreamPath
    const newUpstreamPath = pathMigrations.get(oldUpstreamPath) ?? oldUpstreamPath
    const bytes = yield* Effect.promise(() => retrieveSourceFile(options, source, newUpstreamPath))
    const stagePath = path.join(stageRoot, "files", newUpstreamPath)
    mkdirSync(path.dirname(stagePath), { recursive: true })
    writeFileSync(stagePath, bytes)
    const oldBytes = readFileSync(path.join(root, file.vendoredPath))
    stagedFiles.push({
      oldUpstreamPath,
      newUpstreamPath,
      vendoredPath: file.vendoredPath,
      oldSha256: sha256(oldBytes),
      newSha256: sha256(bytes),
      semanticDiff: semanticDiff(oldBytes.toString("utf8"), bytes.toString("utf8")),
      stagePath
    })
  }

  const report = {
    schemaVersion: 2,
    source: source.id,
    repository: source.repository,
    oldRevision: source.revision,
    newRevision: options.revision,
    files: stagedFiles.map(({ stagePath: _stagePath, ...file }) => file)
  }
  const reportPath = path.join(stageRoot, "refresh-report.json")
  mkdirSync(stageRoot, { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote deterministic refresh report: ${path.relative(root, reportPath)}`)

  if (!options.apply) {
    console.error(
      "Dry run only. Review the semantic diff, update reconciliation notes and fixtures, then repeat with --apply."
    )
    throw new Error("Dry run complete.")
  }

  const reconciliationPath = path.join(root, source.reconciliationFile)
  const reconciliation = existsSync(reconciliationPath) ? readFileSync(reconciliationPath, "utf8") : ""
  if (!reconciliation.includes(source.revision) || !reconciliation.includes(options.revision)) {
    fail(
      `${source.reconciliationFile} must name old revision ${source.revision} and new revision ${options.revision} before --apply.`
    )
  }
  for (const [oldUpstreamPath, newUpstreamPath] of pathMigrations) {
    if (!reconciliation.includes(oldUpstreamPath) || !reconciliation.includes(newUpstreamPath)) {
      fail(
        `${source.reconciliationFile} must name reviewed path migration ${oldUpstreamPath} -> ${newUpstreamPath} before --apply.`
      )
    }
  }

  if (!source.generationCommand) {
    enforceFixtureUpdates(source, root)
  }

  for (const file of stagedFiles) {
    const destination = path.join(root, file.vendoredPath)
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(file.stagePath, destination)
    const manifestFile = source.files.find((candidate) => candidate.upstreamPath === file.oldUpstreamPath)
    if (!manifestFile) {
      fail(`Manifest entry disappeared during refresh: ${file.oldUpstreamPath}`)
    }
    manifestFile.upstreamPath = file.newUpstreamPath
    manifestFile.sha256 = file.newSha256
  }
  source.revision = options.revision
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const historyPath = path.join(
    root,
    "sources",
    "refresh-history",
    source.id,
    `${report.oldRevision}..${report.newRevision}.json`
  )
  mkdirSync(path.dirname(historyPath), { recursive: true })
  writeFileSync(historyPath, `${JSON.stringify(report, null, 2)}\n`)

  if (source.generationCommand) {
    const generation = spawnSync(source.generationCommand, { cwd: root, shell: true, stdio: "inherit" })
    if (generation.status !== 0) {
      fail(`Generation failed: ${source.generationCommand}`)
    }
  }

  enforceFixtureUpdates(source, root)

  const check = spawnSync(process.execPath, [path.join(root, "scripts/check-source-snapshots.mjs")], {
    cwd: root,
    stdio: "inherit"
  })
  if (check.status !== 0) {
    fail("Refreshed source snapshot failed the network-free source check.")
  }

  console.log(
    `Applied only ${source.id}; review and commit ${path.relative(root, historyPath)} with its reconciliation changes.`
  )
})

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(runScript("refresh-source-snapshot", runRefreshSourceSnapshot))
}

function parseArgs(args) {
  const parsed = { apply: false, help: false, pathMigrations: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--") continue
    if (arg === "--apply") parsed.apply = true
    else if (arg === "--help" || arg === "-h") parsed.help = true
    else if (arg === "--path-migration") parsed.pathMigrations.push(args[++index])
    else if (["--source", "--revision", "--root", "--fetch-root"].includes(arg)) {
      parsed[toCamelCase(arg.slice(2))] = args[++index]
    } else {
      fail(`Unknown argument ${arg}`)
    }
  }
  return parsed
}

function parsePathMigrations(values, files, sourceId) {
  const migrations = new Map()
  const currentPaths = new Set(files.map(({ upstreamPath }) => upstreamPath))
  for (const value of values) {
    if (typeof value !== "string") {
      fail("--path-migration requires an old=new value.")
    }
    const separator = value.indexOf("=")
    const oldUpstreamPath = separator === -1 ? "" : value.slice(0, separator)
    const newUpstreamPath = separator === -1 ? "" : value.slice(separator + 1)
    if (!isSafeRelative(oldUpstreamPath) || !isSafeRelative(newUpstreamPath)) {
      fail(`Invalid --path-migration ${value}; both paths must be safe repository-relative paths.`)
    }
    if (!currentPaths.has(oldUpstreamPath)) {
      fail(`Path migration source is not recorded by ${sourceId}: ${oldUpstreamPath}`)
    }
    if (oldUpstreamPath === newUpstreamPath) {
      fail(`Path migration must change the upstream path: ${oldUpstreamPath}`)
    }
    if (migrations.has(oldUpstreamPath)) {
      fail(`Duplicate path migration source: ${oldUpstreamPath}`)
    }
    migrations.set(oldUpstreamPath, newUpstreamPath)
  }
  const resultingPaths = files.map(({ upstreamPath }) => migrations.get(upstreamPath) ?? upstreamPath)
  if (new Set(resultingPaths).size !== resultingPaths.length) {
    fail("Path migrations must not produce duplicate upstream paths.")
  }
  return migrations
}

function retrieveSourceFile(options, source, upstreamPath) {
  if (options.fetchRoot) {
    const fixturePath = path.join(options.fetchRoot, source.repository, options.revision, upstreamPath)
    if (!existsSync(fixturePath)) {
      fail(`Missing local refresh fixture ${fixturePath}`)
    }
    return Promise.resolve(readFileSync(fixturePath))
  }
  const url = `https://raw.githubusercontent.com/${source.repository}/${options.revision}/${upstreamPath}`
  return fetch(url, { redirect: "error" }).then(async (response) => {
    if (!response.ok) {
      fail(`Unable to fetch ${url}: HTTP ${response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
  })
}

function enforceFixtureUpdates(source, root) {
  const unchangedFixtures = source.fixturePaths.filter((fixturePath) => {
    const result = spawnSync("git", ["status", "--porcelain", "--", fixturePath], { cwd: root, encoding: "utf8" })
    return result.status !== 0 || result.stdout.trim() === ""
  })
  if (unchangedFixtures.length > 0) {
    fail(`Refresh applied but required fixtures are unchanged: ${unchangedFixtures.join(", ")}`)
  }
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
}

function semanticDiff(oldText, newText) {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return {
    changed: oldText !== newText,
    commonPrefixLines: prefix,
    commonSuffixLines: suffix,
    removedLines: oldLines.slice(prefix, oldLines.length - suffix),
    addedLines: newLines.slice(prefix, newLines.length - suffix)
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function isSafeRelative(value) {
  return (
    typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..")
  )
}

function fail(message) {
  console.error(message)
  throw new Error(message)
}
