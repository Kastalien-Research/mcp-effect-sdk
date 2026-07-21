import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { withGraphRevision } from "./model/GraphFingerprint"
import type { McpGraphDocument } from "./model/McpGraphDocument"
import {
  type McpTraceDocument,
  type McpTraceEvent,
  validateTraceDocument,
} from "./model/McpTraceDocument"

const PARAMS_SHA = "1".repeat(64)
const STATE_SHA = "2".repeat(64)

const graph = withGraphRevision({
  schemaVersion: "2",
  id: "mrtr-input-tool",
  name: "MRTR input tool",
  description: "Fixture-only core request and retry",
  nodes: [
    {
      id: "client",
      kind: "client",
      label: "Client",
      description: "Calls the content tool",
      position: { x: 0, y: 0 },
      config: { transport: "streamable-http" },
    },
    {
      id: "server",
      kind: "server",
      label: "Server",
      description: "Owns the vertical capability",
      position: { x: 220, y: 0 },
      config: { domain: "input" },
    },
    {
      id: "tool",
      kind: "tool",
      label: "content.review",
      description: "Returns content after input",
      position: { x: 440, y: 0 },
      config: { resultType: "content" },
    },
  ],
  edges: [
    { id: "client-server", kind: "transport", source: "client", target: "server" },
    { id: "server-tool", kind: "exposes", source: "server", target: "tool" },
  ],
} as const) satisfies McpGraphDocument

const logicalRequest = {
  initialSendEventId: "mrtr-send-17",
  method: "tools/call" as const,
  paramsSha256: PARAMS_SHA,
}
const requestState = { present: true as const, sha256: STATE_SHA, byteLength: 24 }

const events = [
  {
    id: "mrtr-send-17",
    sequence: 0,
    atMs: 0,
    nodeId: "client",
    edgeId: "client-server",
    kind: "wire.message-sent",
    family: "wire",
    channel: "mcp",
    summary: "Initial tools/call attempt",
    correlationId: "logical-review",
    protocol: { direction: "send", jsonrpc: "2.0", requestId: 17, method: "tools/call" },
    payload: { evidence: "fixture" },
  },
  {
    id: "mrtr-input-result-17",
    sequence: 1,
    atMs: 10,
    nodeId: "client",
    kind: "wire.message-received",
    family: "wire",
    channel: "mcp",
    summary: "Attempt 17 terminated input_required",
    correlationId: "logical-review",
    protocol: { direction: "receive", jsonrpc: "2.0", requestId: 17 },
    payload: { resultType: "input_required" },
  },
  {
    id: "mrtr-required-1",
    sequence: 2,
    atMs: 20,
    nodeId: "client",
    kind: "mrtr.input-required",
    family: "mrtr",
    channel: "mcp",
    summary: "Server requires structured input",
    correlationId: "logical-review",
    payload: {
      schemaVersion: "1",
      round: 1,
      logicalRequest,
      terminalAttemptResultEventId: "mrtr-input-result-17",
      inputRequests: {
        decision: { method: "elicitation/create", label: "Approve the review?" },
      },
      requestState,
    },
  },
  {
    id: "mrtr-supplied-1",
    sequence: 3,
    atMs: 30,
    nodeId: "client",
    kind: "mrtr.input-supplied",
    family: "mrtr",
    channel: "mcp",
    summary: "Input supplied without retaining values",
    correlationId: "logical-review",
    payload: {
      schemaVersion: "1",
      round: 1,
      requiredEventId: "mrtr-required-1",
      responseKeys: ["decision"],
      values: "not-retained",
    },
  },
  {
    id: "mrtr-resumed-1",
    sequence: 4,
    atMs: 40,
    nodeId: "client",
    kind: "mrtr.resumed",
    family: "mrtr",
    channel: "mcp",
    summary: "Logical request retried on a fresh wire attempt",
    correlationId: "logical-review",
    payload: {
      schemaVersion: "1",
      round: 1,
      requiredEventId: "mrtr-required-1",
      retrySendEventId: "mrtr-send-18",
      logicalRequest,
      responseKeys: ["decision"],
      requestState,
      retry: "fresh-wire-attempt",
    },
  },
  {
    id: "mrtr-send-18",
    sequence: 5,
    atMs: 50,
    nodeId: "client",
    edgeId: "client-server",
    kind: "wire.message-sent",
    family: "wire",
    channel: "mcp",
    summary: "Fresh tools/call retry",
    correlationId: "logical-review",
    protocol: { direction: "send", jsonrpc: "2.0", requestId: 18, method: "tools/call" },
    payload: { evidence: "fixture" },
  },
] as const satisfies ReadonlyArray<McpTraceEvent>

