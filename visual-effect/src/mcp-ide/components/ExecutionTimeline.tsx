"use client"

import type { McpTraceDocument, McpTraceEvent } from "../model/McpTraceDocument"

interface ExecutionTimelineProps {
  readonly trace: McpTraceDocument
  readonly appliedEvents: ReadonlyArray<McpTraceEvent>
  readonly selectedEventId?: string
  readonly onSelectEvent: (eventId: string, cursor: number) => void
}

const formatTime = (atMs: number) => `+${(atMs / 1000).toFixed(2)}s`

export function ExecutionTimeline({
  trace,
  appliedEvents,
  selectedEventId,
  onSelectEvent,
}: ExecutionTimelineProps) {
  const appliedIds = new Set(appliedEvents.map(event => event.id))
  const currentId = appliedEvents.at(-1)?.id
  const events = trace.events.toSorted((left, right) => left.sequence - right.sequence)

  return (
    <section className="timeline-panel" aria-label="Execution timeline">
      <div className="panel-chrome timeline-chrome">
        <div>
          <span className="eyebrow">EXECUTION RAIL</span>
          <h2>{trace.name}</h2>
        </div>
        <span className="timeline-count">
          {appliedEvents.length} / {events.length} EVENTS
        </span>
      </div>
      <ol className="timeline-track">
        {events.map((event, cursor) => {
          const applied = appliedIds.has(event.id)
          const current = currentId === event.id
          const selected = selectedEventId === event.id
          const state = current ? "current" : applied ? "applied" : "pending"
          return (
            <li key={event.id}>
              <button
                type="button"
                className="timeline-event"
                data-channel={event.channel}
                data-applied={applied ? "true" : "false"}
                data-current={current ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
                data-testid={`timeline-${event.id}`}
                onClick={() => onSelectEvent(event.id, cursor)}
                aria-current={current ? "step" : undefined}
                aria-pressed={selected}
                aria-label={`Seek ${event.summary}, ${state}`}
              >
                <span className="event-sequence">{String(event.sequence).padStart(2, "0")}</span>
                <span className="event-channel">{event.channel}</span>
                <span className="event-summary">{event.summary}</span>
                <span className="event-time">{formatTime(event.atMs)}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
