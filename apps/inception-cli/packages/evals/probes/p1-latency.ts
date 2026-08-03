import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { streamChat } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })
const filler = "export const x = 1; // synthetic line of code padding\n".repeat(3000)
const tools = Array.from({ length: 8 }, (_, i) => ({
  type: "function",
  function: {
    name: `tool_${i}`,
    description: `Synthetic tool number ${i} for schema-weight testing`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        count: { type: "integer" },
        mode: { type: "string", enum: ["a", "b"] }
      },
      required: ["path"]
    }
  }
}))
const shapes: Record<string, Record<string, unknown>> = {
  short: {
    messages: [
      {
        role: "user",
        content: "Summarize what a git rebase does in two sentences."
      }
    ]
  },
  long: {
    messages: [{ role: "user", content: `Given this code:\n${filler}\nName one export.` }]
  },
  tools: {
    messages: [{ role: "user", content: "Read ./a.ts using an appropriate tool." }],
    tools,
    tool_choice: "auto"
  }
}
const samples: unknown[] = []
for (const effort of ["instant", "low", "medium", "high"]) {
  for (const [shape, base] of Object.entries(shapes)) {
    for (let rep = 0; rep < 3; rep++) {
      const cap = await streamChat(cfg, {
        model: MERCURY_MODEL,
        reasoning_effort: effort,
        max_tokens: 300,
        ...base
      })
      const rec = {
        effort,
        shape,
        rep,
        ttfbMs: Math.round(cap.ttfbMs),
        ttftMs: cap.ttftMs && Math.round(cap.ttftMs),
        totalMs: Math.round(cap.totalMs),
        usage: cap.usage,
        finishReason: cap.finishReason,
        sawDone: cap.sawDoneSentinel,
        frames: cap.rawFrames.length
      }
      samples.push(rec)
      console.log(JSON.stringify(rec))
    }
  }
}
console.log("report:", writeProbeReport("p1-latency", { model: MERCURY_MODEL, samples }))
