"use client"

import { graphNodeDefinition } from "../model/GraphRegistry"
import {
  GRAPH_NODE_KINDS,
  type McpGraphDocument,
  type McpNodeKind,
} from "../model/McpGraphDocument"
import type { McpNodeExecutionState } from "../model/McpTraceDocument"

export type McpIdeMode = "author" | "trace"

interface GraphRailProps {
  readonly mode: McpIdeMode
  readonly graph: McpGraphDocument
  readonly nodeStates: ReadonlyMap<string, McpNodeExecutionState>
  readonly selectedNodeId?: string
  readonly selectedDocument: boolean
  readonly selectedProject: boolean
  readonly issue?: string
  readonly traceCompatible: boolean
  readonly onSelectNode: (nodeId: string) => void
  readonly onSelectDocument: () => void
  readonly onSelectProject: () => void
  readonly onAddNode: (kind: McpNodeKind) => void
}

const paletteGroups: ReadonlyArray<{
  readonly label: string
  readonly group: "protocol" | "capabilities" | "runtime-apps"
}> = [
  { label: "PROTOCOL", group: "protocol" },
  { label: "CAPABILITIES", group: "capabilities" },
  { label: "RUNTIME + APPS", group: "runtime-apps" },
]

export function GraphRail({
  mode,
  graph,
  nodeStates,
  selectedNodeId,
  selectedDocument,
  selectedProject,
  issue,
  traceCompatible,
  onSelectNode,
  onSelectDocument,
  onSelectProject,
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
                {GRAPH_NODE_KINDS.filter(
                  kind => graphNodeDefinition(kind).paletteGroup === group.group,
                ).map(kind => {
                  const definition = graphNodeDefinition(kind)
                  return (
                    <button
                      type="button"
                      key={kind}
                      data-kind={kind}
                      data-testid={`palette-${kind}`}
                      onClick={() => onAddNode(kind)}
                    >
                      <i />
                      {definition.paletteLabel}
                      <span>+</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          <div className="rail-document-actions">
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
            <button
              type="button"
              className="document-button"
              data-selected={selectedProject ? "true" : "false"}
              data-testid="open-project-source"
              onClick={onSelectProject}
            >
              PROJECT SOURCE
              <span>↗</span>
            </button>
          </div>
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
