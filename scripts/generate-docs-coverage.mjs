// Emits documentation-coverage evidence for GR-DOC-001 and GR-DOC-002.
//
// SEP-1730 asks Tier 1 SDKs for "comprehensive documentation with examples for
// all features" and "a published dependency update policy". Both are judgement
// calls, so this does not try to score prose. It checks the things that can be
// checked mechanically and would otherwise rot silently: that each required
// topic has a document, that each document is reachable from the docs entry
// point (which is what "published" means here, as opposed to a file that merely
// exists), and that the usage guide's code samples name real exported subpaths.
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createChecker } from "./lib/check.mjs"
import { writeTestEvidenceReport } from "./readiness-evidence.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const checker = createChecker({ root, name: "Documentation coverage generation" })

const TOPICS = [
  { id: "client-usage", file: "docs/usage.md", requires: ["McpClient.make", "listTools", "callTool"] },
  { id: "server-usage", file: "docs/usage.md", requires: ["McpServer.make", "registerTool", "registerResource"] },
  { id: "transports", file: "docs/usage.md", requires: ["StreamableHttpServerTransport", "StdioServerTransport"] },
  { id: "authorization", file: "docs/usage.md", requires: ["auth/protected-resource", "auth/client"] },
  { id: "errors", file: "docs/usage.md", requires: ["error channel", "McpErrors"] },
  { id: "limitations", file: "docs/usage.md", requires: ["Current limitations"] },
  { id: "examples", file: "examples/README.md", requires: ["everything-server.ts", "everything-client.ts"] },
  { id: "migration", file: "docs/draft-2026-07-28-migration.md", requires: ["2026-07-28"] },
  { id: "extensions", file: "docs/extensions.md", requires: ["extension"] },
  {
    id: "dependency-update-policy",
    file: "docs/conformance/dependency-update-policy.md",
    requires: ["@modelcontextprotocol/conformance", "pnpm"]
  }
]

const index = checker.requireText("docs/README.md")
const packageJson = checker.requireJson("package.json")
const exportedSubpaths = Object.keys(packageJson?.exports ?? {}).map((subpath) =>
  subpath === "." ? "mcp-effect-sdk" : `mcp-effect-sdk/${subpath.replace(/^\.\//, "")}`
)

const cases = []
for (const topic of TOPICS) {
  const source = checker.requireText(topic.file)
  const missing = topic.requires.filter((needle) => !source.replace(/\s+/g, " ").includes(needle))
  // "Published" is the operative word in the SEP: a document nothing links to is
  // not published documentation, it is a file in a repository.
  const linkedFromIndex = index.includes(path.basename(topic.file)) || index.includes(topic.file.replace("docs/", ""))
  const covered = source !== "" && missing.length === 0 && linkedFromIndex

  if (!covered) {
    checker.fail(
      missing.length > 0
        ? `${topic.id}: ${topic.file} does not cover ${missing.join(", ")}`
        : `${topic.id}: ${topic.file} is not reachable from docs/README.md`
    )
  }
  cases.push({
    id: topic.id,
    case: topic.id,
    description: `${topic.file} covers ${topic.requires.join(", ")} and is linked from the docs index`,
    command: "node scripts/generate-docs-coverage.mjs",
    exitCode: covered ? 0 : 1,
    status: covered ? "pass" : "fail"
  })
}

// A usage guide that imports a subpath the package does not export teaches
// something that cannot work.
const usage = checker.requireText("docs/usage.md")
for (const match of usage.matchAll(/from "(mcp-effect-sdk[^"]*)"/g)) {
  if (!exportedSubpaths.includes(match[1])) {
    checker.fail(`docs/usage.md imports ${match[1]}, which package.json does not export`)
  }
}

// The self-declared sentinel the readiness checker reads. Documentation cannot
// be evidenced as sufficient while the tier evidence says it is not.
const tierEvidence = checker.requireText("docs/conformance/sdk-tier-evidence.md")
if (tierEvidence.includes("Documentation is basic and still being completed.")) {
  checker.fail("docs/conformance/sdk-tier-evidence.md still declares documentation basic")
}

const failed = cases.filter((entry) => entry.status === "fail").length
const evidencePath = writeTestEvidenceReport({
  name: "documentation-coverage",
  evidenceKind: "documentation-coverage",
  command: "node scripts/generate-docs-coverage.mjs",
  exitCode: failed === 0 && checker.failures.length === 0 ? 0 : 1,
  requirementIds: ["GR-DOC-001", "GR-DOC-002"],
  suite: "documentation-coverage",
  summary: {
    source: "sources/vendor/sep-1730/1730-sdks-tiering-system.md",
    topics: cases.length,
    covered: cases.length - failed,
    uncovered: failed
  },
  cases
})

console.log(`Documentation topics covered: ${cases.length - failed}/${cases.length}`)
console.log(`Writing readiness evidence to ${evidencePath}`)
checker.report("Documentation coverage generation completed.")
