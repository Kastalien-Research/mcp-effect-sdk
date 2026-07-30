// Pure SLA arithmetic for the maintenance evidence generator.
//
// This lives apart from scripts/generate-tier-maintenance.mjs so it can be
// tested offline. The generator is a CLI with top-level side effects — it
// shells out to `gh` and writes evidence — so importing it from a test would
// make the test suite hit the network and mutate artifacts.
// MAINTENANCE.md defines business days as Monday–Friday in America/Chicago,
// excluding United States federal holidays. Computing them in UTC would shift
// the boundary by up to six hours and silently mark a response late, so the
// weekday is read in the policy's own timezone.
const CHICAGO = "America/Chicago"
/**
 * Start of a policy effective date in America/Chicago.
 *
 * The generator and `check-tier-operations.mjs` must agree to the millisecond:
 * the generator previously parsed this date as UTC midnight while the checker
 * used Chicago midnight, so an issue opened between 00:00Z and 05:00Z on the
 * effective date was emitted by the generator and then rejected by the checker
 * as retroactive. Sharing one definition makes that disagreement unexpressible.
 */
export const policyEffectiveInstant = (policyEffectiveDate) => Date.parse(`${policyEffectiveDate}T00:00:00-05:00`)

export const chicagoDayKey = (instant) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: CHICAGO, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant
  )
export const chicagoWeekday = (instant) =>
  new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, weekday: "short" }).format(instant)

// Observed US federal holidays. Extend as the ledger accrues years; an absent
// year would silently treat its holidays as business days, so the generator
// refuses to compute a deadline it cannot ground (below).
export const FEDERAL_HOLIDAYS = new Set([
  // 2026
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-10-12",
  "2026-11-11",
  "2026-11-26",
  "2026-12-25",
  // 2027
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-10-11",
  "2027-11-11",
  "2027-11-25",
  "2027-12-24"
])
export const COVERED_HOLIDAY_YEARS = new Set(["2026", "2027"])

export const isBusinessDay = (instant) => {
  const weekday = chicagoWeekday(instant)
  if (weekday === "Sat" || weekday === "Sun") return false
  return !FEDERAL_HOLIDAYS.has(chicagoDayKey(instant))
}

/** N business days after an instant, in the policy's timezone. */
export const addBusinessDays = (from, days) => {
  const cursor = new Date(from)
  let remaining = days
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (isBusinessDay(cursor)) remaining -= 1
  }
  return cursor
}

/**
 * Classify one SLA outcome.
 *
 * Three states, and the closed-late case is the one that is easy to lose: an
 * issue closed *after* its deadline is the paradigm miss, but a naive "overdue
 * means still open past the deadline" test silently files it as pending. That
 * mistake only surfaces once something is actually closed late, which an empty
 * ledger can never reveal — so it is a pure function with its own test.
 */
export const classifyOutcome = ({ closedAt, deadlineAt, now }) => {
  const met = closedAt !== undefined && closedAt <= deadlineAt
  const closedLate = closedAt !== undefined && closedAt > deadlineAt
  const openPastDeadline = closedAt === undefined && now > deadlineAt
  return { met, closedLate, openPastDeadline, overdue: closedLate || openPastDeadline }
}

/** Classify any timeline metric with an optional observed event. */
export const classifyTimedOutcome = ({ observedAt, deadlineAt, now }) =>
  classifyOutcome({ closedAt: observedAt, deadlineAt, now })

/** Return the earliest valid GitHub timeline event satisfying `predicate`. */
export const firstTimelineEvent = (events, predicate) =>
  events
    .filter(
      (event) =>
        event !== null &&
        typeof event === "object" &&
        typeof event.created_at === "string" &&
        Number.isFinite(Date.parse(event.created_at)) &&
        predicate(event)
    )
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))[0]

const firstRecordedEvent = (events, issue, predicate) =>
  events
    .filter(
      (event) =>
        event.issue === issue &&
        typeof event.eventAt === "string" &&
        Number.isFinite(Date.parse(event.eventAt)) &&
        predicate(event)
    )
    .sort(
      (left, right) =>
        Date.parse(left.eventAt) - Date.parse(right.eventAt) || String(left.id).localeCompare(String(right.id))
    )[0]

const metricEntry = ({ issue, metric, startAt, deadlineAt, observedAt, startEvent, observedEvent, now }) => {
  const outcome = classifyTimedOutcome({ observedAt, deadlineAt, now })
  const status = outcome.met ? "met" : outcome.overdue ? "missed" : "pending"
  const clock = metric === "triage-first-label" ? "creation to first label" : "first P0 label to closure"
  const details =
    observedAt === undefined
      ? `${clock}: no qualifying event observed; deadline ${deadlineAt.toISOString()}.`
      : `${clock}: observed ${observedAt.toISOString()}; deadline ${deadlineAt.toISOString()}.`
  return {
    id: `issue-${issue.number}-${metric}`,
    metric,
    issue: { number: issue.number, url: issue.url },
    startAt: startAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    observedAt: observedAt?.toISOString() ?? null,
    startEvent,
    observedEvent,
    status,
    details,
    requirementIds: ["GR-TIER-002"]
  }
}

export const summarizeMetricEntries = (entries, threshold) => {
  const total = entries.length
  const met = entries.filter((entry) => entry.status === "met").length
  const missed = entries.filter((entry) => entry.status === "missed").length
  const pending = entries.filter((entry) => entry.status === "pending").length
  const complianceRate = total === 0 ? 1 : met / total
  return {
    total,
    met,
    missed,
    pending,
    complianceRate,
    passed: threshold === undefined ? met === total : complianceRate >= threshold
  }
}

