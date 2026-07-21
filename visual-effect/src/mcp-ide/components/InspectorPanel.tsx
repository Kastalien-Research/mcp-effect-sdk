"use client"

import type { McpGraphDocument, McpGraphNode } from "../model/McpGraphDocument"
import type {
  McpNodeExecutionState,
  McpTraceDocument,
  McpTraceEvent,
} from "../model/McpTraceDocument"

interface InspectorPanelProps {
  readonly graph: McpGraphDocument
  readonly trace: McpTraceDocument
  readonly node?: McpGraphNode
  readonly nodeState?: McpNodeExecutionState
  readonly event?: McpTraceEvent
}

function JsonPayload({ value }: { readonly value: unknown }) {
  return <pre className="json-payload">{JSON.stringify(value, null, 2)}</pre>
}

const displayValue = (value: string | number | boolean | null | undefined) => {
  if (value === undefined || value === null || value === "") return "—"
  return String(value)
}

export function InspectorPanel({
  graph,
  trace,
  node,
  nodeState = "idle",
  event,
}: InspectorPanelProps) {
  if (event) {
    const eventNode = graph.nodes.find(candidate => candidate.id === event.nodeId)
    const edge = event.edgeId
      ? graph.edges.find(candidate => candidate.id === event.edgeId)
      : undefined
    const relatedEvents = event.correlationId
      ? trace.events.filter(
          candidate => candidate.id !== event.id && candidate.correlationId === event.correlationId,
        )
      : []
    const appNode =
      eventNode?.kind === "app-host" ||
      eventNode?.kind === "app-view" ||
      eventNode?.kind === "app-resource"
        ? eventNode
        : undefined
    const policyOutcome = event.kind.startsWith("apps.policy-")
      ? event.kind.slice("apps.policy-".length)
      : undefined

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

        {event.protocol && (
          <div className="inspector-section compact" data-testid="protocol-metadata">
            <div className="section-label">
              <span>PROTOCOL METADATA</span>
              <span>ACCEPTED TRACE</span>
            </div>
            <dl className="inspector-facts">
              <div>
                <dt>DIRECTION</dt>
                <dd>{displayValue(event.protocol.direction)}</dd>
              </div>
              <div>
                <dt>JSON-RPC</dt>
                <dd>{displayValue(event.protocol.jsonrpc)}</dd>
              </div>
              <div>
                <dt>REQUEST ID</dt>
                <dd>{displayValue(event.protocol.requestId)}</dd>
              </div>
              <div>
                <dt>METHOD</dt>
                <dd>{displayValue(event.protocol.method)}</dd>
              </div>
            </dl>
            {event.protocol.headers && <JsonPayload value={event.protocol.headers} />}
          </div>
        )}

        {event.correlationId && (
          <div className="inspector-section compact" data-testid="request-result-pairing">
            <div className="section-label">
              <span>REQUEST / RESULT PAIRING</span>
              <span>{event.correlationId}</span>
            </div>
            <ul className="connection-list related-event-list">
              {relatedEvents.map(related => (
                <li key={related.id}>
                  <b>
                    {related.protocol?.direction?.toUpperCase() ?? related.family.toUpperCase()}
                  </b>
                  {related.summary}
                </li>
              ))}
              {relatedEvents.length === 0 && <li>NO RELATED EVENTS</li>}
            </ul>
          </div>
        )}

        {(event.spanId || event.parentSpanId) && (
          <div className="inspector-section compact" data-testid="span-context">
            <div className="section-label">
              <span>SPAN CONTEXT</span>
            </div>
            <dl className="inspector-facts">
              <div>
                <dt>SPAN</dt>
                <dd>{displayValue(event.spanId)}</dd>
              </div>
              <div>
                <dt>PARENT SPAN</dt>
                <dd>{displayValue(event.parentSpanId)}</dd>
              </div>
            </dl>
          </div>
        )}

        {event.runtime && (
          <div className="inspector-section compact" data-testid="runtime-context">
            <div className="section-label">
              <span>RUNTIME CONTEXT</span>
              <span>EFFECT</span>
            </div>
            <dl className="inspector-facts">
              <div>
                <dt>PHASE</dt>
                <dd>{displayValue(event.runtime.phase)}</dd>
              </div>
              <div>
                <dt>FIBER</dt>
                <dd>{displayValue(event.runtime.fiberId)}</dd>
              </div>
              <div>
                <dt>SCOPE</dt>
                <dd>{displayValue(event.runtime.scopeId)}</dd>
              </div>
            </dl>
            {event.runtime.cause !== undefined && (
              <>
                <div className="section-label secondary-label">
                  <span>SANITIZED CAUSE</span>
                  <span>READ ONLY</span>
                </div>
                <JsonPayload value={event.runtime.cause} />
              </>
            )}
          </div>
        )}

        {edge && (
          <div className="inspector-section compact" data-testid="edge-traversal">
            <div className="section-label">
              <span>EDGE TRAVERSAL</span>
              <span>{edge.kind.toUpperCase()}</span>
            </div>
            <dl className="inspector-facts">
              <div>
                <dt>EDGE</dt>
                <dd>{edge.id}</dd>
              </div>
              <div>
                <dt>PATH</dt>
                <dd>
                  {edge.source} → {edge.target}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {appNode && (
          <div className="inspector-section compact" data-testid="apps-declarations">
            <div className="section-label">
              <span>APPS DECLARATIONS</span>
              <span>GRAPH / TRACE</span>
            </div>
            <dl className="inspector-facts">
              <div>
                <dt>PROFILE</dt>
                <dd>{appNode.config.profile}</dd>
              </div>
              {appNode.kind === "app-view" && (
                <div>
                  <dt>SANDBOX</dt>
                  <dd>{appNode.config.sandbox ? "SANDBOXED" : "NOT SANDBOXED"}</dd>
                </div>
              )}
              {appNode.kind === "app-resource" && (
                <div>
                  <dt>RESOURCE URI</dt>
                  <dd>{appNode.config.uri}</dd>
                </div>
              )}
              {policyOutcome && (
                <div>
                  <dt>POLICY</dt>
                  <dd>POLICY {policyOutcome.toUpperCase()}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="inspector-section">
          <div className="section-label">
            <span>SANITIZED PAYLOAD</span>
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
