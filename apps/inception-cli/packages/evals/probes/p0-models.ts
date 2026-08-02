import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { mercuryGet } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })
const res = await mercuryGet(cfg, "/models")
const body = await res.json().catch(async () => ({ raw: await res.text() }))
console.log(JSON.stringify(body, null, 2))
console.log("report:", writeProbeReport("p0-models", { status: res.status, body }))
