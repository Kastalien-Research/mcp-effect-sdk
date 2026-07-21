import * as Either from "effect/Either"
import * as Schema from "effect/Schema"
import { CLIENT_REQUEST_RESULT_CODEC_BY_METHOD } from "../generated/mcp/2026-07-28/McpProtocol.generated.js"
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcSuccessResponse
} from "../McpWire.js"

const SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId"

export type SubscriptionTerminalValidation =
  | { readonly _tag: "Valid" }
  | { readonly _tag: "Mismatch" }
  | { readonly _tag: "Invalid"; readonly cause: unknown }

/** @internal Validate one graceful subscriptions/listen terminal without transport policy. */
export const validateSubscriptionTerminal = (
  requestId: JsonRpcId,
  message: JsonRpcSuccessResponse | JsonRpcErrorResponse
): SubscriptionTerminalValidation => {
  if (message._tag !== "SuccessResponse" || !exactId(requestId, message.id) ||
    !exactId(requestId, terminalSubscriptionId(message))) {
    return { _tag: "Mismatch" }
  }
  const decoded = Schema.decodeUnknownEither(
    CLIENT_REQUEST_RESULT_CODEC_BY_METHOD["subscriptions/listen"]
  )(message.result)
  return Either.isLeft(decoded)
    ? { _tag: "Invalid", cause: decoded.left }
    : { _tag: "Valid" }
}

const terminalSubscriptionId = (message: JsonRpcSuccessResponse): unknown => {
  if (!isRecord(message.result)) return undefined
  const meta = dataProperty(message.result, "_meta")
  return isRecord(meta) ? dataProperty(meta, SUBSCRIPTION_ID) : undefined
}

const exactId = (left: JsonRpcId, right: unknown): boolean =>
  (typeof right === "string" || typeof right === "number") &&
  typeof left === typeof right && left === right

const dataProperty = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
