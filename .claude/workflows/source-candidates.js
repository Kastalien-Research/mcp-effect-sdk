export const meta = {
  name: 'source-candidates',
  description: 'Recruiter pipeline: one Webset → complete-cohort independent verification → evidence-certified draft',
  whenToUse:
    'Source and independently verify a complete candidate cohort. Production delivery is performed later by evidence-finalize and requires an immutable receipt.',
  phases: [
    { title: 'Compose', detail: 'role + candidate spec → searches, must-have criteria, enrichments' },
    { title: 'Populate', detail: 'create or resume exactly one Webset and freeze its complete item manifest' },
    { title: 'Verify', detail: 'one evidence-linked dossier per unique candidate; no transcription stage' },
    { title: 'Summarize', detail: 'return CandidateRunDraftV2; trusted application code renders artifacts' },
  ],
}

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
A = A ?? {}

const POLICY_VERSION = 'verification-evidence/v1'
const COUNT = A.count ?? 100
const MAX_VERIFY = A.maxVerify
const VERIFY_CONCURRENCY = 4
const MODEL_REASONING = A.model ?? 'claude-sonnet-5'
const MODEL_CHEAP = A.cheapModel ?? 'claude-haiku-4-5-20251001'

if (A.outputCsv && (!/^[A-Za-z0-9._/ -]+\.csv$/.test(A.outputCsv) || A.outputCsv.includes('..'))) {
  return { schemaVersion: 2, policyVersion: POLICY_VERSION, deliveryEligible: false, error: 'outputCsv must be a plain .csv path with no "..".' }
}

const COMPOSE_SCHEMA = {
  type: 'object',
  required: ['searchQueries', 'criteria', 'enrichments'],
  properties: {
    searchQueries: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    criteria: { type: 'array', items: { type: 'string' }, minItems: 1 },
    criteriaLabels: { type: 'array', items: { type: 'string' } },
    enrichments: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', required: ['description'],
        properties: {
          description: { type: 'string' },
          format: { type: 'string', enum: ['text', 'number', 'date', 'email', 'phone', 'url', 'options'] },
          shortLabel: { type: 'string' },
        },
      },
    },
  },
}

const CREATE_SCHEMA = {
  type: 'object', required: ['websetId', 'searchesCreated'],
  properties: { websetId: { type: 'string' }, searchesCreated: { type: 'number' } },
}

const POLL_SCHEMA = {
  type: 'object', required: ['websetStatus', 'searchStatuses', 'found'],
  properties: {
    websetStatus: { type: 'string' },
    searchStatuses: { type: 'array', items: { type: 'string' } },
    found: { type: 'number' },
  },
}

const RECHECK_SCHEMA = {
  type: 'object', required: ['websetStatus', 'searchStatuses', 'found', 'definitionHash'],
  properties: {
    websetStatus: { type: 'string' },
    searchStatuses: { type: 'array', items: { type: 'string' } },
    found: { type: 'number' },
    definitionHash: { type: 'string' },
  },
}

const COLLECT_SCHEMA = {
  type: 'object',
  required: ['websetId', 'definitionArtifactId', 'definition', 'definitionHash', 'itemsArtifactId', 'itemsArtifactHash', 'captureProof', 'criteria', 'enrichmentColumns', 'truncated'],
  properties: {
    websetId: { type: 'string' },
    definitionArtifactId: { type: 'string' },
    definition: { type: 'object', additionalProperties: true },
    definitionHash: { type: 'string' },
    itemsArtifactId: { type: 'string' },
    itemsArtifactHash: { type: 'string' },
    captureProof: {
      type: 'object',
      required: ['total', 'included', 'excluded', 'ingested', 'mirrored', 'projectedItemIdsHash', 'mirroredItemIdsHash'],
      properties: {
        total: { type: 'number' }, included: { type: 'number' }, excluded: { type: 'number' },
        ingested: { type: 'number' }, mirrored: { type: 'number' },
        projectedItemIdsHash: { type: 'string' }, mirroredItemIdsHash: { type: 'string' },
      },
    },
    criteria: { type: 'array', items: { type: 'string' } },
    enrichmentColumns: { type: 'array', items: { type: 'string' } },
    truncated: { type: 'boolean' },
  },
}

