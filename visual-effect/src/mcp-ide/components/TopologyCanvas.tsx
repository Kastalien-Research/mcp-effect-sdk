"use client"

import { motion } from "motion/react"
import type { McpGraphDocument, McpGraphNode } from "../model/McpGraphDocument"
import type { McpNodeExecutionState, McpTraceEvent } from "../model/McpTraceDocument"

const NODE_WIDTH = 190
const NODE_HEIGHT = 112
const CANVAS_WIDTH = 930
const CANVAS_HEIGHT = 390

const kindLabels: Record<McpGraphNode["kind"], string> = {
  client: "MCP CLIENT",
  gateway: "GATEWAY",
  server: "MCP SERVER",
  tool: "TOOL",
  resource: "RESOURCE",
  prompt: "PROMPT",
  task: "ASYNC TASK",
  "app-host": "APPS HOST",
  "app-view": "APPS VIEW",
  "app-resource": "UI RESOURCE",
}

const nodeSignal: Record<McpGraphNode["kind"], string> = {
  client: "HTTP",
  gateway: "ROUTE",
  server: "VERTICAL",
  tool: "CALL",
  resource: "READ",
  prompt: "GET",
  task: "POLL",
  "app-host": "HOST",
  "app-view": "VIEW",
  "app-resource": "UI://",
}

const stateLabel = (state: McpNodeExecutionState) => state.replace("-", " ").toUpperCase()

interface TopologyCanvasProps {
  readonly graph: McpGraphDocument
  readonly nodeStates: ReadonlyMap<string, McpNodeExecutionState>
  readonly selectedNodeId?: string
  readonly currentEvent?: McpTraceEvent
  readonly onSelectNode: (nodeId: string) => void
}

export function TopologyCanvas({
  graph,
  nodeStates,
  selectedNodeId,
  currentEvent,
  onSelectNode,
}: TopologyCanvasProps) {
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]))

  return (
    <section className="topology-panel" aria-label="MCP process topology">
      <div className="panel-chrome topology-chrome">
        <div>
          <span className="eyebrow">APPLICATION TOPOLOGY</span>
          <h2>{graph.name}</h2>
        </div>
        <fieldset className="canvas-legend">
          <legend className="visually-hidden">Execution state legend</legend>
          <span>
            <i className="legend-dot idle" />
            IDLE
          </span>
          <span>
            <i className="legend-dot active" />
            ACTIVE
          </span>
          <span>
            <i className="legend-dot waiting" />
            WAITING
          </span>
          <span>
            <i className="legend-dot completed" />
            COMPLETE
          </span>
        </fieldset>
      </div>

      <div className="topology-scroll">
        <div className="topology-canvas">
          <div className="topology-grid" />
          <div className="scan-beam" data-running={currentEvent ? "true" : "false"} />

          <svg
            className="edge-layer"
            aria-hidden="true"
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          >
            <defs>
              <marker
                id="edge-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {graph.edges.map(edge => {
              const source = nodesById.get(edge.source)
              const target = nodesById.get(edge.target)
              if (!source || !target) return null

              const vertical = Math.abs(source.position.x - target.position.x) < 40
              const x1 = vertical
                ? source.position.x + NODE_WIDTH / 2
                : source.position.x + NODE_WIDTH
              const y1 = vertical
                ? source.position.y + NODE_HEIGHT
                : source.position.y + NODE_HEIGHT / 2
              const x2 = vertical ? target.position.x + NODE_WIDTH / 2 : target.position.x
              const y2 = vertical ? target.position.y : target.position.y + NODE_HEIGHT / 2
              const middle = vertical ? (y1 + y2) / 2 : (x1 + x2) / 2
              const path = vertical
                ? `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`
                : `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`
              const sourceState = nodeStates.get(source.id) ?? "idle"
              const targetState = nodeStates.get(target.id) ?? "idle"
              const energized =
                sourceState === "active" ||
                sourceState === "waiting" ||
                targetState === "active" ||
                targetState === "waiting"

              return (
                <g key={edge.id} className={energized ? "edge energized" : "edge"}>
                  <path className="edge-shadow" d={path} />
                  <path className="edge-line" d={path} markerEnd="url(#edge-arrow)" />
                  <text
                    x={vertical ? x1 + 13 : middle}
                    y={vertical ? middle : (y1 + y2) / 2 - 9}
                    className="edge-label"
                  >
                    {edge.kind.toUpperCase()}
                  </text>
                </g>
              )
            })}
          </svg>

          {graph.nodes.map((node, index) => {
            const state = nodeStates.get(node.id) ?? "idle"
            const selected = selectedNodeId === node.id
            const eventOnNode = currentEvent?.nodeId === node.id

            return (
              <motion.button
                type="button"
                key={node.id}
                className="topology-node"
                data-kind={node.kind}
                data-state={state}
                data-selected={selected ? "true" : "false"}
                data-event-node={eventOnNode ? "true" : "false"}
                style={{ left: node.position.x, top: node.position.y }}
                onClick={() => onSelectNode(node.id)}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: eventOnNode ? 1.025 : 1 }}
                transition={{ delay: index * 0.045, type: "spring", stiffness: 280, damping: 24 }}
                aria-label={`Inspect ${node.label}`}
              >
                <span className="node-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="node-kind">{kindLabels[node.kind]}</span>
                <span className="node-title">{node.label}</span>
                <span className="node-footer">
                  <span className="node-signal">{nodeSignal[node.kind]}</span>
                  <span className="node-state">
                    <i />
                    {stateLabel(state)}
                  </span>
                </span>
                <span className="node-core" aria-hidden="true">
                  <i />
                </span>
              </motion.button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
