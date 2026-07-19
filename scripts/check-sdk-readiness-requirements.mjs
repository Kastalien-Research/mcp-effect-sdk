import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { types as utilTypes } from "node:util"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")

const TARGET_CLAIMS = [
  "repo-health done",
  "MCP Tier 1",
  "artifact-goal done",
  "release-ready"
]

const CLAIM_DEFINITIONS = {
  "repo-health done": {
    source: "docs/sdk-readiness-requirements.md",
    requiredRequirementIds: [
      "GR-API-001",
      "GR-EFFECT-001"
    ]
  },
  "MCP Tier 1": {
    source: "../modelcontextprotocol/seps/1730-sdks-tiering-system.md",
    requiredRequirementIds: [
      "GR-CONF-001",
      "GR-API-001",
      "GR-TIER-001",
      "GR-TIER-002",
      "GR-REL-001",
      "GR-DOC-001",
      "GR-DOC-002"
    ]
  },
  "artifact-goal done": {
    source: "docs/sdk-readiness-requirements.md",
    requiredRequirementIds: [
      "GR-CONF-001",
      "GR-API-001",
      "GR-TEST-002",
      "GR-TEST-003",
      "GR-TEST-004",
      "GR-REL-001",
      "GR-DOC-001",
      "GR-EFFECT-001",
      "GR-AGENT-001",
      "GR-AGENT-002",
      "GR-AGENT-003"
    ]
  },
  "release-ready": {
    source: "docs/sdk-readiness-requirements.md",
    requiredRequirementIds: [
      "GR-TEST-002",
      "GR-TEST-003",
      "GR-TEST-004",
      "GR-REL-001",
      "GR-DOC-001",
      "GR-EFFECT-001"
    ]
  }
}

const CATEGORIES = new Set([
  "software/protocol correctness",
  "agent-user effectiveness"
])

const STATUSES = new Set([
  "pass",
  "partial",
  "fail",
  "unknown",
  "not-applicable"
])

const DISPOSITIONS = new Set([
  "blocking",
  "deferred",
  "not-applicable"
])

const EVIDENCE_KINDS = new Set([
  "inventory",
  "static-interface",
  "command-result",
  "conformance-result",
  "unit-test-result",
  "integration-test-result",
  "e2e-result",
  "release-provenance",
  "agent-eval-result",
  "documentation-coverage"
])

const DRAFT_DISPOSITIONS = new Set([
  "active",
  "removed",
  "replaced-by-mrtr",
  "extension-gated"
])

const ID_PREFIXES = [
  "GR-CONF-",
  "GR-TSPAR-",
  "GR-API-",
  "GR-DOC-",
  "GR-TEST-",
  "GR-TIER-",
  "GR-REL-",
  "GR-USE-",
  "GR-EFFECT-",
  "GR-AGENT-"
]

const REQUIRED_VERIFY_COMMANDS = [
  "check:sdk-workflow",
  "check:generated",
  "check:invariants",
  "build",
  "check:sdk-runtime",
  "check:generated-protocol-surfaces",
  "check:schema-fixtures",
  "check:extensions",
  "check:conformance-evidence",
  "check:historical-mcp",
  "test:source-refresh",
  "test:tier-operations",
  "check:tier-operations",
  "test:unit",
  "test:integration",
  "test:e2e",
  "check:tier-protocol-features",
  "check:sdk-readiness"
]

const AGENT_EVIDENCE_ROOT = "docs/agent-evidence"
const DEFAULT_READINESS_EVIDENCE_ROOT = ".local/readiness-evidence"
const READINESS_EVIDENCE_ROOT =
  process.env.MCP_READINESS_EVIDENCE_DIR ?? DEFAULT_READINESS_EVIDENCE_ROOT