const labelFor = (value) => value.length > 42 ? value.slice(0, 39).trimEnd() + '…' : value
const mapBounded = async (items, limit, work) => {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      try { results[index] = await work(items[index], index) } catch { results[index] = null }
    }
  })
  await Promise.all(workers)
  return results
}
const normalizeProfileUrl = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const u = new URL(value.trim())
    if (!['http:', 'https:'].includes(u.protocol) || u.hostname === '') return null
    u.hash = ''
    u.search = ''
    u.hostname = u.hostname.toLowerCase()
    u.pathname = u.pathname.replace(/\/+$/, '') || '/'
    return u.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}
const objectRows = (value) => Array.isArray(value)
  ? value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
  : []
const sourceId = (entry) => {
  for (const key of ['id', 'criterionId', 'criterion_id', 'enrichmentId', 'enrichment_id']) {
    if (typeof entry?.[key] === 'string' && entry[key].length > 0) return entry[key]
  }
  return null
}
const definitionColumns = (definition) => {
  const searches = objectRows(definition?.searches)
  const webset = definition?.webset && typeof definition.webset === 'object' ? definition.webset : definition
  const criterionRows = objectRows(searches[0]?.criteria)
  const enrichmentRows = objectRows(webset?.enrichments)
  return {
    criteria: criterionRows.map((entry, index) => ({ index, id: sourceId(entry), description: entry.description })),
    enrichments: enrichmentRows.map((entry, index) => ({ index, id: sourceId(entry), description: entry.description })),
  }
}

let websetId = A.websetId ?? null
let composed = null

if (!websetId) {
  if (!A.role || !A.candidate) {
    return { schemaVersion: 2, policyVersion: POLICY_VERSION, deliveryEligible: false, error: 'Pass {role, candidate} or {websetId}.' }
  }
  phase('Compose')
  composed = await agent(
    `Translate this recruiter request into one Exa people Webset. Do not call tools.\n\n` +
      `JOB DESCRIPTION\n${A.role}\n\nIDEAL CANDIDATE\n${A.candidate}\n\n` +
      `Return 2-4 complementary searchQueries; 3-4 broad, objective MUST-HAVE criteria; and at most 10 ` +
      `enrichments. Every criterion is a hard inclusion requirement later. Preferences must influence the first ` +
      `query but remain enrichments, not criteria. Location stated as an allowed set (for example SF OR Remote ` +
      `Americas) must be preserved exactly as one criterion. Always include current title, employer, location, ` +
      `email, phone, professional URL, years of experience, and degrees/institutions before role-specific ` +
      `enrichments. Internal professional work may be private or unnamed: never demand a public product name, ` +
      `repository, or third-party article unless the request explicitly does. Give each criterion a <=5 word ` +
      `criteriaLabel and each enrichment a <=4 word shortLabel.`,
    { label: 'compose', phase: 'Compose', schema: COMPOSE_SCHEMA, model: MODEL_REASONING, toolProfile: 'none', policyVersion: POLICY_VERSION },
  )
  if (!composed) return { schemaVersion: 2, policyVersion: POLICY_VERSION, deliveryEligible: false, error: 'Compose stage produced no definition.' }
  if (composed.enrichments.length > 10) composed.enrichments = composed.enrichments.slice(0, 10)
}

