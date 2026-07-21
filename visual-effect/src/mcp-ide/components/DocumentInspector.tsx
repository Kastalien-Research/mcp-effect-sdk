"use client"

import { useEffect, useState } from "react"
import { serializeGraphDocument } from "../authoring/GraphDocumentIO"
import type { McpGraphDocument, McpGraphIssue } from "../model/McpGraphDocument"
import { GraphIssueList } from "./GraphIssueList"

interface DocumentInspectorProps {
  readonly graph: McpGraphDocument
  readonly issue?: string
  readonly issues?: ReadonlyArray<McpGraphIssue>
  readonly onImport: (source: string) => void
  readonly onReset: () => void
}

export function DocumentInspector({
  graph,
  issue,
  issues = [],
  onImport,
  onReset,
}: DocumentInspectorProps) {
  const [source, setSource] = useState(() => serializeGraphDocument(graph))
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setSource(serializeGraphDocument(graph))
  }, [graph])

  const copy = async () => {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(source)
    setCopied(true)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([source], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${graph.id}.mcp-graph.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside
      className="inspector-panel document-inspector"
      aria-label="Graph document import and export"
    >
      <div className="inspector-heading">
        <span className="eyebrow">VERSIONED DOCUMENT</span>
        <span className="inspector-sequence">V{graph.schemaVersion}</span>
      </div>
      <h2>Graph JSON</h2>
      <p className="inspector-description">
        Edit, copy, download, or replace the exact document used by both authoring and execution.
      </p>
      <textarea
        className="document-editor"
        data-testid="graph-json"
        value={source}
        onChange={event => setSource(event.target.value)}
        spellCheck={false}
      />
      {issue && <p className="form-issue">{issue}</p>}
      <GraphIssueList issues={issues} />
      <div className="document-actions">
        <button
          type="button"
          className="inspector-action primary"
          data-testid="import-graph"
          onClick={() => onImport(source)}
        >
          IMPORT DOCUMENT
        </button>
        <button type="button" className="inspector-action" onClick={() => void copy()}>
          {copied ? "COPIED" : "COPY JSON"}
        </button>
        <button type="button" className="inspector-action" onClick={download}>
          DOWNLOAD
        </button>
        <button type="button" className="inspector-action danger" onClick={onReset}>
          RESET FIXTURE
        </button>
      </div>
      <div className="inspector-note">
        <span>PORTABLE CONTRACT</span>
        Import is structural and protocol-aware. Invalid graphs never replace the active document.
      </div>
    </aside>
  )
}