const registry = [
  {
    id: "GR-CONF-001",
    category: "software/protocol correctness",
    source: "docs/conformance/sdk-tier-evidence.md",
    requirement: "MCP Tier 1 requires draft-targeted MCP conformance evidence.",
    proofRequired: [
      "Passing @modelcontextprotocol/conformance@0.2.x run for MCP 2026-07-28,",
      "or an exact upstream/tool blocker artifact."
    ].join(" "),
    evidenceKind: "conformance-result",
    disposition: "blocking",
    ownerPaths: [
      readinessEvidenceFile("conformance.json"),
      "docs/conformance/sdk-tier-evidence.md"
    ],
    // Local e2e is package-health evidence only. MCP qualification requires the
    // draft-targeted official conformance lane.
    validationCommands: ["pnpm run conformance:run"],
    check: checkNoExpectedConformanceFailures
  },
  {
    id: "GR-CONF-002",
    category: "software/protocol correctness",
    source: "docs/conformance/sdk-tier-evidence.md",
    requirement: "Public docs must not overclaim Tier 1 or production readiness.",
    proofRequired: "README and evidence docs avoid blocked readiness claims.",
    evidenceKind: "inventory",
    disposition: "not-applicable",
    ownerPaths: [
      "README.md",
      "ROADMAP.md",
      "docs/conformance/sdk-tier-evidence.md",
      "docs/conformance/versioning-policy.md"
    ],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkNoPublicOverclaims
  },
  {
    id: "GR-API-001",
    category: "software/protocol correctness",
    source: "ROADMAP.md",
    requirement: "Public protocol surfaces are generated or generated-backed.",
    proofRequired: "Generated protocol/schema check commands run and pass.",
    evidenceKind: "command-result",
    disposition: "blocking",
    ownerPaths: [
      "src/generated/mcp/2026-07-28/McpProtocol.generated.ts",
      "src/generated/mcp/2026-07-28/McpSchema.generated.ts",
      "scripts/check-generated-protocol-surfaces.mjs"
    ],
    validationCommands: [
      "pnpm run check:generated",
      "pnpm run check:generated-protocol-surfaces"
    ],
    check: checkGeneratedProtocolEvidence
  },
  {
    id: "GR-TEST-001",
    category: "software/protocol correctness",
    source: "package.json",
    requirement: "Package verification includes all current package-local readiness gates.",
    proofRequired: "`verify` runs every package-local readiness check, including this compiler.",
    evidenceKind: "inventory",
    disposition: "not-applicable",
    ownerPaths: ["package.json", "scripts/verify.mjs"],
    validationCommands: ["pnpm run verify"],
    check: checkVerifyScriptCoverage
  },
  {
    id: "GR-TEST-002",
    category: "software/protocol correctness",
    source: "ROADMAP.md",
    requirement: "SDK readiness requires normal unit tests, not only checker scripts.",
    proofRequired: "Unit tests cover runtime kernels, public API behavior, and error paths.",
    evidenceKind: "unit-test-result",
    disposition: "blocking",
    ownerPaths: [
      readinessEvidenceFile("unit-tests.json"),
      "scripts/run-readiness-test-suite.mjs",
      "package.json"
    ],
    validationCommands: ["pnpm run test:unit"],
    check: checkUnitTestCoverage
  },
  {
    id: "GR-TEST-003",
    category: "software/protocol correctness",
    source: "ROADMAP.md",
    requirement: [
      "SDK readiness requires integration tests for client/server/transport/session",
      "behavior."
    ].join(" "),
    proofRequired: "Integration tests exercise real client/server flows across transports.",
    evidenceKind: "integration-test-result",
    disposition: "blocking",
    ownerPaths: [
      readinessEvidenceFile("integration-tests.json"),
      "scripts/run-readiness-test-suite.mjs",
      "package.json"
    ],
    validationCommands: ["pnpm run test:integration"],
    check: checkIntegrationTestCoverage
  },
  {
    id: "GR-TEST-004",
    category: "software/protocol correctness",
    source: "docs/conformance/sdk-tier-evidence.md",
    requirement: "SDK readiness requires end-to-end MCP interaction coverage.",
    proofRequired: "Conformance-backed or package-local E2E runs pass without expected failures.",
    evidenceKind: "e2e-result",
    disposition: "blocking",
    ownerPaths: [
      readinessEvidenceFile("e2e.json"),
      "scripts/run-readiness-test-suite.mjs",
      "scripts/run-conformance-suite.mjs",
      "src/examples/everything-server.ts"
    ],
    validationCommands: ["pnpm run test:e2e"],
    check: checkEndToEndCoverage
  },
  {
    id: "GR-TIER-001",
    category: "software/protocol correctness",
    source: "../modelcontextprotocol/seps/1730-sdks-tiering-system.md",
    requirement: [
      "MCP Tier 1 requires new protocol features before the new spec version",
      "release, allowing the release-candidate window."
    ].join(" "),
    proofRequired: [
      "Machine-readable Tier 1 protocol-feature freshness evidence maps current",
      "protocol support to GR-TIER-001."
    ].join(" "),
    evidenceKind: "static-interface",
    disposition: "blocking",
    ownerPaths: [
      readinessEvidenceFile("tier-protocol-features.json"),
      "src/generated/mcp",
      "scripts/check-tier-protocol-features.mjs"
    ],
    validationCommands: ["pnpm run check:tier-protocol-features"],
    check: checkProtocolFeatureFreshness
  },
  {
    id: "GR-TIER-002",
    category: "software/protocol correctness",
    source: "../modelcontextprotocol/seps/1730-sdks-tiering-system.md",
    requirement: [
      "MCP Tier 1 requires SDK maintenance commitments: issue triage within two",
      "business days and security or critical bug resolution within seven days."
    ].join(" "),
    proofRequired: [
      "Machine-readable maintenance evidence maps issue triage and critical bug",
      "resolution data to GR-TIER-002."
    ].join(" "),
    evidenceKind: "release-provenance",
    disposition: "blocking",
    ownerPaths: [
      "SECURITY.md",
      "MAINTENANCE.md",
      "docs/maintenance/sla-ledger.schema.json",
      "docs/maintenance/sla-ledger.json",
      readinessEvidenceFile("tier-maintenance.json")
    ],
    validationCommands: [
      "pnpm run check:tier-operations",
      "pnpm run check:sdk-readiness"
    ],
    check: checkTierMaintenanceEvidence
  },
  {
    id: "GR-REL-001",
    category: "software/protocol correctness",
    source: "docs/conformance/versioning-policy.md",
    requirement: "Release-ready requires stable release provenance beyond package metadata.",
    proofRequired: "Release tag, package artifact, release notes, and evidence update exist.",
    evidenceKind: "release-provenance",
    disposition: "blocking",
    ownerPaths: ["docs/conformance/versioning-policy.md", "package.json"],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkStableReleaseEvidence
  },
  {
    id: "GR-DOC-001",
    category: "software/protocol correctness",
    source: "ROADMAP.md",
    requirement: "User-facing docs must be sufficient before artifact readiness.",
    proofRequired: "Docs cover core client/server usage, examples, and current limitations.",
    evidenceKind: "documentation-coverage",
    disposition: "blocking",
    ownerPaths: ["README.md", "docs/conformance/sdk-tier-evidence.md"],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkUserDocsDepth
  },
  {
    id: "GR-DOC-002",
    category: "software/protocol correctness",
    source: "../modelcontextprotocol/seps/1730-sdks-tiering-system.md",
    requirement: "MCP Tier 1 requires a published dependency update policy.",
    proofRequired: "Dependency update policy exists and is published with package documentation.",
    evidenceKind: "documentation-coverage",
    disposition: "blocking",
    ownerPaths: [
      "docs/conformance/dependency-update-policy.md",
      "docs/conformance/sdk-tier-evidence.md"
    ],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkDependencyUpdatePolicy
  },
  {
    id: "GR-TSPAR-001",
    category: "software/protocol correctness",
    source: "../tsc-sdk-reference/docs/server.md",
    requirement: "TypeScript server docs reference source is inventoried from an exact path.",
    proofRequired: "Exact reference path is cited as non-runtime provenance.",
    evidenceKind: "inventory",
    disposition: "not-applicable",
    ownerPaths: ["README.md", "docs/sdk-readiness-requirements.md"],
    referencePaths: ["../tsc-sdk-reference/docs/server.md"],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkServerReferenceInventory
  },
  {
    id: "GR-TSPAR-002",
    category: "software/protocol correctness",
    source: "../tsc-sdk-reference/packages/server/package.json",
    requirement: "TypeScript server package reference source is inventoried from an exact path.",
    proofRequired: "Exact reference path is cited as non-runtime provenance.",
    evidenceKind: "inventory",
    disposition: "not-applicable",
    ownerPaths: ["package.json", "docs/sdk-readiness-requirements.md"],
    referencePaths: ["../tsc-sdk-reference/packages/server/package.json"],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkServerPackageReferenceInventory
  },
  {
    id: "GR-EFFECT-001",
    category: "software/protocol correctness",
    source: "docs/extensions.md",
    requirement: "Standalone readiness does not depend on upstream Effect acceptance.",
    proofRequired: "`pnpm run check:extensions` runs and passes.",
    evidenceKind: "command-result",
    disposition: "blocking",
    ownerPaths: ["docs/extensions.md", "docs/conformance/sdk-tier-evidence.md"],
    validationCommands: ["pnpm run check:extensions"],
    check: checkEffectBoundary
  },
  {
    id: "GR-AGENT-001",
    category: "agent-user effectiveness",
    source: "docs/sdk-readiness-requirements.md",
    requirement: "Tool/resource/prompt affordances are discoverable and salient for agents.",
    proofRequired: "Machine-readable salience audit artifact exists and passes.",
    evidenceKind: "agent-eval-result",
    disposition: "blocking",
    ownerPaths: [AGENT_EVIDENCE_ROOT],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkAgentSalienceEvidence,
    agentDetail: {
      taskEvaluated: "Agent discovers available MCP tools, resources, and prompts.",
      targetAgentModelOrClass: "General MCP-capable coding/research agent class.",
      expectedMcpAffordances: "tools/list, resources/list, prompts/list names and descriptions.",
      successCriteria: "Agent selects relevant affordances without prompt-side path hints.",
      failureModesTested: [
        "Noisy names, missing descriptions, ambiguous prompts, ignored resources."
      ].join(" "),
      evidenceArtifactRequired: "docs/agent-evidence/salience-audit.json"
    }
  },
  {
    id: "GR-AGENT-002",
    category: "agent-user effectiveness",
    source: "docs/sdk-readiness-requirements.md",
    requirement: "Representative tasks complete through MCP affordances.",
    proofRequired: "Machine-readable agent eval artifact exists and passes.",
    evidenceKind: "agent-eval-result",
    disposition: "blocking",
    ownerPaths: [AGENT_EVIDENCE_ROOT],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkAgentTaskCompletionEvidence,
    agentDetail: {
      taskEvaluated: "Agent completes representative SDK server/client tasks through MCP.",
      targetAgentModelOrClass: "MCP-capable implementation agent class.",
      expectedMcpAffordances: "Relevant tools, resource reads, prompt retrieval, result payloads.",
      successCriteria: "Task succeeds from model-visible affordances, not hidden API knowledge.",
      failureModesTested: [
        "Wrong affordance choice, malformed args, retries, incomplete result use."
      ].join(" "),
      evidenceArtifactRequired: "docs/agent-evidence/golden-transcripts.json"
    }
  },
  {
    id: "GR-AGENT-003",
    category: "agent-user effectiveness",
    source: "docs/sdk-readiness-requirements.md",
    requirement: [
      "Affordance observability covers offered, selected, ignored, retried, and",
      "failed paths."
    ].join(" "),
    proofRequired: "Machine-readable observability eval artifact exists and passes.",
    evidenceKind: "agent-eval-result",
    disposition: "blocking",
    ownerPaths: [AGENT_EVIDENCE_ROOT],
    validationCommands: ["pnpm run check:sdk-readiness"],
    check: checkAgentObservabilityEvidence,
    agentDetail: {
      taskEvaluated: "Observe agent interaction with offered MCP affordances.",
      targetAgentModelOrClass: "General MCP-capable agent class.",
      expectedMcpAffordances: "Offered, selected, ignored, retried, and failed affordance events.",
      successCriteria: "Evidence shows affordance use and failures at agent-visible boundaries.",
      failureModesTested: [
        "Ignored resources, failed tool call, retry after error, noisy option set."
      ].join(" "),
      evidenceArtifactRequired: "docs/agent-evidence/affordance-observability.json"
    }
  }
]

const selfTest = process.argv.includes("--self-test")
const strictPackageGate = process.argv.includes("--strict-package-gate")

if (selfTest) {
  runSelfTests()
} else {
  runRealCheck()
}

function runRealCheck() {
  const context = makeFileContext()
  const result = compileReadiness(registry, context)

  printRows(result.rows)
  printClaims(result.claims)

  if (strictPackageGate) {
    result.errors.push(...detectStrictPackageGateFailures(result.rows))
  }

  if (result.errors.length > 0) {
    console.error("\nSDK readiness requirements check failed:")
    for (const error of result.errors) {
      console.error(`- ${error}`)
    }
    process.exit(1)
  }

  console.log("\nSDK readiness requirements accounting is internally consistent.")
}

function compileReadiness(requirements, context) {
  const errors = validateRegistry(requirements)
  const rows = requirements.map((requirement) => computeRow(requirement, context))
  const claims = computeClaims(rows)
  errors.push(...detectOverclaims(context, claims))
  return { rows, claims, errors }
}

function computeRow(requirement, context) {
  const check = requirement.check(context, requirement)
  if (!STATUSES.has(check.status)) {
    throw new Error(`${requirement.id} computed invalid status: ${check.status}`)
  }
  if (check.status === "pass" && check.evidenceKind !== requirement.evidenceKind) {
    throw new Error(
      `${requirement.id} passed with ${check.evidenceKind ?? "no"} evidenceKind; ` +
        `expected ${requirement.evidenceKind}`
    )
  }
  return {
    id: requirement.id,
    category: requirement.category,
    evidenceKind: requirement.evidenceKind,
    source: requirement.source,
    requirement: requirement.requirement,
    proofRequired: requirement.proofRequired,
    currentEvidence: check.evidence,
    status: check.status,
    disposition: requirement.disposition,
    ownerPaths: requirement.ownerPaths,
    referencePaths: requirement.referencePaths ?? [],
    validationCommands: requirement.validationCommands
  }
}