phase('Populate')
if (!websetId) {
  const created = await agent(
    `Use only the Websets lifecycle tools. Call create_webset exactly once for this run with title ` +
      `${JSON.stringify('source-candidates: ' + String(A.role).slice(0, 60))}, searchQuery ` +
      `${JSON.stringify(composed.searchQueries[0])}, searchCount ${COUNT}, entity {type:'person'}, criteria ` +
      `${JSON.stringify(composed.criteria.map((description) => ({ description })))}, and enrichments ` +
      `${JSON.stringify(composed.enrichments)}. The application supplies the immutable run identity and makes ` +
      `creation idempotent. For each remaining query call add_webset_search once with behavior 'append', count ` +
      `${COUNT}, entity {type:'person'}, and the same criteria. Do not poll. Return the exact websetId and total ` +
      `searchesCreated.`,
    { label: 'create', phase: 'Populate', schema: CREATE_SCHEMA, model: MODEL_CHEAP, toolProfile: 'websets-lifecycle', policyVersion: POLICY_VERSION },
  )
  if (!created || !/^webset_[a-z0-9]+$/i.test(created.websetId ?? '')) {
    return { schemaVersion: 2, policyVersion: POLICY_VERSION, deliveryEligible: false, error: 'Webset creation did not return a valid id.', detail: created }
  }
  websetId = created.websetId
}

const TERMINAL_SEARCH_STATES = ['completed', 'canceled']
const allSearchesDone = (statuses) => Array.isArray(statuses) && statuses.length > 0 && statuses.every((s) => TERMINAL_SEARCH_STATES.includes(String(s).toLowerCase()))
const websetIsIdle = (status, statuses) => String(status).toLowerCase() === 'idle' && allSearchesDone(statuses)
const columnsFingerprint = (definition) => {
  const cols = definitionColumns(definition)
  return JSON.stringify({
    criteria: cols.criteria.map((entry) => ({ id: entry.id ?? null, description: entry.description })),
    enrichments: cols.enrichments.map((entry) => ({ id: entry.id ?? null, description: entry.description })),
  })
}
const cohortFingerprint = (collected) =>
  JSON.stringify(
    (Array.isArray(collected?.items) ? collected.items : [])
      .map((item) => [item?.itemId ?? '', item?.rawSnapshotHash ?? ''])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  )
const MAX_POLLS = 150
let polls = 0
let lastFound = 0
let lastStatuses = []
let lastWebsetStatus = 'unknown'
let missingStreak = 0
while (!websetIsIdle(lastWebsetStatus, lastStatuses) && polls < MAX_POLLS) {
  polls++
  const poll = await agent(
    `Call wait_for_webset exactly once for webset ${websetId}, with timeout 100000 and pollInterval 5000. ` +
      `Return raw websetStatus, searches[].status in order, and the sum of searches[].progress.found. Do not ` +
      `decide completion yourself and do not call another tool.`,
    { label: `poll:${polls}`, phase: 'Populate', schema: POLL_SCHEMA, model: MODEL_CHEAP, toolProfile: 'websets-lifecycle', policyVersion: POLICY_VERSION, subject: { websetId } },
  )
  missingStreak = poll?.websetStatus === 'missing' ? missingStreak + 1 : 0
  if (missingStreak >= 3) return { schemaVersion: 2, policyVersion: POLICY_VERSION, websetId, deliveryEligible: false, error: `Webset ${websetId} was not found.` }
  lastWebsetStatus = typeof poll?.websetStatus === 'string' ? poll.websetStatus : 'unknown'
  lastStatuses = Array.isArray(poll?.searchStatuses) ? poll.searchStatuses : []
  if (typeof poll?.found === 'number') lastFound = poll.found
}
const populationComplete = websetIsIdle(lastWebsetStatus, lastStatuses)
if (!populationComplete) {
  return { schemaVersion: 2, policyVersion: POLICY_VERSION, websetId, deliveryEligible: false, error: 'Webset did not become idle with every search terminal.' }
}

const collectItems = () => agent(
  `Freeze the complete cohort for webset ${websetId}. Call list_webset_items exactly once with ingest:true ` +
    `(default maxItems is fine; do not lower it). It returns compact captureProof, itemIdentities, and ` +
    `itemsArtifactId/itemsArtifactHash — not full raw item bodies. Call get_webset_definition exactly once and ` +
    `retain its definitionArtifactId. Return the artifact ids, content hashes, captureProof, exact Webset ` +
    `definition, exact ordered criterion descriptions, exact ordered enrichment descriptions, and the list ` +
    `operation's raw truncated boolean. Do not echo, transcribe, or fabricate item bodies; the host completion ` +
    `carries the frozen cohort from the items artifact.`,
  { label: 'collect', phase: 'Populate', schema: COLLECT_SCHEMA, model: MODEL_REASONING, toolProfile: 'websets-lifecycle', policyVersion: POLICY_VERSION, subject: { websetId } },
)

