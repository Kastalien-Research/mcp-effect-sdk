import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const workspace = path.resolve(root, "..")
const failures = []

const rel = (target) => path.relative(root, target).replaceAll(path.sep, "/")
const requireFile = (relativePath) => {
  const filePath = path.join(root, relativePath)
  if (!existsSync(filePath)) {
    failures.push(`Missing ${relativePath}`)
    return ""
  }
  return readFileSync(filePath, "utf8")
}

const packageJson = JSON.parse(requireFile("package.json") || "{}")
const scripts = packageJson.scripts ?? {}
for (const [name, expected] of [
  ["check:conformance-evidence", "node scripts/check-conformance-evidence.mjs"],
  ["check:historical-mcp", "node scripts/check-historical-mcp-cleanup.mjs"],
  ["conformance:server", "node scripts/run-conformance-server.mjs"],
  ["conformance:run", "node scripts/run-conformance-suite.mjs"]
]) {
  if (!String(scripts[name] ?? "").includes(expected)) {
    failures.push(`package.json script ${name} must include: ${expected}`)
  }
}
const verifySource = requireFile("scripts/verify.mjs")
for (const required of ["check:conformance-evidence", "check:historical-mcp"]) {
  if (!verifySource.includes(required)) {
    failures.push(`scripts/verify.mjs must include ${required}`)
  }
}
for (const forbidden of [/\bnpm\s/, /\bnpm\t/, /\bnpm\n/]) {
  for (const [name, value] of Object.entries(scripts)) {
    if (forbidden.test(String(value))) {
      failures.push(`package script ${name} must not run npm in this pnpm package`)
    }
  }
}

const tsconfig = JSON.parse(requireFile("tsconfig.json") || "{}")
const includes = Array.isArray(tsconfig.include) ? tsconfig.include.map(String) : []
if (!includes.some((entry) => entry === "src/**/*" || entry.startsWith("src/"))) {
  failures.push("tsconfig.json must include src/**/* so src/examples builds")
}

const exampleSource = requireFile("src/examples/everything-server.ts")
if (!exampleSource.includes("McpProtocol.generated")) {
  failures.push("everything-server.ts must use package generated protocol facts")
}
if (!existsSync(path.join(root, "dist/examples/everything-server.js"))) {
  failures.push("dist/examples/everything-server.js is missing; run pnpm run build")
}

const scenarioMap = requireFile("docs/conformance/scenario-map.md")
for (const scenario of listActiveServerScenarios()) {
  if (!scenarioMap.includes(`| ${scenario} |`)) {
    failures.push(`scenario-map.md must include active server scenario ${scenario}`)
  }
}
for (const required of ["SDK feature", "Status", "Evidence"]) {
  if (!scenarioMap.includes(required)) {
    failures.push(`scenario-map.md must include ${required} column`)
  }
}

const tierEvidence = requireFile("docs/conformance/sdk-tier-evidence.md")
for (const required of [
  "Reproducible command",
  "Source inputs",
  "Conformance coverage",
  "Tier blockers",
  "Current evidenced tier"
]) {
  if (!tierEvidence.includes(required)) {
    failures.push(`sdk-tier-evidence.md missing section: ${required}`)
  }
}
const expectedFailures = requireFile("docs/conformance/expected-failures.yml")
for (const scenario of [
  "tools-call-with-logging",
  "tools-call-with-progress",
  "tools-call-sampling",
  "tools-call-elicitation",
  "elicitation-sep1034-defaults",
  "elicitation-sep1330-enums",
  "prompts-get-embedded-resource",
  "dns-rebinding-protection"
]) {
  if (!expectedFailures.includes(`- ${scenario}`)) {
    failures.push(`expected-failures.yml missing current baseline scenario ${scenario}`)
  }
}

const dependencyPolicy = requireFile("docs/conformance/dependency-update-policy.md")
if (!dependencyPolicy.includes("pnpm") || !dependencyPolicy.includes("../conformance")) {
  failures.push("dependency update policy must document pnpm package and ../conformance boundary")
}
const versioningPolicy = requireFile("docs/conformance/versioning-policy.md")
if (!versioningPolicy.includes("stable release") || !versioningPolicy.includes("version")) {
  failures.push("versioning policy must document stable release/versioning status")
}

const readme = requireFile("README.md")
if (claimsUnevidencedTier(readme, tierEvidence)) {
  failures.push("README.md claims a tier or conformance level above the evidence report")
}

const workflow = requireFile(".github/workflows/verify.yml")
for (const required of ["pnpm run verify", "pnpm run conformance:run"]) {
  if (!workflow.includes(required)) {
    failures.push(`verify.yml must run ${required}`)
  }
}
for (const line of workflow.split("\n")) {
  const match = line.match(/uses:\s+[^@\s]+\/[^@\s]+@([^\s#]+)/)
  if (match && !/^[0-9a-f]{40}$/i.test(match[1])) {
    failures.push(`verify.yml must pin actions to full commit SHAs: ${line.trim()}`)
  }
}
for (const required of ["de0fac2e4500dabe0009e67214ff5f5447ce83dd", "53b83947a5a98c8d113130e565377fae1a50d02f"]) {
  if (!workflow.includes(required)) {
    failures.push(`verify.yml missing pinned action SHA ${required}`)
  }
}

const runner = requireFile("scripts/run-conformance-suite.mjs")
for (const required of [
  "../conformance",
  "npm --prefix ../conformance",
  "expected-failures.yml",
  "SIGTERM",
  "fetch(url"
]) {
  if (!runner.includes(required)) {
    failures.push(`run-conformance-suite.mjs missing lifecycle/boundary marker: ${required}`)
  }
}
if (runner.includes("pnpm --prefix ../conformance")) {
  failures.push("run-conformance-suite.mjs must not use pnpm in ../conformance")
}

if (failures.length > 0) {
  console.error("Conformance evidence check failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("Conformance evidence check passed.")

function claimsUnevidencedTier(readme, evidence) {
  const claimsTier = /Tier\s+[12]|full conformance|production ready/i.test(readme)
  const evidenceTier3 = /Current evidenced tier\s*\n+\s*Tier 3/i.test(evidence)
  return claimsTier && evidenceTier3
}

function listActiveServerScenarios() {
  const serverDir = path.join(workspace, "conformance/src/scenarios/server")
  const pending = new Set(["json-schema-2020-12"])
  const names = []
  for (const filePath of walk(serverDir)) {
    const text = readFileSync(filePath, "utf8")
    for (const match of text.matchAll(/name\s*=\s*['"]([^'"]+)['"]/g)) {
      if (!pending.has(match[1])) {
        names.push(match[1])
      }
    }
  }
  return [...new Set(names)].sort()
}

function walk(dir) {
  const out = []
  if (!existsSync(dir)) {
    failures.push(`Missing ${rel(dir)}`)
    return out
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(filePath))
    } else if (filePath.endsWith(".ts")) {
      out.push(filePath)
    }
  }
  return out
}