function computeClaims(rows) {
  const claims = new Map()
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  for (const claim of TARGET_CLAIMS) {
    const definition = CLAIM_DEFINITIONS[claim]
    const blockers = definition.requiredRequirementIds
      .map((id) => {
        const row = rowsById.get(id)
        if (row === undefined) {
          return {
            id,
            status: "fail",
            evidence: `Claim definition ${claim} references missing requirement ${id}.`
          }
        }
        if (row.disposition !== "blocking" || row.status === "pass") {
          return undefined
        }
        return {
          id: row.id,
          status: row.status,
          evidence: row.currentEvidence
        }
      })
      .filter(Boolean)
    claims.set(claim, {
      verdict: blockers.length === 0 ? "pass" : "blocked",
      source: definition.source,
      requiredRequirementIds: definition.requiredRequirementIds,
      blockers
    })
  }
  return claims
}

function validateRegistry(requirements) {
  const errors = []
  const seenIds = new Set()

  for (const requirement of requirements) {
    validateRequirement(requirement, seenIds, errors)
  }
  validateClaimDefinitions(requirements, errors)

  return errors
}

function validateRequirement(requirement, seenIds, errors) {
  if (seenIds.has(requirement.id)) {
    errors.push(`Duplicate requirement ID: ${requirement.id}`)
  }
  seenIds.add(requirement.id)

  if (!ID_PREFIXES.some((prefix) => requirement.id.startsWith(prefix))) {
    errors.push(`${requirement.id} must use an allowed GR-* prefix`)
  }
  if (!CATEGORIES.has(requirement.category)) {
    errors.push(`${requirement.id} has invalid category: ${requirement.category}`)
  }
  if (!DISPOSITIONS.has(requirement.disposition)) {
    errors.push(`${requirement.id} has invalid disposition: ${requirement.disposition}`)
  }
  if ((requirement.claims ?? []).length > 0) {
    errors.push(`${requirement.id} must not define readiness claims; use CLAIM_DEFINITIONS`)
  }
  validateRequiredString(requirement, "source", errors)
  validateRequiredString(requirement, "requirement", errors)
  validateRequiredString(requirement, "proofRequired", errors)
  validateEvidenceKind(requirement, errors)
  validateRequiredArray(requirement, "ownerPaths", errors)
  validateRequiredArray(requirement, "validationCommands", errors)
  validateSiblingReferencePolicy(requirement, errors)
  validateAgentDetail(requirement, errors)
}

function validateEvidenceKind(requirement, errors) {
  if (!EVIDENCE_KINDS.has(requirement.evidenceKind)) {
    errors.push(`${requirement.id} has invalid evidenceKind: ${requirement.evidenceKind}`)
  }
  if (
    requirement.evidenceKind === "inventory" &&
    requirement.disposition === "blocking"
  ) {
    errors.push(`${requirement.id} inventory rows must not participate in readiness claims`)
  }
}

function validateClaimDefinitions(requirements, errors) {
  const requirementIds = new Set(requirements.map((requirement) => requirement.id))
  for (const claim of TARGET_CLAIMS) {
    const definition = CLAIM_DEFINITIONS[claim]
    if (definition === undefined) {
      errors.push(`Missing claim definition for ${claim}`)
      continue
    }
    if (!Array.isArray(definition.requiredRequirementIds)) {
      errors.push(`${claim} missing requiredRequirementIds`)
      continue
    }
    if (definition.requiredRequirementIds.length === 0) {
      errors.push(`${claim} must require at least one requirement ID`)
    }
    for (const id of definition.requiredRequirementIds) {
      if (!requirementIds.has(id)) {
        errors.push(`${claim} references missing requirement ${id}`)
      }
    }
  }
  for (const claim of Object.keys(CLAIM_DEFINITIONS)) {
    if (!TARGET_CLAIMS.includes(claim)) {
      errors.push(`Unknown claim definition: ${claim}`)
    }
  }
}

function validateRequiredString(requirement, field, errors) {
  if (typeof requirement[field] !== "string" || requirement[field].trim() === "") {
    errors.push(`${requirement.id} missing ${field}`)
  }
}

function validateRequiredArray(requirement, field, errors) {
  if (!Array.isArray(requirement[field]) || requirement[field].length === 0) {
    errors.push(`${requirement.id} missing ${field}`)
  }
}

function validateSiblingReferencePolicy(requirement, errors) {
  const paths = [
    requirement.source,
    ...(requirement.ownerPaths ?? []),
    ...(requirement.referencePaths ?? [])
  ]

  for (const candidate of paths) {
    if (String(candidate).includes("../tsc-sdk-reference") && !isExactReferencePath(candidate)) {
      errors.push(`${requirement.id} cites non-exact TypeScript SDK reference path: ${candidate}`)
    }
  }

  const proofPaths = requirement.proofPaths ?? []
  for (const proofPath of proofPaths) {
    if (String(proofPath).includes("../tsc-sdk-reference")) {
      errors.push(`${requirement.id} uses TypeScript SDK reference checkout as proof: ${proofPath}`)
    }
  }
}

function isExactReferencePath(candidate) {
  const text = String(candidate)
  return text.startsWith("../tsc-sdk-reference/") && !text.endsWith("/") && !text.includes("**")
}

function validateAgentDetail(requirement, errors) {
  if (!requirement.id.startsWith("GR-AGENT-")) return
  const detail = requirement.agentDetail
  if (detail === undefined) {
    errors.push(`${requirement.id} missing agentDetail`)
    return
  }
  for (const field of [
    "taskEvaluated",
    "targetAgentModelOrClass",
    "expectedMcpAffordances",
    "successCriteria",
    "failureModesTested",
    "evidenceArtifactRequired"
  ]) {
    if (typeof detail[field] !== "string" || detail[field].trim() === "") {
      errors.push(`${requirement.id} missing agentDetail.${field}`)
    }
  }
}

function checkNoExpectedConformanceFailures(context, requirement) {
  if (context.exists("docs/conformance/expected-failures.yml")) {
    return fail("docs/conformance/expected-failures.yml still exists.")
  }

  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("conformance.json"),
    "conformance-result",
    requirement.id
  )
  if (artifact.status === "missing") {
    return unknown([
      "Missing draft-targeted MCP conformance artifact:",
      `${artifact.file}. Run pnpm run conformance:run with`,
      "@modelcontextprotocol/conformance@0.2.x or record an exact upstream/tool blocker."
    ].join(" "))
  }
  if (artifact.status === "invalid") {
    return fail(`Invalid conformance artifact ${artifact.file}: ${artifact.reason}`)
  }
  if (artifact.artifact.command !== "pnpm run conformance:run") {
    return unknown([
      `${artifact.file} was produced by ${artifact.artifact.command}, not official MCP`,
      "conformance. Local self-hosted draft e2e is package-health evidence only."
    ].join(" "))
  }
  const conformancePackage = artifact.artifact.conformancePackage
  if (
    conformancePackage?.name !== "@modelcontextprotocol/conformance" ||
    typeof conformancePackage.version !== "string" ||
    !conformancePackage.version.startsWith("0.2.")
  ) {
    return unknown([
      `${artifact.file} does not identify draft-targeted`,
      "@modelcontextprotocol/conformance@0.2.x evidence."
    ].join(" "))
  }
  if (artifact.artifact.specVersion !== "2026-07-28") {
    return unknown(`${artifact.file} does not target MCP spec version 2026-07-28.`)
  }
  const target = [
    `${conformancePackage.name}@${conformancePackage.version}`,
    `spec ${artifact.artifact.specVersion}`
  ].join(", ")
  if (artifact.artifact.exitCode !== 0) {
    return fail([
      `${artifact.file} records failing draft-targeted MCP conformance`,
      `(${target}): exit ${artifact.artifact.exitCode},`,
      `${artifact.artifact.failureCount ?? "unknown"} failure(s),`,
      `artifactDir ${artifact.artifact.artifactDir ?? "unknown"}.`
    ].join(" "))
  }
  if (artifact.artifact.failureCount !== 0) {
    return fail([
      `${artifact.file} records draft-targeted MCP conformance failures`,
      `(${target}): ${artifact.artifact.failureCount} failure(s).`
    ].join(" "))
  }
  return artifactResult(artifact, "conformance-result")
}

function checkNoPublicOverclaims(context) {
  const matches = findPublicOverclaims(context)
  if (matches.length === 0) {
    return pass(
      "inventory",
      "Public docs do not claim blocked readiness targets as ready."
    )
  }
  return fail(`Public docs contain blocked readiness overclaim(s): ${matches.join("; ")}`)
}

function checkGeneratedProtocolEvidence() {
  return runPackageCommands([
    "check:generated",
    "check:generated-protocol-surfaces"
  ])
}