let collected = null
let manifestStable = false
let lastCohortFingerprint = null
let lastColumnsFingerprint = null
for (let attempt = 1; attempt <= 12; attempt++) {
  collected = await collectItems()
  if (!collected || !Array.isArray(collected.items)) break
  const recheck = await agent(
    `Call get_webset_definition exactly once for ${websetId}. Return raw websetStatus, ordered searchStatuses, ` +
      `the sum of search progress.found, and definitionHash. Do not decide stability.`,
    { label: `recheck:${attempt}`, phase: 'Populate', schema: RECHECK_SCHEMA, model: MODEL_CHEAP, toolProfile: 'websets-lifecycle', policyVersion: POLICY_VERSION, subject: { websetId } },
  )
  // A recheck without a numeric found cannot prove stability (fail closed),
  // but it must not poison the count comparison with a sentinel: comparison
  // and update use the same value, so an inconclusive recheck retries against
  // the real lastFound instead of manufacturing movement forever.
  const nextFound = typeof recheck?.found === 'number' ? recheck.found : null
  const nextStatuses = Array.isArray(recheck?.searchStatuses) ? recheck.searchStatuses : []
  const nextWebsetStatus = typeof recheck?.websetStatus === 'string' ? recheck.websetStatus : 'unknown'
  // Freeze on cohort identity, not websetStatus===idle and not Exa's webset-level
  // enrichment statuses (those stay "pending" even after item enrichment results
  // complete). Two consecutive collects with the same item rawSnapshot hashes,
  // stable columns, stable found count, and terminal searches certify the freeze.
  const nextCohortFingerprint = cohortFingerprint(collected)
  const nextColumnsFingerprint = columnsFingerprint(collected.definition)
  // Host lifecycleCompletion always returns definition on recheck; missing
  // definition fails closed as movement rather than skipping the column check.
  const recheckColumnsFingerprint = recheck?.definition
    ? columnsFingerprint(recheck.definition)
    : null
  const moved = nextFound === null || nextFound !== lastFound || !allSearchesDone(nextStatuses) ||
    lastCohortFingerprint === null || nextCohortFingerprint !== lastCohortFingerprint ||
    lastColumnsFingerprint === null || nextColumnsFingerprint !== lastColumnsFingerprint ||
    recheckColumnsFingerprint === null || recheckColumnsFingerprint !== nextColumnsFingerprint
  lastCohortFingerprint = nextCohortFingerprint
  lastColumnsFingerprint = nextColumnsFingerprint
  if (!moved) {
    manifestStable = true
    break
  }
  if (nextFound !== null) lastFound = nextFound
  lastStatuses = nextStatuses
  lastWebsetStatus = nextWebsetStatus
}

if (!collected || !Array.isArray(collected.items)) {
  return { schemaVersion: 2, policyVersion: POLICY_VERSION, websetId, deliveryEligible: false, error: 'Complete item collection failed.' }
}
if (!manifestStable) {
  return { schemaVersion: 2, policyVersion: POLICY_VERSION, websetId, deliveryEligible: false, error: 'Webset changed during manifest freeze; no stable cohort was certified.' }
}

