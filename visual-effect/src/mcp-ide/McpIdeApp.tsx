"use client"

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  PauseIcon,
  PlayIcon,
  SkipForwardIcon,
  StopIcon,
} from "@phosphor-icons/react"
import { Effect, Either } from "effect"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import {
  createEdgeId,
  createGraphHistory,
  createPaletteNode,
  executeGraphCommand,
  inferEdgeKind,
  type McpGraphCommand,
  type McpGraphCommandFailure,
  type McpGraphHistory,
  redoGraphHistory,
  undoGraphHistory,
} from "./authoring/GraphCommands"
import { parseGraphDocument } from "./authoring/GraphDocumentIO"
import { parseProjectBundle } from "./authoring/McpProjectBundleIO"
import { parseTraceDocument } from "./authoring/TraceDocumentIO"
import { AuthoringInspector } from "./components/AuthoringInspector"
import { DocumentInspector, type McpDocumentKind } from "./components/DocumentInspector"
import { ExecutionTimeline } from "./components/ExecutionTimeline"
import { GraphRail, type McpIdeMode } from "./components/GraphRail"
import { InspectorPanel } from "./components/InspectorPanel"
import { TopologyCanvas } from "./components/TopologyCanvas"
import type {
  McpGraphDocument,
  McpGraphIssue,
  McpGraphNode,
  McpNodeKind,
} from "./model/McpGraphDocument"
import type {
  McpNodeExecutionState,
  McpTraceDocument,
  McpTraceEvent,
} from "./model/McpTraceDocument"
import { gatewayTaskScenario } from "./scenarios/gatewayTaskScenario"
import { TraceReplay } from "./trace/TraceReplay"

interface McpIdeAppProps {
  readonly replay?: TraceReplay
}

type Selection =
  | { readonly type: "node"; readonly id: string }
  | { readonly type: "event"; readonly id: string }
  | { readonly type: "document" }

const statusCopy = {
  idle: "READY TO RUN",
  running: "TRACE RUNNING",
  paused: "TRACE PAUSED",
  completed: "RUN COMPLETE",
  cancelled: "RUN CANCELLED",
  failed: "RUN FAILED",
} as const

const authoringFailureMessage = (failure: McpGraphCommandFailure): string =>
  failure._tag === "McpGraphValidationError"
    ? failure.issues.map(issue => issue.message).join(" · ")
    : failure.message

interface McpDocumentFailure {
  readonly _tag: string
  readonly message?: string
  readonly issues?: ReadonlyArray<{ readonly message: string }>
}

const documentFailureMessage = (failure: McpDocumentFailure): string =>
  failure.issues?.map(issue => issue.message).join(" · ") ??
  failure.message ??
  "The document could not be imported"

const suggestPosition = (graph: McpGraphDocument): McpGraphNode["position"] => {
  for (let column = 0; column < 24; column += 1) {
    for (const y of [20, 250]) {
      const candidate = { x: 40 + column * 220, y }
      const occupied = graph.nodes.some(
        node =>
          Math.abs(node.position.x - candidate.x) < 190 &&
          Math.abs(node.position.y - candidate.y) < 112,
      )
      if (!occupied) return candidate
    }
  }

  return { x: 40 + graph.nodes.length * 24, y: 250 }
}

