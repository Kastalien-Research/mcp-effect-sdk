// Fixture workflow for test/runner-journal.test.ts (headless-v1 A1/runner-core).
// Makes N sequential agent() calls, each labeled by its index, and returns the
// list of outputs plus the values the harness threads through (budget totals).
// Deliberately tiny and deterministic so journal replay/divergence/budget
// behavior can be asserted without depending on source-candidates.js.
export const meta = { name: 'counter', description: 'test fixture: N sequential agent calls' }

const n = args?.n ?? 3
const label = args?.label ?? 'step'
const out = []
for (let i = 0; i < n; i++) {
  const v = await agent(`call ${i}`, { label: `${label}:${i}` })
  out.push(v)
}
return { out, budgetTotal: budget.total, budgetRemaining: budget.remaining() }
