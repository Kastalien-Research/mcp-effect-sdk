// Derives the supported final-spec surface from generated protocol metadata and
// the pinned JSON Schema, then requires an exact API/docs/example/test mapping.
// This is intentionally structural: adding one method or capability upstream
// creates a missing matrix row instead of passing because a broad topic word
// happens to exist somewhere in the documentation.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { runScript } from "./lib/process.mjs"

import { schemaErrors } from "./lib/evidence.mjs"
import { writeTestEvidenceReport } from "./readiness-evidence.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const runGenerateDocsCoverage = Effect.sync(() => {
  const matrixPath = "docs/conformance/feature-coverage.json"
  const matrixSchemaPath = "docs/conformance/feature-coverage.schema.json"
  const generatedProtocolPath = "src/generated/mcp/2026-07-28/McpProtocol.generated.ts"
  const sourceSchemaPath = "sources/vendor/mcp-core/schema.json"
  const failures = []

  const read = (relativePath) => {
    const absolute = path.join(root, relativePath)
    if (!existsSync(absolute)) {
      failures.push(`Missing ${relativePath}`)
      return ""
    }
    return readFileSync(absolute, "utf8")
  }

  const parseJson = (relativePath) => {
    const source = read(relativePath)
    if (source === "") return undefined
    try {
      return JSON.parse(source)
    } catch (error) {
      failures.push(`${relativePath} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  const matrix = parseJson(matrixPath)
  const matrixSchema = parseJson(matrixSchemaPath)
  const protocolSource = read(generatedProtocolPath)
  const sourceSchema = parseJson(sourceSchemaPath)

  if (matrix && matrixSchema) {
    for (const error of schemaErrors(matrixSchema, matrix)) failures.push(`${matrixPath}${error}`)
  }

  const expected = new Set()
  const derivedExpected = new Set()
  const expectedExclusions = new Set()
  if (protocolSource !== "") {
    addDescriptorFeatures(expected, derivedExpected, protocolSource, "CLIENT_REQUEST_DESCRIPTORS", "client-request")
    addDescriptorFeatures(
      expected,
      derivedExpected,
      protocolSource,
      "CLIENT_NOTIFICATION_DESCRIPTORS",
      "client-notification"
    )
    addDescriptorFeatures(
      expected,
      derivedExpected,
      protocolSource,
      "SERVER_NOTIFICATION_DESCRIPTORS",
      "server-notification"
    )
  }
  if (sourceSchema) {
    addCapabilityFeatures(
      expected,
      derivedExpected,
      expectedExclusions,
      sourceSchema,
      "ClientCapabilities",
      "client-capability"
    )
    addCapabilityFeatures(
      expected,
      derivedExpected,
      expectedExclusions,
      sourceSchema,
      "ServerCapabilities",
      "server-capability"
    )
  }

  for (const id of [
    "transport:stdio-client",
    "transport:stdio-server",
    "transport:streamable-http-client",
    "transport:streamable-http-server",
    "authorization:metadata-discovery",
    "authorization:registration-modes",
    "authorization:pkce-authorization-code",
    "authorization:resource-indicator-audience",
    "authorization:issuer-validation",
    "authorization:token-exchange-refresh",
    "authorization:challenge-step-up-scopes",
    "authorization:credential-redaction",
    "authorization:protected-resource-metadata",
    "authorization:bearer-verification",
    "authorization:scope-hierarchy-policy",
    "deprecated:roots-provider",
    "deprecated:sampling-handler",
    "deprecated:logging-message"
  ]) {
    expected.add(id)
  }

  const features = Array.isArray(matrix?.features) ? matrix.features : []
  const excluded = Array.isArray(matrix?.excluded) ? matrix.excluded : []
  const featureIds = new Set()
  const exclusionIds = new Set()
  const cases = []

  for (const feature of features) {
    const id = feature?.id
    if (typeof id !== "string" || id.length === 0) continue
    if (featureIds.has(id)) failures.push(`Duplicate feature matrix row ${id}`)
    featureIds.add(id)

    const rowFailures = []
    if (derivedExpected.has(id)) {
      const separator = id.indexOf(":")
      const expectedKind = id.slice(0, separator)
      const expectedIdentifier = id.slice(separator + 1)
      if (feature.kind !== expectedKind) {
        rowFailures.push(`${id}.kind must be ${expectedKind}`)
      }
      if (feature.protocolIdentifier !== expectedIdentifier) {
        rowFailures.push(`${id}.protocolIdentifier must be ${expectedIdentifier}`)
      }
    }
    validateReference(feature.api, `${id}.api`, { requireSymbol: true, rowFailures })
    validateReference(feature.documentation, `${id}.documentation`, { requireAnchor: true, rowFailures })
    validateReference(feature.example, `${id}.example`, { rowFailures })
    if (!Array.isArray(feature.tests) || feature.tests.length === 0) {
      rowFailures.push(`${id}.tests must contain at least one test reference`)
    } else {
      for (const [index, reference] of feature.tests.entries()) {
        validateReference(reference, `${id}.tests[${index}]`, { rowFailures })
      }
    }
    failures.push(...rowFailures)
    cases.push({
      id,
      case: feature.kind,
      description: `${feature.protocolIdentifier} maps to API, documentation, example, and test evidence`,
      command: "node scripts/generate-docs-coverage.mjs",
      exitCode: rowFailures.length === 0 ? 0 : 1,
      status: rowFailures.length === 0 ? "pass" : "fail"
    })
  }

  for (const entry of excluded) {
    if (typeof entry?.id !== "string") continue
    if (exclusionIds.has(entry.id)) failures.push(`Duplicate feature exclusion ${entry.id}`)
    exclusionIds.add(entry.id)
  }

  compareExactSet("supported feature", expected, featureIds)
  compareExactSet("official experimental exclusion", expectedExclusions, exclusionIds)

  if (matrix?.roleBoundaries?.authorizationServer !== "not-claimed") {
    failures.push("Feature matrix must explicitly classify the authorization-server role as not claimed")
  }

  const docsIndex = read("docs/README.md")
  for (const required of [
    "feature-coverage.md",
    "../DEPENDENCY_POLICY.md",
    "../VERSIONING.md",
    "../MAINTENANCE.md",
    "../ROADMAP.md",
    "migration-2026-07-28.md"
  ]) {
    if (!docsIndex.includes(required)) failures.push(`docs/README.md does not publish ${required}`)
  }

  const exitCode = failures.length === 0 ? 0 : 1
  const evidencePath = writeTestEvidenceReport({
    name: "documentation-coverage",
    evidenceKind: "documentation-coverage",
    command: "node scripts/generate-docs-coverage.mjs",
    exitCode,
    requirementIds: ["GR-DOC-001", "GR-DOC-002", "GR-TIER-003"],
    suite: "final-feature-coverage",
    summary: {
      protocolVersion: matrix?.protocolVersion,
      authority: {
        protocol: generatedProtocolPath,
        capabilities: sourceSchemaPath,
        policy: "https://modelcontextprotocol.io/community/sdk-tiers"
      },
      requiredSupported: expected.size,
      mappedSupported: featureIds.size,
      requiredExcluded: expectedExclusions.size,
      mappedExcluded: exclusionIds.size,
      failureCount: failures.length
    },
    cases
  })

  console.log(`Feature coverage rows: ${featureIds.size}/${expected.size}`)
  console.log(`Official experimental exclusions: ${exclusionIds.size}/${expectedExclusions.size}`)
  console.log(`Writing readiness evidence to ${evidencePath}`)
  if (failures.length > 0) {
    console.error("Feature coverage generation failed:")
    for (const failure of failures) console.error(`- ${failure}`)
    throw new Error(`Feature coverage generation failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  }
  console.log("Feature coverage generation passed.")

  function addDescriptorFeatures(target, identityTarget, source, constant, kind) {
    const pattern = new RegExp(`export const ${constant} = \\[([\\s\\S]*?)\\n\\] as const`)
    const match = source.match(pattern)
    if (!match) {
      failures.push(`Unable to read ${constant} from ${generatedProtocolPath}`)
      return
    }
    for (const method of Array.from(match[1].matchAll(/"method": "([^"]+)"/g), (entry) => entry[1])) {
      const id = `${kind}:${method}`
      target.add(id)
      identityTarget.add(id)
    }
  }

  function addCapabilityFeatures(target, identityTarget, exclusionsTarget, schema, definitionName, kind) {
    const definition = schema?.$defs?.[definitionName]
    if (!definition || typeof definition !== "object") {
      failures.push(`${sourceSchemaPath} has no ${definitionName}`)
      return
    }
    for (const capability of Object.keys(definition.properties ?? {})) {
      const id = `${kind}:${capability}`
      if (capability === "experimental") exclusionsTarget.add(id)
      else {
        target.add(id)
        identityTarget.add(id)
      }
    }
  }

  function compareExactSet(name, expectedSet, actualSet) {
    const missing = [...expectedSet].filter((id) => !actualSet.has(id)).sort()
    const extra = [...actualSet].filter((id) => !expectedSet.has(id)).sort()
    if (missing.length > 0) failures.push(`Missing ${name} row(s): ${missing.join(", ")}`)
    if (extra.length > 0) failures.push(`Unexpected ${name} row(s): ${extra.join(", ")}`)
  }

  function validateReference(reference, label, options) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      options.rowFailures.push(`${label} must be an object`)
      return
    }
    const relativePath = reference.path
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      options.rowFailures.push(`${label}.path must be non-empty`)
      return
    }
    const absolute = path.join(root, relativePath)
    if (!existsSync(absolute)) {
      options.rowFailures.push(`${label} points to missing ${relativePath}`)
      return
    }
    const source = readFileSync(absolute, "utf8")
    if (options.requireSymbol) {
      if (typeof reference.symbol !== "string" || reference.symbol.length === 0) {
        options.rowFailures.push(`${label}.symbol must be non-empty`)
      } else if (!new RegExp(`\\b${escapeRegExp(reference.symbol)}\\b`).test(source)) {
        options.rowFailures.push(`${label} symbol ${reference.symbol} is absent from ${relativePath}`)
      }
    }
    if (options.requireAnchor) {
      if (typeof reference.anchor !== "string" || reference.anchor.length === 0) {
        options.rowFailures.push(`${label}.anchor must be non-empty`)
      } else if (!markdownAnchors(source).has(reference.anchor)) {
        options.rowFailures.push(`${label} anchor #${reference.anchor} is absent from ${relativePath}`)
      }
    }
  }

  function markdownAnchors(source) {
    const anchors = new Set()
    for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
      const anchor = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/[`*_~]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
      anchors.add(anchor)
    }
    return anchors
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
})

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(runScript("generate-docs-coverage", runGenerateDocsCoverage))
}
