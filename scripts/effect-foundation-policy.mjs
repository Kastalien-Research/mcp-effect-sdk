import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"])
const sourcePolicyExemptions = new Set([
  "scripts/effect-foundation-policy.mjs",
  "test/foundation/effect-foundation.test.mjs",
  "test/types/negative/removed-effect-ai-api.ts"
])

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
  if (Object.hasOwn(dev, "@effect/schema")) {
    errors.push("@effect/schema must not be a development dependency")
  }
  if (dev["@effect/rpc"] !== "0.76.0") {
    errors.push("@effect/rpc dev-only peer provider must be pinned exactly to 0.76.0")
  }
  if (packageJson.pnpm?.overrides?.["@effect/rpc"] !== "0.76.0") {
    errors.push("@effect/rpc pnpm override must pin the platform-node peer provider to 0.76.0")
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
  const strictInstall = /pnpm install[^\n]*--frozen-lockfile[^\n]*--strict-peer-dependencies/.test(workflow)
  const errors = []
  if (!hasMatrix || !setupUsesMatrix) errors.push("verify workflow must run its package gate on Node 22 and Node 24")
  if (!strictInstall) errors.push("verify workflow install must use --frozen-lockfile --strict-peer-dependencies")
  return errors
}

export function collectSourceFiles(root) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
  return tracked
    .filter((file) => sourceExtensions.has(path.extname(file)))
    .filter((file) => !sourcePolicyExemptions.has(file))
    .map((file) => ({ file, source: readFileSync(path.join(root, file), "utf8") }))
}