function runPackageCommands(scriptNames) {
  const summaries = []
  for (const scriptName of scriptNames) {
    const result = spawnSync("pnpm", ["run", scriptName], {
      cwd: root,
      encoding: "utf8"
    })
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    summaries.push(`${scriptName} exit ${result.status ?? "unknown"}`)
    if (result.status !== 0) {
      return fail(
        `Command pnpm run ${scriptName} failed with exit ${result.status ?? "unknown"}: ` +
          truncate(output)
      )
    }
  }
  return pass("command-result", `Executed command(s): ${summaries.join("; ")}.`)
}

function checkVerifyScriptCoverage(context) {
  const packageJson = parseJson(context.read("package.json"), "package.json")
  const scripts = packageJson.scripts ?? {}
  const verifySource = context.read("scripts/verify.mjs")
  const missing = []

  if (scripts["check:sdk-readiness"] !== "node scripts/check-sdk-readiness-requirements.mjs") {
    missing.push("package.json script check:sdk-readiness")
  }
  for (const command of REQUIRED_VERIFY_COMMANDS) {
    if (!verifySource.includes(command)) {
      missing.push(`verify command ${command}`)
    }
  }

  if (missing.length > 0) {
    return fail(`Verification coverage missing: ${missing.join(", ")}`)
  }
  return pass(
    "inventory",
    "verify includes all package-local readiness gates including this compiler."
  )
}

function checkUnitTestCoverage(context, requirement) {
  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("unit-tests.json"),
    "unit-test-result",
    requirement.id,
    "pnpm run test:unit"
  )
  return artifactResult(artifact, "unit-test-result")
}

function checkIntegrationTestCoverage(context, requirement) {
  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("integration-tests.json"),
    "integration-test-result",
    requirement.id,
    "pnpm run test:integration"
  )
  return artifactResult(artifact, "integration-test-result")
}

function checkEndToEndCoverage(context, requirement) {
  if (context.exists("docs/conformance/expected-failures.yml")) {
    return fail("docs/conformance/expected-failures.yml blocks E2E readiness.")
  }
  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("e2e.json"),
    "e2e-result",
    requirement.id,
    "pnpm run test:e2e"
  )
  return artifactResult(artifact, "e2e-result")
}

function checkProtocolFeatureFreshness(context, requirement) {
  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("tier-protocol-features.json"),
    "static-interface",
    requirement.id
  )
  return artifactResult(artifact, "static-interface")
}

function checkTierMaintenanceEvidence(context, requirement) {
  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("tier-maintenance.json"),
    "release-provenance",
    requirement.id
  )
  return artifactResult(artifact, "release-provenance")
}

function checkStableReleaseEvidence(context, requirement) {
  const policy = context.read("docs/conformance/versioning-policy.md")
  const tier = context.read("docs/conformance/sdk-tier-evidence.md")
  const packageJson = parseJson(context.read("package.json"), "package.json")
  if (/Current status:\s*no stable release is evidenced/i.test(policy)) {
    return fail("Versioning policy states no stable release is evidenced.")
  }
  if (/No published stable package release evidence/i.test(tier)) {
    return fail("Tier evidence states no published stable package release evidence.")
  }
  if (String(packageJson.description ?? "").trim() === "") {
    return fail("Package description is empty.")
  }
  if (String(packageJson.license ?? "") === "ISC") {
    return fail("Package license remains scaffold default ISC.")
  }
  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("release-provenance.json"),
    "release-provenance",
    requirement.id
  )
  return artifactResult(artifact, "release-provenance")
}

function checkUserDocsDepth(context, requirement) {
  const readme = context.read("README.md")
  const tier = context.read("docs/conformance/sdk-tier-evidence.md")
  const hasBasicDocs = readme.includes("Current Package Shape") && readme.includes("Commands")
  const declaresBasic = tier.includes("Documentation is basic and still being completed.")

  if (!hasBasicDocs) {
    return fail("README lacks basic package shape and command documentation.")
  }
  if (declaresBasic) {
    return partial("Docs exist but tier evidence says documentation is still basic.")
  }
  const artifact = readEvidenceArtifact(
    context,
    readinessEvidenceFile("documentation-coverage.json"),
    "documentation-coverage",
    requirement.id
  )
  return artifactResult(artifact, "documentation-coverage")
}

function checkDependencyUpdatePolicy(context) {
  const policy = context.read("docs/conformance/dependency-update-policy.md")
  if (!policy.includes("@modelcontextprotocol/conformance") || !policy.includes("pnpm")) {
    return fail("Dependency update policy is missing conformance dependency update details.")
  }
  return partial(
    "Dependency update policy exists locally; no published Tier 1 docs evidence exists."
  )
}

function checkServerReferenceInventory(context) {
  const requirements = context.read("docs/sdk-readiness-requirements.md")
  if (!context.exists("../tsc-sdk-reference/docs/server.md")) {
    return unknown("TypeScript SDK server docs reference path is unavailable.")
  }
  if (!requirements.includes("../tsc-sdk-reference/docs/server.md")) {
    return fail("Server reference inventory does not cite the exact TypeScript SDK doc path.")
  }
  return pass("inventory", "Exact TypeScript server docs reference path is inventoried.")
}

function checkServerPackageReferenceInventory(context) {
  const requirements = context.read("docs/sdk-readiness-requirements.md")
  if (!context.exists("../tsc-sdk-reference/packages/server/package.json")) {
    return unknown("TypeScript SDK server package reference path is unavailable.")
  }
  if (!requirements.includes("../tsc-sdk-reference/packages/server/package.json")) {
    return fail("Server package reference inventory does not cite the exact TypeScript SDK path.")
  }
  return pass("inventory", "Exact TypeScript server package reference path is inventoried.")
}

function checkEffectBoundary() {
  return runPackageCommands(["check:extensions"])
}

function checkAgentSalienceEvidence(context, requirement) {
  return checkMachineEvalArtifact(
    context,
    "docs/agent-evidence/salience-audit.json",
    "No agent salience audit artifact exists.",
    requirement
  )
}

function checkAgentTaskCompletionEvidence(context, requirement) {
  return checkMachineEvalArtifact(
    context,
    "docs/agent-evidence/golden-transcripts.json",
    "No golden transcript or agent-in-the-loop eval artifact exists.",
    requirement
  )
}

function checkAgentObservabilityEvidence(context, requirement) {
  return checkMachineEvalArtifact(
    context,
    "docs/agent-evidence/affordance-observability.json",
    "No affordance observability artifact exists.",
    requirement
  )
}

function checkMachineEvalArtifact(context, file, missingMessage, requirement) {
  const artifact = readEvidenceArtifact(context, file, "agent-eval-result", requirement.id)
  if (artifact.status === "missing") {
    return unknown(missingMessage)
  }
  return artifactResult(artifact, "agent-eval-result")
}

function readEvidenceArtifact(context, file, expectedKind, requirementId, expectedCommand) {
  if (!context.exists(file)) {
    return { status: "missing", file }
  }

  let artifact
  try {
    artifact = JSON.parse(context.read(file))
  } catch (error) {
    return { status: "invalid", file, reason: `invalid JSON: ${error.message}` }
  }

  const missing = []
  if (artifact.evidenceKind !== expectedKind) {
    missing.push(`evidenceKind ${expectedKind}`)
  }
  if (typeof artifact.timestamp !== "string" || artifact.timestamp.trim() === "") {
    missing.push("timestamp")
  }
  if (typeof artifact.command !== "string" || artifact.command.trim() === "") {
    missing.push("command")
  }
  if (expectedCommand !== undefined && artifact.command !== expectedCommand) {
    missing.push(`command ${expectedCommand}`)
  }
  if (typeof artifact.exitCode !== "number") {
    missing.push("numeric exitCode")
  }
  if (!Array.isArray(artifact.requirementIds) || !artifact.requirementIds.includes(requirementId)) {
    missing.push(`requirementIds including ${requirementId}`)
  }
  if (requiresResultScope(expectedKind) && !hasResultScope(artifact)) {
    missing.push("suite, case, scenario, cases, or scenarios")
  }
  if (artifact.summary === undefined) {
    missing.push("summary")
  }
  if (expectedKind === "conformance-result") {
    missing.push(...validateConformanceArtifact(context, artifact))
  }
  if (expectedKind === "static-interface") {
    missing.push(...validateProtocolFeatureArtifact(artifact))
  }
  if (missing.length > 0) {
    return { status: "invalid", file, reason: `missing or mismatched ${missing.join(", ")}` }
  }
  return { status: "ok", file, artifact }
}

