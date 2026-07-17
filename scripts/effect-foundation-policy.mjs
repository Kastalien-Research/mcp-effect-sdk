import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"])

const forbiddenSourcePatterns = [
  [/@effect\/schema(?:["'/]|$)/, "@effect/schema"],
  [/@effect\/rpc(?:["'/]|$)/, "@effect/rpc"],
  [/effect\/unstable\//, "effect/unstable"],
  [/effect\/ServiceMap(?:["'/]|$)/, "effect/ServiceMap"],
  [/\bServiceMap\./, "ServiceMap"],
  [/\bFiber\.getCurrent\s*\(/, "fiber-internal service access"],
  [/\bfiber\.services\b/, "fiber-internal service access"],
  [/\bregisterToolkit\b|\bToolkit\.Toolkit\b|\bTool\.HandlersFor\b/, "Effect AI Tool/Toolkit coupling"]
]

export function dependencyPolicyErrors(packageJson) {
  const errors = []
  const dependencies = packageJson.dependencies ?? {}
  const peers = packageJson.peerDependencies ?? {}
  const peerMeta = packageJson.peerDependenciesMeta ?? {}
  const dev = packageJson.devDependencies ?? {}

  if (Object.hasOwn(dependencies, "effect")) errors.push("effect must not be a production dependency")
  for (const name of ["@effect/schema", "@effect/rpc"]) {
    if (Object.hasOwn(dependencies, name) || Object.hasOwn(peers, name)) {
      errors.push(`${name} must not be a production dependency or peer`)
    }
  }
  if (peers.effect !== "^3.22.0") errors.push("effect peer must be ^3.22.0")
  if (dev.effect !== "3.22.0") errors.push("effect development runtime must be pinned to 3.22.0")
  if (peers["@effect/platform"] !== "^0.97.0") {
    errors.push("@effect/platform peer must be ^0.97.0")
  }
  if (peerMeta["@effect/platform"]?.optional !== true) {
    errors.push("@effect/platform peer must be optional")
  }
  if (dev["@effect/platform-node"] !== "0.108.0") {
    errors.push("@effect/platform-node development dependency must be pinned to 0.108.0")
  }
  if (dev["@types/node"] !== "^22.0.0") {
    errors.push("@types/node must compile against the Node 22 floor")
  }
  if (packageJson.engines?.node !== "^22.0.0 || ^24.0.0") {
    errors.push("Node engines must be ^22.0.0 || ^24.0.0")
  }

  const requiredPeers = Object.entries(peers)
    .filter(([name]) => peerMeta[name]?.optional !== true)
    .map(([name]) => name)
  if (requiredPeers.length !== 1 || requiredPeers[0] !== "effect") {
    errors.push("effect must be the only required peer")
  }
  return errors
}

export function sourcePolicyErrors(files) {
  const errors = []
  for (const { file, source } of files) {
    for (const [pattern, label] of forbiddenSourcePatterns) {
      if (pattern.test(source)) errors.push(`${file}: forbidden ${label}`)
    }
  }
  return errors
}

export function lockfileRuntimeErrors(lockfile) {
  const versions = new Set()
  for (const match of lockfile.matchAll(/^\s{2}effect@([^:\s(]+)(?:\([^\n]*)?:/gm)) {
    versions.add(match[1])
  }
  if (versions.size !== 1 || !versions.has("3.22.0")) {
    return [`pnpm lockfile must resolve exactly one Effect runtime at 3.22.0; found ${[...versions].join(", ") || "none"}`]
  }
  return []
}

export function workflowPolicyErrors(workflow) {
  const hasMatrix = /matrix:\s*[\s\S]*?node(?:-version)?:\s*\[\s*["']?22["']?\s*,\s*["']?24["']?\s*\]/m.test(workflow)
  const setupUsesMatrix = /node-version:\s*\$\{\{\s*matrix\.node(?:-version)?\s*\}\}/.test(workflow)
  return hasMatrix && setupUsesMatrix ? [] : ["verify workflow must run its package gate on Node 22 and Node 24"]
}

export function collectSourceFiles(root) {
  const result = []
  for (const relativeRoot of ["src", "scripts"]) {
    const directory = path.join(root, relativeRoot)
    walk(directory, result, root)
  }
  return result
}

function walk(directory, result, root) {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry)
    if (statSync(absolute).isDirectory()) {
      walk(absolute, result, root)
    } else if (sourceExtensions.has(path.extname(entry))) {
      if (path.basename(absolute) === "effect-foundation-policy.mjs") continue
      result.push({
        file: path.relative(root, absolute).replaceAll(path.sep, "/"),
        source: readFileSync(absolute, "utf8")
      })
    }
  }
}
