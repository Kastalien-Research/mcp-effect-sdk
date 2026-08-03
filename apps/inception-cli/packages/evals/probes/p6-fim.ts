import { readFileSync } from "node:fs"
import { join } from "node:path"
import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { mercuryFetch } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })

async function probeEndpoint(path: string, body: unknown) {
  const res = await mercuryFetch(cfg, path, body)
  const text = await res.text()
  return { path, status: res.status, bodySnippet: text.slice(0, 500) }
}

const completionsFim = await probeEndpoint("/completions", {
  model: MERCURY_MODEL,
  prompt: "function add(",
  suffix: ") { return a + b }",
  max_tokens: 20
})

const fimCompletions = await probeEndpoint("/fim/completions", {
  model: MERCURY_MODEL,
  prompt: "function add(",
  suffix: ") { return a + b }",
  max_tokens: 20
})

const edits = await probeEndpoint("/edits", {
  model: MERCURY_MODEL,
  input: "const x=1",
  instruction: "rename x to y"
})

// Local re-scan of the P0 /models fixture for edit/coder-suffixed model ids.
// No new API call — reads the already-committed fixture file.
const p0Path = join(
  process.cwd(),
  "fixtures",
  "probes",
  "p0-models.json"
)
const p0 = JSON.parse(readFileSync(p0Path, "utf8"))
const modelIds: string[] = (p0.data?.body?.data ?? []).map(
  (m: { id: string }) => m.id
)
const editOrCoderModelIds = modelIds.filter((id) => /edit|coder/i.test(id))
const modelIdRescan = { modelIds, editOrCoderModelIds }

const report = writeProbeReport("p6-fim", {
  model: MERCURY_MODEL,
  candidates: { completionsFim, fimCompletions, edits },
  modelIdRescan
})
console.log("report:", report)
