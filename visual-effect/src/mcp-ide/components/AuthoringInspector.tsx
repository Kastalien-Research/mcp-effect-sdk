"use client"

import { useEffect, useState } from "react"
import type { McpGraphDocument, McpGraphNode } from "../model/McpGraphDocument"

interface AuthoringInspectorProps {
  readonly graph: McpGraphDocument
  readonly node: McpGraphNode
  readonly connectingFromNodeId?: string
  readonly onUpdate: (
    patch: Partial<Pick<McpGraphNode, "label" | "description" | "config">>,
  ) => void
  readonly onDuplicate: () => void
  readonly onRemove: () => void
  readonly onRemoveEdge: (edgeId: string) => void
  readonly onBeginConnection: () => void
}

export function AuthoringInspector({
  graph,
  node,
  connectingFromNodeId,
  onUpdate,
  onDuplicate,
  onRemove,
  onRemoveEdge,
  onBeginConnection,
}: AuthoringInspectorProps) {
  const [label, setLabel] = useState(node.label)
  const [description, setDescription] = useState(node.description)
  const [config, setConfig] = useState(() => JSON.stringify(node.config, null, 2))
  const [formIssue, setFormIssue] = useState<string>()

  useEffect(() => {
    setLabel(node.label)
    setDescription(node.description)
    setConfig(JSON.stringify(node.config, null, 2))
    setFormIssue(undefined)
  }, [node])

  const incoming = graph.edges.filter(edge => edge.target === node.id)
  const outgoing = graph.edges.filter(edge => edge.source === node.id)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const parsedConfig = JSON.parse(config) as unknown
      if (
        typeof parsedConfig !== "object" ||
        parsedConfig === null ||
        Array.isArray(parsedConfig)
      ) {
        setFormIssue("Configuration must be a JSON object")
        return
      }
      setFormIssue(undefined)
      onUpdate({
        label: label.trim() || node.label,
        description: description.trim(),
        config: parsedConfig as Record<string, unknown>,
      })
    } catch {
      setFormIssue("Configuration is not valid JSON")
    }
  }

  return (
    <aside className="inspector-panel authoring-inspector" aria-label="Node authoring inspector">
      <div className="inspector-heading">
        <span className="eyebrow">EDIT GRAPH NODE</span>
        <span className="inspector-sequence">{node.kind.toUpperCase()}</span>
      </div>
      <h2>{node.label}</h2>
      <div className="inspector-tags">
        <span data-channel="mcp">AUTHORED</span>
        <span>SCHEMA V{graph.schemaVersion}</span>
      </div>

      <form className="node-config-form" onSubmit={submit}>
        <label>
          <span>LABEL</span>
          <input value={label} onChange={event => setLabel(event.target.value)} />
        </label>
        <label>
          <span>DESCRIPTION</span>
          <textarea
            rows={3}
            value={description}
            onChange={event => setDescription(event.target.value)}
          />
        </label>
        <label>
          <span>CONFIGURATION / JSON</span>
          <textarea
            className="config-editor"
            rows={8}
            value={config}
            onChange={event => setConfig(event.target.value)}
            spellCheck={false}
          />
        </label>
        {formIssue && <p className="form-issue">{formIssue}</p>}
        <button type="submit" className="inspector-action primary" data-testid="save-node">
          APPLY CONFIGURATION
        </button>
      </form>

      <div className="inspector-section compact">
        <div className="section-label">
          <span>TYPED CONNECTIONS</span>
          <span>{incoming.length + outgoing.length}</span>
        </div>
        <button
          type="button"
          className="inspector-action"
          data-active={connectingFromNodeId === node.id ? "true" : "false"}
          onClick={onBeginConnection}
        >
          {connectingFromNodeId === node.id ? "SELECT A TARGET PORT" : "CONNECT FROM NODE"}
        </button>
        <ul className="connection-list editable-connections">
          {incoming.map(edge => (
            <li key={edge.id}>
              <span>
                <b>IN</b>
                {edge.kind} ← {edge.source}
              </span>
              <button
                type="button"
                onClick={() => onRemoveEdge(edge.id)}
                aria-label={`Remove ${edge.id}`}
              >
                ×
              </button>
            </li>
          ))}
          {outgoing.map(edge => (
            <li key={edge.id}>
              <span>
                <b>OUT</b>
                {edge.kind} → {edge.target}
              </span>
              <button
                type="button"
                onClick={() => onRemoveEdge(edge.id)}
                aria-label={`Remove ${edge.id}`}
              >
                ×
              </button>
            </li>
          ))}
          {incoming.length + outgoing.length === 0 && <li>NO CONNECTIONS</li>}
        </ul>
      </div>

      <div className="node-danger-zone">
        <button type="button" className="inspector-action" onClick={onDuplicate}>
          DUPLICATE NODE
        </button>
        <button
          type="button"
          className="inspector-action danger"
          data-testid="remove-node"
          onClick={onRemove}
        >
          REMOVE NODE
        </button>
      </div>
    </aside>
  )
}
