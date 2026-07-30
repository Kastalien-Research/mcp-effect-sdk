const fs = require("fs")
const { makePipeline, makeParallel, makeAgent } = require("./mock-agent.cjs")

const SRC = fs.readFileSync(".claude/workflows/source-candidates.js", "utf8")
  .replace("export const meta", "const meta")
const AsyncFunction = async function () {}.constructor

async function run(args, cfg, override) {
  const calls = []
  const observations = []
  const base = makeAgent({ ...cfg, onCall: (entry) => observations.push(entry) }, calls)
  const agent = override ? (prompt, opts) => override(prompt, opts, base) : base
  const fn = new AsyncFunction("agent", "parallel", "pipeline", "log", "phase", "args", "budget", "workflow", SRC)
  const result = await fn(agent, makeParallel(), makePipeline(), () => {}, () => {}, args,
    { total: null, spent: () => 0, remaining: () => Infinity }, () => {})
  return { result, calls, observations }
}

const item = (itemId, name, url) => ({
  itemId, name, url,
  rawSnapshot: { id: itemId, properties: { person: { name }, url }, evaluations: [], enrichments: [] },
  rawSnapshotHash: `raw-hash-${itemId}`,
  references: [{ referenceKey: `${itemId}:profile:0`, url }],
})
const ITEMS = [
  item("w1", "Alice", "https://x.example/a"),
  item("w2", "Bob", "https://x.example/b"),
  item("w3", "Same Name", "https://x.example/c"),
  item("w4", "Same Name", "https://x.example/d"),
]
const COLLECT_OK = {
  websetId: "webset_test",
  definitionArtifactId: "artifact-definition",
  definition: {
    webset: {
      id: "webset_test",
      enrichments: [
        { id: "enrichment-title", description: "Current title" },
        { id: "enrichment-employer", description: "Current employer" },
      ],
    },
    searches: [{
      id: "search-1",
      criteria: [
        { id: "criterion-swe", description: "Currently a professional software engineer" },
        { id: "criterion-tools", description: "Built internal tools" },
      ],
    }],
  },
  definitionHash: "definition-hash",
  itemsArtifactId: "artifact-items",
  itemsArtifactHash: "items-hash",
  captureProof: {
    total: ITEMS.length, included: ITEMS.length, excluded: 0, ingested: ITEMS.length, mirrored: ITEMS.length,
    projectedItemIdsHash: "0".repeat(64), mirroredItemIdsHash: "1".repeat(64),
  },
  criteria: ["Currently a professional software engineer", "Built internal tools"],
  enrichmentColumns: ["Current title", "Current employer"],
  items: ITEMS,
  truncated: false,
}