function validateConformanceArtifact(context, artifact) {
  const missing = []
  if (typeof artifact.summary !== "object" || artifact.summary === null) {
    missing.push("object summary")
  }
  for (const field of ["scenarioCount", "checkCount", "failureCount", "warningCount"]) {
    if (typeof artifact[field] !== "number") {
      missing.push(`numeric ${field}`)
    }
    if (
      typeof artifact.summary === "object" &&
      artifact.summary !== null &&
      typeof artifact[field] === "number" &&
      artifact.summary[field] !== artifact[field]
    ) {
      missing.push(`summary.${field} matching ${field}`)
    }
  }
  if (typeof artifact.scenarioCount === "number" && artifact.scenarioCount <= 0) {
    missing.push("positive scenarioCount")
  }
  if (typeof artifact.checkCount === "number" && artifact.checkCount <= 0) {
    missing.push("positive checkCount")
  }
  if (!Array.isArray(artifact.failedChecks)) {
    missing.push("failedChecks array")
  }
  if (
    typeof artifact.failureCount === "number" &&
    Array.isArray(artifact.failedChecks) &&
    artifact.failureCount !== artifact.failedChecks.length
  ) {
    missing.push("failureCount matching failedChecks length")
  }
  if (typeof artifact.artifactDir !== "string" || artifact.artifactDir.trim() === "") {
    missing.push("artifactDir")
  } else if (!context.exists(artifact.artifactDir)) {
    missing.push(`existing artifactDir ${artifact.artifactDir}`)
  }
  return missing
}

function validateProtocolFeatureArtifact(artifact) {
  const missing = []
  if (typeof artifact.summary !== "object" || artifact.summary === null) {
    missing.push("object summary")
  } else {
    if (artifact.summary.status !== "pass") {
      missing.push("passing summary.status")
    }
    if (typeof artifact.summary.featureCount !== "number" || artifact.summary.featureCount <= 0) {
      missing.push("positive summary.featureCount")
    }
    if (artifact.summary.failed !== 0) {
      missing.push("summary.failed equal to 0")
    }
  }
  if (typeof artifact.protocol !== "object" || artifact.protocol === null) {
    missing.push("protocol metadata")
  } else {
    for (const field of ["version", "generatedProtocolVersion", "generatedSchemaVersion"]) {
      if (!nonEmptyString(artifact.protocol[field])) {
        missing.push(`protocol.${field}`)
      }
    }
  }
  if (!Array.isArray(artifact.features) || artifact.features.length === 0) {
    missing.push("features array")
    return missing
  }
  const seen = new Set()
  for (const feature of artifact.features) {
    if (!nonEmptyString(feature.id)) {
      missing.push("feature.id")
    } else if (seen.has(feature.id)) {
      missing.push(`unique feature id ${feature.id}`)
    }
    seen.add(feature.id)
    if (!Array.isArray(feature.identifiers)) {
      missing.push(`feature identifiers for ${feature.id ?? "unknown"}`)
    } else if (feature.identifiers.length === 0 && !hasValidEmptyFeatureDisposition(feature)) {
      missing.push(`feature identifiers or draft disposition for ${feature.id ?? "unknown"}`)
    }
    if (feature.status !== "pass") {
      missing.push(`passing feature ${feature.id ?? "unknown"}`)
    }
  }
  missing.push(...validateDraftFeatureCompleteness(artifact))
  return missing
}

function hasValidEmptyFeatureDisposition(feature) {
  if (!DRAFT_DISPOSITIONS.has(feature.draftDisposition)) {
    return false
  }
  if (feature.draftDisposition === "active") {
    return false
  }
  if (!Array.isArray(feature.trackingIssues) || feature.trackingIssues.length === 0) {
    return feature.draftDisposition === "removed"
  }
  return feature.trackingIssues.every(nonEmptyString)
}

function validateDraftFeatureCompleteness(artifact) {
  const missing = []
  const completenessValue = ownDataProperty(artifact, "draftFeatureCompleteness")
  const completeness = snapshotOwnDataRecord(completenessValue, [
    "status",
    "trackingIssues",
    "remoteIssueDisposition",
    "qualification",
    "issueMap"
  ])
  if (completeness === undefined) {
    missing.push("draftFeatureCompleteness metadata")
    return missing
  }
  const requiredIssues = ["#13", "#14", "#15", "#17", "#19", "#20"]
  const requiredStatuses = {
    "#13": "implemented-locally",
    "#14": "implemented-locally",
    "#15": "deferred-wp7",
    "#17": "implemented-locally",
    "#19": "implemented-locally",
    "#20": "deferred-wp6"
  }
  if (completeness.status !== "local-core-implemented-with-deferred-profiles") {
    missing.push("draftFeatureCompleteness local/deferred status")
  }
  if (completeness.remoteIssueDisposition !== "approval-required") {
    missing.push("draftFeatureCompleteness remote issue approval boundary")
  }
  if (completeness.qualification !== "not-official-conformance-release-or-tier-evidence") {
    missing.push("draftFeatureCompleteness qualification boundary")
  }
  const trackingIssues = snapshotDenseArray(completeness.trackingIssues, requiredIssues.length)
  if (trackingIssues === undefined || trackingIssues.some((issue) => !nonEmptyString(issue))) {
    missing.push("draftFeatureCompleteness.trackingIssues")
  } else {
    for (const issue of requiredIssues) {
      if (!trackingIssues.includes(issue)) {
        missing.push(`draft feature issue ${issue}`)
      }
    }
    if (trackingIssues.length !== requiredIssues.length) {
      missing.push("draftFeatureCompleteness exact tracking issue length")
    }
  }
  const issueMap = snapshotDenseArray(completeness.issueMap, requiredIssues.length)
  if (issueMap === undefined || issueMap.length === 0) {
    missing.push("draftFeatureCompleteness.issueMap")
  } else {
    const issueCounts = new Map()
    for (const entry of issueMap) {
      const snapshot = snapshotIssueMapEntry(entry)
      if (snapshot === undefined) {
        missing.push("draftFeatureCompleteness issue map entry")
        continue
      }
      const validIssue = nonEmptyString(snapshot.issue)
      const validArea = nonEmptyString(snapshot.area)
      const validStatus = nonEmptyString(snapshot.implementationStatus)
      if (!validIssue || !validArea) {
        missing.push("draftFeatureCompleteness issue/area")
      }
      if (!validStatus) {
        missing.push("draftFeatureCompleteness implementation status")
      }
      if (validIssue) {
        issueCounts.set(snapshot.issue, (issueCounts.get(snapshot.issue) ?? 0) + 1)
        if (!Object.hasOwn(requiredStatuses, snapshot.issue)) {
          missing.push(`draftFeatureCompleteness unknown issue ${snapshot.issue}`)
        } else if (!validStatus || requiredStatuses[snapshot.issue] !== snapshot.implementationStatus) {
          missing.push(`draftFeatureCompleteness implementation status ${snapshot.issue}`)
        }
      }
    }
    if (issueMap.length !== requiredIssues.length) {
      missing.push("draftFeatureCompleteness exact issue map length")
    }
    for (const issue of requiredIssues) {
      if (issueCounts.get(issue) !== 1) {
        missing.push(`draftFeatureCompleteness exact issue ${issue}`)
      }
    }
  }
  return missing
}

function snapshotIssueMapEntry(entry) {
  return snapshotOwnDataRecord(entry, ["issue", "area", "implementationStatus"])
}

function ownDataProperty(container, key) {
  if (typeof container !== "object" || container === null || utilTypes.isProxy(container)) {
    return undefined
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(container, key)
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function snapshotOwnDataRecord(value, requiredKeys) {
  if (typeof value !== "object" || value === null || utilTypes.isProxy(value) || Array.isArray(value)) {
    return undefined
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length !== requiredKeys.length ||
      keys.some((key) => typeof key !== "string" || !requiredKeys.includes(key))) {
      return undefined
    }
    const snapshot = {}
    for (const key of requiredKeys) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor)) return undefined
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch {
    return undefined
  }
}

function snapshotDenseArray(value, expectedLength) {
  if (typeof value !== "object" || value === null || utilTypes.isProxy(value) || !Array.isArray(value)) {
    return undefined
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const lengthDescriptor = descriptors.length
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== expectedLength) {
      return undefined
    }
    const length = lengthDescriptor.value
    const expectedKeys = new Set(["length", ...Array.from({ length }, (_, index) => String(index))])
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length !== expectedKeys.size ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
      return undefined
    }
    const snapshot = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[index]
      if (descriptor === undefined || !("value" in descriptor)) return undefined
      snapshot.push(descriptor.value)
    }
    return snapshot
  } catch {
    return undefined
  }
}

function requiresResultScope(evidenceKind) {
  return new Set([
    "conformance-result",
    "unit-test-result",
    "integration-test-result",
    "e2e-result",
    "agent-eval-result"
  ]).has(evidenceKind)
}

function hasResultScope(artifact) {
  return (
    nonEmptyString(artifact.suite) ||
    nonEmptyString(artifact.case) ||
    nonEmptyString(artifact.scenario) ||
    nonEmptyArray(artifact.cases) ||
    nonEmptyArray(artifact.scenarios)
  )
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== ""
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0
}