/**
 * Derive the official Tier maintenance scorecard from append-only GitHub facts.
 *
 * Triage uses the requested rolling issue-creation window and the Tier 1
 * threshold of at least 90%. P0 uses every exact P0-label event since the local
 * policy effective date; an open P0 is not counted as resolved. Historical
 * misses remain in the separate fact ledger after they leave the rolling
 * triage window.
 */
export const deriveMaintenanceScorecard = ({
  history,
  collectedAt,
  windowDays,
  triageBusinessDays,
  p0ResolutionCalendarDays,
  triageComplianceThreshold,
  relegationMonths
}) => {
  const now = new Date(collectedAt)
  const rollingStart = new Date(now.getTime() - windowDays * 86400000)
  const policyEffectiveAt = new Date(policyEffectiveInstant(history.policyEffectiveDate))
  const events = history.events

  const triageEntries = history.issues
    .filter((issue) => new Date(issue.createdAt) >= rollingStart)
    .map((issue) => {
      const startAt = new Date(issue.createdAt)
      const firstLabel = firstRecordedEvent(events, issue.number, (event) => event.kind === "labeled")
      const observedAt = firstLabel === undefined ? undefined : new Date(firstLabel.eventAt)
      return metricEntry({
        issue,
        metric: "triage-first-label",
        startAt,
        deadlineAt: addBusinessDays(startAt, triageBusinessDays),
        observedAt,
        startEvent: { kind: "created", eventAt: issue.createdAt },
        observedEvent:
          firstLabel === undefined ? null : { kind: "labeled", label: firstLabel.label, eventAt: firstLabel.eventAt },
        now
      })
    })

  const p0Entries = events
    .filter((event) => event.kind === "labeled" && event.label === "P0" && new Date(event.eventAt) >= policyEffectiveAt)
    .filter(
      (event, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.issue === event.issue &&
            (Date.parse(candidate.eventAt) < Date.parse(event.eventAt) ||
              (candidate.eventAt === event.eventAt && String(candidate.id).localeCompare(String(event.id)) <= 0))
        ) === index
    )
    .map((firstP0) => {
      const issue = history.issues.find((candidate) => candidate.number === firstP0.issue)
      if (issue === undefined) {
        throw new Error(`P0 event ${firstP0.id} references missing issue ${firstP0.issue}`)
      }
      const startAt = new Date(firstP0.eventAt)
      const firstClose = firstRecordedEvent(
        events,
        issue.number,
        (event) => event.kind === "closed" && Date.parse(event.eventAt) >= startAt.getTime()
      )
      const observedAt = firstClose === undefined ? undefined : new Date(firstClose.eventAt)
      return metricEntry({
        issue,
        metric: "p0-resolution",
        startAt,
        deadlineAt: new Date(startAt.getTime() + p0ResolutionCalendarDays * 86400000),
        observedAt,
        startEvent: { kind: "labeled", label: "P0", eventAt: firstP0.eventAt },
        observedEvent: firstClose === undefined ? null : { kind: "closed", eventAt: firstClose.eventAt },
        now
      })
    })

  const entries = [...triageEntries, ...p0Entries].sort(
    (left, right) => left.issue.number - right.issue.number || left.metric.localeCompare(right.metric)
  )
  const triage = summarizeMetricEntries(triageEntries, triageComplianceThreshold)
  const p0Resolution = summarizeMetricEntries(p0Entries)
  const relegationHorizon = history.issues
    .filter((issue) => firstRecordedEvent(events, issue.number, (event) => event.kind === "labeled") === undefined)
    .map((issue) => {
      const deadline = new Date(issue.createdAt)
      deadline.setUTCMonth(deadline.getUTCMonth() + relegationMonths)
      return {
        issue: issue.number,
        url: issue.url,
        openedAt: issue.createdAt,
        relegationAt: deadline.toISOString(),
        daysRemaining: Math.ceil((deadline.getTime() - now.getTime()) / 86400000)
      }
    })
    .sort((left, right) => left.daysRemaining - right.daysRemaining || left.issue - right.issue)

  return {
    window: {
      days: windowDays,
      startAt: rollingStart.toISOString()
    },
    entries,
    triage,
    p0Resolution,
    passed: triage.passed && p0Resolution.passed,
    relegationHorizon
  }
}

/**
 * Preserve already-recorded GitHub facts byte-for-byte while admitting newly
 * observed issues and timeline events.
 */
export const mergeImmutableHistory = (previous, current) => {
  const currentIssues = new Map(current.issues.map((issue) => [issue.number, issue]))
  for (const issue of previous.issues) {
    if (JSON.stringify(currentIssues.get(issue.number)) !== JSON.stringify(issue)) {
      throw new Error(`Previously recorded issue #${issue.number} changed or disappeared`)
    }
  }

  const currentEvents = new Map(current.events.map((event) => [event.id, event]))
  for (const event of previous.events) {
    if (JSON.stringify(currentEvents.get(event.id)) !== JSON.stringify(event)) {
      throw new Error(`Previously recorded timeline event ${event.id} changed or disappeared`)
    }
  }

  return {
    ...current,
    issues: [...current.issues].sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.number - right.number
    ),
    events: [...current.events].sort(
      (left, right) =>
        Date.parse(left.eventAt) - Date.parse(right.eventAt) || String(left.id).localeCompare(String(right.id))
    )
  }
}
