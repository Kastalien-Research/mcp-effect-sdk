// Fixture for test/runner-parallel-replay.test.ts. Runs a bounded-concurrency
// verify phase (per-item subject, VERBATIM copy of source-candidates.js:100
// mapBounded) followed by an OPTIONAL throw in a later "summarize" phase. Pins
// the invariant that agent() seq is assigned by item index under bounded
// concurrency — not by model-completion order — so a run whose bounded phase
// completed out of order still replays cleanly on resume.
export const meta = { name: 'parallel-verify', description: 'bounded verify phase, optional summarize throw' }

const items = args?.items ?? []
const limit = args?.limit ?? 4
const throwInSummarize = args?.throwInSummarize ?? false

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

const out = await mapBounded(items, limit, (item) =>
  agent(`verify ${item.itemId}`, {
    label: `verify:${item.itemId}`,
    subject: { recordId: 'rec1', websetId: 'ws1', itemId: item.itemId },
  })
)

if (throwInSummarize) throw new Error('transient summarize failure')
return { out }