function artifactResult(artifact, evidenceKind) {
  if (artifact.status === "missing") {
    return unknown(`Missing machine-readable ${evidenceKind} artifact: ${artifact.file}`)
  }
  if (artifact.status === "invalid") {
    return fail(`Invalid ${evidenceKind} artifact ${artifact.file}: ${artifact.reason}`)
  }
  if (artifact.artifact.exitCode !== 0) {
    return fail(`${artifact.file} records failing command exit ${artifact.artifact.exitCode}.`)
  }
  if (evidenceKind === "conformance-result" && artifact.artifact.failureCount !== 0) {
    return fail(
      `${artifact.file} records ${artifact.artifact.failureCount} conformance failure(s).`
    )
  }
  if (evidenceKind === "static-interface") {
    return pass(evidenceKind, protocolFeatureEvidenceSummary(artifact))
  }
  return pass(evidenceKind, `${artifact.file} records passing ${artifact.artifact.command}.`)
}

function protocolFeatureEvidenceSummary(artifact) {
  const features = artifact.artifact.features ?? []
  const accounted = features.filter((feature) =>
    feature.draftDisposition !== undefined && feature.identifiers.length === 0
  )
  const completeness = artifact.artifact.draftFeatureCompleteness ?? {}
  const issueMap = completeness.issueMap ?? []
  const localIssues = issueMap
    .filter(({ implementationStatus }) => implementationStatus === "implemented-locally")
    .map(({ issue }) => issue)
  const deferredIssues = issueMap
    .filter(({ implementationStatus }) => String(implementationStatus).startsWith("deferred-"))
    .map(({ issue }) => issue)
  const details = [
    accounted.length > 0
      ? `${accounted.length} removed/replaced/extension-gated draft group(s) accounted.`
      : undefined,
    localIssues.length > 0
      ? `Local implementation accounted for ${localIssues.join(", ")}; remote disposition remains approval-required.`
      : undefined,
    deferredIssues.length > 0
      ? `Deferred profiles: ${deferredIssues.join(", ")}.`
      : undefined
  ].filter(Boolean).join(" ")

  return `${artifact.file} records passing ${artifact.artifact.command}. ${details}`.trim()
}

function readinessEvidenceFile(file) {
  return normalizePath(path.join(READINESS_EVIDENCE_ROOT, file))
}

function detectOverclaims(context, claims) {
  const errors = []
  const matches = findPublicOverclaims(context)
  const blockedClaims = [...claims.entries()]
    .filter(([, result]) => result.verdict === "blocked")
    .map(([claim]) => claim)

  if (matches.length > 0 && blockedClaims.length > 0) {
    errors.push(`Public docs overclaim blocked readiness: ${matches.join("; ")}`)
  }
  return errors
}

function findPublicOverclaims(context) {
  const publicFiles = [
    "README.md",
    "ROADMAP.md",
    "docs/conformance/sdk-tier-evidence.md",
    "docs/conformance/versioning-policy.md"
  ]
  const patterns = [
    /\bCurrent evidenced tier\s*\n+\s*Tier 1\b/i,
    /\bMCP Tier 1\b.{0,80}\b(pass|passed|ready|done|complete|evidenced)\b/i,
    /\bartifact-goal done\b.{0,80}\b(pass|passed|ready|complete|evidenced)\b/i,
    /\brelease-ready\b.{0,80}\b(pass|passed|ready|complete|evidenced)\b/i,
    /\bproduction ready\b/i,
    /\bfull conformance\b.{0,80}\b(pass|passed|ready|complete|evidenced)\b/i
  ]
  const matches = []

  for (const file of publicFiles) {
    const content = context.read(file)
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        matches.push(`${file} matches ${pattern}`)
      }
    }
  }
  return matches
}

function makeFileContext(files) {
  if (files !== undefined) {
    const normalized = new Map()
    for (const [file, content] of Object.entries(files)) {
      normalized.set(normalizePath(file), content)
    }
    return {
      exists: (relativePath) => normalized.has(normalizePath(relativePath)),
      read: (relativePath) => normalized.get(normalizePath(relativePath)) ?? ""
    }
  }

  return {
    exists: (relativePath) => existsSync(path.resolve(root, relativePath)),
    read: (relativePath) => {
      const absolutePath = path.resolve(root, relativePath)
      return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : ""
    }
  }
}

function normalizePath(relativePath) {
  return relativePath.replaceAll("\\", "/")
}

function parseJson(source, label) {
  try {
    return JSON.parse(source || "{}")
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function truncate(value) {
  return value.length > 400 ? `${value.slice(0, 400)}...` : value
}

function pass(evidenceKind, evidence) {
  return { status: "pass", evidenceKind, evidence }
}

function partial(evidence) {
  return { status: "partial", evidence }
}

function fail(evidence) {
  return { status: "fail", evidence }
}

function unknown(evidence) {
  return { status: "unknown", evidence }
}

function printRows(rows) {
  console.log("Computed SDK readiness requirements:")
  for (const row of rows) {
    console.log(
      `- ${row.id}: ${row.status} (${row.disposition}, ${row.evidenceKind}) ` +
        row.currentEvidence
    )
  }
}

function printClaims(claims) {
  console.log("\nComputed readiness claims:")
  for (const [claim, result] of claims) {
    console.log(`- ${claim}: ${result.verdict}`)
    for (const blocker of result.blockers) {
      console.log(`  - blocked by ${blocker.id} (${blocker.status}): ${blocker.evidence}`)
    }
  }
}

function detectStrictPackageGateFailures(rows) {
  return rows
    .filter((row) =>
      row.disposition === "blocking" &&
      row.status !== "pass"
    )
    .map((row) =>
      `Strict package gate blocked by ${row.id} (${row.status}): ${row.currentEvidence}`
    )
}

function runSelfTests() {
  const tests = [
    testMalformedRegistry,
    testDuplicateIds,
    testInvalidEnums,
    testInvalidEvidenceKind,
    testRowsCannotDefineClaims,
    testInventoryRowsCannotGateClaims,
    testInvalidComputedStatus,
    testPassEvidenceKindMismatch,
    testMissingAgentDetail,
    testMissingBlockingProof,
    testSiblingCheckoutProofMisuse,
    testOverclaimDetection,
    testNormalTestsBlockReadiness,
    testMachineReportMustMapRequirement,
    testMissingConformanceReportIsUnknown,
    testMalformedConformanceReportFails,
    testWrongConformanceEvidenceKindFails,
    testNonConformanceCommandIsUnknown,
    testConformanceReportMustMapRequirement,
    testNonzeroConformanceExitFails,
    testConformanceFailuresFail,
    testValidConformanceReportPasses,
    testStaticInterfaceReportMustIncludeFeatures,
    testStaticInterfaceReportRequiresExactIssueMap,
    testValidStaticInterfaceReportPasses,
    testMarkdownPassIsNotAgentEvidence,
    testBlockingRowsBlockClaims
  ]

  for (const test of tests) {
    test()
  }

  console.log(`SDK readiness requirements self-test passed (${tests.length} cases).`)
}

function testMalformedRegistry() {
  const errors = validateRegistry([{
    id: "GR-CONF-999",
    category: "software/protocol correctness"
  }])
  assert(errors.some((error) => error.includes("missing source")), "malformed source")
  assert(errors.some((error) => error.includes("missing ownerPaths")), "malformed ownerPaths")
}

function testDuplicateIds() {
  const requirement = makeFixtureRequirement({ id: "GR-CONF-900" })
  const errors = validateRegistry([requirement, { ...requirement }])
  assert(errors.some((error) => error.includes("Duplicate requirement ID")), "duplicate ID")
}

function testInvalidEnums() {
  const errors = validateRegistry([
    makeFixtureRequirement({
      id: "GR-CONF-901",
      category: "bad",
      disposition: "ready"
    })
  ])
  assert(errors.some((error) => error.includes("invalid category")), "invalid category")
  assert(errors.some((error) => error.includes("invalid disposition")), "invalid disposition")
}

function testInvalidEvidenceKind() {
  const errors = validateRegistry([
    makeFixtureRequirement({
      id: "GR-CONF-908",
      evidenceKind: "citation-presence"
    })
  ])
  assert(errors.some((error) => error.includes("invalid evidenceKind")), "invalid evidenceKind")
}

function testRowsCannotDefineClaims() {
  const errors = validateRegistry([
    makeFixtureRequirement({
      id: "GR-CONF-911",
      claims: ["MCP Tier 1"]
    })
  ])
  assert(errors.some((error) => error.includes("must not define readiness claims")), "row claims")
}

function testInventoryRowsCannotGateClaims() {
  const errors = validateRegistry([
    makeFixtureRequirement({
      id: "GR-CONF-910",
      evidenceKind: "inventory",
      disposition: "blocking",
      check: () => pass("inventory", "inventory")
    })
  ])
  assert(errors.some((error) => error.includes("must not participate")), "inventory gating")
}

function testInvalidComputedStatus() {
  let failed = false
  try {
    compileReadiness([
      makeFixtureRequirement({
        id: "GR-CONF-906",
        check: () => ({ status: "ready", evidence: "bad status" })
      })
    ], makeFileContext({}))
  } catch (error) {
    failed = String(error.message).includes("invalid status")
  }
  assert(failed, "invalid computed status")
}

function testPassEvidenceKindMismatch() {
  let failed = false
  try {
    compileReadiness([
      makeFixtureRequirement({
        id: "GR-CONF-909",
        evidenceKind: "unit-test-result",
        check: () => pass("inventory", "wrong kind")
      })
    ], makeFileContext({}))
  } catch (error) {
    failed = String(error.message).includes("expected unit-test-result")
  }
  assert(failed, "pass evidenceKind mismatch")
}

function testMissingAgentDetail() {
  const errors = validateRegistry([
    makeFixtureRequirement({
      id: "GR-AGENT-901",
      category: "agent-user effectiveness"
    })
  ])
  assert(errors.some((error) => error.includes("missing agentDetail")), "agent detail")
}

function testMissingBlockingProof() {
  const result = compileReadiness([
    makeFixtureRequirement({
      id: "GR-CONF-902",
      claims: ["MCP Tier 1"],
      check: () => fail("proof missing")
    })
  ], makeFileContext({}))
  const claim = result.claims.get("MCP Tier 1")
  assert(claim.verdict === "blocked", "missing proof blocks claim")
}

function testSiblingCheckoutProofMisuse() {
  const errors = validateRegistry([
    makeFixtureRequirement({
      id: "GR-TSPAR-903",
      source: "../tsc-sdk-reference/docs/server.md",
      referencePaths: ["../tsc-sdk-reference/docs/server.md"],
      proofPaths: ["../tsc-sdk-reference/packages/server/package.json"]
    })
  ])
  assert(errors.some((error) => error.includes("as proof")), "sibling proof misuse")
}

function testOverclaimDetection() {
  const result = compileReadiness([
    makeFixtureRequirement({
      id: "GR-CONF-904",
      claims: ["MCP Tier 1"],
      check: () => fail("blocked")
    })
  ], makeFileContext({
    "README.md": "MCP Tier 1 ready",
    "ROADMAP.md": "",
    "docs/conformance/sdk-tier-evidence.md": "",
    "docs/conformance/versioning-policy.md": ""
  }))
  assert(result.errors.some((error) => error.includes("overclaim")), "overclaim detection")
}

function testNormalTestsBlockReadiness() {
  const result = compileReadiness([
    makeFixtureRequirement({
      id: "GR-TEST-907",
      claims: ["artifact-goal done"],
      check: checkUnitTestCoverage
    })
  ], makeFileContext({
    "package.json": JSON.stringify({ scripts: {} })
  }))
  const claim = result.claims.get("artifact-goal done")
  assert(claim.verdict === "blocked", "missing unit tests block readiness")
}

function testMachineReportMustMapRequirement() {
  const result = checkUnitTestCoverage(makeFileContext({
    [readinessEvidenceFile("unit-tests.json")]: JSON.stringify({
      evidenceKind: "unit-test-result",
      timestamp: "2026-05-03T00:00:00.000Z",
      command: "pnpm run test:unit",
      exitCode: 0,
      suite: "unit",
      requirementIds: ["GR-TEST-OTHER"],
      summary: { passed: 1 }
    })
  }), makeFixtureRequirement({ id: "GR-TEST-907" }))
  assert(result.status === "fail", "machine report requirement mapping")
}

function testMissingConformanceReportIsUnknown() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext({}),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "unknown", "missing conformance report is unknown")
}

