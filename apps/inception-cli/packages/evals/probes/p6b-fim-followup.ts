import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { mercuryFetch } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })

const MODELS = ["mercury-coder", "mercury-edit-2"] as const

interface FimResult {
  model: string
  status: number
  bodySnippet: string
  completionTextPath: string | null
  completionText: unknown
}

async function probeFim(model: string): Promise<FimResult> {
  const res = await mercuryFetch(cfg, "/fim/completions", {
    model,
    prompt: "function add(",
    suffix: ") { return a + b }",
    max_tokens: 20
  })
  const text = await res.text()
  const bodySnippet = text.slice(0, 1000)

  let completionTextPath: string | null = null
  let completionText: unknown = null
  if (res.status === 200) {
    try {
      const json = JSON.parse(text)
      if (typeof json?.choices?.[0]?.text === "string") {
        completionTextPath = "choices[0].text"
        completionText = json.choices[0].text
      }
    } catch {
      /* body not JSON; leave path/text null */
    }
  }

  return { model, status: res.status, bodySnippet, completionTextPath, completionText }
}

const results: FimResult[] = []
for (const model of MODELS) {
  results.push(await probeFim(model))
}

const report = writeProbeReport("p6b-fim-followup", { results })
console.log("report:", report)
