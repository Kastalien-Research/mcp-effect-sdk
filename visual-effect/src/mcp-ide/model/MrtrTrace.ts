import type { McpTraceEvent } from "./McpTraceDocument"
import { isTraceIdentifier, isTraceLabel } from "./TraceCodecs"

export type ParentMethod = "prompts/get" | "resources/read" | "tools/call"
export type InputMethod = "sampling/createMessage" | "roots/list" | "elicitation/create"

export interface LogicalRequest {
  readonly initialSendEventId: string
  readonly method: ParentMethod
  readonly paramsSha256: string
}

export type RequestStateEvidence =
  | { readonly present: false }
  | { readonly present: true; readonly sha256: string; readonly byteLength: number }

export interface InputRequestSummary {
  readonly method: InputMethod
  readonly label: string
}

export interface MrtrInputRequiredPayload {
  readonly schemaVersion: "1"
  readonly round: number
  readonly logicalRequest: LogicalRequest
  readonly terminalAttemptResultEventId: string
  readonly inputRequests: Readonly<Record<string, InputRequestSummary>>
  readonly requestState: RequestStateEvidence
}

export interface MrtrInputSuppliedPayload {
  readonly schemaVersion: "1"
  readonly round: number
  readonly requiredEventId: string
  readonly responseKeys: ReadonlyArray<string>
  readonly values: "not-retained"
}

export interface MrtrResumedPayload {
  readonly schemaVersion: "1"
  readonly round: number
  readonly requiredEventId: string
  readonly retrySendEventId: string
  readonly logicalRequest: LogicalRequest
  readonly responseKeys: ReadonlyArray<string>
  readonly requestState: RequestStateEvidence
  readonly retry: "fresh-wire-attempt"
}

export type MrtrPayload = MrtrInputRequiredPayload | MrtrInputSuppliedPayload | MrtrResumedPayload

export interface MrtrTraceIssue {
  readonly code: "invalid-mrtr-payload" | "invalid-mrtr-sequence"
  readonly path: string
  readonly message: string
}

interface OwnDataRecord {
  readonly values: Readonly<Record<string, unknown>>
  readonly keys: ReadonlyArray<string>
}

const parentMethods = new Set<ParentMethod>(["prompts/get", "resources/read", "tools/call"])
const inputMethods = new Set<InputMethod>([
  "sampling/createMessage",
  "roots/list",
  "elicitation/create",
])
const SHA_256 = /^[0-9a-f]{64}$/

const ownDataRecord = (value: unknown): OwnDataRecord | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  for (const key in value) {
    if (!Object.hasOwn(value, key)) return undefined
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const ownKeys = Reflect.ownKeys(descriptors)
  if (ownKeys.some(key => typeof key === "symbol")) return undefined
  const keys = ownKeys as Array<string>
  const values: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !("value" in descriptor)) return undefined
    Object.defineProperty(values, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return { values, keys }
}

const exactRecord = (
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): OwnDataRecord | undefined => {
  const record = ownDataRecord(value)
  if (!record || record.keys.length !== expectedKeys.length) return undefined
  const expected = new Set(expectedKeys)
  return record.keys.every(key => expected.has(key)) ? record : undefined
}

const ownArray = (value: unknown): ReadonlyArray<unknown> | undefined => {
  if (!Array.isArray(value)) return undefined
  for (const key in value) {
    if (!Object.hasOwn(value, key)) return undefined
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const symbolKeys = Reflect.ownKeys(descriptors).filter(key => typeof key === "symbol")
  if (symbolKeys.length > 0) return undefined
  const values: Array<unknown> = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!descriptor?.enumerable || !("value" in descriptor)) return undefined
    values.push(descriptor.value)
  }
  const stringKeys = Object.keys(descriptors).filter(key => key !== "length")
  if (stringKeys.length !== value.length) return undefined
  return values
}

const decodeRound = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : undefined

const decodeLogicalRequest = (value: unknown): LogicalRequest | undefined => {
  const record = exactRecord(value, ["initialSendEventId", "method", "paramsSha256"])
  if (!record) return undefined
  const initialSendEventId = record.values.initialSendEventId
  const method = record.values.method
  const paramsSha256 = record.values.paramsSha256
  if (
    !isTraceIdentifier(initialSendEventId) ||
    typeof method !== "string" ||
    !parentMethods.has(method as ParentMethod) ||
    typeof paramsSha256 !== "string" ||
    !SHA_256.test(paramsSha256)
  ) {
    return undefined
  }
  return { initialSendEventId, method: method as ParentMethod, paramsSha256 }
}

