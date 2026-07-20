import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { parseGraphDocument, serializeGraphDocument } from "./authoring/GraphDocumentIO"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"

describe("MCP IDE graph document I/O", () => {
  it("round-trips the versioned graph without losing authored data", () => {
    const encoded = serializeGraphDocument(gatewayTaskScenario.graph)
    const decoded = Effect.runSync(parseGraphDocument(encoded).pipe(Effect.either))

    expect(Either.isRight(decoded)).toBe(true)
    if (Either.isRight(decoded)) expect(decoded.right).toEqual(gatewayTaskScenario.graph)
  })

  it("distinguishes malformed JSON from unsupported graph documents", () => {
    const malformed = Effect.runSync(parseGraphDocument("{").pipe(Effect.either))
    expect(Either.isLeft(malformed)).toBe(true)
    if (Either.isLeft(malformed)) expect(malformed.left).toMatchObject({ code: "invalid-json" })

    const unsupported = Effect.runSync(
      parseGraphDocument(JSON.stringify({ schemaVersion: "99" })).pipe(Effect.either),
    )
    expect(Either.isLeft(unsupported)).toBe(true)
    if (Either.isLeft(unsupported)) {
      expect(unsupported.left).toMatchObject({ code: "unsupported-schema" })
    }
  })

  it("runs imported documents through protocol-aware graph validation", () => {
    const invalid = {
      ...gatewayTaskScenario.graph,
      edges: [
        ...gatewayTaskScenario.graph.edges,
        { id: "invalid", kind: "routes", source: "task", target: "client" },
      ],
    }
    const result = Effect.runSync(parseGraphDocument(JSON.stringify(invalid)).pipe(Effect.either))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left._tag).toBe("McpGraphValidationError")
  })
})
