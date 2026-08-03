import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { streamChat } from "../src/lib/mercury.js"
import { mercuryFetch } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })

const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the workspace",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer" }
        },
        required: ["path"]
      }
    }
  }
]

// Raw finding: OpenAI-style object tool_choice ({type:"function", function:{name}})
// is rejected outright by Mercury's /chat/completions with HTTP 400 before any
// stream starts. Captured verbatim here since it's load-bearing for the M2
// provider client's tool_choice mapping.
const objectToolChoiceRes = await mercuryFetch(cfg, "/chat/completions", {
  model: MERCURY_MODEL,
  max_tokens: 60,
  messages: [{ role: "user", content: "Read ./a.ts using the appropriate tool." }],
  tools,
  tool_choice: { type: "function", function: { name: "read_file" } },
  stream: false
})
const objectToolChoiceRejection = {
  status: objectToolChoiceRes.status,
  body: await objectToolChoiceRes.text()
}
console.log(JSON.stringify(objectToolChoiceRejection))

const scenarios: Record<string, Record<string, unknown>> = {
  // Object-form tool_choice ({type:"function", function:{name:"read_file"}}) is
  // rejected with HTTP 400 by Mercury (see objectToolChoiceRejection above).
  // Only "auto" | "required" | "none" are accepted. Substituting "required"
  // with a single tool defined still forces that tool, giving comparable
  // forced-single-call tool_calls frame shapes.
  forcedSingle: {
    messages: [{ role: "user", content: "Read ./a.ts using the appropriate tool." }],
    tools,
    tool_choice: "required"
  },
  autoTwoFiles: {
    messages: [
      {
        role: "user",
        content: "Read both ./a.ts and ./b.ts using the appropriate tool."
      }
    ],
    tools,
    tool_choice: "auto"
  }
}

const runs: unknown[] = []
for (const [scenario, base] of Object.entries(scenarios)) {
  for (let rep = 0; rep < 3; rep++) {
    const cap = await streamChat(cfg, {
      model: MERCURY_MODEL,
      max_tokens: 200,
      ...base
    })
    const rec = {
      scenario,
      rep,
      finishReason: cap.finishReason,
      toolCallFrames: cap.toolCallFrames
    }
    runs.push(rec)
    console.log(JSON.stringify(rec))
  }
}
console.log(
  "report:",
  writeProbeReport("p3-tool-fragments", {
    model: MERCURY_MODEL,
    objectToolChoiceRejection,
    runs
  })
)