const frozenColumns = definitionColumns(collected.definition)
const criteriaCols = frozenColumns.criteria
const enrichCols = frozenColumns.enrichments
const returnedCriteria = Array.isArray(collected.criteria) ? collected.criteria : []
const returnedEnrichments = Array.isArray(collected.enrichmentColumns) ? collected.enrichmentColumns : []
if (
  criteriaCols.length === 0 || criteriaCols.some((entry) => typeof entry.description !== 'string' || entry.description.length === 0) ||
  enrichCols.some((entry) => typeof entry.description !== 'string' || entry.description.length === 0) ||
  JSON.stringify(criteriaCols.map((entry) => entry.description)) !== JSON.stringify(returnedCriteria) ||
  JSON.stringify(enrichCols.map((entry) => entry.description)) !== JSON.stringify(returnedEnrichments)
) {
  return { schemaVersion: 2, policyVersion: POLICY_VERSION, websetId, deliveryEligible: false, error: 'Canonical columns did not reconstruct exactly from the frozen Webset definition.' }
}

const criteriaLabelMap = new Map((composed?.criteria ?? []).map((criterion, index) => [criterion.toLowerCase(), composed?.criteriaLabels?.[index]]))
const enrichLabelMap = new Map((composed?.enrichments ?? []).filter((e) => e.shortLabel).map((e) => [e.description.toLowerCase(), e.shortLabel]))
const criteria = criteriaCols.map(({ index, id, description }) => ({ index, id, description, label: criteriaLabelMap.get(description.toLowerCase()) ?? labelFor(description) }))
const enrichments = enrichCols.map(({ index, id, description }) => ({ index, id, description, label: enrichLabelMap.get(description.toLowerCase()) ?? labelFor(description) }))

// Item id is canonical. Only an exact normalized profile URL may establish an
// alias. Name equality is never identity resolution.
const urlOwners = new Map()
const candidateByItemId = new Map()
const candidates = []
const duplicates = []
for (const item of collected.items) {
  const normalizedUrl = normalizeProfileUrl(item.url)
  const owner = normalizedUrl ? urlOwners.get(normalizedUrl) : null
  if (owner) {
    duplicates.push({ itemId: item.itemId, canonicalItemId: owner, reason: 'same_normalized_profile_url', normalizedUrl })
    const canonical = candidateByItemId.get(owner)
    if (canonical) {
      canonical.aliases.push({
        itemId: item.itemId,
        name: item.name,
        ...(item.url ? { url: item.url } : {}),
        rawSnapshot: item.rawSnapshot,
        rawSnapshotHash: item.rawSnapshotHash,
        references: Array.isArray(item.references) ? item.references : [],
      })
      canonical.references.push(...(Array.isArray(item.references) ? item.references : []))
    }
    continue
  }
  if (normalizedUrl) urlOwners.set(normalizedUrl, item.itemId)
  const candidate = {
    itemId: item.itemId,
    name: item.name,
    ...(item.url ? { url: item.url } : {}),
    normalizedUrl,
    rawSnapshot: item.rawSnapshot,
    rawSnapshotHash: item.rawSnapshotHash,
    references: Array.isArray(item.references) ? item.references : [],
    aliases: [],
  }
  candidates.push(candidate)
  candidateByItemId.set(item.itemId, candidate)
}

const toVerify = MAX_VERIFY == null ? candidates : candidates.slice(0, Math.max(0, MAX_VERIFY))
const canonicalToolContext = {
  policyVersion: POLICY_VERSION,
  websetId,
  definitionArtifactId: collected.definitionArtifactId,
  definitionHash: collected.definitionHash,
  itemsArtifactId: collected.itemsArtifactId,
  itemsArtifactHash: collected.itemsArtifactHash,
  criteria,
  enrichments,
}

