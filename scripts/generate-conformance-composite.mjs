import { existsSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

import {
  assertConformanceEvidenceContract,
  readinessEvidencePath,
  runtimeEvidenceName,
  writeEvidenceFileAtomic
} from "./readiness-evidence.mjs"
import { runScript } from "./lib/process.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const runGenerateConformanceComposite = Effect.sync(() => {
  const publishedArtifact = process.argv.includes("--published")
  if (process.argv.slice(2).some((argument) => argument !== "--published")) {
    throw new Error("Usage: node scripts/generate-conformance-composite.mjs [--published]")
  }
  const evidencePrefix = publishedArtifact ? "published-" : ""
  const target = readinessEvidencePath(`${evidencePrefix}conformance-composite`)
  const manifest = JSON.parse(readFileSync(path.join(root, "sources", "manifest.json"), "utf8"))
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const conformanceSource = manifest.sources.find((source) => source.id === "mcp-conformance")
  const requiredComponents = [
    {
      name: "server-all",
      suite: "all",
      command: publishedArtifact ? "published artifact server-all" : "pnpm run conformance:run",
      evidencePath: readinessEvidencePath(
        publishedArtifact ? runtimeEvidenceName("published-conformance") : "conformance"
      )
    },
    {
      name: "client-all",
      suite: "client-all",
      command: publishedArtifact ? "published artifact client-all" : "pnpm run conformance:client",
      evidencePath: readinessEvidencePath(runtimeEvidenceName(`${evidencePrefix}conformance-client`))
    },
    {
      name: "client-auth",
      suite: "client-auth",
      command: publishedArtifact ? "published artifact client-auth" : "pnpm run conformance:client-auth",
      evidencePath: readinessEvidencePath(runtimeEvidenceName(`${evidencePrefix}conformance-client-auth`))
    }
  ]

  rmSync(target, { force: true })

  try {
    requirePinnedConformanceAuthority()
    const qualificationTarget = publishedArtifact ? requirePublishedQualificationTarget() : undefined
    const reports = requiredComponents.map(loadComponent)
    requireSameAuthority(reports)

    const components = reports.map(({ requirement, report }) => {
      const applicableCheckCount = report.checkCount - report.skippedCount
      if (applicableCheckCount <= 0) {
        throw new Error(`${requirement.name} has no applicable conformance checks`)
      }
      const passedCheckCount = applicableCheckCount - report.failureCount - report.warningCount
      const passRate = passedCheckCount / applicableCheckCount
      if (report.exitCode !== 0 || report.failureCount !== 0 || report.warningCount !== 0 || passRate !== 1) {
        throw new Error(`${requirement.name} did not pass 100% of applicable checks`)
      }
      for (const skipped of report.skippedChecks) {
        if (skipped.classification !== "upstream-declared-skipped-informational") {
          throw new Error(`${requirement.name} contains a locally classified exclusion`)
        }
      }
      return {
        name: requirement.name,
        suite: report.suite,
        command: report.command,
        evidencePath: path.relative(root, requirement.evidencePath),
        specVersion: report.specVersion,
        commit: report.commit,
        runtime: report.runtime,
        packageManager: report.packageManager,
        conformancePackage: {
          ...report.conformancePackage,
          sourceRevision: conformanceSource.revision,
          integrity: conformanceSource.npmOracle.integrity
        },
        sourceRevisions: report.sourceRevisions,
        scenarioCount: report.scenarioCount,
        checkCount: report.checkCount,
        applicableCheckCount,
        passedCheckCount,
        excludedCheckCount: report.skippedCount,
        failureCount: report.failureCount,
        warningCount: report.warningCount,
        passRate
      }
    })

    const exclusions = reports.flatMap(({ requirement, report }) =>
      report.skippedChecks.map((skipped) => ({
        component: requirement.name,
        scenario: skipped.scenario,
        id: skipped.id,
        name: skipped.name,
        classification: skipped.classification,
        specReferences: skipped.specReferences
      }))
    )
    const first = reports[0].report
    const total = (field) => components.reduce((sum, component) => sum + component[field], 0)
    const report = {
      evidenceKind: "conformance-result",
      timestamp: new Date().toISOString(),
      command: publishedArtifact ? "node scripts/verify-conformance.mjs --published" : "pnpm run verify:conformance",
      exitCode: 0,
      requirementIds: ["GR-CONF-001"],
      suite: publishedArtifact ? "published-tier1-composite" : "tier1-composite",
      specVersion: first.specVersion,
      commit: first.commit,
      runtime: first.runtime,
      packageManager: first.packageManager,
      conformancePackage: {
        ...first.conformancePackage,
        sourceRevision: conformanceSource.revision,
        integrity: conformanceSource.npmOracle.integrity
      },
      sourceRevisions: first.sourceRevisions,
      summary: {
        componentCount: components.length,
        scenarioCount: total("scenarioCount"),
        checkCount: total("checkCount"),
        applicableCheckCount: total("applicableCheckCount"),
        passedCheckCount: total("passedCheckCount"),
        excludedCheckCount: total("excludedCheckCount"),
        failureCount: total("failureCount"),
        warningCount: total("warningCount"),
        passRate: 1
      },
      components,
      exclusions,
      ...(qualificationTarget === undefined ? {} : { qualificationTarget }),
      outOfScopeNonBlocking: [
        {
          suite: "authorization-server",
          reason:
            "This SDK implements OAuth client and protected-resource seams, not an authorization-server implementation."
        }
      ]
    }

    writeEvidenceFileAtomic(target, `${JSON.stringify(report, null, 2)}\n`)
    console.log(
      `Writing same-commit ${publishedArtifact ? "published-artifact " : ""}Tier 1 conformance composite to ${target}`
    )
  } catch (error) {
    rmSync(target, { force: true })
    console.error(error instanceof Error ? error.message : String(error))
    throw error
  }

  function loadComponent(requirement) {
    if (!existsSync(requirement.evidencePath)) {
      throw new Error(`Missing ${path.relative(root, requirement.evidencePath)}`)
    }
    const report = JSON.parse(readFileSync(requirement.evidencePath, "utf8"))
    assertConformanceEvidenceContract(report)
    if (report.suite !== requirement.suite) {
      throw new Error(`${requirement.name} suite must be ${requirement.suite}`)
    }
    if (report.command !== requirement.command) {
      throw new Error(`${requirement.name} command must be ${requirement.command}`)
    }
    return { requirement, report }
  }

  function requireSameAuthority(reports) {
    const first = reports[0].report
    const authorityFields = [
      "specVersion",
      "commit",
      "runtime",
      "packageManager",
      "conformancePackage",
      "sourceRevisions"
    ]
    for (const { requirement, report } of reports.slice(1)) {
      for (const field of authorityFields) {
        if (JSON.stringify(report[field]) !== JSON.stringify(first[field])) {
          throw new Error(`${requirement.name} ${field} does not match the other conformance components`)
        }
      }
    }
  }

  function requirePinnedConformanceAuthority() {
    if (
      conformanceSource?.version !== "0.2.0-alpha.10" ||
      conformanceSource.revision !== "a9896553900a2ef61787b57adfcbbe936a8ab1f9" ||
      conformanceSource.npmOracle?.package !== "@modelcontextprotocol/conformance" ||
      conformanceSource.npmOracle.version !== conformanceSource.version ||
      conformanceSource.npmOracle.gitHead !== conformanceSource.revision ||
      conformanceSource.npmOracle.integrity !==
        "sha512-0V/HZDdWHcg6j0zVBzBsXcPZ571IVi6umKgTpnBhtTx/jm/LONmGF6cIWL2k4Xjyps0OiHV6B37nj2s0pUg0nQ=="
    ) {
      throw new Error("The conformance composite requires the exact alpha.10 source and registry authority")
    }
  }

  function requirePublishedQualificationTarget() {
    const expected = `${packageJson.name}@${packageJson.version}`
    const packageSpec = process.env.MCP_PUBLISHED_PACKAGE_SPEC
    if (packageSpec !== expected) {
      throw new Error(`Published conformance requires MCP_PUBLISHED_PACKAGE_SPEC=${expected}`)
    }
    return {
      kind: "published-npm-artifact",
      package: packageSpec
    }
  }
})

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(runScript("generate-conformance-composite", runGenerateConformanceComposite))
}
