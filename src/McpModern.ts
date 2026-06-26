/**
 * Helpers for the draft/modern MCP protocol era (`2026-07-28` and later).
 *
 * The stable SDK APIs in this repository still expose the legacy MCP request
 * names for compatibility, but these helpers centralize the new draft wire
 * requirements so transports, clients, and servers can opt into the stateless
 * protocol model without reintroducing session-local assumptions.
 */
import type { ClientCapabilities, Implementation, ServerCapabilities } from "./McpSchema.js"

/** The protocol version used by the current MCP draft/release-candidate schema. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28" as const

/** The first protocol version in the stateless, handshake-free MCP era. */
export const FIRST_MODERN_PROTOCOL_VERSION = MODERN_PROTOCOL_VERSION

export const MCP_PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion" as const
export const MCP_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo" as const
export const MCP_CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities" as const
export const MCP_LOG_LEVEL_META_KEY = "io.modelcontextprotocol/logLevel" as const
export const MCP_SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId" as const

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
  readonly serverInfo: Implementation
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
  readonly serverInfo: Implementation
  readonly instructions?: string | undefined
  readonly ttlMs?: number | undefined
  readonly cacheScope?: "public" | "private" | string | undefined
}): DiscoverResult => normalizeModernResult({
  supportedVersions: options.supportedVersions ?? [MODERN_PROTOCOL_VERSION],
  capabilities: modernServerCapabilities(options.capabilities),
  serverInfo: options.serverInfo,
  ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
  ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  ...(options.cacheScope === undefined ? {} : { cacheScope: options.cacheScope })
}) as DiscoverResult
