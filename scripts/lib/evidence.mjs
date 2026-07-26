// Evidence helpers for artifacts that live outside `.local/readiness-evidence`.
//
// `readinessEvidencePath()` in scripts/readiness-evidence.mjs resolves every
// path under `.local/`, which is gitignored. Some evidence is deliberately
// committed instead — `docs/agent-evidence/*.json` is read by
// check-sdk-readiness-requirements.mjs from a working tree, so it must survive a
// clean checkout and must not require regenerating (which would mean a network
// call and an API key in CI). This module writes those, and validates them.
//
// Validation matters more than writing. `readEvidenceArtifact` accepts any
// object carrying six generic fields, with no `additionalProperties` check and
// no per-kind validator, so a hand-written stub would satisfy a blocking
// requirement while proving nothing. Every artifact this module writes is
// schema-checked on the way out and re-checked by a gate on the way in.
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeEvidenceFileAtomic } from "../readiness-evidence.mjs"

/**
 * Build the generic envelope `readEvidenceArtifact` requires.
 *
 * `exitCode` is load-bearing: `artifactResult` fails the requirement on any
 * non-zero value, so a generator must pass through a real pass/fail verdict
 * rather than hardcoding 0.
 */
export function buildEvidenceReport({
  evidenceKind,
  command,
  exitCode,
  requirementIds,
  suite,
  summary,
  scenarios,
  cases,
  ...rest
}) {
  const report = {
    evidenceKind,
    timestamp: new Date().toISOString(),
    command,
    exitCode,
    requirementIds,
    suite,
    summary,
    ...rest
  }
  if (scenarios !== undefined) report.scenarios = scenarios
  if (cases !== undefined) report.cases = cases
  return report
}

export function compileSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile(schema)
}

/** Validate a report against a JSON Schema. Returns human-readable errors. */
export function schemaErrors(schema, report) {
  const validate = compileSchema(schema)
  if (validate(report)) return []
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`)
}

/**
 * Validate then atomically write. Throws rather than emitting an artifact that
 * would be reported as `invalid` — a missing artifact is an honest `unknown`,
 * a malformed one is noise.
 */
export function writeEvidence({ targetPath, report, schema }) {
  if (schema !== undefined) {
    const errors = schemaErrors(schema, report)
    if (errors.length > 0) {
      throw new Error(`Refusing to write ${path.basename(targetPath)}:\n- ${errors.join("\n- ")}`)
    }
  }
  return writeEvidenceFileAtomic(targetPath, `${JSON.stringify(report, null, 2)}\n`)
}

export function readJsonFile(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, "utf8"))
}
