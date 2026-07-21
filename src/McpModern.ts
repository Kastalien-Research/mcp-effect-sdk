/**
 * Helpers for the draft/modern MCP protocol era (`2026-07-28` and later).
 *
 * The stable SDK APIs in this repository still expose the legacy MCP request
 * names for compatibility, but these helpers centralize the new draft wire
 * requirements so transports, clients, and servers can opt into the stateless
 * protocol model without reintroducing session-local assumptions.
 */
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  Implementation,
  type ClientCapabilities,
  type ServerCapabilities
} from "./McpSchema.js"

/** The protocol version used by the current MCP draft/release-candidate schema. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28" as const

/** The first protocol version in the stateless, handshake-free MCP era. */
export const FIRST_MODERN_PROTOCOL_VERSION = MODERN_PROTOCOL_VERSION

export const MCP_PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion" as const
export const MCP_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo" as const
export const MCP_CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities" as const
export const MCP_LOG_LEVEL_META_KEY = "io.modelcontextprotocol/logLevel" as const
export const MCP_SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId" as const
export const MCP_TRACEPARENT_META_KEY = "traceparent" as const
export const MCP_TRACESTATE_META_KEY = "tracestate" as const
export const MCP_BAGGAGE_META_KEY = "baggage" as const
export const MCP_SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo" as const

export const MCP_PROTOCOL_VERSION_HEADER = "MCP-Protocol-Version" as const
export const MCP_METHOD_HEADER = "Mcp-Method" as const
export const MCP_NAME_HEADER = "Mcp-Name" as const

export const SERVER_DISCOVER_METHOD = "server/discover" as const
export const SUBSCRIPTIONS_LISTEN_METHOD = "subscriptions/listen" as const

export const HEADER_MISMATCH_ERROR_CODE = -32020 as const
export const MISSING_REQUIRED_CLIENT_CAPABILITY_ERROR_CODE = -32021 as const
export const UNSUPPORTED_PROTOCOL_VERSION_ERROR_CODE = -32022 as const

export type ResultType = "complete" | "input_required" | string

export interface ModernRequestMeta extends Record<string, unknown> {
  readonly [MCP_PROTOCOL_VERSION_META_KEY]: string
  readonly [MCP_CLIENT_INFO_META_KEY]: Implementation
  readonly [MCP_CLIENT_CAPABILITIES_META_KEY]: ClientCapabilities
  readonly [MCP_LOG_LEVEL_META_KEY]?: string | undefined
  readonly [MCP_TRACEPARENT_META_KEY]?: string | undefined
  readonly [MCP_TRACESTATE_META_KEY]?: string | undefined
  readonly [MCP_BAGGAGE_META_KEY]?: string | undefined
}

export interface ModernResult extends Record<string, unknown> {
  readonly _meta?: Record<string, unknown> | undefined
  readonly resultType: ResultType
}

export interface InputRequiredResult extends ModernResult {
  readonly resultType: "input_required"
  readonly inputRequests?: Record<string, unknown> | undefined
  readonly requestState?: string | undefined
}

export interface CompleteResult extends ModernResult {
  readonly resultType: "complete"
}

export interface DiscoverResult extends CompleteResult {
  readonly supportedVersions: ReadonlyArray<string>
  readonly capabilities: ServerCapabilities
  readonly instructions?: string | undefined
  readonly ttlMs?: number | undefined
  readonly cacheScope?: "public" | "private" | string | undefined
}

export const makeModernRequestMeta = (options: {
  readonly clientInfo: Implementation
  readonly clientCapabilities?: ClientCapabilities | undefined
  readonly protocolVersion?: string | undefined
  readonly logLevel?: string | undefined
  readonly meta?: Record<string, unknown> | undefined
}): ModernRequestMeta => ({
  ...options.meta,
  [MCP_PROTOCOL_VERSION_META_KEY]: options.protocolVersion ?? MODERN_PROTOCOL_VERSION,
  [MCP_CLIENT_INFO_META_KEY]: options.clientInfo,
  [MCP_CLIENT_CAPABILITIES_META_KEY]: options.clientCapabilities ?? {},
  ...(options.logLevel === undefined ? {} : { [MCP_LOG_LEVEL_META_KEY]: options.logLevel })
})

