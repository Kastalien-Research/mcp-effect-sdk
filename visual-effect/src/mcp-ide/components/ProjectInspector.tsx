"use client"

import { Effect, Either } from "effect"
import { useEffect, useMemo, useState } from "react"
import { compileGraph } from "../compiler/compileGraph"
import type { McpProjectIssue } from "../compiler/McpProject"
import { renderProject } from "../compiler/renderProject"
import type { McpGraphDocument } from "../model/McpGraphDocument"

interface ProjectInspectorProps {
  readonly graph: McpGraphDocument
}

const issueLabel = (issue: McpProjectIssue): string => issue.code.replaceAll("-", " ").toUpperCase()

export function ProjectInspector({ graph }: ProjectInspectorProps) {
  const projection = useMemo(() => {
    const compiled = Effect.runSync(compileGraph(graph).pipe(Effect.either))
    if (Either.isLeft(compiled)) {
      return {
        status: "compile-blocked" as const,
        issues: compiled.left.issues,
      }
    }
    const rendered = Effect.runSync(renderProject(compiled.right).pipe(Effect.either))
    return Either.isLeft(rendered)
      ? {
          status: "backend-blocked" as const,
          project: compiled.right,
          issues: rendered.left.issues,
        }
      : {
          status: "ready" as const,
          project: compiled.right,
          rendered: rendered.right,
          issues: [] as ReadonlyArray<McpProjectIssue>,
        }
  }, [graph])
  const files = projection.status === "ready" ? projection.rendered.files : []
  const [selectedPath, setSelectedPath] = useState<string>()
  const [copied, setCopied] = useState(false)
  const selectedFile = files.find(file => file.path === selectedPath) ?? files[0]

  useEffect(() => {
    setSelectedPath(files[0]?.path)
    setCopied(false)
  }, [files])

  const copy = async () => {
    if (!selectedFile || !navigator.clipboard) return
    await navigator.clipboard.writeText(selectedFile.text)
    setCopied(true)
  }

  const download = () => {
    if (!selectedFile) return
    const url = URL.createObjectURL(new Blob([selectedFile.text], { type: selectedFile.mediaType }))
    const link = document.createElement("a")
    link.href = url
    link.download = selectedFile.path.split("/").at(-1) ?? "project-file.txt"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="inspector-panel project-inspector" aria-label="Compiled project source">
      <div className="inspector-heading">
        <span className="eyebrow">PROJECT SOURCE</span>
        <span className="inspector-sequence">EFFECT SCAFFOLD V1</span>
      </div>
      <h2>Inspectable MCP project</h2>
      <p className="inspector-description">
        The current graph compiles to backend-neutral IR before the deterministic scaffold backend
        evaluates it. This projection never edits or executes the graph.
      </p>
      <p
        className={
          projection.status === "ready" ? "project-status ready" : "project-status blocked"
        }
        data-testid="project-status"
      >
        {projection.status === "ready"
          ? `READY / ${files.length} FILES`
          : projection.status === "backend-blocked"
            ? `BACKEND BLOCKED / ${projection.issues.length} ISSUES`
            : `COMPILE BLOCKED / ${projection.issues.length} ISSUES`}
      </p>

      {projection.project && (
        <section className="inspector-section">
          <div className="section-label">
            <span>BACKEND-NEUTRAL IR</span>
            <span>V{projection.project.schemaVersion}</span>
          </div>
          <pre className="json-payload project-ir" data-testid="project-ir">
            {JSON.stringify(projection.project, null, 2)}
          </pre>
        </section>
      )}

      {projection.issues.length > 0 && (
        <section className="inspector-section">
          <div className="section-label">
            <span>STRUCTURED REPAIRS</span>
            <span>{projection.issues.length}</span>
          </div>
          <ul className="project-issue-list">
            {projection.issues.map(issue => (
              <li key={`${issue.path}:${issue.code}`} data-testid="project-issue">
                <span>{issueLabel(issue)}</span>
                <code>{issue.path}</code>
                <p>{issue.explanation}</p>
                <ul>
                  {issue.repairs.map(repair => (
                    <li key={repair.id}>{repair.label}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {projection.status === "ready" && selectedFile && (
        <>
          <section className="inspector-section">
            <div className="section-label">
              <span>GENERATED FILES</span>
              <span>{files.length}</span>
            </div>
            <div className="project-file-tabs">
              {files.map(file => (
                <button
                  type="button"
                  className="inspector-action"
                  data-active={selectedFile.path === file.path ? "true" : "false"}
                  data-path={file.path}
                  data-testid="project-file"
                  key={file.path}
                  onClick={() => {
                    setSelectedPath(file.path)
                    setCopied(false)
                  }}
                >
                  {file.path}
                </button>
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <div className="section-label">
              <span>{selectedFile.path}</span>
              <span>READ ONLY</span>
            </div>
            <pre className="project-file-source" data-testid="project-file-source">
              {selectedFile.text}
            </pre>
          </section>
          <div className="project-file-actions">
            <button
              type="button"
              className="inspector-action primary"
              data-testid="copy-project-file"
              onClick={() => void copy()}
            >
              {copied ? "COPIED" : "COPY VISIBLE FILE"}
            </button>
            <button
              type="button"
              className="inspector-action"
              data-testid="download-project-file"
              onClick={download}
            >
              DOWNLOAD VISIBLE FILE
            </button>
          </div>
        </>
      )}

      <div className="inspector-note">
        <span>INSPECTABLE, NOT EXECUTABLE</span>
        The executable SDK backend remains pending upstream reconciliation. Placeholder handlers
        fail explicitly and never fabricate business results.
      </div>
    </aside>
  )
}