let failures = 0
function check(description, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${description}`)
  if (!condition) failures++
}

;(async () => {
  {
    const { result, observations } = await run({ websetId: "webset_test", recordId: "rec1" }, { collect: COLLECT_OK })
    check("returns CandidateRunDraftV2", result.schemaVersion === 2 && result.policyVersion === "verification-evidence/v1")
    check("complete cohort is eligible", result.deliveryEligible === true && result.dossiers.length === 4)
    check("name-only duplicates are never merged", result.manifest.candidates.length === 4 && result.manifest.duplicates.length === 0)
    check("no model self-report file fields survive", !("csvWritten" in result) && !("csvPath" in result))
    check("verification uses evidence tool profile", observations.filter((x) => x.label.startsWith("verify:")).every((x) => x.opts.toolProfile === "candidate-verification"))
    check("non-research calls receive no tools", observations.filter((x) => ["report", "email-summary"].includes(x.label)).every((x) => x.opts.toolProfile === "none"))
    check("removed transcriber/persist/export agent stages", !observations.some((x) => /^(verdict:|persist:|write:|assemble-csv)/.test(x.label)))
  }

  {
    const collect = { ...COLLECT_OK, items: [...ITEMS, item("w5", "Alice duplicate", "https://x.example/a/")] }
    const { result } = await run({ websetId: "webset_test" }, { collect })
    check("exact normalized profile URL duplicate is explicitly accounted", result.manifest.candidates.length === 4 && result.manifest.duplicates[0]?.itemId === "w5" && result.manifest.duplicates[0]?.canonicalItemId === "w1")
  }

  {
    const invalidItems = [item("invalid-1", "First", "N/A"), item("invalid-2", "Second", "N/A")]
    const collect = {
      ...COLLECT_OK,
      items: invalidItems,
      captureProof: {
        ...COLLECT_OK.captureProof,
        total: 2,
        included: 2,
        ingested: 2,
        mirrored: 2,
      },
    }
    const { result } = await run({ websetId: "webset_test" }, { collect })
    check("invalid placeholder URLs never deduplicate candidates", result.manifest.candidates.length === 2 && result.manifest.duplicates.length === 0)
  }

  {
    const { result } = await run({ websetId: "webset_test" }, { collect: COLLECT_OK, unclearFor: "Alice" })
    check("every criterion is a must-have: Unclear excludes", result.validated === 3 && result.rejected === 1)
    const miss = await run({ websetId: "webset_test" }, { collect: COLLECT_OK, missFor: "Bob" })
    check("Miss excludes", miss.result.validated === 3 && miss.result.rejected === 1)
    const identity = await run({ websetId: "webset_test" }, { collect: COLLECT_OK, identityUnconfirmedFor: "Bob" })
    check("unconfirmed identity excludes", identity.result.validated === 3 && identity.result.rejected === 1)
  }

  {
    const { result, calls } = await run({ websetId: "webset_test" }, { collect: COLLECT_OK, verifyNullOnce: "Bob" })
    check("missing dossier retries once", calls.includes("verify:Bob:retry") && result.deliveryEligible === true)
    const failed = await run({ websetId: "webset_test" }, { collect: COLLECT_OK, verifyNullAlways: "Bob" })
    check("permanently missing dossier makes run non-deliverable", failed.result.deliveryEligible === false && failed.result.unverified[0]?.itemId === "w2")
    const malformed = await run({ websetId: "webset_test" }, { collect: COLLECT_OK, omitCriterionFor: "Bob" })
    check("structurally incomplete dossier makes run non-deliverable", malformed.result.deliveryEligible === false && malformed.result.unverified[0]?.itemId === "w2")
  }

  {
    const manyItems = Array.from({ length: 11 }, (_, index) =>
      item(`bounded-${index}`, `Bounded ${index}`, `https://x.example/bounded-${index}`))
    let active = 0
    let maximum = 0
    const bounded = await run(
      { websetId: "webset_test" },
      { collect: { ...COLLECT_OK, items: manyItems } },
      async (prompt, opts, base) => {
        if (!String(opts?.label ?? "").startsWith("verify:")) return base(prompt, opts)
        active++
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        try { return await base(prompt, opts) } finally { active-- }
      },
    )
    check("complete-cohort verification uses bounded concurrency", bounded.result.dossiers.length === 11 && maximum === 4)
  }

  {
    const moving = await run(
      { websetId: "webset_test" },
      {
        collect: COLLECT_OK,
        recheckSequence: Array.from({ length: 12 }, (_, index) => ({
          websetStatus: "idle",
          searchStatuses: ["completed"],
          found: 5 + index,
        })),
      },
    )
    check(
      "a cohort that keeps moving during freeze is rejected before verification",
      moving.result.deliveryEligible === false && /changed during manifest freeze/.test(moving.result.error) &&
        !moving.calls.some((label) => label.startsWith("verify:")),
    )
  }

  {
    const driftedDefinition = {
      ...COLLECT_OK.definition,
      searches: [{
        ...COLLECT_OK.definition.searches[0],
        criteria: [
          { id: "criterion-swe", description: "Currently a professional software engineer" },
          { id: "criterion-tools", description: "Built completely different internal tooling" },
        ],
      }],
    }
    const definitionDrift = await run(
      { websetId: "webset_test" },
      {
        collect: COLLECT_OK,
        recheckSequence: Array.from({ length: 12 }, () => ({
          websetStatus: "idle",
          searchStatuses: ["completed"],
          found: ITEMS.length,
          definition: driftedDefinition,
          definitionHash: "changed-definition-hash",
        })),
      },
    )
    check(
      "definition drift with stable counts is rejected before verification",
      definitionDrift.result.deliveryEligible === false &&
        /changed during manifest freeze/.test(definitionDrift.result.error) &&
        !definitionDrift.calls.some((label) => label.startsWith("verify:")),
    )
  }

  {
    const capped = await run({ websetId: "webset_test", maxVerify: 2 }, { collect: COLLECT_OK })
    check("diagnostic maxVerify is never deliverable", capped.result.deliveryEligible === false && capped.result.verified === 2)
    const truncated = await run({ websetId: "webset_test" }, { collect: { ...COLLECT_OK, truncated: true } })
    check("truncated collection is never deliverable", truncated.result.deliveryEligible === false && truncated.result.ingestTruncated === true)
  }

  {
    const composed = {
      searchQueries: ["one", "two"],
      criteria: COLLECT_OK.criteria,
      criteriaLabels: ["Current SWE", "Internal tools"],
      enrichments: COLLECT_OK.enrichmentColumns.map((description) => ({ description, format: "text" })),
    }
    const { calls, observations } = await run({ role: "role", candidate: "candidate", count: 40 }, { compose: composed, collect: COLLECT_OK })
    check("one create agent call creates the run Webset", calls.filter((x) => x === "create").length === 1)
    check("lifecycle operations use only lifecycle profile", observations.filter((x) => ["create", "collect"].includes(x.label) || x.label.startsWith("poll:") || x.label.startsWith("recheck:")).every((x) => x.opts.toolProfile === "websets-lifecycle"))
  }

  check("verification prompt does not demand a named public internal tool", !SRC.includes("named work product") && SRC.includes("private or unnamed"))
  check("workflow contains no filesystem-capable agent instructions", !SRC.includes("Write tool") && !SRC.includes("Bash tool") && !SRC.includes("store.annotate"))

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
})()
