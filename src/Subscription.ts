import type * as Cause from "effect/Cause"
import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type {
  PromptListChangedNotification,
  ResourceListChangedNotification,
  ResourceUpdatedNotification,
  SubscriptionsListenResult,
  ToolListChangedNotification
} from "./generated/mcp/2026-07-28/McpSchema.generated.js"

/** Exact core opt-ins for one `subscriptions/listen` request. */
export interface SubscriptionFilter {
  readonly toolsListChanged?: boolean
  readonly promptsListChanged?: boolean
  readonly resourcesListChanged?: boolean
  readonly resourceSubscriptions?: ReadonlyArray<string>
}

/** Change notifications selected for a stable subscription product. */
export type SubscriptionNotification =
  | ToolListChangedNotification
  | PromptListChangedNotification
  | ResourceListChangedNotification
  | ResourceUpdatedNotification

export type SubscriptionAbruptReason =
  | "UnexpectedEnd"
  | "Transport"
  | "Overflow"
  | "Dispatch"

export type SubscriptionProtocolReason =
  | "Acknowledgement"
  | "Frame"
  | "Terminal"

interface SubscriptionErrorOptions<Reason extends string> {
  readonly reason: Reason
  readonly cause: Cause.Cause<unknown>
}

/** Unexpected non-protocol termination of an acknowledged subscription. */
export class SubscriptionAbruptError extends Error {
  readonly _tag = "SubscriptionAbruptError" as const
  readonly reason: SubscriptionAbruptReason
  declare readonly cause: Cause.Cause<unknown>

  constructor(options: SubscriptionErrorOptions<SubscriptionAbruptReason>) {
    super("Subscription closed unexpectedly")
    this.name = "SubscriptionAbruptError"
    this.reason = options.reason
    Object.defineProperty(this, "cause", {
      configurable: false,
      enumerable: false,
      value: options.cause,
      writable: false
    })
  }
}

/** Generated acknowledgement, frame, or terminal protocol violation. */
export class SubscriptionProtocolError extends Error {
  readonly _tag = "SubscriptionProtocolError" as const
  readonly reason: SubscriptionProtocolReason
  declare readonly cause: Cause.Cause<unknown>

  constructor(options: SubscriptionErrorOptions<SubscriptionProtocolReason>) {
    super("Subscription protocol violation")
    this.name = "SubscriptionProtocolError"
    this.reason = options.reason
    Object.defineProperty(this, "cause", {
      configurable: false,
      enumerable: false,
      value: options.cause,
      writable: false
    })
  }
}

export type SubscriptionClosure =
  | { readonly _tag: "CallerClosed" }
  | {
      readonly _tag: "Graceful"
      readonly result: SubscriptionsListenResult
    }
  | {
      readonly _tag: "Abrupt"
      readonly error: SubscriptionAbruptError
    }
  | {
      readonly _tag: "ProtocolError"
      readonly error: SubscriptionProtocolError
    }

/**
 * Scoped single-consumer subscription product. The caller's Scope owns the
 * request even if `close` is not invoked explicitly.
 */
export interface Subscription {
  readonly acknowledgedFilter: SubscriptionFilter
  readonly notifications: Stream.Stream<
    SubscriptionNotification,
    SubscriptionAbruptError | SubscriptionProtocolError
  >
  readonly close: Effect.Effect<void>
  readonly closed: Effect.Effect<SubscriptionClosure>
}