export function McpIdeApp({ replay: providedReplay }: McpIdeAppProps) {
  const [mode, setMode] = useState<McpIdeMode>("author")
  const [history, setHistory] = useState<McpGraphHistory>(() =>
    createGraphHistory(gatewayTaskScenario.graph),
  )
  const [trace, setTrace] = useState<McpTraceDocument>(() => gatewayTaskScenario.trace)
  const [selection, setSelection] = useState<Selection>({ type: "node", id: "client" })
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string>()
  const [authoringIssue, setAuthoringIssue] = useState<string>()
  const [authoringIssues, setAuthoringIssues] = useState<ReadonlyArray<McpGraphIssue>>([])
  const graph = history.present

  const replayValidation = useMemo(
    () => Effect.runSync(TraceReplay.make(graph, trace).pipe(Effect.either)),
    [graph, trace],
  )
  const generatedReplay = useMemo(() => {
    if (Either.isRight(replayValidation)) return replayValidation.right
    return Effect.runSync(
      TraceReplay.make(graph, {
        ...trace,
        graphId: graph.id,
        graphRevision: graph.revision,
        events: [],
      }),
    )
  }, [graph, replayValidation, trace])
  const replay = providedReplay ?? generatedReplay
  const subscribe = useCallback((listener: () => void) => replay.subscribe(listener), [replay])
  const getSnapshot = useCallback(() => replay.getSnapshot(), [replay])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const traceCompatible = Either.isRight(replayValidation)
  const traceIssue = Either.isLeft(replayValidation)
    ? replayValidation.left.issues.map(issue => issue.message).join(" · ")
    : undefined
  const currentEvent = snapshot.appliedEvents.at(-1)

  useEffect(() => {
    if (mode === "trace" && currentEvent) setSelection({ type: "event", id: currentEvent.id })
  }, [currentEvent, mode])

  useEffect(() => {
    if (selection.type === "node" && !graph.nodes.some(node => node.id === selection.id)) {
      const [firstNode] = graph.nodes
      setSelection(firstNode ? { type: "node", id: firstNode.id } : { type: "document" })
    }
  }, [graph.nodes, selection])

  useEffect(() => {
    const clearConnection = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConnectingFromNodeId(undefined)
    }
    window.addEventListener("keydown", clearConnection)
    return () => window.removeEventListener("keydown", clearConnection)
  }, [])

  const selectedEvent: McpTraceEvent | undefined =
    selection.type === "event" ? trace.events.find(event => event.id === selection.id) : undefined
  const selectedNode =
    selection.type === "node" ? graph.nodes.find(node => node.id === selection.id) : undefined

  const execute = (command: McpGraphCommand): boolean => {
    const result = Effect.runSync(executeGraphCommand(history, command).pipe(Effect.either))
    if (Either.isLeft(result)) {
      setAuthoringIssue(authoringFailureMessage(result.left))
      setAuthoringIssues(result.left._tag === "McpGraphValidationError" ? result.left.issues : [])
      return false
    }

    replay.reset()
    setHistory(result.right)
    setAuthoringIssue(undefined)
    setAuthoringIssues([])
    return true
  }

  const addNode = (kind: McpNodeKind) => {
    const node = createPaletteNode(graph, kind, suggestPosition(graph))
    if (execute({ type: "node.add", node })) setSelection({ type: "node", id: node.id })
  }

  const moveNode = (nodeId: string, position: McpGraphNode["position"]) => {
    execute({ type: "node.move", nodeId, position })
  }

  const duplicateNode = (node: McpGraphNode) => {
    const duplicate = createPaletteNode(graph, node.kind, {
      x: node.position.x + 32,
      y: node.position.y + 32,
    })
    if (
      execute({
        type: "node.duplicate",
        nodeId: node.id,
        duplicateId: duplicate.id,
        position: duplicate.position,
      })
    ) {
      setSelection({ type: "node", id: duplicate.id })
    }
  }

  const removeNode = (nodeId: string) => {
    if (!execute({ type: "node.remove", nodeId })) return
    const nextNode = graph.nodes.find(node => node.id !== nodeId)
    setSelection(nextNode ? { type: "node", id: nextNode.id } : { type: "document" })
    if (connectingFromNodeId === nodeId) setConnectingFromNodeId(undefined)
  }

  const completeConnection = (targetId: string) => {
    if (!connectingFromNodeId) return
    const source = graph.nodes.find(node => node.id === connectingFromNodeId)
    const target = graph.nodes.find(node => node.id === targetId)
    if (!source || !target) return
    const kind = inferEdgeKind(source.kind, target.kind)
    if (!kind) {
      setAuthoringIssue(`No typed edge can connect ${source.kind} → ${target.kind}`)
      setAuthoringIssues([])
      return
    }

    const connected = execute({
      type: "edge.connect",
      edge: {
        id: createEdgeId(graph, source.id, target.id),
        kind,
        source: source.id,
        target: target.id,
      },
    })
    if (connected) {
      setConnectingFromNodeId(undefined)
      setSelection({ type: "node", id: target.id })
    }
  }

  const undo = () => {
    if (history.past.length === 0) return
    replay.reset()
    setHistory(undoGraphHistory(history))
    setAuthoringIssue(undefined)
    setAuthoringIssues([])
  }

  const redo = () => {
    if (history.future.length === 0) return
    replay.reset()
    setHistory(redoGraphHistory(history))
    setAuthoringIssue(undefined)
    setAuthoringIssues([])
  }

  const rejectDocumentImport = (failure: McpDocumentFailure) => {
    setAuthoringIssue(documentFailureMessage(failure))
    setAuthoringIssues(
      failure._tag === "McpGraphValidationError"
        ? (failure.issues as ReadonlyArray<McpGraphIssue>)
        : [],
    )
  }

  const importDocument = (
    kind: McpDocumentKind,
    source: string,
    options: { readonly allowLegacyRebind: boolean },
  ) => {
    if (kind === "trace") {
      const result = Effect.runSync(parseTraceDocument(source, graph, options).pipe(Effect.either))
      if (Either.isLeft(result)) {
        rejectDocumentImport(result.left)
        return
      }
      replay.reset()
      setTrace(result.right)
      setAuthoringIssue(undefined)
      setAuthoringIssues([])
      return
    }

    if (kind === "bundle") {
      const result = Effect.runSync(parseProjectBundle(source, options).pipe(Effect.either))
      if (Either.isLeft(result)) {
        rejectDocumentImport(result.left)
        return
      }
      replay.reset()
      setHistory(createGraphHistory(result.right.graph))
      if (result.right.trace) setTrace(result.right.trace)
      setSelection({ type: "document" })
      setConnectingFromNodeId(undefined)
      setAuthoringIssue(undefined)
      setAuthoringIssues([])
      return
    }

    const result = Effect.runSync(parseGraphDocument(source).pipe(Effect.either))
    if (Either.isLeft(result)) {
      rejectDocumentImport(result.left)
      return
    }

    replay.reset()
    setHistory(createGraphHistory(result.right))
    setSelection({ type: "document" })
    setConnectingFromNodeId(undefined)
    setAuthoringIssue(undefined)
    setAuthoringIssues([])
  }

  const resetDocument = () => {
    replay.reset()
    setHistory(createGraphHistory(gatewayTaskScenario.graph))
    setTrace(gatewayTaskScenario.trace)
    setSelection({ type: "node", id: "client" })
    setConnectingFromNodeId(undefined)
    setAuthoringIssue(undefined)
    setAuthoringIssues([])
  }

  const switchMode = (nextMode: McpIdeMode) => {
    if (snapshot.status === "running") replay.cancel()
    setMode(nextMode)
    setConnectingFromNodeId(undefined)
    if (nextMode === "author" && selection.type === "event") {
      setSelection({
        type: "node",
        id: selection.id ? (currentEvent?.nodeId ?? "client") : "client",
      })
    }
  }

  const runTrace = () => {
    if (traceCompatible) void replay.run()
  }

  const resetTrace = () => {
    replay.reset()
    const [firstNode] = graph.nodes
    setSelection(firstNode ? { type: "node", id: firstNode.id } : { type: "document" })
  }

  const idleNodeStates = useMemo(
    () => new Map<string, McpNodeExecutionState>(graph.nodes.map(node => [node.id, "idle"])),
    [graph.nodes],
  )
  const nodeStates = mode === "author" ? idleNodeStates : snapshot.nodeStates

  return (
    <main className="mcp-ide-shell" data-mode={mode}>
      <header className="ide-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <span className="brand-title">EFFECT MCP IDE</span>
            <span className="brand-subtitle">LOW-CODE PROTOCOL WORKBENCH</span>
          </div>
        </div>

        <fieldset className="mode-switch">
          <legend className="visually-hidden">Workbench mode</legend>
          <button
            type="button"
            data-active={mode === "author" ? "true" : "false"}
            data-testid="mode-author"
            onClick={() => switchMode("author")}
          >
            AUTHOR
          </button>
          <button
            type="button"
            data-active={mode === "trace" ? "true" : "false"}
            data-testid="mode-trace"
            onClick={() => switchMode("trace")}
          >
            TRACE
          </button>
        </fieldset>

        <div className="run-readout" data-status={mode === "author" ? "author" : snapshot.status}>
          <span className="readout-source">
            <i />
            {mode === "author" ? "EDITABLE GRAPH" : "FIXTURE REPLAY"}
          </span>
          <strong>
            {mode === "author"
              ? authoringIssue
                ? "EDIT REJECTED"
                : "AUTHORING READY"
              : traceCompatible
                ? statusCopy[snapshot.status]
                : "TRACE INCOMPATIBLE"}
          </strong>
          <span>
            {mode === "author"
              ? `${history.past.length} COMMANDS`
              : `${snapshot.appliedEvents.length} / ${trace.events.length} EVENTS`}
          </span>
        </div>

        <fieldset className="run-controls">
          <legend className="visually-hidden">
            {mode === "author" ? "Graph" : "Trace"} controls
          </legend>
          {mode === "author" ? (
            <>
              <button
                type="button"
                className="control"
                data-testid="undo-graph"
                disabled={history.past.length === 0}
                onClick={undo}
              >
                <ArrowCounterClockwiseIcon size={15} weight="bold" />
                UNDO
              </button>
              <button
                type="button"
                className="control"
                data-testid="redo-graph"
                disabled={history.future.length === 0}
                onClick={redo}
              >
                <ArrowClockwiseIcon size={15} weight="bold" />
                REDO
              </button>
            </>
          ) : (
            <>
              {snapshot.status === "idle" && (
                <button
                  type="button"
                  className="control primary"
                  data-testid="run-trace"
                  disabled={!traceCompatible}
                  title={traceIssue}
                  onClick={runTrace}
                >
                  <PlayIcon size={15} weight="fill" />
                  RUN TRACE
                </button>
              )}
              {snapshot.status === "running" && (
                <button
                  type="button"
                  className="control"
                  data-testid="pause-trace"
                  onClick={() => replay.pause()}
                >
                  <PauseIcon size={15} weight="fill" />
                  PAUSE
                </button>
              )}
              {snapshot.status === "paused" && (
                <button
                  type="button"
                  className="control primary"
                  data-testid="resume-trace"
                  onClick={() => void replay.resume()}
                >
                  <PlayIcon size={15} weight="fill" />
                  RESUME
                </button>
              )}
              {(snapshot.status === "idle" || snapshot.status === "paused") && (
                <button
                  type="button"
                  className="control"
                  data-testid="step-trace"
                  disabled={!traceCompatible}
                  onClick={() => replay.step()}
                >
                  <SkipForwardIcon size={15} weight="fill" />
                  STEP
                </button>
              )}
              {(snapshot.status === "running" || snapshot.status === "paused") && (
                <button
                  type="button"
                  className="control danger"
                  data-testid="cancel-trace"
                  onClick={() => replay.cancel()}
                >
                  <StopIcon size={15} weight="fill" />
                  CANCEL
                </button>
              )}
              <button
                type="button"
                className="control"
                data-testid="reset-trace"
                onClick={resetTrace}
              >
                <ArrowClockwiseIcon size={15} weight="bold" />
                RESET
              </button>
            </>
          )}
        </fieldset>
      </header>

      <div className="ide-grid">
        <GraphRail
          mode={mode}
          graph={graph}
          nodeStates={nodeStates}
          {...(selection.type === "node" ? { selectedNodeId: selection.id } : {})}
          selectedDocument={selection.type === "document"}
          {...(authoringIssue ? { issue: authoringIssue } : {})}
          traceCompatible={traceCompatible}
          onSelectNode={id => setSelection({ type: "node", id })}
          onSelectDocument={() => setSelection({ type: "document" })}
          onAddNode={addNode}
        />

        <div className="workspace-column">
          <TopologyCanvas
            graph={graph}
            nodeStates={nodeStates}
            {...(selection.type === "node" ? { selectedNodeId: selection.id } : {})}
            {...(mode === "trace" && currentEvent ? { currentEvent } : {})}
            editable={mode === "author"}
            {...(connectingFromNodeId ? { connectingFromNodeId } : {})}
            onSelectNode={id => setSelection({ type: "node", id })}
            onMoveNode={moveNode}
            onBeginConnection={id => {
              setSelection({ type: "node", id })
              setConnectingFromNodeId(current => (current === id ? undefined : id))
              setAuthoringIssue(undefined)
            }}
            onCompleteConnection={completeConnection}
          />
          {mode === "trace" ? (
            <ExecutionTimeline
              trace={trace}
              appliedEvents={snapshot.appliedEvents}
              {...(selection.type === "event" ? { selectedEventId: selection.id } : {})}
              onSelectEvent={(id, cursor) => {
                replay.seek(cursor)
                setSelection({ type: "event", id })
              }}
            />
          ) : (
            <section className="authoring-console" aria-label="Authoring command status">
              <div className="panel-chrome">
                <div>
                  <span className="eyebrow">COMMAND HISTORY</span>
                  <h2>Validated graph operations</h2>
                </div>
                <span>
                  {history.past.length} APPLIED / {history.future.length} REDO
                </span>
              </div>
              <div className="authoring-console-body">
                <p>
                  <b>01</b> Add a typed node from the palette.
                </p>
                <p>
                  <b>02</b> Drag nodes to position them in the document.
                </p>
                <p>
                  <b>03</b> Select an output port, then a target input port.
                </p>
                <p data-issue={authoringIssue ? "true" : "false"}>
                  <b>SYS</b>{" "}
                  {authoringIssue ?? "All committed operations satisfy graph validation."}
                </p>
              </div>
            </section>
          )}
        </div>

        {mode === "author" ? (
          selection.type === "document" || !selectedNode ? (
            <DocumentInspector
              graph={graph}
              trace={trace}
              {...(traceIssue ? { traceIssue } : {})}
              {...(authoringIssue ? { issue: authoringIssue } : {})}
              issues={authoringIssues}
              onImport={importDocument}
              onReset={resetDocument}
            />
          ) : (
            <AuthoringInspector
              graph={graph}
              node={selectedNode}
              issues={authoringIssues}
              {...(connectingFromNodeId ? { connectingFromNodeId } : {})}
              onUpdate={patch => execute({ type: "node.update", nodeId: selectedNode.id, patch })}
              onDuplicate={() => duplicateNode(selectedNode)}
              onRemove={() => removeNode(selectedNode.id)}
              onRemoveEdge={edgeId => execute({ type: "edge.remove", edgeId })}
              onBeginConnection={() =>
                setConnectingFromNodeId(current => {
                  setAuthoringIssues([])
                  return current === selectedNode.id ? undefined : selectedNode.id
                })
              }
            />
          )
        ) : (
          <InspectorPanel
            graph={graph}
            trace={trace}
            {...(selectedNode ? { node: selectedNode } : {})}
            {...(selectedNode
              ? { nodeState: snapshot.nodeStates.get(selectedNode.id) ?? "idle" }
              : {})}
            {...(selectedEvent ? { event: selectedEvent } : {})}
          />
        )}
      </div>
    </main>
  )
}
