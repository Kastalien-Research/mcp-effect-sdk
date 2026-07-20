"use client"

import { ArrowClockwiseIcon, PlayIcon, StopIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { ExecutionTimeline } from "./components/ExecutionTimeline"
import { InspectorPanel } from "./components/InspectorPanel"
import { TopologyCanvas } from "./components/TopologyCanvas"
import type { McpTraceEvent } from "./model/McpTraceDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import { TraceReplay } from "./trace/TraceReplay"

interface McpIdeAppProps {
  readonly replay?: TraceReplay
}

type Selection =
  | { readonly type: "node"; readonly id: string }
  | { readonly type: "event"; readonly id: string }

const statusCopy = {
  idle: "READY TO RUN",
  running: "TRACE RUNNING",
  completed: "RUN COMPLETE",
  cancelled: "RUN CANCELLED",
  failed: "RUN FAILED",
} as const

export function McpIdeApp({ replay: providedReplay }: McpIdeAppProps) {
  const defaultReplay = useMemo(
    () => new TraceReplay(gatewayTaskScenario.graph, gatewayTaskScenario.trace),
    [],
  )
  const replay = providedReplay ?? defaultReplay
  const subscribe = useCallback((listener: () => void) => replay.subscribe(listener), [replay])
  const getSnapshot = useCallback(() => replay.getSnapshot(), [replay])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [selection, setSelection] = useState<Selection>({ type: "node", id: "client" })

  const currentEvent = snapshot.appliedEvents.at(-1)

  useEffect(() => {
    if (currentEvent) setSelection({ type: "event", id: currentEvent.id })
  }, [currentEvent])

  const selectedEvent: McpTraceEvent | undefined =
    selection.type === "event"
      ? snapshot.appliedEvents.find(event => event.id === selection.id)
      : undefined
  const selectedNode =
    selection.type === "node"
      ? gatewayTaskScenario.graph.nodes.find(node => node.id === selection.id)
      : undefined

  const runTrace = () => {
    void replay.run()
  }

  const resetTrace = () => {
    replay.reset()
    setSelection({ type: "node", id: "client" })
  }

  return (
    <main className="mcp-ide-shell">
      <header className="ide-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <span className="brand-title">EFFECT MCP IDE</span>
            <span className="brand-subtitle">PROTOCOL WORKBENCH / TRACE CHECKPOINT</span>
          </div>
        </div>

        <div className="run-readout" data-status={snapshot.status}>
          <span className="readout-source">
            <i />
            FIXTURE REPLAY
          </span>
          <strong>{statusCopy[snapshot.status]}</strong>
          <span>
            {snapshot.appliedEvents.length} / {gatewayTaskScenario.trace.events.length} EVENTS
          </span>
        </div>

        <fieldset className="run-controls">
          <legend className="visually-hidden">Trace controls</legend>
          {snapshot.status === "running" ? (
            <button
              type="button"
              className="control danger"
              data-testid="cancel-trace"
              onClick={() => replay.cancel()}
            >
              <StopIcon size={15} weight="fill" />
              CANCEL
            </button>
          ) : (
            <button
              type="button"
              className="control primary"
              data-testid="run-trace"
              onClick={runTrace}
            >
              <PlayIcon size={15} weight="fill" />
              RUN TRACE
            </button>
          )}
          <button type="button" className="control" data-testid="reset-trace" onClick={resetTrace}>
            <ArrowClockwiseIcon size={15} weight="bold" />
            RESET
          </button>
        </fieldset>
      </header>

      <div className="ide-grid">
        <nav className="graph-rail" aria-label="Graph document outline">
          <div className="rail-section">
            <span className="eyebrow">GRAPH DOCUMENT</span>
            <h1>{gatewayTaskScenario.graph.name}</h1>
            <p>{gatewayTaskScenario.graph.description}</p>
          </div>

          <div className="contract-meter">
            <div>
              <span>SCHEMA</span>
              <strong>V{gatewayTaskScenario.graph.schemaVersion}</strong>
            </div>
            <div>
              <span>NODES</span>
              <strong>{gatewayTaskScenario.graph.nodes.length}</strong>
            </div>
            <div>
              <span>EDGES</span>
              <strong>{gatewayTaskScenario.graph.edges.length}</strong>
            </div>
          </div>

          <div className="validation-strip">
            <i />
            VALID / 0 ISSUES
          </div>

          <div className="rail-outline">
            <span className="eyebrow">COMPONENTS</span>
            {gatewayTaskScenario.graph.nodes.map((node, index) => {
              const state = snapshot.nodeStates.get(node.id) ?? "idle"
              return (
                <button
                  type="button"
                  key={node.id}
                  data-selected={
                    selection.type === "node" && selection.id === node.id ? "true" : "false"
                  }
                  data-state={state}
                  onClick={() => setSelection({ type: "node", id: node.id })}
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

          <div className="authoring-note">
            <span>AUTHORING SUBSTRATE</span>
            This topology is loaded from the same typed document the editable canvas will mutate.
          </div>
        </nav>

        <div className="workspace-column">
          <TopologyCanvas
            graph={gatewayTaskScenario.graph}
            nodeStates={snapshot.nodeStates}
            {...(selection.type === "node" ? { selectedNodeId: selection.id } : {})}
            {...(currentEvent ? { currentEvent } : {})}
            onSelectNode={id => setSelection({ type: "node", id })}
          />
          <ExecutionTimeline
            trace={gatewayTaskScenario.trace}
            appliedEvents={snapshot.appliedEvents}
            {...(selection.type === "event" ? { selectedEventId: selection.id } : {})}
            onSelectEvent={id => setSelection({ type: "event", id })}
          />
        </div>

        <InspectorPanel
          graph={gatewayTaskScenario.graph}
          {...(selectedNode ? { node: selectedNode } : {})}
          {...(selectedNode
            ? { nodeState: snapshot.nodeStates.get(selectedNode.id) ?? "idle" }
            : {})}
          {...(selectedEvent ? { event: selectedEvent } : {})}
        />
      </div>
    </main>
  )
}
