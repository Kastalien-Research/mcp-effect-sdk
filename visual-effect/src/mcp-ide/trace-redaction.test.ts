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
        path: "/events/0/protocol/headers/authorization",
        reason: "sensitive-header",
      },
      {
        eventId: "event-02",
        path: "/events/0/protocol/headers/cookie",
        reason: "sensitive-header",
      },
      {
        eventId: "event-02",
        path: "/events/0/protocol/headers/x-tenant-id",
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
      arguments: {
        credential: { $mcpTraceRedaction: "explicit-sensitive-value" },
      },
      nested: {
        apiKey: { $mcpTraceRedaction: "sensitive-key" },
        safe: "visible",
      },
    })
    expect(sanitized.provenance.redactions).toEqual([
      {
        eventId: "event-01",
        path: "/events/0/payload/arguments/credential",
        reason: "explicit-sensitive-value",
      },
      {
        eventId: "event-01",
        path: "/events/0/payload/nested/apiKey",
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

  it("treats ordinary redacted business objects as data, not contract sentinels", () => {
    const trace = {
      ...gatewayTaskScenario.trace,
      events: [
        {
          ...gatewayTaskScenario.trace.events[0],
          payload: { businessFlag: { redacted: true } },
        },
      ],
    } satisfies McpTraceDocument

    const sanitized = sanitizeTraceDocument(trace)

    expect(sanitized.events[0]?.payload).toEqual({ businessFlag: { redacted: true } })
    expect(sanitized.provenance.redactions).toEqual([])
  })

  it("regenerates provenance from tagged sentinels with RFC 6901 paths", () => {
    const trace = {
      ...gatewayTaskScenario.trace,
      provenance: {
        ...gatewayTaskScenario.trace.provenance,
        redactions: [{ eventId: "forged", path: "/forged", reason: "sensitive-key" as const }],
      },
      events: [
        {
          ...gatewayTaskScenario.trace.events[0],
          id: "event.with.dot/~",
          payload: {
            "a.b/c~d": {
              token: "secret",
              businessFlag: { redacted: true },
            },
          },
        },
      ],
    } satisfies McpTraceDocument

    const once = sanitizeTraceDocument(trace)
    const twice = sanitizeTraceDocument(once)

    expect(once.provenance.redactions).toEqual([
      {
        eventId: "event.with.dot/~",
        path: "/events/0/payload/a.b~1c~0d/token",
        reason: "sensitive-key",
      },
    ])
    expect(once.events[0]?.payload).toEqual({
      "a.b/c~d": {
        token: { $mcpTraceRedaction: "sensitive-key" },
        businessFlag: { redacted: true },
      },
    })
    expect(twice).toEqual(once)
    expect(JSON.stringify(once)).not.toContain("/forged")
  })

  it("replaces marked or non-string trusted metadata without retaining raw values", () => {
    const rawSecret = "metadata-marker-secret"
    const trace = {
      ...gatewayTaskScenario.trace,
      name: sensitiveTraceValue(rawSecret),
      events: [
        {
          ...gatewayTaskScenario.trace.events[0],
          summary: sensitiveTraceValue(rawSecret),
          correlationId: sensitiveTraceValue(rawSecret),
          spanId: 42,
          protocol: { method: sensitiveTraceValue(rawSecret) },
        },
      ],
    } as unknown as McpTraceDocument

    const sanitized = sanitizeTraceDocument(trace)
    const source = JSON.stringify(sanitized)

    expect(source).not.toContain(rawSecret)
    expect(sanitized.name).toBe("Invalid trace label")
    expect(sanitized.events[0]?.summary).toBe("Invalid trace event")
    expect(sanitized.events[0]).not.toHaveProperty("correlationId")
    expect(sanitized.events[0]).not.toHaveProperty("spanId")
    expect(sanitized.events[0]).not.toHaveProperty("protocol.method")
  })

  it("preserves only migration provenance bound to this trace graph", () => {
    const valid = {
      kind: "legacy-v1-rebind" as const,
      sourceGraphId: "legacy-graph",
      targetGraphId: gatewayTaskScenario.trace.graphId,
      targetGraphRevision: gatewayTaskScenario.trace.graphRevision,
    }
    const trace = {
      ...gatewayTaskScenario.trace,
      provenance: {
        ...gatewayTaskScenario.trace.provenance,
        migrations: [valid, { ...valid, targetGraphRevision: "graph-v2-forged" }],
      },
    } satisfies McpTraceDocument

    expect(sanitizeTraceDocument(trace).provenance.migrations).toEqual([valid])
  })
})
