import { makeProjectBundle } from "../authoring/McpProjectBundleIO"
import { withGraphRevision } from "../model/GraphFingerprint"
import type { McpGraphDocument } from "../model/McpGraphDocument"
import type { McpTraceDocument } from "../model/McpTraceDocument"

const makeBeginnerGraph = (): McpGraphDocument =>
  withGraphRevision({
    schemaVersion: "2",
    id: "beginner-tool-server",
    name: "Beginner tool server",
    description: "A small client, server, and tool workflow for a first MCP application",
    nodes: [
      {
        id: "client",
        kind: "client",
        label: "Starter client",
        description: "Calls the hello tool",
        position: { x: 70, y: 130 },
        config: { transport: "streamable-http" },
      },
      {
        id: "server",
        kind: "server",
        label: "Hello server",
        description: "A beginner-friendly vertical MCP server",
        position: { x: 340, y: 130 },
        config: { domain: "hello" },
      },
      {
        id: "tool",
        kind: "tool",
        label: "hello.world",
        description: "Returns a small content result",
        position: { x: 620, y: 130 },
        config: { resultType: "content" },
      },
    ],
    edges: [
      { id: "client-server", kind: "transport", source: "client", target: "server" },
      { id: "server-tool", kind: "exposes", source: "server", target: "tool" },
    ],
  })

const makeBeginnerTrace = (graph: McpGraphDocument): McpTraceDocument => ({
  schemaVersion: "2",
  id: "beginner-tool-run",
  graphId: graph.id,
  graphRevision: graph.revision,
  name: "Call a first MCP tool",
  provenance: { redactionPolicy: "allowlist-v1", redactions: [], migrations: [] },
  events: [
    {
      id: "event-01",
      sequence: 0,
      atMs: 0,
      nodeId: "client",
      kind: "runtime.started",
      family: "runtime",
      channel: "effect",
      summary: "Client started",
      payload: { phase: "started" },
    },
    {
      id: "event-02",
      sequence: 1,
      atMs: 120,
      nodeId: "client",
      edgeId: "client-server",
      kind: "wire.message-sent",
      family: "wire",
      channel: "mcp",
      summary: "Call hello.world",
      correlationId: "beginner-call-1",
      protocol: { direction: "send", jsonrpc: "2.0", requestId: 1, method: "tools/call" },
      payload: { method: "tools/call", name: "hello.world" },
    },
    {
      id: "event-03",
      sequence: 2,
      atMs: 220,
      nodeId: "server",
      edgeId: "client-server",
      kind: "wire.message-received",
      family: "wire",
      channel: "mcp",
      summary: "Server received the call",
      correlationId: "beginner-call-1",
      protocol: { direction: "receive", requestId: 1, method: "tools/call" },
      payload: { name: "hello.world" },
    },
    {
      id: "event-04",
      sequence: 3,
      atMs: 340,
      nodeId: "tool",
      edgeId: "server-tool",
      kind: "runtime.started",
      family: "runtime",
      channel: "effect",
      summary: "Tool handler started",
      correlationId: "beginner-call-1",
      payload: { handler: "hello.world" },
    },
    {
      id: "event-05",
      sequence: 4,
      atMs: 460,
      nodeId: "tool",
      edgeId: "server-tool",
      kind: "runtime.completed",
      family: "runtime",
      channel: "effect",
      summary: "Tool returned content",
      correlationId: "beginner-call-1",
      payload: { resultType: "content", text: "Hello from Effect MCP" },
    },
    {
      id: "event-06",
      sequence: 5,
      atMs: 580,
      nodeId: "client",
      edgeId: "client-server",
      kind: "wire.message-received",
      family: "wire",
      channel: "mcp",
      summary: "Client received the result",
      correlationId: "beginner-call-1",
      protocol: { direction: "receive", jsonrpc: "2.0", requestId: 1 },
      payload: { resultType: "content" },
    },
  ],
})

export const instantiateBeginnerToolTemplate = () => {
  const graph = makeBeginnerGraph()
  return makeProjectBundle(graph, makeBeginnerTrace(graph))
}
