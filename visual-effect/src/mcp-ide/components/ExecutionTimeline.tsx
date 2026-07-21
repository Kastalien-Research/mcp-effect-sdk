"use client"

import { useEffect, useState } from "react"
import type { McpTraceDocument, McpTraceEvent } from "../model/McpTraceDocument"

interface ExecutionTimelineProps {
  readonly trace: McpTraceDocument
  readonly appliedEvents: ReadonlyArray<McpTraceEvent>
  readonly selectedEventId?: string
  readonly onSelectEvent: (eventId: string, cursor: number) => void
  readonly canSeek?: (cursor: number) => boolean
}

const formatTime = (atMs: number) => `+${(atMs / 1000).toFixed(2)}s`

export function ExecutionTimeline({
  trace,
  appliedEvents,
  selectedEventId,
  onSelectEvent,
  canSeek = () => true,
}: ExecutionTimelineProps) {
  const [filter, setFilter] = useState<"all" | "mrtr" | "tasks" | "apps">("all")
  const appliedIds = new Set(appliedEvents.map(event => event.id))
  const currentId = appliedEvents.at(-1)?.id
  const orderedEvents = trace.events.toSorted((left, right) => left.sequence - right.sequence)
  const hasAppsEvents = orderedEvents.some(event => event.family === "apps")
  const hasMrtrEvents = orderedEvents.some(event => event.family === "mrtr")
  const hasTasksEvents = orderedEvents.some(event => event.family === "tasks")
  useEffect(() => setFilter("all"), [trace.id])
  const events =
    filter === "all" ? orderedEvents : orderedEvents.filter(event => event.family === filter)
  const appliedVisible = events.filter(event => appliedIds.has(event.id)).length

  return (
    <section className="timeline-panel" aria-label="Execution timeline">
      <div className="panel-chrome timeline-chrome">
        <div>
          <span className="eyebrow">EXECUTION RAIL</span>
          <h2>{trace.name}</h2>
        </div>
        <div className="timeline-tools">
          <fieldset className="timeline-filter">
            <legend className="visually-hidden">Timeline family filter</legend>
            <button
              type="button"
              data-active={filter === "all" ? "true" : "false"}
              data-testid="timeline-filter-all"
              onClick={() => setFilter("all")}
            >
              ALL
            </button>
            <button
              type="button"
              data-active={filter === "mrtr" ? "true" : "false"}
              data-testid="timeline-filter-mrtr"
              disabled={!hasMrtrEvents}
              onClick={() => setFilter("mrtr")}
            >
              MRTR
            </button>
            <button
              type="button"
              data-active={filter === "tasks" ? "true" : "false"}
              data-testid="timeline-filter-tasks"
              disabled={!hasTasksEvents}
              onClick={() => setFilter("tasks")}
            >
              TASKS
            </button>
            <button
              type="button"
              data-active={filter === "apps" ? "true" : "false"}
              data-testid="timeline-filter-apps"
              disabled={!hasAppsEvents}
              onClick={() => setFilter("apps")}
            >
              APPS
            </button>
          </fieldset>
          <span className="timeline-count">
            {appliedVisible} / {events.length} EVENTS
          </span>
        </div>
      </div>
      <ol className="timeline-track">
        {events.map(event => {
          const cursor = orderedEvents.findIndex(candidate => candidate.id === event.id)
          const applied = appliedIds.has(event.id)
          const current = currentId === event.id
          const selected = selectedEventId === event.id
          const seekable = canSeek(cursor)
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
                data-family={event.family}
                data-testid={`timeline-${event.id}`}
                disabled={!seekable}
                title={
                  seekable
                    ? undefined
                    : "Resolve the current input requirement before seeking ahead"
                }
                onClick={() => onSelectEvent(event.id, cursor)}
                aria-current={current ? "step" : undefined}
                aria-pressed={selected}
                aria-label={`Seek ${event.summary}, ${state}`}
              >
                <span className="event-sequence">{String(event.sequence).padStart(2, "0")}</span>
                <span className="event-channel">
                  {event.family === "mrtr" || event.family === "tasks"
                    ? event.family
                    : event.channel}
                </span>
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