const decodeRequestState = (value: unknown): RequestStateEvidence | undefined => {
  const record = ownDataRecord(value)
  if (!record || typeof record.values.present !== "boolean") return undefined
  if (record.values.present === false) {
    return record.keys.length === 1 && record.keys[0] === "present" ? { present: false } : undefined
  }
  const exact = exactRecord(value, ["present", "sha256", "byteLength"])
  if (
    !exact ||
    typeof exact.values.sha256 !== "string" ||
    !SHA_256.test(exact.values.sha256) ||
    typeof exact.values.byteLength !== "number" ||
    !Number.isInteger(exact.values.byteLength) ||
    exact.values.byteLength < 0
  ) {
    return undefined
  }
  return {
    present: true,
    sha256: exact.values.sha256,
    byteLength: exact.values.byteLength,
  }
}

const decodeInputRequests = (
  value: unknown,
): Readonly<Record<string, InputRequestSummary>> | undefined => {
  const record = ownDataRecord(value)
  if (!record || record.keys.length > 32) return undefined
  const requests: Record<string, InputRequestSummary> = Object.create(null)
  for (const key of record.keys) {
    const summary = exactRecord(record.values[key], ["method", "label"])
    if (!summary) return undefined
    const method = summary.values.method
    const label = summary.values.label
    if (
      typeof method !== "string" ||
      !inputMethods.has(method as InputMethod) ||
      !isTraceLabel(label)
    ) {
      return undefined
    }
    Object.defineProperty(requests, key, {
      value: { method: method as InputMethod, label },
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return requests
}

const decodeResponseKeys = (value: unknown): ReadonlyArray<string> | undefined => {
  const values = ownArray(value)
  if (!values || values.length > 32 || values.some(key => typeof key !== "string")) {
    return undefined
  }
  const keys = values as Array<string>
  return new Set(keys).size === keys.length ? keys : undefined
}

export const decodeMrtrInputRequiredPayload = (
  value: unknown,
): MrtrInputRequiredPayload | undefined => {
  const record = exactRecord(value, [
    "schemaVersion",
    "round",
    "logicalRequest",
    "terminalAttemptResultEventId",
    "inputRequests",
    "requestState",
  ])
  if (!record || record.values.schemaVersion !== "1") return undefined
  const round = decodeRound(record.values.round)
  const logicalRequest = decodeLogicalRequest(record.values.logicalRequest)
  const terminalAttemptResultEventId = record.values.terminalAttemptResultEventId
  const inputRequests = decodeInputRequests(record.values.inputRequests)
  const requestState = decodeRequestState(record.values.requestState)
  if (
    round === undefined ||
    !logicalRequest ||
    !isTraceIdentifier(terminalAttemptResultEventId) ||
    !inputRequests ||
    !requestState ||
    (Object.keys(inputRequests).length === 0 && !requestState.present)
  ) {
    return undefined
  }
  return {
    schemaVersion: "1",
    round,
    logicalRequest,
    terminalAttemptResultEventId,
    inputRequests,
    requestState,
  }
}

export const decodeMrtrInputSuppliedPayload = (
  value: unknown,
): MrtrInputSuppliedPayload | undefined => {
  const record = exactRecord(value, [
    "schemaVersion",
    "round",
    "requiredEventId",
    "responseKeys",
    "values",
  ])
  if (!record || record.values.schemaVersion !== "1" || record.values.values !== "not-retained") {
    return undefined
  }
  const round = decodeRound(record.values.round)
  const requiredEventId = record.values.requiredEventId
  const responseKeys = decodeResponseKeys(record.values.responseKeys)
  if (round === undefined || !isTraceIdentifier(requiredEventId) || !responseKeys) return undefined
  return { schemaVersion: "1", round, requiredEventId, responseKeys, values: "not-retained" }
}

export const decodeMrtrResumedPayload = (value: unknown): MrtrResumedPayload | undefined => {
  const record = exactRecord(value, [
    "schemaVersion",
    "round",
    "requiredEventId",
    "retrySendEventId",
    "logicalRequest",
    "responseKeys",
    "requestState",
    "retry",
  ])
  if (
    !record ||
    record.values.schemaVersion !== "1" ||
    record.values.retry !== "fresh-wire-attempt"
  ) {
    return undefined
  }
  const round = decodeRound(record.values.round)
  const requiredEventId = record.values.requiredEventId
  const retrySendEventId = record.values.retrySendEventId
  const logicalRequest = decodeLogicalRequest(record.values.logicalRequest)
  const responseKeys = decodeResponseKeys(record.values.responseKeys)
  const requestState = decodeRequestState(record.values.requestState)
  if (
    round === undefined ||
    !isTraceIdentifier(requiredEventId) ||
    !isTraceIdentifier(retrySendEventId) ||
    !logicalRequest ||
    !responseKeys ||
    !requestState
  ) {
    return undefined
  }
  return {
    schemaVersion: "1",
    round,
    requiredEventId,
    retrySendEventId,
    logicalRequest,
    responseKeys,
    requestState,
    retry: "fresh-wire-attempt",
  }
}

export const decodeMrtrEventPayload = (event: McpTraceEvent): MrtrPayload | undefined => {
  switch (event.kind) {
    case "mrtr.input-required":
      return decodeMrtrInputRequiredPayload(event.payload)
    case "mrtr.input-supplied":
      return decodeMrtrInputSuppliedPayload(event.payload)
    case "mrtr.resumed":
      return decodeMrtrResumedPayload(event.payload)
    default:
      return undefined
  }
}

const sameLogicalRequest = (left: LogicalRequest, right: LogicalRequest): boolean =>
  left.initialSendEventId === right.initialSendEventId &&
  left.method === right.method &&
  left.paramsSha256 === right.paramsSha256

const sameStateEvidence = (left: RequestStateEvidence, right: RequestStateEvidence): boolean =>
  left.present === right.present &&
  (!left.present ||
    (right.present && left.sha256 === right.sha256 && left.byteLength === right.byteLength))

const sameKeys = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((key, index) => key === right[index])

const sameKeySet = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  left.every(key => right.includes(key))

const requestIdOf = (event: McpTraceEvent): string | number | null | undefined =>
  event.protocol?.requestId

const payloadResultType = (event: McpTraceEvent): unknown => {
  const record = ownDataRecord(event.payload)
  return record?.values.resultType
}

const sequenceIssue = (event: McpTraceEvent, message: string): MrtrTraceIssue => ({
  code: "invalid-mrtr-sequence",
  path: `events.${event.id}`,
  message,
})

export const validateMrtrTraceEvents = (
  events: ReadonlyArray<McpTraceEvent>,
): ReadonlyArray<MrtrTraceIssue> => {
  const issues: Array<MrtrTraceIssue> = []
  const byId = new Map(events.map(event => [event.id, event]))
  const decoded = new Map<string, MrtrPayload>()
  const mrtrEvents = events.filter(
    event => event.family === "mrtr" || event.kind.startsWith("mrtr."),
  )

  for (const event of mrtrEvents) {
    const payload = decodeMrtrEventPayload(event)
    if (!payload) {
      issues.push({
        code: "invalid-mrtr-payload",
        path: `events.${event.id}.payload`,
        message: `Trace event "${event.id}" has an invalid normalized MRTR payload`,
      })
    } else {
      decoded.set(event.id, payload)
    }
  }

  const requiredEvents = mrtrEvents.filter(event => event.kind === "mrtr.input-required")
  const suppliedEvents = mrtrEvents.filter(event => event.kind === "mrtr.input-supplied")
  const resumedEvents = mrtrEvents.filter(event => event.kind === "mrtr.resumed")
  const overflowRound = requiredEvents[10]
  if (overflowRound) {
    issues.push(sequenceIssue(overflowRound, "MRTR traces support at most 10 resolved rounds"))
  }

  let firstLogicalRequest: LogicalRequest | undefined
  let previousRound = 0
  let previousRetrySend: McpTraceEvent | undefined
  for (const requiredEvent of requiredEvents.toSorted((a, b) => a.sequence - b.sequence)) {
    const required = decoded.get(requiredEvent.id)
    if (!required || !("inputRequests" in required)) continue
    if (required.round <= previousRound) {
      issues.push(
        sequenceIssue(requiredEvent, "MRTR rounds must be unique and increase in event order"),
      )
    }
    previousRound = required.round
    if (firstLogicalRequest && !sameLogicalRequest(firstLogicalRequest, required.logicalRequest)) {
      issues.push(
        sequenceIssue(
          requiredEvent,
          "MRTR logical request evidence must remain constant across rounds",
        ),
      )
    }
    firstLogicalRequest ??= required.logicalRequest

    const initialSend = byId.get(required.logicalRequest.initialSendEventId)
    const attemptSend = previousRetrySend ?? initialSend
    const terminalResult = byId.get(required.terminalAttemptResultEventId)
    if (
      !initialSend ||
      initialSend.kind !== "wire.message-sent" ||
      initialSend.sequence >= requiredEvent.sequence ||
      initialSend.protocol?.method !== required.logicalRequest.method ||
      initialSend.protocol?.direction !== "send" ||
      initialSend.correlationId !== requiredEvent.correlationId ||
      requestIdOf(initialSend) === undefined ||
      requestIdOf(initialSend) === null
    ) {
      issues.push(
        sequenceIssue(
          requiredEvent,
          "MRTR initial request evidence must reference an earlier matching wire send",
        ),
      )
    }
    if (
      !terminalResult ||
      terminalResult.kind !== "wire.message-received" ||
      terminalResult.sequence >= requiredEvent.sequence ||
      !attemptSend ||
      terminalResult.sequence <= attemptSend.sequence ||
      terminalResult.protocol?.direction !== "receive" ||
      terminalResult.correlationId !== requiredEvent.correlationId ||
      requestIdOf(terminalResult) !== requestIdOf(attemptSend) ||
      payloadResultType(terminalResult) !== "input_required"
    ) {
      issues.push(
        sequenceIssue(
          requiredEvent,
          "MRTR input_required must reference the terminal result of its wire attempt",
        ),
      )
    }

    const suppliedMatches = suppliedEvents.filter(event => {
      const payload = decoded.get(event.id)
      return payload && "values" in payload && payload.requiredEventId === requiredEvent.id
    })
    const resumedMatches = resumedEvents.filter(event => {
      const payload = decoded.get(event.id)
      return payload && "retry" in payload && payload.requiredEventId === requiredEvent.id
    })
    if (suppliedMatches.length !== 1 || resumedMatches.length !== 1) {
      issues.push(
        sequenceIssue(
          requiredEvent,
          "MRTR input_required must have one supplied and one resumed event",
        ),
      )
      continue
    }
    const suppliedEvent = suppliedMatches[0]
    const resumedEvent = resumedMatches[0]
    if (!suppliedEvent || !resumedEvent) continue
    const supplied = decoded.get(suppliedEvent.id) as MrtrInputSuppliedPayload
    const resumed = decoded.get(resumedEvent.id) as MrtrResumedPayload
    const requestKeys = Object.keys(required.inputRequests)
    if (
      suppliedEvent.sequence <= requiredEvent.sequence ||
      resumedEvent.sequence <= suppliedEvent.sequence ||
      supplied.round !== required.round ||
      resumed.round !== required.round ||
      suppliedEvent.correlationId !== requiredEvent.correlationId ||
      resumedEvent.correlationId !== requiredEvent.correlationId ||
      !sameKeySet(supplied.responseKeys, requestKeys) ||
      !sameKeys(supplied.responseKeys, resumed.responseKeys) ||
      !sameLogicalRequest(required.logicalRequest, resumed.logicalRequest) ||
      !sameStateEvidence(required.requestState, resumed.requestState)
    ) {
      issues.push(
        sequenceIssue(
          requiredEvent,
          "MRTR supplied and resumed events must preserve round correlation and exact evidence",
        ),
      )
    }

    const retrySend = byId.get(resumed.retrySendEventId)
    if (
      !retrySend ||
      retrySend.kind !== "wire.message-sent" ||
      retrySend.sequence <= resumedEvent.sequence ||
      retrySend.protocol?.method !== required.logicalRequest.method ||
      retrySend.protocol?.direction !== "send" ||
      retrySend.correlationId !== requiredEvent.correlationId ||
      !attemptSend ||
      requestIdOf(retrySend) === undefined ||
      requestIdOf(retrySend) === null ||
      requestIdOf(retrySend) === requestIdOf(attemptSend)
    ) {
      issues.push(
        sequenceIssue(
          requiredEvent,
          "MRTR retry must reference a later matching wire send with a fresh request id",
        ),
      )
    }
    previousRetrySend = retrySend
  }

  for (const event of [...suppliedEvents, ...resumedEvents]) {
    const payload = decoded.get(event.id)
    if (!payload || !("requiredEventId" in payload)) continue
    const required = byId.get(payload.requiredEventId)
    if (!required || required.kind !== "mrtr.input-required") {
      issues.push(
        sequenceIssue(
          event,
          "MRTR supplied or resumed evidence must reference an input_required event",
        ),
      )
    }
  }

  return issues
}
