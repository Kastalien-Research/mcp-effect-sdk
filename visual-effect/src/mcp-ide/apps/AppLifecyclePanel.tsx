"use client"

import type { McpTraceDocument, McpTraceEvent } from "../model/McpTraceDocument"
import { projectAppsTraceEvent } from "./AppsTraceAdapter"

interface AppLifecyclePanelProps {
  readonly trace: McpTraceDocument
  readonly selectedEventId?: string
  readonly onSelectEvent: (eventId: string, cursor: number) => void
}

const lifecycleLabel = (event: McpTraceEvent): string =>
  event.kind.slice("apps.".length).replaceAll("-", " ").toUpperCase()

export function AppLifecyclePanel({
  trace,
  selectedEventId,
  onSelectEvent,
}: AppLifecyclePanelProps) {
  const orderedEvents = trace.events.toSorted((left, right) => left.sequence - right.sequence)
  const projected = orderedEvents.flatMap((event, cursor) => {
    const projection = projectAppsTraceEvent(event)
    return projection ? [{ event, cursor, projection }] : []
  })
  const first = projected[0]?.projection
  if (!first) return null

  return (
    <section className="apps-lifecycle-panel" aria-label="Apps fixture lifecycle">
      <div className="section-label">
        <span>APPS LIFECYCLE</span>
        <span>FIXTURE ONLY</span>
      </div>
      <div className="apps-contract-markers">
        <span>{first.profile}</span>
        <span>
          {first.contract.status === "stable-profile-fixture"
            ? "STABLE PROFILE FIXTURE"
            : "UNQUALIFIED PREVIEW"}
        </span>
        <span>CONTRACT-SHAPED</span>
      </div>
      <dl className="inspector-facts apps-resource-facts">
        <div>
          <dt>RESOURCE</dt>
          <dd>{first.resource.uri}</dd>
        </div>
        <div>
          <dt>RESOURCE NODE</dt>
          <dd>{first.resource.nodeId}</dd>
        </div>
        <div>
          <dt>LINKED NODES</dt>
          <dd>{first.resource.linkedNodeIds.join(" · ")}</dd>
        </div>
        <div>
          <dt>PROVENANCE</dt>
          <dd>DECLARED FIXTURE / {first.provenance.fixtureId}</dd>
        </div>
      </dl>
      <ol className="apps-lifecycle-list">
        {projected.map(({ event, cursor, projection }) => (
          <li key={event.id}>
            <button
              type="button"
              data-testid={`apps-lifecycle-${event.id}`}
              data-selected={selectedEventId === event.id ? "true" : "false"}
              onClick={() => onSelectEvent(event.id, cursor)}
            >
              <span>{String(event.sequence).padStart(2, "0")}</span>
              <b>{lifecycleLabel(event)}</b>
              <small>
                {projection.policy.kind === "none"
                  ? "DECLARED EVENT"
                  : `${projection.policy.kind.toUpperCase()} ${projection.policy.outcome.toUpperCase()}`}
              </small>
            </button>
          </li>
        ))}
      </ol>
      <p className="apps-fixture-note">
        Lifecycle rows are explicit fixture events. No current Host, View, or negotiated state is
        inferred.
      </p>
    </section>
  )
}
