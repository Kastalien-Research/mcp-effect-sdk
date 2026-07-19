import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type {
  CreateMessageRequestParams,
  ElicitRequestFormParams,
  ElicitRequestURLParams
} from "./generated/mcp/2026-07-28/McpSchema.generated.js"
import type {
  CreateMessageResult,
  ElicitResult,
  ListRootsResult
} from "./McpSchema.js"
import type { ClientRequestMethod } from "./generated/mcp/2026-07-28/McpProtocol.generated.js"

export type InputRequiredMode = "automatic" | "manual"

export interface InputRequiredHandlerContext {
  readonly parentMethod: "prompts/get" | "resources/read" | "tools/call"
  readonly key: string
  readonly round: number
}

export interface SamplingInputHandler<R = never> {
  readonly handle: (
    params: CreateMessageRequestParams,
    context: InputRequiredHandlerContext
  ) => Effect.Effect<CreateMessageResult, unknown, R>
  readonly context?: boolean
  readonly tools?: boolean
}

export interface RootsInputHandler<R = never> {
  readonly list:
    | Effect.Effect<ListRootsResult, unknown, R>
    | ((context: InputRequiredHandlerContext) => Effect.Effect<ListRootsResult, unknown, R>)
}

export interface ElicitationInputHandlers<R = never> {
  readonly form?: (
    params: ElicitRequestFormParams,
    context: InputRequiredHandlerContext
  ) => Effect.Effect<ElicitResult, unknown, R>
  readonly url?: (
    params: ElicitRequestURLParams,
    context: InputRequiredHandlerContext
  ) => Effect.Effect<ElicitResult, unknown, R>
}

export interface AutomaticInputRequiredPolicy<R = never> {
  readonly mode: "automatic"
  readonly maxRounds?: number
  readonly maxRequestsPerRound?: number
  readonly maxConcurrency?: number
  readonly sampling?: SamplingInputHandler<R>
  readonly roots?: RootsInputHandler<R>
  readonly elicitation?: ElicitationInputHandlers<R>
}

export interface ManualInputRequiredPolicy {
  readonly mode: "manual"
}

export type InputRequiredPolicy<R = never> =
  | AutomaticInputRequiredPolicy<R>
  | ManualInputRequiredPolicy

const manual: ManualInputRequiredPolicy = Object.freeze({ mode: "manual" })

export const InputRequiredPolicy = Object.freeze({
  manual,
  automatic: <R = never>(
    options: Omit<AutomaticInputRequiredPolicy<R>, "mode"> = {}
  ): AutomaticInputRequiredPolicy<R> => Object.freeze({ mode: "automatic", ...options })
})

export type InputRequiredErrorReason =
  | "MissingHandler"
  | "CapabilityMismatch"
  | "InvalidInputRequest"
  | "InvalidInputResponse"
  | "Overloaded"
  | "RoundLimit"

export class InputRequiredError extends Data.TaggedError("InputRequiredError")<{
  readonly reason: InputRequiredErrorReason
  readonly message: string
  readonly method: ClientRequestMethod
  readonly key?: string
  readonly cause?: unknown
}> {}
