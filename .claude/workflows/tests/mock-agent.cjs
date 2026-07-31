// Shared source-candidates agent mock used by the plain workflow tests and
// the production runner parity tests. It models the new contract: verification
// calls return the exact dossier submitted through submit_verification. There
// is no transcription, annotation, or filesystem-writing agent stage.

function makePipeline() {
  return async (items, ...stages) => Promise.all(items.map(async (item, idx) => {
    let acc = item
    for (const stage of stages) {
      try { acc = await stage(acc, item, idx) } catch { return null }
      if (acc === null || acc === undefined) return null
    }
    return acc
  }))
}

function makeParallel() {
  return async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
}

function dossierFor(cfg, prompt, label, opts) {
  const itemId = /item "([^"]+)"/.exec(prompt)?.[1] ?? "unknown"
  const item = opts?.toolContext?.item ?? cfg.collect.items.find((candidate) => candidate.itemId === itemId) ?? {
    itemId,
    name: "unknown",
    url: "",
  }
  const retry = label.endsWith(":retry")
  if (cfg.verifyNullAlways === item.name || (cfg.verifyNullOnce === item.name && !retry)) return null

  const criteria = cfg.collect.criteria.map((description, index) => ({
    index,
    description,
    verdict:
      cfg.missFor === item.name ? "Miss" :
      cfg.unclearFor === item.name ? "Unclear" : "Match",
    websetSaid: "Match",
    rationale: `evidence for ${description}`,
    interviewFollowUp: false,
    evidence: [{ artifactId: `artifact-${itemId}-criterion-${index}`, relation: "supports" }],
  }))
  const enrichments = cfg.collect.enrichmentColumns.map((description, index) => ({
    index,
    description,
    originalValue: `original-${index}`,
    verifiedValue: `verified-${index}`,
    verdict: "confirmed",
    rationale: `verified ${description}`,
    interviewFollowUp: false,
    evidence: [{ artifactId: `artifact-${itemId}-enrichment-${index}`, relation: "supports" }],
  }))
  if (cfg.omitCriterionFor === item.name) criteria.pop()

  return {
    schemaVersion: 1,
    policyVersion: "verification-evidence/v1",
    itemId,
    websetId: cfg.collect.websetId,
    name: item.name,
    url: item.url,
    identity: {
      confirmed: cfg.identityUnconfirmedFor !== item.name,
      rationale: "identity evidence",
      evidence: [{ artifactId: `artifact-${itemId}-identity`, relation: "supports" }],
      interviewFollowUp: false,
    },
    criteria,
    enrichments,
    websetReferenceDispositions: (item.references ?? []).map(({ referenceKey, url }) => ({
      referenceKey,
      url,
      disposition: "inspected",
      evidenceArtifactId: `artifact-${itemId}-contents`,
      rationale: "read",
    })),
    confidence: 0.9,
    notes: "mock verified dossier",
  }
}

function makeAgent(cfg, calls) {
  return async (prompt, opts = {}) => {
    const label = opts.label ?? "(none)"
    calls.push(label)
    cfg.onCall?.({ label, prompt, opts })
    if (label === "compose") return cfg.compose
    if (label === "create") return {
      websetId: cfg.collect.websetId,
      searchesCreated: cfg.compose?.searchQueries?.length ?? 1,
    }
    if (label.startsWith("poll:")) {
      const n = Number(label.slice("poll:".length))
      return cfg.pollSequence?.[n - 1] ?? {
        websetStatus: "idle",
        searchStatuses: ["completed"],
        found: cfg.collect.items.length,
      }
    }
    if (label === "collect") return cfg.collect
    if (label.startsWith("recheck:")) {
      const n = Number(label.slice("recheck:".length))
      const stableFound = cfg.pollSequence?.at(-1)?.found ?? cfg.collect.items.length
      return cfg.recheckSequence?.[n - 1] ?? {
        websetStatus: "idle",
        searchStatuses: ["completed"],
        found: stableFound,
        definitionHash: cfg.collect.definitionHash,
        definition: cfg.collect.definition,
      }
    }
    if (label.startsWith("verify:")) return dossierFor(cfg, prompt, label, opts)
    if (label === "report") return "mock report"
    if (label === "email-summary") return "mock email summary"
    throw new Error(`mock agent: unhandled label ${label}`)
  }
}

module.exports = { makePipeline, makeParallel, makeAgent }
