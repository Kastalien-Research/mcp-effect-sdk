import { afterEach, describe, expect, it } from "vitest"
import { traced } from "./tracing.js"

describe("traced (identity path, LANGSMITH_TRACING unset or not \"true\")", () => {
  const originalEnv = process.env["LANGSMITH_TRACING"]

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["LANGSMITH_TRACING"]
    else process.env["LANGSMITH_TRACING"] = originalEnv
  })

  it("returns the exact same function reference when the env var is unset", () => {
    delete process.env["LANGSMITH_TRACING"]
    const fn = (a: number, b: number) => a + b
    expect(traced("add", fn)).toBe(fn)
  })

  it("returns the exact same function reference when the env var is not \"true\"", () => {
    process.env["LANGSMITH_TRACING"] = "false"
    const fn = async (x: string) => x.toUpperCase()
    expect(traced("upper", fn)).toBe(fn)
  })

  it("never throws when constructing the wrapper without network/env configured", () => {
    delete process.env["LANGSMITH_TRACING"]
    expect(() => traced("noop", () => undefined)).not.toThrow()
  })

  it("passthrough result matches the original function's result", async () => {
    delete process.env["LANGSMITH_TRACING"]
    const fn = async (x: number) => x * 2
    const wrapped = traced("double", fn)
    await expect(wrapped(21)).resolves.toBe(42)
  })
})
