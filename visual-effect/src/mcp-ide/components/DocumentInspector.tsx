"use client"

import { useEffect, useMemo, useState } from "react"
import { serializeGraphDocument } from "../authoring/GraphDocumentIO"
import { serializeProjectBundle } from "../authoring/McpProjectBundleIO"
import { serializeTraceDocument } from "../authoring/TraceDocumentIO"
import type { McpGraphDocument, McpGraphIssue } from "../model/McpGraphDocument"
import type { McpTraceDocument } from "../model/McpTraceDocument"
import { GraphIssueList } from "./GraphIssueList"

export type McpDocumentKind = "graph" | "trace" | "bundle"

interface DocumentInspectorProps {
  readonly graph: McpGraphDocument
  readonly trace: McpTraceDocument
  readonly traceIssue?: string
  readonly issue?: string
  readonly issues?: ReadonlyArray<McpGraphIssue>
  readonly onImport: (
    kind: McpDocumentKind,
    source: string,
    options: { readonly allowLegacyRebind: boolean },
  ) => void
  readonly onReset: () => void
}

const kindLabel: Readonly<Record<McpDocumentKind, string>> = {
  graph: "Graph",
  trace: "Trace",
  bundle: "Bundle",
}

export function DocumentInspector({
  graph,
  trace,
  traceIssue,
  issue,
  issues = [],
  onImport,
  onReset,
}: DocumentInspectorProps) {
  const [kind, setKind] = useState<McpDocumentKind>("graph")
  const [source, setSource] = useState(() => serializeGraphDocument(graph))
  const [copied, setCopied] = useState(false)
  const [allowLegacyRebind, setAllowLegacyRebind] = useState(false)
  const exportSource = useMemo(() => {
    switch (kind) {
      case "graph":
        return serializeGraphDocument(graph)
      case "trace":
        return serializeTraceDocument(trace)
      case "bundle":
        return serializeProjectBundle({
          schemaVersion: "1",
          kind: "mcp-project-bundle",
          graph,
          trace,
        })
    }
  }, [graph, kind, trace])

  useEffect(() => {
    setSource(exportSource)
    setCopied(false)
  }, [exportSource])

  const selectKind = (nextKind: McpDocumentKind) => {
    setKind(nextKind)
    setCopied(false)
  }

  const copy = async () => {
    if (!navigator.clipboard) return
    // Copy from current sanitized application state, never unaccepted editor contents.
    await navigator.clipboard.writeText(exportSource)
    setCopied(true)
  }

  const download = () => {
    // Download from current sanitized application state, never unaccepted editor contents.
    const url = URL.createObjectURL(new Blob([exportSource], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download =
      kind === "graph"
        ? `${graph.id}.mcp-graph.json`
        : kind === "trace"
          ? `${trace.id}.mcp-trace.json`
          : `${graph.id}.mcp-project.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside
      className="inspector-panel document-inspector"
      aria-label="Graph, trace, and bundle import and export"
    >
      <div className="inspector-heading">
        <span className="eyebrow">VERSIONED DOCUMENT</span>
        <span className="inspector-sequence">
          {kind === "graph"
            ? `V${graph.schemaVersion}`
            : kind === "trace"
              ? `V${trace.schemaVersion}`
              : "V1"}
        </span>
      </div>
      <h2>{kindLabel[kind]} JSON</h2>
      <p className="inspector-description">
        Import graph, redacted trace, or portable bundle state. Copy and download always use the
        last accepted sanitized document.
      </p>
      <fieldset className="document-kind-switch">
        <legend className="visually-hidden">Document kind</legend>
        {(["graph", "trace", "bundle"] as const).map(candidate => (
          <button
            type="button"
            className="inspector-action"
            data-active={kind === candidate ? "true" : "false"}
            data-testid={`document-${candidate}`}
            key={candidate}
            onClick={() => selectKind(candidate)}
          >
            {candidate.toUpperCase()}
          </button>
        ))}
      </fieldset>
      <textarea
        className="document-editor"
        data-testid={`${kind}-json`}
        value={source}
        onChange={event => {
          setSource(event.target.value)
          setCopied(false)
        }}
        spellCheck={false}
      />
      {issue && <p className="form-issue">{issue}</p>}
      <GraphIssueList issues={issues} />
      <p
        className={traceIssue ? "form-issue" : "document-compatibility"}
        data-testid="trace-compatibility"
      >
        {traceIssue ? `TRACE INCOMPATIBLE / ${traceIssue}` : `TRACE BOUND / ${trace.graphRevision}`}
      </p>
      {kind !== "graph" && (
        <label className="legacy-rebind-control">
          <input
            type="checkbox"
            checked={allowLegacyRebind}
            onChange={event => setAllowLegacyRebind(event.target.checked)}
          />
          ALLOW EXPLICIT LEGACY V1 REBIND
        </label>
      )}
      <div className="document-actions">
        <button
          type="button"
          className="inspector-action primary"
          data-testid={kind === "graph" ? "import-graph" : "import-document"}
          onClick={() => onImport(kind, source, { allowLegacyRebind })}
        >
          IMPORT DOCUMENT
        </button>
        <button
          type="button"
          className="inspector-action"
          data-testid="copy-document"
          onClick={() => void copy()}
        >
          {copied ? "COPIED" : "COPY SAFE JSON"}
        </button>
        <button type="button" className="inspector-action" onClick={download}>
          DOWNLOAD SAFE JSON
        </button>
        <button type="button" className="inspector-action danger" onClick={onReset}>
          RESET FIXTURE
        </button>
      </div>
      <div className="inspector-note">
        <span>PORTABLE CONTRACT</span>
        Imports are decoded, redacted, and checked against the exact graph revision before entering
        application state. Legacy trace rebinding is opt-in and recorded in provenance.
      </div>
    </aside>
  )
}
