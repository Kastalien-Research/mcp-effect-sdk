import { describe, expect, it } from "vitest"
import { McpClientError } from "./McpClientError.js"
import type { McpClientErrorReason } from "./McpClientError.js"

describe("McpClientError", () => {
  const reasons: Array<McpClientErrorReason> = [
    "Transport",
    "Protocol",
    "NotInitialized",
    "CapabilityNotSupported",
    "Timeout",
    "SessionExpired"
  ]

  it("has correct _tag", () => {
    const error = new McpClientError({
      reason: "Transport",
      message: "connection refused"
    })
    expect(error._tag).toBe("McpClientError")
  })

  it.each(reasons)("constructs with reason %s", (reason) => {
    const error = new McpClientError({
      reason,
      message: `test ${reason}`
    })
    expect(error.reason).toBe(reason)
    expect(error.message).toBe(`test ${reason}`)
  })

  it("preserves cause when provided", () => {
    const underlying = new Error("socket closed")
    const error = new McpClientError({
      reason: "Transport",
      message: "connection lost",
      cause: underlying
    })
    expect(error.cause).toBe(underlying)
  })

  it("cause is undefined when omitted", () => {
    const error = new McpClientError({
      reason: "NotInitialized",
      message: "client not ready"
    })
    expect(error.cause).toBeUndefined()
  })

  it("supports pattern matching on reason", () => {
    const error = new McpClientError({
      reason: "CapabilityNotSupported",
      message: "server lacks tools"
    })

    const label = (() => {
      switch (error.reason) {
        case "Transport":
          return "transport"
        case "Protocol":
          return "protocol"
        case "NotInitialized":
          return "not-init"
        case "CapabilityNotSupported":
          return "no-cap"
        case "Timeout":
          return "timeout"
        case "SessionExpired":
          return "expired"
      }
    })()

    expect(label).toBe("no-cap")
  })

  it("is an instance of Error", () => {
    const error = new McpClientError({
      reason: "Timeout",
      message: "request timed out"
    })
    expect(error).toBeInstanceOf(Error)
  })
})
