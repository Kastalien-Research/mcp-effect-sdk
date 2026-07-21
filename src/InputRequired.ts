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

const automaticPolicy = <R>(
  options: Omit<AutomaticInputRequiredPolicy<R>, "mode">
): AutomaticInputRequiredPolicy<R> => {
  if ((typeof options !== "object" && typeof options !== "function") || options === null) {
    throw new TypeError("Automatic input-required policy options must be an object")
  }
  const allowed = new Set([
    "mode", "maxRounds", "maxRequestsPerRound", "maxConcurrency", "sampling", "roots", "elicitation"
  ])
  const keys = Reflect.ownKeys(options)
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("Invalid automatic input-required policy property")
  }
  const descriptors = Object.getOwnPropertyDescriptors(options)
  const output: Record<string, unknown> = Object.create(null)
  for (const key of keys as ReadonlyArray<string>) {
    const descriptor = descriptors[key]
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`Automatic input-required policy ${key} must be an enumerable data property`)
    }
    if (key === "mode") continue
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false
    })
  }
  Object.defineProperty(output, "mode", {
    configurable: false,
    enumerable: true,
    value: "automatic",
    writable: false
  })
  return Object.freeze(output) as unknown as AutomaticInputRequiredPolicy<R>
}

export const InputRequiredPolicy = Object.freeze({
  manual,
  automatic: <R = never>(
    options: Omit<AutomaticInputRequiredPolicy<R>, "mode"> = {}
  ): AutomaticInputRequiredPolicy<R> => automaticPolicy(options)
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