const hasEvidence = (entry) => Array.isArray(entry?.evidence) && entry.evidence.length > 0 && entry.evidence.every((link) => typeof link?.artifactId === 'string')
const hasOwn = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key)
const completeDossier = (dossier, item) => {
  if (!dossier || dossier.schemaVersion !== 1 || dossier.policyVersion !== POLICY_VERSION) return false
  if (dossier.itemId !== item.itemId || dossier.websetId !== websetId || dossier.name !== item.name) return false
  if (typeof dossier.identity?.confirmed !== 'boolean' || !hasEvidence(dossier.identity)) return false
  if (!Array.isArray(dossier.criteria) || dossier.criteria.length !== criteria.length) return false
  if (!criteria.every((canonical, index) => {
    const claim = dossier.criteria[index]
    return claim?.index === index && claim?.description === canonical.description && ['Match', 'Miss', 'Unclear'].includes(claim?.verdict) && typeof claim?.interviewFollowUp === 'boolean' && hasEvidence(claim)
  })) return false
  if (!Array.isArray(dossier.enrichments) || dossier.enrichments.length !== enrichments.length) return false
  if (!enrichments.every((canonical, index) => {
    const claim = dossier.enrichments[index]
    return claim?.index === index && claim?.description === canonical.description && ['confirmed', 'corrected', 'disputed', 'unverifiable'].includes(claim?.verdict) && hasOwn(claim, 'originalValue') && hasOwn(claim, 'verifiedValue') && typeof claim?.interviewFollowUp === 'boolean' && hasEvidence(claim)
  })) return false
  if (!Array.isArray(dossier.websetReferenceDispositions)) return false
  const expectedReferences = (item.references ?? []).map((entry) => entry.referenceKey).sort()
  const accountedReferences = dossier.websetReferenceDispositions.map((entry) => entry?.referenceKey).filter(Boolean).sort()
  return JSON.stringify(accountedReferences) === JSON.stringify(expectedReferences)
}

const verifyOne = (item, retry = false) => agent(
  `Independently verify candidate "${item.name}" (item "${item.itemId}", webset "${websetId}"` +
    `${item.url ? `, profile ${item.url}` : ''}). The exact canonical criteria and enrichments are provided to ` +
    `your tools. Every criterion is a must-have.\n\n` +
    `1. Call get_candidate_claims and get_webset_definition. Read the Websets value, its evaluation reasoning, ` +
    `and every reference backing every cell; these are claims to audit, not final truth.\n` +
    `2. Establish same-person identity using search_people and relevant profile anchors.\n` +
    `3. Inspect every Websets reference with get_contents, or record a fetch-failed/unavailable disposition. ` +
    `Use search_web/search_people and get_contents for independent corroboration or contradiction.\n` +
    `4. Evaluate every canonical criterion as Match, Miss, or Unclear and every enrichment as confirmed, ` +
    `corrected, disputed, or unverifiable. Preserve the model judgment you actually reach. Do not turn a Match ` +
    `into Unclear merely because work was private: detailed, internally consistent work history tied to a ` +
    `verified role can support private or unnamed internal work, with interview follow-up where appropriate. ` +
    `Check date arithmetic, name collisions, authorship, licenses, and fabricated identifiers.\n` +
    `5. Call submit_verification exactly once. Copy each criterion websetSaid value and each enrichment ` +
    `originalValue exactly from the frozen raw Websets row; do not normalize or paraphrase them. Include exact ` +
    `item/webset identity, identity conclusion, one claim ` +
    `per canonical criterion and enrichment in order, an interviewFollowUp boolean on every claim, rationale ` +
    `and artifact links for every conclusion, and one ` +
    `disposition for every Websets reference. Do not use a prose answer as completion.`,
  {
    label: `verify:${item.name}${retry ? ':retry' : ''}`,
    phase: 'Verify', model: MODEL_REASONING, toolProfile: 'candidate-verification',
    policyVersion: POLICY_VERSION,
    subject: { recordId: A.recordId, websetId, itemId: item.itemId },
    toolContext: { ...canonicalToolContext, item },
  },
)

phase('Verify')
let dossiers = (await mapBounded(toVerify, VERIFY_CONCURRENCY, (item) => verifyOne(item, false)))
  .map((dossier, index) => completeDossier(dossier, toVerify[index]) ? dossier : null)
  .filter(Boolean)
const firstPassIds = new Set(dossiers.map((dossier) => dossier.itemId))
const retryItems = toVerify.filter((item) => !firstPassIds.has(item.itemId))
if (retryItems.length > 0) {
  const retried = await mapBounded(retryItems, VERIFY_CONCURRENCY, (item) => verifyOne(item, true))
  for (let index = 0; index < retryItems.length; index++) {
    if (completeDossier(retried[index], retryItems[index])) dossiers.push(retried[index])
  }
}