export const withModernRequestMeta = <Params extends Record<string, unknown> | undefined>(
  params: Params,
  meta: ModernRequestMeta
): Params extends undefined ? { readonly _meta: ModernRequestMeta } : Params & { readonly _meta: ModernRequestMeta } => ({
  ...(params ?? {}),
  _meta: {
    ...((params as { readonly _meta?: Record<string, unknown> } | undefined)?._meta),
    ...meta
  }
}) as never

export const normalizeModernResult = <Result extends Record<string, unknown>>(
  result: Result
): Result & { readonly resultType: ResultType } => ({
  resultType: "complete",
  ...result
}) as Result & { readonly resultType: ResultType }

export const isInputRequiredResult = (result: unknown): result is InputRequiredResult =>
  typeof result === "object" && result !== null &&
  (result as { readonly resultType?: unknown }).resultType === "input_required"

export const modernServerCapabilities = (capabilities: ServerCapabilities): ServerCapabilities => ({
  ...capabilities,
  extensions: capabilities.extensions ?? {}
})

export const makeDiscoverResult = (options: {
  readonly supportedVersions?: ReadonlyArray<string> | undefined
  readonly capabilities: ServerCapabilities
  readonly instructions?: string | undefined
  readonly ttlMs?: number | undefined
  readonly cacheScope?: "public" | "private" | string | undefined
}): DiscoverResult => normalizeModernResult({
  supportedVersions: options.supportedVersions ?? [MODERN_PROTOCOL_VERSION],
  capabilities: modernServerCapabilities(options.capabilities),
  ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
  ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  ...(options.cacheScope === undefined ? {} : { cacheScope: options.cacheScope })
}) as DiscoverResult

/**
 * Read the self-reported server identity from a result's reserved metadata.
 *
 * The helper deliberately snapshots own data properties before schema
 * validation. Accessors, cyclic values, and hostile proxies are treated as
 * absent metadata rather than invoked.
 */
export const serverInfoFromResult = (result: unknown): Option.Option<Implementation> => {
  const metadata = ownDataProperty(result, "_meta")
  if (Option.isNone(metadata)) return Option.none()
  const identity = ownDataProperty(metadata.value, MCP_SERVER_INFO_META_KEY)
  if (Option.isNone(identity)) return Option.none()
  const snapshot = snapshotOwnData(identity.value, new Set())
  if (Option.isNone(snapshot)) return Option.none()
  try {
    const decoded = Schema.decodeUnknownEither(Implementation)(snapshot.value)
    return Either.isRight(decoded) ? Option.some(decoded.right) : Option.none()
  } catch {
    return Option.none()
  }
}

const ownDataProperty = (value: unknown, key: PropertyKey): Option.Option<unknown> => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return Option.none()
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && "value" in descriptor
      ? Option.some(descriptor.value)
      : Option.none()
  } catch {
    return Option.none()
  }
}

const snapshotOwnData = (
  value: unknown,
  seen: Set<object>
): Option.Option<unknown> => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return Option.some(value)
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Option.some(value) : Option.none()
  }
  if (typeof value !== "object" || seen.has(value)) return Option.none()

  try {
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== "string")) return Option.none()
    const descriptors = Object.getOwnPropertyDescriptors(value)
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        const output: unknown[] = []
        const lengthDescriptor = descriptors.length
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
          return Option.none()
        }
        for (let index = 0; index < lengthDescriptor.value; index++) {
          const descriptor = descriptors[String(index)]
          if (descriptor === undefined || !("value" in descriptor)) return Option.none()
          const item = snapshotOwnData(descriptor.value, seen)
          if (Option.isNone(item)) return Option.none()
          output.push(item.value)
        }
        return Option.some(output)
      }

      const output: Record<string, unknown> = Object.create(null)
      for (const key of keys as string[]) {
        const descriptor = descriptors[key]
        if (descriptor === undefined || !("value" in descriptor)) return Option.none()
        const item = snapshotOwnData(descriptor.value, seen)
        if (Option.isNone(item)) return Option.none()
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value: item.value,
          writable: true
        })
      }
      return Option.some(output)
    } finally {
      seen.delete(value)
    }
  } catch {
    return Option.none()
  }
}
