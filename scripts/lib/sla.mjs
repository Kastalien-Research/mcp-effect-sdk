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