function testMalformedConformanceReportFails() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext({
      [readinessEvidenceFile("conformance.json")]: "{",
      ".local/conformance/run": ""
    }),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "fail", "malformed conformance report fails")
}

function testWrongConformanceEvidenceKindFails() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext(makeConformanceFiles({ evidenceKind: "inventory" })),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "fail", "wrong conformance evidence kind fails")
}

function testNonConformanceCommandIsUnknown() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext(makeConformanceFiles({ command: "pnpm run verify" })),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "unknown", "non-conformance command is not proof")
}

function testConformanceReportMustMapRequirement() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext(makeConformanceFiles({ requirementIds: ["GR-CONF-OTHER"] })),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "fail", "conformance report requirement mapping")
}

function testNonzeroConformanceExitFails() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext(makeConformanceFiles({ exitCode: 1 })),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "fail", "nonzero conformance exit fails")
}

function testConformanceFailuresFail() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext(makeConformanceFiles({
      failureCount: 1,
      failedChecks: [{
        scenario: "tools-list",
        id: "tools-list",
        name: "ToolsList",
        message: "failed",
        specReferences: []
      }]
    })),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "fail", "conformance failure count fails")
}

function testValidConformanceReportPasses() {
  const result = checkNoExpectedConformanceFailures(
    makeFileContext(makeConformanceFiles()),
    makeFixtureRequirement({ id: "GR-CONF-001" })
  )
  assert(result.status === "pass", "valid conformance report passes")
}

function testStaticInterfaceReportMustIncludeFeatures() {
  const files = makeProtocolFeatureFiles({ features: [] })
  const result = checkProtocolFeatureFreshness(
    makeFileContext(files),
    makeFixtureRequirement({ id: "GR-TIER-001" })
  )
  assert(result.status === "fail", "static interface report feature validation")
}

function testStaticInterfaceReportRequiresExactIssueMap() {
  const cases = [
    ["truncated", (completeness) => completeness.issueMap.splice(1)],
    ["duplicate", (completeness) => completeness.issueMap.push(completeness.issueMap[0])],
    ["unknown", (completeness) => {
      completeness.issueMap[0] = { issue: "#999", area: "unknown issue" }
    }],
    ["null entry", (completeness) => {
      completeness.issueMap = [null]
    }],
    ["primitive entry", (completeness) => {
      completeness.issueMap = [17]
    }],
    ["array entry", (completeness) => {
      completeness.issueMap = [["#13", "core"]]
    }],
    ["missing issue", (completeness) => {
      completeness.issueMap[0] = {
        area: "missing issue",
        implementationStatus: "implemented-locally"
      }
    }],
    ["empty area", (completeness) => {
      completeness.issueMap[0].area = ""
    }],
    ["wrong status", (completeness) => {
      completeness.issueMap[0].implementationStatus = "deferred-wp7"
    }]
  ]
  const statuses = cases.map(([label, mutate]) => {
    const files = makeProtocolFeatureFiles()
    const evidencePath = readinessEvidenceFile("tier-protocol-features.json")
    const artifact = JSON.parse(files[evidencePath])
    mutate(artifact.draftFeatureCompleteness)
    files[evidencePath] = JSON.stringify(artifact)
    return [label, checkProtocolFeatureFreshness(
      makeFileContext(files),
      makeFixtureRequirement({ id: "GR-TIER-001" })
    ).status]
  })
  assert(statuses.every(([, status]) => status === "fail"),
    `static interface report exact issue map: ${JSON.stringify(statuses)}`)

  const makeCompletenessWith = (entry) => {
    const files = makeProtocolFeatureFiles()
    const evidencePath = readinessEvidenceFile("tier-protocol-features.json")
    const artifact = JSON.parse(files[evidencePath])
    artifact.draftFeatureCompleteness.issueMap[0] = entry
    return artifact.draftFeatureCompleteness
  }
  const validEntry = () => ({
    issue: "#13",
    area: "result metadata",
    implementationStatus: "implemented-locally"
  })
  let getterReads = 0
  const valueAccessor = validEntry()
  Object.defineProperty(valueAccessor, "issue", {
    enumerable: true,
    get() {
      getterReads += 1
      return "#13"
    }
  })
  const throwingAccessor = validEntry()
  Object.defineProperty(throwingAccessor, "issue", {
    enumerable: true,
    get() {
      throw new Error("issue getter must not run")
    }
  })
  const { proxy: revokedProxy, revoke } = Proxy.revocable(validEntry(), {})
  revoke()
  const hostileCases = [
    ["value accessor", valueAccessor],
    ["throwing accessor", throwingAccessor],
    ["get trap", new Proxy(validEntry(), {
      get() {
        throw new Error("get trap must be contained")
      }
    })],
    ["ownKeys trap", new Proxy(validEntry(), {
      ownKeys() {
        throw new Error("ownKeys trap must be contained")
      }
    })],
    ["descriptor trap", new Proxy(validEntry(), {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap must be contained")
      }
    })],
    ["revoked proxy", revokedProxy]
  ]
  const hostileStatuses = hostileCases.map(([label, entry]) => {
    try {
      const errors = validateDraftFeatureCompleteness({
        draftFeatureCompleteness: makeCompletenessWith(entry)
      })
      return [label, errors.length > 0 ? "fail" : "pass"]
    } catch (error) {
      return [label, `threw:${error instanceof Error ? error.message : String(error)}`]
    }
  })
  assert(getterReads === 0,
    `static interface report invoked an issue getter ${getterReads} time(s)`)
  assert(hostileStatuses.every(([, status]) => status === "fail"),
    `static interface hostile issue map: ${JSON.stringify(hostileStatuses)}`)

  let containerReads = 0
  const validCompleteness = () => {
    const files = makeProtocolFeatureFiles()
    const evidencePath = readinessEvidenceFile("tier-protocol-features.json")
    return JSON.parse(files[evidencePath]).draftFeatureCompleteness
  }
  const artifactGetter = {}
  Object.defineProperty(artifactGetter, "draftFeatureCompleteness", {
    get() {
      containerReads += 1
      throw new Error("completeness getter must not run")
    }
  })
  const completenessStatusGetter = validCompleteness()
  Object.defineProperty(completenessStatusGetter, "status", {
    enumerable: true,
    get() {
      containerReads += 1
      throw new Error("status getter must not run")
    }
  })
  const issueMapGetter = validCompleteness()
  Object.defineProperty(issueMapGetter, "issueMap", {
    enumerable: true,
    get() {
      containerReads += 1
      throw new Error("issueMap getter must not run")
    }
  })
  const issueMapSlot = validCompleteness()
  Object.defineProperty(issueMapSlot.issueMap, "0", {
    enumerable: true,
    get() {
      containerReads += 1
      throw new Error("issueMap slot getter must not run")
    }
  })
  const issueMapProxy = validCompleteness()
  issueMapProxy.issueMap = new Proxy(issueMapProxy.issueMap, {
    get() {
      containerReads += 1
      throw new Error("issueMap proxy trap must not run")
    }
  })
  const completenessProxy = new Proxy(validCompleteness(), {
    get() {
      containerReads += 1
      throw new Error("completeness proxy trap must not run")
    }
  })
  const revokedIssueMap = validCompleteness()
  const revokedArray = Proxy.revocable(revokedIssueMap.issueMap, {})
  revokedIssueMap.issueMap = revokedArray.proxy
  revokedArray.revoke()
  const containerCases = [
    ["artifact completeness getter", artifactGetter],
    ["completeness status getter", { draftFeatureCompleteness: completenessStatusGetter }],
    ["issueMap getter", { draftFeatureCompleteness: issueMapGetter }],
    ["issueMap slot getter", { draftFeatureCompleteness: issueMapSlot }],
    ["issueMap proxy", { draftFeatureCompleteness: issueMapProxy }],
    ["completeness proxy", { draftFeatureCompleteness: completenessProxy }],
    ["revoked issueMap", { draftFeatureCompleteness: revokedIssueMap }]
  ]
  const containerStatuses = containerCases.map(([label, artifact]) => {
    try {
      const errors = validateDraftFeatureCompleteness(artifact)
      return [label, errors.length > 0 ? "fail" : "pass"]
    } catch (error) {
      return [label, `threw:${error instanceof Error ? error.message : String(error)}`]
    }
  })
  assert(containerReads === 0,
    `static interface invoked hostile container ${containerReads} time(s)`)
  assert(containerStatuses.every(([, status]) => status === "fail"),
    `static interface hostile containers: ${JSON.stringify(containerStatuses)}`)

  let coercions = 0
  const coercingValue = {
    [Symbol.toPrimitive]() {
      coercions += 1
      throw new Error("field coercion must not run")
    }
  }
  const revokedValue = Proxy.revocable({}, {})
  revokedValue.revoke()
  const hostileValueCases = [
    ["symbol issue", "issue", Symbol("issue")],
    ["symbol area", "area", Symbol("area")],
    ["symbol status", "implementationStatus", Symbol("status")],
    ["coercing issue", "issue", coercingValue],
    ["coercing area", "area", coercingValue],
    ["coercing status", "implementationStatus", coercingValue],
    ["revoked issue", "issue", revokedValue.proxy],
    ["revoked area", "area", revokedValue.proxy],
    ["revoked status", "implementationStatus", revokedValue.proxy]
  ]
  const valueStatuses = hostileValueCases.map(([label, field, value]) => {
    const completeness = validCompleteness()
    completeness.issueMap[0][field] = value
    try {
      const errors = validateDraftFeatureCompleteness({ draftFeatureCompleteness: completeness })
      return [label, errors.length > 0 ? "fail" : "pass"]
    } catch (error) {
      return [label, `threw:${error instanceof Error ? error.message : String(error)}`]
    }
  })
  assert(coercions === 0, `static interface coerced hostile fields ${coercions} time(s)`)
  assert(valueStatuses.every(([, status]) => status === "fail"),
    `static interface hostile field values: ${JSON.stringify(valueStatuses)}`)
}

