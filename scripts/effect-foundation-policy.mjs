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
  [/(?:from\s+|import\s*\(?\s*|require\(\s*)["']@effect\/rpc(?:["'/]|$)/, "@effect/rpc"],
  [/effect\/ServiceMap(?:["'/]|$)/, "effect/ServiceMap"],
  [/\bServiceMap\./, "ServiceMap"],
  [/\bFiber\.getCurrent\s*\(/, "fiber-internal service access"],
  [/\bfiber\.services\b/, "fiber-internal service access"],
  [/(?:from\s+|import\s*\(?\s*|require\(\s*)["']@effect\/platform(?:["'/]|$)/, "@effect/platform"]
]

export function dependencyPolicyErrors(packageJson) {
  const errors = []
  const dependencies = packageJson.dependencies ?? {}
  const peers = packageJson.peerDependencies ?? {}
  const peerMeta = packageJson.peerDependenciesMeta ?? {}
  const dev = packageJson.devDependencies ?? {}

  if (Object.hasOwn(dependencies, "effect")) errors.push("effect must not be a production dependency")
  for (const name of ["@effect/schema", "@effect/rpc", "@effect/platform"]) {
    if (Object.hasOwn(dependencies, name) || Object.hasOwn(peers, name) || Object.hasOwn(dev, name)) {
      errors.push(`${name} is consolidated into effect and must not be a dependency or peer`)
    }
    if (Object.hasOwn(packageJson.pnpm?.overrides ?? {}, name)) {
      errors.push(`${name} must not retain an obsolete pnpm override`)
    }
  }
  if (peers.effect !== "4.0.0-rc.112") errors.push("effect peer must be pinned to 4.0.0-rc.112")
  if (dev.effect !== "4.0.0-rc.112") errors.push("effect development runtime must be pinned to 4.0.0-rc.112")
  if (dev["@effect/platform-node"] !== "4.0.0-rc.112") {
    errors.push("@effect/platform-node development dependency must be pinned to 4.0.0-rc.112")
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
  if (versions.size !== 1 || !versions.has("4.0.0-rc.112")) {
    return [
      `pnpm lockfile must resolve exactly one Effect runtime at 4.0.0-rc.112; found ${[...versions].join(", ") || "none"}`
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
