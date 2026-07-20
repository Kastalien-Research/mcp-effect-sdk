"use client"

import type { McpTraceDocument, McpTraceEvent } from "../model/McpTraceDocument"

interface ExecutionTimelineProps {
  readonly trace: McpTraceDocument
  readonly appliedEvents: ReadonlyArray<McpTraceEvent>
  readonly selectedEventId?: string
  readonly onSelectEvent: (eventId: string) => void
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

  return (
    <section className="timeline-panel" aria-label="Execution timeline">
      <div className="panel-chrome timeline-chrome">
        <div>
          <span className="eyebrow">EXECUTION RAIL</span>
          <h2>{trace.name}</h2>
        </div>
        <span className="timeline-count">
          {appliedEvents.length} / {trace.events.length} EVENTS
        </span>
      </div>
      <ol className="timeline-track">
        {trace.events.map(event => {
          const applied = appliedIds.has(event.id)
          const current = currentId === event.id
          return (
            <li key={event.id}>
              <button
                type="button"
                className="timeline-event"
                data-channel={event.channel}
                data-applied={applied ? "true" : "false"}
                data-current={current ? "true" : "false"}
                data-selected={selectedEventId === event.id ? "true" : "false"}
                onClick={() => applied && onSelectEvent(event.id)}
                disabled={!applied}
                aria-label={applied ? `Inspect ${event.summary}` : `${event.summary}, pending`}
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
