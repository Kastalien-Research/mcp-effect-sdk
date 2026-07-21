import { Effect, Option } from "effect"
import { McpWire } from "mcp-effect-sdk"
import {
  McpCache,
  McpCacheError,
  make as makeClient,
  type CacheableClientMethod,
  type McpCacheAuthorization,
  type McpCacheAuthorizationProvider,
  type McpCacheEntry,
  type McpCacheKey,
  type McpCacheSelector,
  type McpCacheService,
  type McpClientErrorReason,
  type McpTransport
} from "mcp-effect-sdk/client"
import {
  PaginationCursor,
  make as makeServer,
  type McpServerService,
  type PaginatedCollection,
  type PaginationCursorService,
  type PaginationCursorState,
  type PaginationPolicy
} from "mcp-effect-sdk/server"

declare const transport: McpTransport<never>
const authorization: McpCacheAuthorization = { _tag: "Authorized", partition: "tenant" }
const provider: McpCacheAuthorizationProvider = () => Effect.succeed(authorization)
const cache = McpCache.memory({ capacity: 4 })
const cursor = PaginationCursor.memory({ capacity: 4, lifetimeMs: 1_000 })
const policy: PaginationPolicy = { pageSize: 2, ttlMs: 10, cacheScope: "private" }
const collection: PaginatedCollection = "resourceTemplates"
const state: PaginationCursorState = {
  owner: "owner",
  collection,
  revision: 1,
  offset: 2,
  view: ["one", "two"]
}
const cursorService: Effect.Effect<PaginationCursorService, McpWire.SchemaValidationError> = cursor
type AssertNever<T extends never> = T
type _PaginationInternalsArePrivate = AssertNever<Extract<
  "paginationOwner" | "paginationCursor" | "paginationRevisions",
  keyof McpServerService
>>
const cacheService: Effect.Effect<McpCacheService, McpCacheError> = cache
const key: McpCacheKey = {
  namespace: "server",
  method: "tools/list",
  params: {},
  protocolVersion: "2026-07-28",
  capabilities: {},
  cacheScope: "public"
}
const entry: McpCacheEntry = {
  result: { resultType: "complete", ttlMs: 1, cacheScope: "public", tools: [] },
  receivedAt: 0,
  expiresAt: 1,
  cacheScope: "public"
}
const selector: McpCacheSelector = { namespace: "server", methods: ["tools/list"] }
const method: CacheableClientMethod = "resources/read"
const reason: McpClientErrorReason = "Cache"
void makeClient({ transport, cache: undefined, cacheAuthorization: provider, cacheNamespace: "server" })
void makeServer({ serverInfo: { name: "server", version: "1" }, handlers: Effect.void, pagination: policy })
void Option.none()
void cursor
void cursorService
void cacheService
void key
void entry
void selector
void method
void reason
void state

// @ts-expect-error cache partitions are already-derived strings, never arbitrary principals
const noPrincipal: McpCacheAuthorization = { _tag: "Authorized", principal: { token: "secret" } }
// @ts-expect-error pagination does not expose progress policy
makeServer({ serverInfo: { name: "x", version: "1" }, handlers: Effect.void, progressPolicy: {} })
void noPrincipal
