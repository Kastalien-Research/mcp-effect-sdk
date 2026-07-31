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
  // Import-context only: a bare string like `["@effect/rpc", "packages/rpc"]`
  // (vendor-effect.mjs's clone metadata) names the package without importing it.
  [/(?:from\s+|import\s*\(?\s*|require\(\s*)["']@effect\/rpc(?:["'/]|$)/, "@effect/rpc"],
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
    return [
      `pnpm lockfile must resolve exactly one Effect runtime at 3.22.0; found ${[...versions].join(", ") || "none"}`
    ]
  }
  return []
}

export function workflowPolicyErrors(workflow) {
  const errors = []
  const tierNode22 = workflowJob(workflow, "tier-node22")
  const packageHealthNode24 = workflowJob(workflow, "package-health-node24")
  if (
    tierNode22 === undefined ||
    !/node-version:\s*["']?22["']?/.test(tierNode22) ||
    !/run:\s*pnpm run verify(?:\s|$)/.test(tierNode22) ||
    /--package-health/.test(tierNode22)
  ) {
    errors.push("verify workflow must have a canonical Node 22 Tier/full-conformance lane")
  }
  if (
    packageHealthNode24 === undefined ||
    !/node-version:\s*["']?24["']?/.test(packageHealthNode24) ||
    !/run:\s*node scripts\/verify\.mjs --package-health(?:\s|$)/.test(packageHealthNode24)
  ) {
    errors.push("verify workflow must have an explicit Node 24 package-health lane")
  }
  for (const [name, job] of [
    ["Node 22 Tier", tierNode22],
    ["Node 24 package-health", packageHealthNode24]
  ]) {
    if (job !== undefined && !/pnpm install[^\n]*--frozen-lockfile[^\n]*--strict-peer-dependencies/.test(job)) {
      errors.push(`${name} workflow install must use --frozen-lockfile --strict-peer-dependencies`)
    }
  }
  return errors
}

function workflowJob(workflow, name) {
  const match = workflow.match(
    new RegExp(`^  ${name}:\\s*\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\s*$|(?![\\s\\S]))`, "m")
  )
  return match?.[1]
}

export function collectSourceFiles(root) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean)
  return tracked
    .filter((file) => sourceExtensions.has(path.extname(file)))
    .filter((file) => !sourcePolicyExemptions.has(file))
    .flatMap((file) => {
      try {
        return [{ file, source: readFileSync(path.join(root, file), "utf8") }]
      } catch (error) {
        // `git ls-files` reports the index, which can still list a path an agent
        // deleted from the working tree without staging the deletion. That is not
        // a policy violation, so skip it; any other read failure (permissions,
        // a genuinely broken tracked file) still surfaces.
        if (error.code === "ENOENT") return []
        throw error
      }
    })
}
