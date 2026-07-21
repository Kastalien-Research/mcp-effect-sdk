import { describe, expect, it } from "vitest"
import type { McpTraceDocument } from "./model/McpTraceDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import { sanitizeTraceDocument, sensitiveTraceValue } from "./trace/TraceRedaction"

describe("MCP trace redaction", () => {
  it("redacts sensitive headers and retains only allowlisted header values", () => {
    const trace = {
      ...gatewayTaskScenario.trace,
      events: [
        {
          ...gatewayTaskScenario.trace.events[1],
          protocol: {
            direction: "send",
            headers: {
              accept: "application/json",
              authorization: "Bearer private-token",
              cookie: "session=private-cookie",
              "mcp-protocol-version": "2026-07-28",
              "x-tenant-id": "private-tenant",
            },
          },
        },
      ],
    } satisfies McpTraceDocument

    const sanitized = sanitizeTraceDocument(trace)
    const source = JSON.stringify(sanitized)

    expect(source).not.toContain("private-token")
    expect(source).not.toContain("private-cookie")
    expect(source).not.toContain("private-tenant")
    expect(source).toContain("application/json")
    expect(source).toContain("2026-07-28")
    expect(sanitized.provenance.redactions).toEqual([
      {
        eventId: "event-02",
        path: "events.event-02.protocol.headers.authorization",
        reason: "sensitive-header",
      },
      {
        eventId: "event-02",
        path: "events.event-02.protocol.headers.cookie",
        reason: "sensitive-header",
      },
      {
        eventId: "event-02",
        path: "events.event-02.protocol.headers.x-tenant-id",
        reason: "header-not-allowlisted",
      },
    ])
  })

  it("recursively removes secret-key fields and marked raw values before returning state", () => {
    const rawSecret = "must-never-survive"
    const trace = {
      ...gatewayTaskScenario.trace,
      events: [
        {
          ...gatewayTaskScenario.trace.events[0],
          payload: {
            nested: { apiKey: rawSecret, safe: "visible" },
            arguments: { credential: sensitiveTraceValue(rawSecret) },
          },
        },
      ],
    } satisfies McpTraceDocument

    const sanitized = sanitizeTraceDocument(trace)
    const source = JSON.stringify(sanitized)

    expect(source).not.toContain(rawSecret)
    expect(source).toContain("visible")
    expect(sanitized.events[0]?.payload).toEqual({
      arguments: { credential: { redacted: true } },
      nested: { apiKey: { redacted: true }, safe: "visible" },
    })
    expect(sanitized.provenance.redactions).toEqual([
      {
        eventId: "event-01",
        path: "events.event-01.payload.arguments.credential",
        reason: "explicit-sensitive-value",
      },
      {
        eventId: "event-01",
        path: "events.event-01.payload.nested.apiKey",
        reason: "sensitive-key",
      },
    ])
  })

  it("is deterministic and idempotent", () => {
    const once = sanitizeTraceDocument(gatewayTaskScenario.trace)
    const twice = sanitizeTraceDocument(once)

    expect(twice).toEqual(once)
  })

  it("drops non-contract fields so defensive export cannot retain marked raw values", () => {
    const rawSecret = "raw-extra-field-secret"
    const trace = {
      ...gatewayTaskScenario.trace,
      debug: { token: rawSecret },
      events: [
        {
          ...gatewayTaskScenario.trace.events[0],
          debug: sensitiveTraceValue(rawSecret),
        },
      ],
    } as unknown as McpTraceDocument

    const sanitized = sanitizeTraceDocument(trace)

    expect(JSON.stringify(sanitized)).not.toContain(rawSecret)
    expect(sanitized).not.toHaveProperty("debug")
    expect(sanitized.events[0]).not.toHaveProperty("debug")
  })
})
