// Minimal fixture workflow for test/step-runner.test.ts — no agent calls,
// just echoes its resolved args back so the test can assert deferred-token
// substitution and timing threading without a real source-candidates run.
export const meta = { name: 'trivial' }
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
if (A?.callAgent) {
  return { agentResult: await agent('test agent call', { label: 'test-agent' }) }
}
return { receivedArgs: A ?? null }
