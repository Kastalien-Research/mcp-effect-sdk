"use client"

import type { McpGraphDocument, McpNodeKind } from "../model/McpGraphDocument"
import type { McpNodeExecutionState } from "../model/McpTraceDocument"

export type McpIdeMode = "author" | "trace"

interface GraphRailProps {
  readonly mode: McpIdeMode
  readonly graph: McpGraphDocument
  readonly nodeStates: ReadonlyMap<string, McpNodeExecutionState>
  readonly selectedNodeId?: string
  readonly selectedDocument: boolean
  readonly issue?: string
  readonly traceCompatible: boolean
  readonly onSelectNode: (nodeId: string) => void
  readonly onSelectDocument: () => void
  readonly onAddNode: (kind: McpNodeKind) => void
}

const paletteGroups: ReadonlyArray<{
  readonly label: string
  readonly kinds: ReadonlyArray<{ readonly kind: McpNodeKind; readonly label: string }>
}> = [
  {
    label: "PROTOCOL",
    kinds: [
      { kind: "client", label: "Client" },
      { kind: "gateway", label: "Gateway" },
      { kind: "server", label: "Server" },
    ],
  },
  {
    label: "CAPABILITIES",
    kinds: [
      { kind: "tool", label: "Tool" },
      { kind: "resource", label: "Resource" },
      { kind: "prompt", label: "Prompt" },
    ],
  },
  {
    label: "RUNTIME + APPS",
    kinds: [
      { kind: "task", label: "Task" },
      { kind: "app-host", label: "App host" },
      { kind: "app-view", label: "App view" },
      { kind: "app-resource", label: "UI resource" },
    ],
  },
]

export function GraphRail({
  mode,
  graph,
  nodeStates,
  selectedNodeId,
  selectedDocument,
  issue,
  traceCompatible,
  onSelectNode,
  onSelectDocument,
  onAddNode,
}: GraphRailProps) {
  return (
    <nav className="graph-rail" aria-label="Graph document and node palette">
      <div className="rail-section">
        <span className="eyebrow">GRAPH DOCUMENT</span>
        <h1>{graph.name}</h1>
        <p>{graph.description}</p>
      </div>

      <div className="contract-meter">
        <div>
          <span>SCHEMA</span>
          <strong>V{graph.schemaVersion}</strong>
        </div>
        <div>
          <span>NODES</span>
          <strong>{graph.nodes.length}</strong>
        </div>
        <div>
          <span>EDGES</span>
          <strong>{graph.edges.length}</strong>
        </div>
      </div>

      <div
        className="validation-strip"
        data-valid={issue || !traceCompatible ? "false" : "true"}
        title={issue}
      >
        <i />
        {issue
          ? `EDIT REJECTED / ${issue}`
          : mode === "trace" && !traceCompatible
            ? "TRACE INCOMPATIBLE"
            : "VALID / 0 ISSUES"}
      </div>

      {mode === "author" ? (
        <div className="node-palette">
          <span className="eyebrow">NODE PALETTE</span>
          {paletteGroups.map(group => (
            <section key={group.label}>
              <h2>{group.label}</h2>
              <div>
                {group.kinds.map(item => (
                  <button
                    type="button"
                    key={item.kind}
                    data-kind={item.kind}
                    data-testid={`palette-${item.kind}`}
                    onClick={() => onAddNode(item.kind)}
                  >
                    <i />
                    {item.label}
                    <span>+</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <button
            type="button"
            className="document-button"
            data-selected={selectedDocument ? "true" : "false"}
            data-testid="open-graph-json"
            onClick={onSelectDocument}
          >
            DOCUMENT JSON
            <span>↗</span>
          </button>
          <p className="palette-count">
            {graph.nodes.length} NODES / {graph.edges.length} EDGES
          </p>
        </div>
      ) : (
        <div className="rail-outline">
          <span className="eyebrow">COMPONENTS</span>
          {graph.nodes.map((node, index) => {
            const state = nodeStates.get(node.id) ?? "idle"
            return (
              <button
                type="button"
                key={node.id}
                data-selected={selectedNodeId === node.id ? "true" : "false"}
                data-state={state}
                onClick={() => onSelectNode(node.id)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <b>{node.label}</b>
                  <small>{node.kind}</small>
                </span>
                <i />
              </button>
            )
          })}
        </div>
      )}

      <div className="authoring-note">
        <span>{mode === "author" ? "AUTHORING ACTIVE" : "SHARED GRAPH"}</span>
        {mode === "author"
          ? "Every edit is a validated command over the versioned graph document."
          : "This trace projects onto the same typed document used by authoring."}
      </div>
    </nav>
  )
}