function testValidStaticInterfaceReportPasses() {
  const result = checkProtocolFeatureFreshness(
    makeFileContext(makeProtocolFeatureFiles()),
    makeFixtureRequirement({ id: "GR-TIER-001" })
  )
  assert(result.status === "pass", "valid static interface report passes")
}

function testMarkdownPassIsNotAgentEvidence() {
  const result = checkAgentSalienceEvidence(makeFileContext({
    "docs/agent-evidence/salience-audit.md": "pass"
  }), makeFixtureRequirement({ id: "GR-AGENT-907" }))
  assert(result.status === "unknown", "markdown pass is not agent evidence")
}

function testBlockingRowsBlockClaims() {
  const result = compileReadiness([
    makeFixtureRequirement({
      id: "GR-AGENT-905",
      category: "agent-user effectiveness",
      claims: ["artifact-goal done"],
      check: () => unknown("agent evidence missing"),
      agentDetail: {
        taskEvaluated: "task",
        targetAgentModelOrClass: "agent",
        expectedMcpAffordances: "affordance",
        successCriteria: "success",
        failureModesTested: "failure",
        evidenceArtifactRequired: "artifact"
      }
    })
  ], makeFileContext({}))
  const claim = result.claims.get("artifact-goal done")
  assert(claim.verdict === "blocked", "agent row blocks artifact-goal")
}

function makeFixtureRequirement(overrides = {}) {
  return {
    id: "GR-CONF-999",
    category: "software/protocol correctness",
    source: "README.md",
    requirement: "Fixture requirement.",
    proofRequired: "Fixture proof.",
    disposition: "blocking",
    claims: ["repo-health done"],
    ownerPaths: ["README.md"],
    validationCommands: ["pnpm run check:sdk-readiness"],
    evidenceKind: "command-result",
    check: () => pass("command-result", "fixture pass"),
    ...overrides
  }
}

function makeConformanceFiles(overrides = {}) {
  const artifact = {
    evidenceKind: "conformance-result",
    timestamp: "2026-05-03T00:00:00.000Z",
    command: "pnpm run conformance:run",
    exitCode: 0,
    summary: {
      suite: "active",
      scenarioCount: 30,
      checkCount: 39,
      failureCount: 0,
      warningCount: 0
    },
    requirementIds: ["GR-CONF-001"],
    suite: "draft",
    specVersion: "2026-07-28",
    conformancePackage: {
      name: "@modelcontextprotocol/conformance",
      version: "0.2.0-alpha.7"
    },
    artifactDir: ".local/conformance/run",
    scenarioCount: 30,
    checkCount: 39,
    failureCount: 0,
    warningCount: 0,
    failedChecks: [],
    ...overrides
  }
  return {
    [readinessEvidenceFile("conformance.json")]: JSON.stringify(artifact),
    ".local/conformance/run": ""
  }
}

function makeProtocolFeatureFiles(overrides = {}) {
  const artifact = {
    evidenceKind: "static-interface",
    timestamp: "2026-05-03T00:00:00.000Z",
    command: "pnpm run check:tier-protocol-features",
    exitCode: 0,
    summary: {
      status: "pass",
      protocolVersion: "2026-07-28",
      featureCount: 1,
      passed: 1,
      failed: 0
    },
    requirementIds: ["GR-TIER-001"],
    protocol: {
      version: "2026-07-28",
      generatedProtocolVersion: "2026-07-28",
      generatedSchemaVersion: "2026-07-28"
    },
    draftFeatureCompleteness: {
      status: "local-core-implemented-with-deferred-profiles",
      trackingIssues: ["#13", "#14", "#15", "#17", "#19", "#20"],
      remoteIssueDisposition: "approval-required",
      qualification: "not-official-conformance-release-or-tier-evidence",
      issueMap: [
        { issue: "#13", area: "MRTR input-required retry flows", implementationStatus: "implemented-locally" },
        { issue: "#14", area: "Request-scoped subscriptions/listen streaming", implementationStatus: "implemented-locally" },
        { issue: "#15", area: "io.modelcontextprotocol/tasks extension", implementationStatus: "deferred-wp7" },
        { issue: "#17", area: "Stateless Streamable HTTP negative paths", implementationStatus: "implemented-locally" },
        { issue: "#19", area: "Re-authored examples beyond Everything", implementationStatus: "implemented-locally" },
        { issue: "#20", area: "Draft authorization hardening", implementationStatus: "deferred-wp6" }
      ]
    },
    features: [
      {
        id: "protocol-version",
        kind: "version",
        identifiers: ["2026-07-28"],
        status: "pass"
      },
      {
        id: "server-requests",
        kind: "descriptor-group",
        identifiers: [],
        status: "pass",
        draftDisposition: "replaced-by-mrtr",
        trackingIssues: ["#13"]
      }
    ],
    ...overrides
  }
  return {
    [readinessEvidenceFile("tier-protocol-features.json")]: JSON.stringify(artifact)
  }
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`Self-test assertion failed: ${label}`)
  }
}
