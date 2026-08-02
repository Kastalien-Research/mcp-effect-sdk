import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { writeProbeReport } from "./report.js"

describe("writeProbeReport", () => {
  it("writes name, timestamp, host — and never the API key", () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-"))
    const p = writeProbeReport("unit-test-probe", { n: 1 }, "api.inceptionlabs.ai", dir)
    const parsed = JSON.parse(readFileSync(p, "utf8"))
    expect(parsed.probe).toBe("unit-test-probe")
    expect(parsed.data).toEqual({ n: 1 })
    expect(JSON.stringify(parsed)).not.toContain("sk_")
    expect(typeof parsed.capturedAt).toBe("string")
  })
})
