import { makeProjectBundle } from "../authoring/McpProjectBundleIO"
import { withGraphRevision } from "../model/GraphFingerprint"
import type { McpGraphDocument } from "../model/McpGraphDocument"
import type { McpTraceDocument } from "../model/McpTraceDocument"

export const INPUT_REQUIRED_PARAMS_SHA256 = "1".repeat(64)
export const INPUT_REQUIRED_STATE_SHA256 = "2".repeat(64)

const makeGraph = (): McpGraphDocument =>
  withGraphRevision({
    schemaVersion: "2",
    id: "input-required-tool",
    name: "Input-required content tool",
    description: "A fixture-only core tools/call retry with one structured input round",
    nodes: [
      {
        id: "client",
        kind: "client",
        label: "Review client",
        description: "Calls the content review tool",
        position: { x: 70, y: 130 },
        config: { transport: "streamable-http" },
      },
      {
        id: "server",
        kind: "server",
        label: "Review server",
        description: "A vertical MCP server for content review",
        position: { x: 340, y: 130 },
        config: { domain: "content-review" },
      },
      {
        id: "tool",
        kind: "tool",
        label: "content.review",
        description: "Returns content after a manual input round",
        position: { x: 620, y: 130 },
        config: { resultType: "content" },
      },
    ],
    edges: [
      { id: "client-server", kind: "transport", source: "client", target: "server" },
      { id: "server-tool", kind: "exposes", source: "server", target: "tool" },
    ],
  })

const makeTrace = (graph: McpGraphDocument): McpTraceDocument => {
  const logicalRequest = {
    initialSendEventId: "mrtr-send-17",
    method: "tools/call" as const,
    paramsSha256: INPUT_REQUIRED_PARAMS_SHA256,
  }
  const requestState = {
    present: true as const,
    sha256: INPUT_REQUIRED_STATE_SHA256,
    byteLength: 24,
  }
  return {
    schemaVersion: "2",
    id: "input-required-tool-run",
    graphId: graph.id,
    graphRevision: graph.revision,
    name: "Manual input then fresh core retry",
    provenance: { redactionPolicy: "allowlist-v1", redactions: [], migrations: [] },
    events: [
      {
        id: "mrtr-send-17",
        sequence: 0,
        atMs: 0,
        nodeId: "client",
        edgeId: "client-server",
        kind: "wire.message-sent",
        family: "wire",
        channel: "mcp",
        summary: "Initial tools/call attempt 17",
        correlationId: "content-review-logical-request",
        protocol: {
          direction: "send",
          jsonrpc: "2.0",
          requestId: 17,
          method: "tools/call",
        },
        payload: { evidence: "fixture-only", paramsSha256: INPUT_REQUIRED_PARAMS_SHA256 },
      },
      {
        id: "mrtr-input-result-17",
        sequence: 1,
        atMs: 120,
        nodeId: "client",
        edgeId: "client-server",
        kind: "wire.message-received",
        family: "wire",
        channel: "mcp",
        summary: "Attempt 17 terminated input_required",
        correlationId: "content-review-logical-request",
        protocol: { direction: "receive", jsonrpc: "2.0", requestId: 17 },
        payload: { resultType: "input_required" },
      },
      {
        id: "mrtr-required-1",
        sequence: 2,
        atMs: 240,
        nodeId: "client",
        kind: "mrtr.input-required",
        family: "mrtr",
        channel: "mcp",
        summary: "Review decision required for round 1",
        correlationId: "content-review-logical-request",
        payload: {
          schemaVersion: "1",
          round: 1,
          logicalRequest,
          terminalAttemptResultEventId: "mrtr-input-result-17",
          inputRequests: {
            decision: { method: "elicitation/create", label: "Approve the content review?" },
          },
          requestState,
        },
      },
      {
        id: "mrtr-supplied-1",
        sequence: 3,
        atMs: 360,
        nodeId: "client",
        kind: "mrtr.input-supplied",
        family: "mrtr",
        channel: "mcp",
        summary: "Decision supplied; value not retained",
        correlationId: "content-review-logical-request",
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
        atMs: 480,
        nodeId: "client",
        kind: "mrtr.resumed",
        family: "mrtr",
        channel: "mcp",
        summary: "Logical tools/call resumed on a fresh attempt",
        correlationId: "content-review-logical-request",
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
        atMs: 600,
        nodeId: "client",
        edgeId: "client-server",
        kind: "wire.message-sent",
        family: "wire",
        channel: "mcp",
        summary: "Fresh tools/call retry 18",
        correlationId: "content-review-logical-request",
        protocol: {
          direction: "send",
          jsonrpc: "2.0",
          requestId: 18,
          method: "tools/call",
        },
        payload: {
          evidence: "fixture-only",
          paramsSha256: INPUT_REQUIRED_PARAMS_SHA256,
          responseKeys: ["decision"],
          requestState,
        },
      },
      {
        id: "mrtr-received-18",
        sequence: 6,
        atMs: 720,
        nodeId: "server",
        edgeId: "client-server",
        kind: "wire.message-received",
        family: "wire",
        channel: "mcp",
        summary: "Server received retry 18",
        correlationId: "content-review-logical-request",
        protocol: {
          direction: "receive",
          jsonrpc: "2.0",
          requestId: 18,
          method: "tools/call",
        },
        payload: { evidence: "fixture-only", responseKeys: ["decision"] },
      },
      {
        id: "mrtr-tool-started",
        sequence: 7,
        atMs: 840,
        nodeId: "tool",
        edgeId: "server-tool",
        kind: "runtime.started",
        family: "runtime",
        channel: "effect",
        summary: "Content tool started after input",
        correlationId: "content-review-logical-request",
        payload: { handler: "content.review" },
      },
      {
        id: "mrtr-tool-completed",
        sequence: 8,
        atMs: 960,
        nodeId: "tool",
        edgeId: "server-tool",
        kind: "runtime.completed",
        family: "runtime",
        channel: "effect",
        summary: "Content tool returned a result",
        correlationId: "content-review-logical-request",
        payload: { resultType: "content", decisionRecorded: true },
      },
      {
        id: "mrtr-result-18",
        sequence: 9,
        atMs: 1080,
        nodeId: "client",
        edgeId: "client-server",
        kind: "wire.message-received",
        family: "wire",
        channel: "mcp",
        summary: "Client received completed retry 18",
        correlationId: "content-review-logical-request",
        protocol: { direction: "receive", jsonrpc: "2.0", requestId: 18 },
        payload: { resultType: "content" },
      },
      {
        id: "mrtr-client-completed",
        sequence: 10,
        atMs: 1200,
        nodeId: "client",
        kind: "runtime.completed",
        family: "runtime",
        channel: "effect",
        summary: "Client completed the logical request",
        correlationId: "content-review-logical-request",
        payload: { exit: "success" },
      },
    ],
  }
}

export const instantiateInputRequiredScenario = () => {
  const graph = makeGraph()
  return makeProjectBundle(graph, makeTrace(graph))
}

const graph = makeGraph()
export const inputRequiredScenario = { graph, trace: makeTrace(graph) }
