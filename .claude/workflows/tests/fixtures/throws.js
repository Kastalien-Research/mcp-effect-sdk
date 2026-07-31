// Fixture workflow for test/runner-journal.test.ts (headless-v1 A1/runner-core).
// Makes one agent() call directly at the top level (not inside pipeline/parallel,
// so a rejection is NOT swallowed to null) then throws.
export const meta = { name: 'throws', description: 'test fixture: throws after one agent call' }

await agent('will throw after this', { label: 'before-throw' })
throw new Error('fixture: intentional throw')