const trace = {
  schemaVersion: "2",
  id: "mrtr-input-tool-run",
  graphId: graph.id,
  graphRevision: graph.revision,
  name: "Fixture MRTR input round",
  provenance: { redactionPolicy: "allowlist-v1", redactions: [], migrations: [] },
  events,
} as const satisfies McpTraceDocument

const validate = (candidate: McpTraceDocument) =>
  Effect.runSync(validateTraceDocument(graph, candidate).pipe(Effect.either))

const replaceEvent = (
  id: string,
  replace: (event: McpTraceEvent) => McpTraceEvent,
): McpTraceDocument => ({
  ...trace,
  events: trace.events.map(event => (event.id === id ? replace(event) : event)),
})

describe("fixture-only MRTR normalized trace contract", () => {
  it("rejects malformed exact payloads with typed non-echoing issues", () => {
    const rawSecret = "must-not-echo-mrtr-state"
    const candidates = [
      replaceEvent("mrtr-required-1", event => ({
        ...event,
        payload: { ...event.payload, round: 0 },
      })),
      replaceEvent("mrtr-required-1", event => ({
        ...event,
        payload: {
          ...event.payload,
          requestState: { present: true, sha256: rawSecret, byteLength: 1 },
        },
      })),
      replaceEvent("mrtr-supplied-1", event => ({
        ...event,
        payload: { ...event.payload, values: { decision: rawSecret } },
      })),
      replaceEvent("mrtr-resumed-1", event => ({
        ...event,
        payload: { ...event.payload, extra: rawSecret },
      })),
    ]

    const results = candidates.map(validate)
    expect(results.every(Either.isLeft)).toBe(true)
    for (const result of results) {
      if (Either.isLeft(result)) {
        expect(result.left.issues.map(issue => issue.code)).toContain("invalid-mrtr-payload")
        expect(JSON.stringify(result.left)).not.toContain(rawSecret)
      }
    }
  })

  it("rejects inherited, accessor, symbol, and prototype-sensitive contract shapes without defects", () => {
    let accessorReads = 0
    const inherited = Object.create({ decision: { method: "elicitation/create", label: "bad" } })
    const accessor = Object.defineProperty({}, "decision", {
      enumerable: true,
      get: () => {
        accessorReads += 1
        throw new Error("hostile-accessor-secret")
      },
    })
    const symbol = { decision: { method: "elicitation/create", label: "Approve?" } }
    Object.defineProperty(symbol, Symbol("hidden"), { enumerable: true, value: "secret" })
    const polluted = Object.create({ polluted: true })
    Object.defineProperty(polluted, "decision", {
      enumerable: true,
      value: { method: "elicitation/create", label: "Approve?" },
    })
    const records = [inherited, accessor, symbol, polluted]

    const results = records.map(inputRequests =>
      validate(
        replaceEvent("mrtr-required-1", event => ({
          ...event,
          payload: { ...event.payload, inputRequests },
        })),
      ),
    )

    expect(accessorReads).toBe(0)
    expect(results.every(Either.isLeft)).toBe(true)
    expect(JSON.stringify(results)).not.toContain("hostile-accessor-secret")
  })

  it("accepts empty, Unicode, and own __proto__ server keys plus a state-only round", () => {
    const inputRequests = JSON.parse(
      '{"":{"method":"roots/list","label":"Empty key"},"\u8a2d\u5b9a":{"method":"sampling/createMessage","label":"Unicode key"},"__proto__":{"method":"elicitation/create","label":"Prototype key"}}',
    ) as Record<string, unknown>
    const keys = ["", "設定", "__proto__"]
    const keyed = replaceEvent("mrtr-required-1", event => ({
      ...event,
      payload: { ...event.payload, inputRequests },
    }))
    const supplied = {
      ...keyed,
      events: keyed.events.map(event =>
        event.id === "mrtr-supplied-1" || event.id === "mrtr-resumed-1"
          ? { ...event, payload: { ...event.payload, responseKeys: keys } }
          : event,
      ),
    } as McpTraceDocument
    const stateOnly = {
      ...trace,
      events: trace.events.map(event => {
        if (event.id === "mrtr-required-1") {
          return { ...event, payload: { ...event.payload, inputRequests: {} } }
        }
        if (event.id === "mrtr-supplied-1" || event.id === "mrtr-resumed-1") {
          return { ...event, payload: { ...event.payload, responseKeys: [] } }
        }
        return event
      }),
    } as McpTraceDocument

    expect(Either.isRight(validate(supplied))).toBe(true)
    expect(Either.isRight(validate(stateOnly))).toBe(true)
  })

  it("rejects broken required, supplied, resumed, terminal-attempt, and fresh-retry correlation", () => {
    const candidates = [
      { ...trace, events: trace.events.filter(event => event.id !== "mrtr-supplied-1") },
      replaceEvent("mrtr-supplied-1", event => ({
        ...event,
        payload: { ...event.payload, responseKeys: ["wrong"] },
      })),
      replaceEvent("mrtr-resumed-1", event => ({
        ...event,
        payload: { ...event.payload, requestState: { present: false } },
      })),
      replaceEvent("mrtr-input-result-17", event => ({
        ...event,
        protocol: { ...event.protocol, requestId: 99 },
      })),
      replaceEvent("mrtr-send-18", event => ({
        ...event,
        protocol: { ...event.protocol, requestId: 17 },
      })),
    ] as ReadonlyArray<McpTraceDocument>

    const results = candidates.map(validate)
    expect(results.every(Either.isLeft)).toBe(true)
    for (const result of results) {
      if (Either.isLeft(result)) {
        expect(result.left.issues.map(issue => issue.code)).toContain("invalid-mrtr-sequence")
      }
    }
  })

  it("rejects a same-request wire continuation after the terminal input_required result", () => {
    const shifted = trace.events.map(event =>
      event.sequence >= 2
        ? { ...event, sequence: event.sequence + 1, atMs: event.atMs + 1 }
        : event,
    )
    const continuation = {
      id: "post-terminal-same-id",
      sequence: 2,
      atMs: 11,
      nodeId: "client",
      edgeId: "client-server",
      kind: "wire.message-received",
      family: "wire",
      channel: "mcp",
      summary: "Illegal continuation after terminal result",
      correlationId: "logical-review",
      protocol: { direction: "receive", jsonrpc: "2.0", requestId: 17 },
      payload: { resultType: "content" },
    } as const satisfies McpTraceEvent
    const result = validate({ ...trace, events: [...shifted, continuation] })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-mrtr-sequence",
            path: "events.mrtr-required-1",
          }),
        ]),
      )
    }
  })

  it("keeps the registry MRTR family/channel authority separate from Tasks", () => {
    const result = validate(
      replaceEvent("mrtr-required-1", event => ({ ...event, family: "tasks", channel: "tasks" })),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues.map(issue => issue.code)).toEqual(
        expect.arrayContaining(["event-family-mismatch", "event-channel-mismatch"]),
      )
    }
  })

  it("accepts per-round responses and a later opaque-state replacement for one logical request", () => {
    const nextState = { present: true as const, sha256: "3".repeat(64), byteLength: 48 }
    const secondRound = [
      {
        id: "mrtr-input-result-18",
        sequence: 6,
        atMs: 60,
        nodeId: "client",
        kind: "wire.message-received",
        family: "wire",
        channel: "mcp",
        summary: "Attempt 18 terminated input_required",
        correlationId: "logical-review",
        protocol: { direction: "receive", jsonrpc: "2.0", requestId: 18 },
        payload: { resultType: "input_required" },
      },
      {
        id: "mrtr-required-2",
        sequence: 7,
        atMs: 70,
        nodeId: "client",
        kind: "mrtr.input-required",
        family: "mrtr",
        channel: "mcp",
        summary: "Second structured input round",
        correlationId: "logical-review",
        payload: {
          schemaVersion: "1",
          round: 2,
          logicalRequest,
          terminalAttemptResultEventId: "mrtr-input-result-18",
          inputRequests: {
            revision: { method: "sampling/createMessage", label: "Revise the review" },
          },
          requestState: nextState,
        },
      },
      {
        id: "mrtr-supplied-2",
        sequence: 8,
        atMs: 80,
        nodeId: "client",
        kind: "mrtr.input-supplied",
        family: "mrtr",
        channel: "mcp",
        summary: "Second-round response supplied",
        correlationId: "logical-review",
        payload: {
          schemaVersion: "1",
          round: 2,
          requiredEventId: "mrtr-required-2",
          responseKeys: ["revision"],
          values: "not-retained",
        },
      },
      {
        id: "mrtr-resumed-2",
        sequence: 9,
        atMs: 90,
        nodeId: "client",
        kind: "mrtr.resumed",
        family: "mrtr",
        channel: "mcp",
        summary: "Second retry starts fresh",
        correlationId: "logical-review",
        payload: {
          schemaVersion: "1",
          round: 2,
          requiredEventId: "mrtr-required-2",
          retrySendEventId: "mrtr-send-19",
          logicalRequest,
          responseKeys: ["revision"],
          requestState: nextState,
          retry: "fresh-wire-attempt",
        },
      },
      {
        id: "mrtr-send-19",
        sequence: 10,
        atMs: 100,
        nodeId: "client",
        edgeId: "client-server",
        kind: "wire.message-sent",
        family: "wire",
        channel: "mcp",
        summary: "Fresh second retry",
        correlationId: "logical-review",
        protocol: { direction: "send", jsonrpc: "2.0", requestId: 19, method: "tools/call" },
        payload: { evidence: "fixture" },
      },
    ] as const satisfies ReadonlyArray<McpTraceEvent>
    const candidate = { ...trace, events: [...trace.events, ...secondRound] }

    expect(Either.isRight(validate(candidate))).toBe(true)

    const drifted = {
      ...candidate,
      events: candidate.events.map(event =>
        event.id === "mrtr-required-2"
          ? {
              ...event,
              payload: {
                ...event.payload,
                logicalRequest: { ...logicalRequest, paramsSha256: "4".repeat(64) },
              },
            }
          : event,
      ),
    } as McpTraceDocument
    const result = validate(drifted)
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.issues.map(issue => issue.code)).toContain("invalid-mrtr-sequence")
    }
  })

  it("enforces round, request-count, response-array, and absent state-only bounds", () => {
    const thirtyThree = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [
        `key-${index}`,
        { method: "roots/list", label: `Key ${index}` },
      ]),
    )
    const candidates = [
      replaceEvent("mrtr-required-1", event => ({
        ...event,
        payload: { ...event.payload, round: 11 },
      })),
      replaceEvent("mrtr-required-1", event => ({
        ...event,
        payload: { ...event.payload, inputRequests: thirtyThree },
      })),
      replaceEvent("mrtr-required-1", event => ({
        ...event,
        payload: { ...event.payload, inputRequests: {}, requestState: { present: false } },
      })),
      replaceEvent("mrtr-supplied-1", event => ({
        ...event,
        payload: { ...event.payload, responseKeys: ["decision", "decision"] },
      })),
    ]

    for (const candidate of candidates) {
      const result = validate(candidate)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left.issues.map(issue => issue.code)).toContain("invalid-mrtr-payload")
      }
    }
  })
})
