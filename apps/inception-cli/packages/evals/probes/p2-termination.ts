import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { streamChat } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })
const runs: unknown[] = []
for (let i = 0; i < 5; i++) {
  const cap = await streamChat(cfg, {
    model: MERCURY_MODEL,
    max_tokens: 60,
    messages: [{ role: "user", content: `Say "run ${i} ok" and nothing else.` }]
  })
  runs.push({
    i,
    sawDone: cap.sawDoneSentinel,
    finishReason: cap.finishReason,
    hasUsage: cap.usage !== null,
    tailFrames: cap.rawFrames.slice(-6)
  })
}
console.log(
  "report:",
  writeProbeReport("p2-termination", { model: MERCURY_MODEL, runs })
)
