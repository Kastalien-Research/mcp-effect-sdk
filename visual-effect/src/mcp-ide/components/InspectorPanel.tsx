"use client"

import type { McpGraphDocument, McpGraphNode } from "../model/McpGraphDocument"
import type { McpNodeExecutionState, McpTraceEvent } from "../model/McpTraceDocument"

interface InspectorPanelProps {
  readonly graph: McpGraphDocument
  readonly node?: McpGraphNode
  readonly nodeState?: McpNodeExecutionState
  readonly event?: McpTraceEvent
}

function JsonPayload({ value }: { readonly value: Readonly<Record<string, unknown>> }) {
  return <pre className="json-payload">{JSON.stringify(value, null, 2)}</pre>
}

export function InspectorPanel({ graph, node, nodeState = "idle", event }: InspectorPanelProps) {
  if (event) {
    return (
      <aside className="inspector-panel" aria-label="Trace event inspector">
        <div className="inspector-heading">
          <span className="eyebrow">TRACE EVENT</span>
          <span className="inspector-sequence">#{String(event.sequence).padStart(2, "0")}</span>
        </div>
        <h2>{event.summary}</h2>
        <div className="inspector-tags">
          <span data-channel={event.channel}>{event.channel.toUpperCase()}</span>
          <span>{event.kind.toUpperCase()}</span>
        </div>

        <dl className="inspector-facts">
          <div>
            <dt>NODE</dt>
            <dd>{event.nodeId}</dd>
          </div>
          <div>
            <dt>OFFSET</dt>
            <dd>+{event.atMs} ms</dd>
          </div>
          <div>
            <dt>CORRELATION</dt>
            <dd>{event.correlationId ?? "—"}</dd>
          </div>
        </dl>

        <div className="inspector-section">
          <div className="section-label">
            <span>PAYLOAD</span>
            <span>READ ONLY</span>
          </div>
          <JsonPayload value={event.payload} />
        </div>

        <div className="inspector-note">
          <span>OBSERVED</span>
          State is projected from this versioned trace event, not inferred from UI timing.
        </div>
      </aside>
    )
  }

  if (!node) return null
  const incoming = graph.edges.filter(edge => edge.target === node.id)
  const outgoing = graph.edges.filter(edge => edge.source === node.id)

  return (
    <aside className="inspector-panel" aria-label="Graph node inspector">
      <div className="inspector-heading">
        <span className="eyebrow">GRAPH NODE</span>
        <span className="inspector-sequence">{node.kind.toUpperCase()}</span>
      </div>
      <h2>{node.label}</h2>
      <p className="inspector-description">{node.description}</p>
      <div className="inspector-tags">
        <span data-state={nodeState}>{nodeState.replace("-", " ").toUpperCase()}</span>
        <span>SCHEMA V{graph.schemaVersion}</span>
      </div>

      <dl className="inspector-facts">
        <div>
          <dt>NODE ID</dt>
          <dd>{node.id}</dd>
        </div>
        <div>
          <dt>INBOUND</dt>
          <dd>{incoming.length}</dd>
        </div>
        <div>
          <dt>OUTBOUND</dt>
          <dd>{outgoing.length}</dd>
        </div>
      </dl>

      <div className="inspector-section">
        <div className="section-label">
          <span>CONFIGURATION</span>
          <span>GRAPH DATA</span>
        </div>
        <JsonPayload value={node.config} />
      </div>

      <div className="inspector-section compact">
        <div className="section-label">
          <span>TYPED CONNECTIONS</span>
        </div>
        <ul className="connection-list">
          {incoming.map(edge => (
            <li key={edge.id}>
              <b>IN</b>
              {edge.kind} ← {edge.source}
            </li>
          ))}
          {outgoing.map(edge => (
            <li key={edge.id}>
              <b>OUT</b>
              {edge.kind} → {edge.target}
            </li>
          ))}
          {incoming.length + outgoing.length === 0 && <li>NO CONNECTIONS</li>}
        </ul>
      </div>
    </aside>
  )
}