const dossierIds = new Set(dossiers.map((dossier) => dossier.itemId))
const unverified = toVerify.filter((item) => !dossierIds.has(item.itemId)).map(({ itemId, name }) => ({ itemId, name }))
dossiers = dossiers.map((dossier) => ({
  ...dossier,
  included: dossier.identity.confirmed === true && dossier.criteria.every((claim) => claim.verdict === 'Match'),
}))
const validated = dossiers.filter((dossier) => dossier.included)
const rejected = dossiers.filter((dossier) => !dossier.included)

phase('Summarize')
const [report, emailSummary] = await parallel([
  () => agent(
    `Write a concise recruiter report from these already-completed dossiers. Do not call tools and do not ` +
      `change any verdict. ${dossiers.length}/${candidates.length} unique candidates have dossiers; ` +
      `${validated.length} satisfy every must-have. Discuss the top included candidates and recurring ` +
      `discrepancies.\n\n${JSON.stringify(dossiers.map((d) => ({ name: d.name, included: d.included, confidence: d.confidence, notes: d.notes })), null, 2)}`,
    { label: 'report', phase: 'Summarize', model: MODEL_REASONING, toolProfile: 'none', policyVersion: POLICY_VERSION },
  ),
  () => agent(
    `Write the client-facing email body for a sourcing delivery. Do not call tools and do not change any ` +
      `verdict. State that ${validated.length} candidates satisfy every must-have out of ${dossiers.length} ` +
      `independently reviewed. Include a short top-candidates table and explain that the attached CSV contains ` +
      `included candidates while the attached JSON evidence bundle covers the complete reviewed cohort with ` +
      `source links, corrections, disputes, and unverifiable fields. Avoid internal system jargon.\n\n` +
      JSON.stringify(validated.slice(0, 5).map((d) => ({ name: d.name, confidence: d.confidence, notes: d.notes, enrichments: d.enrichments })), null, 2),
    { label: 'email-summary', phase: 'Summarize', model: MODEL_REASONING, toolProfile: 'none', policyVersion: POLICY_VERSION },
  ),
])

const deliveryEligible =
  populationComplete && manifestStable && !collected.truncated && MAX_VERIFY == null &&
  typeof collected.definitionArtifactId === 'string' && typeof collected.definitionHash === 'string' &&
  typeof collected.itemsArtifactId === 'string' && typeof collected.itemsArtifactHash === 'string' &&
  collected.captureProof && typeof collected.captureProof === 'object' &&
  collected.items.every((item) => item?.rawSnapshot && typeof item?.rawSnapshotHash === 'string' && Array.isArray(item?.references)) &&
  unverified.length === 0 && dossiers.length === candidates.length

return {
  schemaVersion: 2,
  policyVersion: POLICY_VERSION,
  recordId: A.recordId ?? null,
  runKey: A.runKey ?? null,
  websetId,
  deliveryEligible,
  manifest: {
    recordId: A.recordId ?? null,
    runKey: A.runKey ?? null,
    websetId,
    populationComplete,
    definitionArtifactId: collected.definitionArtifactId,
    definition: collected.definition,
    definitionHash: collected.definitionHash,
    itemsArtifactId: collected.itemsArtifactId,
    itemsArtifactHash: collected.itemsArtifactHash,
    captureProof: collected.captureProof,
    criteria,
    enrichments,
    items: collected.items,
    candidates,
    duplicates,
    truncated: !!collected.truncated,
    diagnosticMaxVerify: MAX_VERIFY ?? null,
    requestedOutputCsv: A.outputCsv ?? null,
  },
  dossiers,
  found: collected.items.length,
  ingestTruncated: !!collected.truncated,
  uniqueCandidates: candidates.length,
  verified: dossiers.length,
  validated: validated.length,
  rejected: rejected.length,
  unverified,
  report: typeof report === 'string' ? report : '',
  emailSummary: typeof emailSummary === 'string' ? emailSummary : '',
}
