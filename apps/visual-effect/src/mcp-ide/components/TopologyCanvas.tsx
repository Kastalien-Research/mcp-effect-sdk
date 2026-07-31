"use client"

import { motion } from "motion/react"
import { type PointerEvent as ReactPointerEvent, useState } from "react"
import { inferEdgeKind } from "../authoring/GraphCommands"
import { graphNodeDefinition, graphNodePorts } from "../model/GraphRegistry"
import type { McpGraphDocument, McpGraphNode } from "../model/McpGraphDocument"
import type { McpNodeExecutionState, McpTraceEvent } from "../model/McpTraceDocument"

const NODE_WIDTH = 190
const NODE_HEIGHT = 112
const MIN_CANVAS_WIDTH = 930
const MIN_CANVAS_HEIGHT = 390

const stateLabel = (state: McpNodeExecutionState) => state.replace("-", " ").toUpperCase()

interface DragState {
  readonly nodeId: string
  readonly pointerId: number
  readonly pointerX: number
  readonly pointerY: number
  readonly originX: number
  readonly originY: number
  readonly x: number
  readonly y: number
  readonly moved: boolean
}

interface TopologyCanvasProps {
  readonly graph: McpGraphDocument
  readonly nodeStates: ReadonlyMap<string, McpNodeExecutionState>
  readonly selectedNodeId?: string
  readonly currentEvent?: McpTraceEvent
  readonly editable?: boolean
  readonly connectingFromNodeId?: string
  readonly onSelectNode: (nodeId: string) => void
  readonly onMoveNode?: (nodeId: string, position: McpGraphNode["position"]) => void
  readonly onBeginConnection?: (nodeId: string) => void
  readonly onCompleteConnection?: (nodeId: string) => void
}

export function TopologyCanvas({
  graph,
  nodeStates,
  selectedNodeId,
  currentEvent,
  editable = false,
  connectingFromNodeId,
  onSelectNode,
  onMoveNode,
  onBeginConnection,
  onCompleteConnection,
}: TopologyCanvasProps) {
  const [drag, setDrag] = useState<DragState>()
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]))
  const connectionSource = connectingFromNodeId ? nodesById.get(connectingFromNodeId) : undefined
  const canvasWidth = Math.max(
    MIN_CANVAS_WIDTH,
    ...graph.nodes.map(node => node.position.x + NODE_WIDTH + 40),
  )
  const canvasHeight = Math.max(
    MIN_CANVAS_HEIGHT,
    ...graph.nodes.map(node => node.position.y + NODE_HEIGHT + 40),
  )

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, node: McpGraphNode) => {
    if (!editable || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      nodeId: node.id,
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
      x: node.position.x,
      y: node.position.y,
      moved: false,
    })
  }

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.pointerX
    const deltaY = event.clientY - drag.pointerY
    const x = Math.round(Math.max(0, Math.min(canvasWidth - NODE_WIDTH, drag.originX + deltaX)))
    const y = Math.round(Math.max(0, Math.min(canvasHeight - NODE_HEIGHT, drag.originY + deltaY)))
    setDrag({
      ...drag,
      x,
      y,
      moved: drag.moved || Math.abs(deltaX) + Math.abs(deltaY) > 3,
    })
  }

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.moved) onMoveNode?.(drag.nodeId, { x: drag.x, y: drag.y })
    onSelectNode(drag.nodeId)
    setDrag(undefined)
  }

  return (
    <section className="topology-panel" aria-label="MCP process topology">
      <div className="panel-chrome topology-chrome">
        <div>
          <span className="eyebrow">
            {editable ? "EDITABLE APPLICATION GRAPH" : "APPLICATION TOPOLOGY"}
          </span>
          <h2>{graph.name}</h2>
        </div>
        {editable ? (
          <div className="authoring-legend">
            <span data-active={connectionSource ? "true" : "false"}>
              {connectionSource
                ? `CONNECTING FROM ${connectionSource.id}`
                : "DRAG TO POSITION / PORTS TO WIRE"}
            </span>
          </div>
        ) : (
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
        )}
      </div>

      <div className="topology-scroll">
        <div className="topology-canvas" style={{ width: canvasWidth, height: canvasHeight }}>
          <div className="topology-grid" />
          <div className="scan-beam" data-running={currentEvent ? "true" : "false"} />

          <svg
            className="edge-layer"
            aria-hidden="true"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            style={{ width: canvasWidth, height: canvasHeight }}
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

              const sourcePosition =
                drag?.nodeId === source.id ? { x: drag.x, y: drag.y } : source.position
              const targetPosition =
                drag?.nodeId === target.id ? { x: drag.x, y: drag.y } : target.position
              const vertical = Math.abs(sourcePosition.x - targetPosition.x) < 40
              const x1 = vertical
                ? sourcePosition.x + NODE_WIDTH / 2
                : sourcePosition.x + NODE_WIDTH
              const y1 = vertical
                ? sourcePosition.y + NODE_HEIGHT
                : sourcePosition.y + NODE_HEIGHT / 2
              const x2 = vertical ? targetPosition.x + NODE_WIDTH / 2 : targetPosition.x
              const y2 = vertical ? targetPosition.y : targetPosition.y + NODE_HEIGHT / 2
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
            const position = drag?.nodeId === node.id ? { x: drag.x, y: drag.y } : node.position
            const compatibleTarget = connectionSource
              ? inferEdgeKind(connectionSource.kind, node.kind) !== undefined
              : false
            const definition = graphNodeDefinition(node.kind)
            const ports = graphNodePorts(node.kind)

            return (
              <motion.div
                key={node.id}
                className="topology-node"
                data-kind={node.kind}
                data-state={state}
                data-selected={selected ? "true" : "false"}
                data-event-node={eventOnNode ? "true" : "false"}
                data-dragging={drag?.nodeId === node.id ? "true" : "false"}
                data-connect-source={connectingFromNodeId === node.id ? "true" : "false"}
                style={{ left: position.x, top: position.y }}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: eventOnNode ? 1.025 : 1 }}
                transition={{ delay: index * 0.045, type: "spring", stiffness: 280, damping: 24 }}
              >
                <button
                  type="button"
                  className="node-body"
                  data-testid={`node-${node.id}`}
                  onClick={() => onSelectNode(node.id)}
                  onPointerDown={event => beginDrag(event, node)}
                  onPointerMove={moveDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  aria-label={`${editable ? "Edit" : "Inspect"} ${node.label}`}
                >
                  <span className="node-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="node-kind">{definition.displayLabel}</span>
                  <span className="node-title">{node.label}</span>
                  <span className="node-footer">
                    <span className="node-signal">{definition.signal}</span>
                    <span className="node-state">
                      <i />
                      {editable ? "AUTHORED" : stateLabel(state)}
                    </span>
                  </span>
                  <span className="node-core" aria-hidden="true">
                    <i />
                  </span>
                </button>
                {editable && (
                  <>
                    {ports.input && (
                      <button
                        type="button"
                        className="node-port input"
                        data-compatible={compatibleTarget ? "true" : "false"}
                        data-testid={`connect-to-${node.id}`}
                        disabled={!connectionSource || connectionSource.id === node.id}
                        onClick={() => onCompleteConnection?.(node.id)}
                        aria-label={`Connect to ${node.label}`}
                      />
                    )}
                    {ports.output && (
                      <button
                        type="button"
                        className="node-port output"
                        data-testid={`connect-from-${node.id}`}
                        data-active={connectingFromNodeId === node.id ? "true" : "false"}
                        onClick={() => onBeginConnection?.(node.id)}
                        aria-label={`Connect from ${node.label}`}
                      />
                    )}
                  </>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
