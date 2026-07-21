"use client"

import { useMemo, useState } from "react"
import type { McpTraceDocument, McpTraceEvent } from "../model/McpTraceDocument"
import { decodeMrtrInputRequiredPayload } from "../model/MrtrTrace"

interface MrtrControlsProps {
  readonly trace: McpTraceDocument
  readonly event: McpTraceEvent
  readonly onSubmit: (eventId: string, responseKeys: ReadonlyArray<string>) => boolean
}

const requestIdFor = (trace: McpTraceDocument, eventId: string): string => {
  const requestId = trace.events.find(event => event.id === eventId)?.protocol?.requestId
  return requestId === undefined || requestId === null ? "unavailable" : String(requestId)
}

const emptyDrafts = (keys: ReadonlyArray<string>): Record<string, string> =>
  Object.fromEntries(keys.map(key => [key, ""]))

export function MrtrControls({ trace, event, onSubmit }: MrtrControlsProps) {
  const payload = decodeMrtrInputRequiredPayload(event.payload)
  const keys = useMemo(() => (payload ? Object.keys(payload.inputRequests) : []), [payload])
  const [drafts, setDrafts] = useState<Record<string, string>>(() => emptyDrafts(keys))
  const [issue, setIssue] = useState<string>()

  if (!payload) return null
  const resumed = trace.events.find(candidate => {
    if (candidate.kind !== "mrtr.resumed") return false
    const requiredEventId = Object.getOwnPropertyDescriptor(
      candidate.payload,
      "requiredEventId",
    )?.value
    return requiredEventId === event.id
  })
  const retrySendEventId = Object.getOwnPropertyDescriptor(
    resumed?.payload ?? {},
    "retrySendEventId",
  )?.value
  const retryId =
    typeof retrySendEventId === "string" ? requestIdFor(trace, retrySendEventId) : "unavailable"

  const submit = () => {
    for (const key of keys) {
      try {
        JSON.parse(drafts[key] ?? "")
      } catch {
        setIssue("Every server-assigned key requires valid JSON before this fixture can continue.")
        return
      }
    }
    if (!onSubmit(event.id, keys)) {
      setIssue("This input requirement is no longer current and could not be resolved.")
      return
    }
    setDrafts(emptyDrafts(keys))
    setIssue(undefined)
  }

  return (
    <section className="mrtr-controls" aria-label="MRTR input controls">
      <div className="panel-chrome">
        <div>
          <span className="eyebrow">FIXTURE-ONLY CORE RETRY</span>
          <h2>INPUT REQUIRED</h2>
        </div>
        <span>ROUND {payload.round} / 10</span>
      </div>
      <div className="mrtr-disclosure">
        <p>
          This models the core request/result retry pattern. It is not a Task, durable handle, live
          transport, or SDK execution.
        </p>
        <dl>
          <div>
            <dt>PARENT METHOD</dt>
            <dd>{payload.logicalRequest.method}</dd>
          </div>
          <div>
            <dt>TERMINAL RESULT</dt>
            <dd>ATTEMPT {requestIdFor(trace, payload.terminalAttemptResultEventId)} TERMINATED</dd>
          </div>
          <div>
            <dt>RETRY ATTEMPT</dt>
            <dd>FRESH RETRY {retryId}</dd>
          </div>
          <div>
            <dt>POLICY BOUNDS</dt>
            <dd>10 ROUNDS · 32 REQUESTS / ROUND · CONCURRENCY 4</dd>
          </div>
          <div>
            <dt>REQUEST STATE</dt>
            <dd>
              {payload.requestState.present
                ? `SERVER-OWNED OPAQUE · PRESENT · SHA-256 ${payload.requestState.sha256} · ${payload.requestState.byteLength} BYTES`
                : "SERVER-OWNED OPAQUE · ABSENT"}
            </dd>
          </div>
        </dl>
      </div>
      <div className="mrtr-drafts">
        {keys.map(key => {
          const request = payload.inputRequests[key]
          if (!request) return null
          return (
            <label key={key}>
              <span className="mrtr-key">{key.length > 0 ? key : "(empty key)"}</span>
              <small>
                {request.method} · {request.label}
              </small>
              <textarea
                data-testid={`mrtr-draft-${key}`}
                aria-label={`JSON response for ${key.length > 0 ? key : "empty key"}`}
                spellCheck={false}
                value={drafts[key] ?? ""}
                onChange={change => {
                  const value = change.currentTarget.value
                  setIssue(undefined)
                  setDrafts(current => ({ ...current, [key]: value }))
                }}
                placeholder='{"approved": true}'
              />
            </label>
          )
        })}
      </div>
      {issue && (
        <p className="mrtr-issue" role="alert">
          VALID JSON REQUIRED · {issue}
        </p>
      )}
      <button
        type="button"
        className="control primary"
        data-testid="submit-mrtr-input"
        onClick={submit}
      >
        SUPPLY INPUT AND RETRY
      </button>
      <p className="mrtr-retention">
        Draft values remain in this control only and are discarded on submit, cancel, reset, or
        replacement. The trace retains keys plus “not-retained”.
      </p>
    </section>
  )
}
