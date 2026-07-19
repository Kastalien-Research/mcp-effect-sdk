import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Random from "effect/Random"

export type CacheableClientMethod =
  | "server/discover"
  | "tools/list"
  | "resources/list"
  | "resources/templates/list"
  | "resources/read"
  | "prompts/list"

export type McpCacheAuthorization =
  | { readonly _tag: "Anonymous" }
  | { readonly _tag: "Authorized"; readonly partition: string }
  | { readonly _tag: "AuthorizedUnpartitioned" }

export type McpCacheAuthorizationProvider<E = never, R = never> =
  () => Effect.Effect<McpCacheAuthorization, E, R>

export interface McpCacheKey {
  readonly namespace: string
  readonly method: CacheableClientMethod
  readonly params: Readonly<Record<string, unknown>>
  readonly protocolVersion: string
  readonly capabilities: Readonly<Record<string, unknown>>
  readonly cacheScope: "public" | "private"
  readonly authorizationPartition?: string
}

export interface McpCacheEntry {
  readonly result: Readonly<Record<string, unknown>>
  readonly receivedAt: number
  readonly expiresAt: number
  readonly cacheScope: "public" | "private"
}

export interface McpCacheSelector {
  readonly namespace: string
  readonly methods?: ReadonlyArray<CacheableClientMethod>
  readonly uri?: string
}

export interface McpCacheService {
  readonly get: (key: McpCacheKey) => Effect.Effect<Option.Option<McpCacheEntry>, unknown>
  readonly set: (key: McpCacheKey, entry: McpCacheEntry) => Effect.Effect<void, unknown>
  readonly invalidate: (selector: McpCacheSelector) => Effect.Effect<void, unknown>
}

export class McpCacheError extends Data.TaggedError("McpCacheError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface McpCacheMemoryOptions {
  readonly capacity?: number
}

const keyText = (key: McpCacheKey): string => JSON.stringify(key)

const memory = (
  options: McpCacheMemoryOptions = {}
): Effect.Effect<McpCacheService, McpCacheError> => Effect.gen(function*() {
  const capacity = yield* Effect.try({
    try: () => {
      const descriptors = Object.getOwnPropertyDescriptors(options)
      const descriptor = descriptors.capacity
      if (descriptor !== undefined && !("value" in descriptor)) throw new TypeError("capacity must be a data property")
      const candidate = descriptor === undefined ? 256 : descriptor.value
      if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1) {
        throw new TypeError("capacity must be a positive safe integer")
      }
      return candidate
    },
    catch: (cause) => new McpCacheError({ message: "Invalid cache configuration", cause })
  })
  const entries = new Map<string, { readonly key: McpCacheKey; readonly entry: McpCacheEntry }>()

  const get: McpCacheService["get"] = (key) => Effect.sync(() => {
    const encoded = keyText(key)
    const found = entries.get(encoded)
    if (found === undefined) return Option.none()
    entries.delete(encoded)
    entries.set(encoded, found)
    return Option.some(found.entry)
  })

  const set: McpCacheService["set"] = (key, entry) => Effect.sync(() => {
    const encoded = keyText(key)
    entries.delete(encoded)
    entries.set(encoded, { key, entry })
    while (entries.size > capacity) {
      const oldest = entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  })

  const invalidate: McpCacheService["invalidate"] = (selector) => Effect.sync(() => {
    for (const [encoded, stored] of entries) {
      if (stored.key.namespace !== selector.namespace) continue
      if (selector.methods !== undefined && !selector.methods.includes(stored.key.method)) continue
      if (selector.uri !== undefined && stored.key.params["uri"] !== selector.uri) continue
      entries.delete(encoded)
    }
  })

  return Object.freeze({ get, set, invalidate })
})

export const McpCache = Object.freeze({ memory })

export const randomCacheNamespace = (): Effect.Effect<string> => Effect.forEach(
  Array.from({ length: 16 }),
  () => Random.nextIntBetween(0, 256)
).pipe(Effect.map((bytes) => bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")))
