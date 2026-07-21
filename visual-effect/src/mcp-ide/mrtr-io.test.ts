import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import {
  makeProjectBundle,
  parseProjectBundle,
  serializeProjectBundle,
} from "./authoring/McpProjectBundleIO"
import { parseTraceDocument, serializeTraceDocument } from "./authoring/TraceDocumentIO"
import type { McpTraceDocument, McpTraceEvent } from "./model/McpTraceDocument"
import { validateTraceDocument } from "./model/McpTraceDocument"
import { inputRequiredScenario } from "./scenarios/inputRequiredScenario"
import { sanitizeTraceDocument, sensitiveTraceValue } from "./trace/TraceRedaction"

const replaceRequiredPayload = (payload: Readonly<Record<string, unknown>>): McpTraceDocument => ({
  ...inputRequiredScenario.trace,
  events: inputRequiredScenario.trace.events.map(event =>
    event.id === "mrtr-required-1" ? ({ ...event, payload } as McpTraceEvent) : event,
  ),
})

describe("MRTR trace and bundle security boundary", () => {
  it("round trips only the accepted normalized fixture deterministically", () => {
    const traceSource = serializeTraceDocument(inputRequiredScenario.trace)
    const trace = Effect.runSync(parseTraceDocument(traceSource, inputRequiredScenario.graph))
    const bundleSource = Effect.runSync(
      serializeProjectBundle({
        schemaVersion: "1",
        kind: "mcp-project-bundle",
        graph: inputRequiredScenario.graph,
        trace: inputRequiredScenario.trace,
      }),
    )
    const bundle = Effect.runSync(parseProjectBundle(bundleSource))

    expect(trace).toEqual(inputRequiredScenario.trace)
    expect(serializeTraceDocument(trace)).toBe(traceSource)
    expect(bundle.trace).toEqual(inputRequiredScenario.trace)
    expect(Effect.runSync(serializeProjectBundle(bundle))).toBe(bundleSource)
    expect(traceSource).not.toMatch(/inputResponses|taskId|pollAfter|secure-state/)
  })

  it("redacts raw request state and response values with provenance before exact validation fails", () => {
    const rawState = "raw-mrtr-state-secret"
    const rawResponse = "raw-mrtr-response-secret"
    const required = inputRequiredScenario.trace.events.find(
      event => event.id === "mrtr-required-1",
    )
    if (!required) throw new Error("fixture requires the normalized input event")
    const candidate = replaceRequiredPayload({
      ...required.payload,
      requestState: {
        present: true,
        sha256: "2".repeat(64),
        byteLength: 24,
        token: rawState,
      },
      responseValues: { password: rawResponse },
    })

    const sanitized = sanitizeTraceDocument(candidate)
    const sanitizedSource = JSON.stringify(sanitized)
    const direct = Effect.runSync(
      validateTraceDocument(inputRequiredScenario.graph, sanitized).pipe(Effect.either),
    )
    const imported = Effect.runSync(
      parseTraceDocument(JSON.stringify(candidate), inputRequiredScenario.graph).pipe(
        Effect.either,
      ),
    )
    const bundled = Effect.runSync(
      makeProjectBundle(inputRequiredScenario.graph, candidate).pipe(Effect.either),
    )

    expect(sanitizedSource).not.toContain(rawState)
    expect(sanitizedSource).not.toContain(rawResponse)
    expect(sanitized.provenance.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "mrtr-required-1",
          path: expect.stringContaining("/requestState/token"),
          reason: "sensitive-key",
        }),
        expect.objectContaining({
          eventId: "mrtr-required-1",
          path: expect.stringContaining("/responseValues/password"),
          reason: "sensitive-key",
        }),
      ]),
    )
    expect(Either.isLeft(direct)).toBe(true)
    expect(Either.isLeft(imported)).toBe(true)
    expect(Either.isLeft(bundled)).toBe(true)
    if (Either.isLeft(direct)) {
      expect(direct.left._tag).toBe("McpTraceValidationError")
      expect(JSON.stringify(direct.left)).not.toContain(rawState)
      expect(JSON.stringify(direct.left)).not.toContain(rawResponse)
    }
    if (Either.isLeft(imported)) {
      expect(imported.left._tag).toBe("McpTraceValidationError")
      expect(JSON.stringify(imported.left)).not.toContain(rawState)
      expect(JSON.stringify(imported.left)).not.toContain(rawResponse)
    }
    if (Either.isLeft(bundled)) {
      expect(bundled.left._tag).toBe("McpTraceValidationError")
      expect(JSON.stringify(bundled.left)).not.toContain(rawState)
      expect(JSON.stringify(bundled.left)).not.toContain(rawResponse)
    }
  })

  it("rejects an explicit sensitive value in an unaccepted field without exporting it", () => {
    const raw = "explicit-mrtr-sensitive-marker"
    const required = inputRequiredScenario.trace.events.find(
      event => event.id === "mrtr-required-1",
    )
    if (!required) throw new Error("fixture requires the normalized input event")
    const candidate = replaceRequiredPayload({
      ...required.payload,
      principal: sensitiveTraceValue(raw),
    })
    const sanitized = sanitizeTraceDocument(candidate)
    const result = Effect.runSync(
      validateTraceDocument(inputRequiredScenario.graph, sanitized).pipe(Effect.either),
    )

    expect(JSON.stringify(sanitized)).not.toContain(raw)
    expect(sanitized.provenance.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "mrtr-required-1",
          reason: "explicit-sensitive-value",
        }),
      ]),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues.map(issue => issue.code)).toContain("invalid-mrtr-payload")
      expect(JSON.stringify(result.left)).not.toContain(raw)
    }
  })
})
