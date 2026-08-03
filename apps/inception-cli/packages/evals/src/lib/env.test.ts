import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadEnv, mercuryConfig } from "./env.js"

describe("loadEnv", () => {
  it("parses quoted and bare values, skips comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"))
    writeFileSync(join(dir, ".env"), '# c\nA="x y"\nB=plain\n\n')
    expect(loadEnv(dir)).toEqual({ A: "x y", B: "plain" })
  })
})

describe("mercuryConfig", () => {
  it("throws without INCEPTION_API_KEY", () => {
    expect(() => mercuryConfig({})).toThrow("INCEPTION_API_KEY missing")
  })
  it("defaults the base URL", () => {
    expect(mercuryConfig({ INCEPTION_API_KEY: "k" }).baseUrl).toBe(
      "https://api.inceptionlabs.ai/v1"
    )
  })
})
