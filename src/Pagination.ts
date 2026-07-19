import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Random from "effect/Random"
import { SchemaValidationError } from "./McpErrors.js"

export type PaginatedCollection = "tools" | "resources" | "resourceTemplates" | "prompts"

export interface PaginationPolicy {
  readonly pageSize?: number
  readonly ttlMs?: number
  readonly cacheScope?: "public" | "private"
}

export interface PaginationCursorState {
  readonly owner: string
  readonly collection: PaginatedCollection
  readonly revision: number
  readonly offset: number
  readonly view: ReadonlyArray<string>
}

export interface PaginationCursorService {
  readonly issue: (state: PaginationCursorState) => Effect.Effect<string, SchemaValidationError>
  readonly resolve: (cursor: string) => Effect.Effect<PaginationCursorState, SchemaValidationError>
  readonly invalidate: (
    collections?: ReadonlyArray<PaginatedCollection>
  ) => Effect.Effect<void, SchemaValidationError>
}

export interface PaginationCursorMemoryOptions {
  readonly capacity?: number
  readonly lifetimeMs?: number
}

const DEFAULT_CAPACITY = 1_024
const DEFAULT_LIFETIME_MS = 5 * 60 * 1_000
const TOKEN = /^[a-f0-9]{32}$/
const CURSOR = /^mcp1\.([a-f0-9]{32})\.([a-f0-9]{32})$/

const error = (message: string, cause?: unknown) => new SchemaValidationError({
  message,
  ...(cause === undefined ? {} : { cause })
})

const safeInteger = (value: unknown, fallback: number, minimum: number, label: string): number => {
  const candidate = value === undefined ? fallback : value
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < minimum) {
    throw new TypeError(`${label} must be a safe integer greater than or equal to ${minimum}`)
  }
  return candidate
}

export const randomOpaque128 = (): Effect.Effect<string> => Effect.forEach(
  Array.from({ length: 16 }),
  () => Random.nextIntBetween(0, 256)
).pipe(Effect.map((bytes) => bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")))

const cloneState = (state: PaginationCursorState): PaginationCursorState => ({
  owner: state.owner,
  collection: state.collection,
  revision: state.revision,
  offset: state.offset,
  view: Object.freeze([...state.view])
})

const snapshotState = (value: unknown): PaginationCursorState | undefined => {
  try {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return undefined
    const data = (name: string): unknown => {
      const descriptor = descriptors[name]
      return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined
    }
    const owner = data("owner")
    const collection = data("collection")
    const revision = data("revision")
    const offset = data("offset")
    const rawView = data("view")
    if (typeof owner !== "string" || !TOKEN.test(owner) ||
      (collection !== "tools" && collection !== "resources" &&
        collection !== "resourceTemplates" && collection !== "prompts") ||
      typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
      typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 ||
      !Array.isArray(rawView)) return undefined
    const viewDescriptors = Object.getOwnPropertyDescriptors(rawView) as Record<string, PropertyDescriptor>
    const length = viewDescriptors.length
    if (length === undefined || !("value" in length) ||
      typeof length.value !== "number" || !Number.isSafeInteger(length.value)) return undefined
    const view: Array<string> = []
    for (let index = 0; index < length.value; index++) {
      const descriptor = viewDescriptors[String(index)]
      if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string") return undefined
      view.push(descriptor.value)
    }
    return Object.freeze({ owner, collection, revision, offset, view: Object.freeze(view) })
  } catch {
    return undefined
  }
}

interface StoredCursor {
  readonly state: PaginationCursorState
  readonly expiresAt: number
}

const memory = (
  options: PaginationCursorMemoryOptions = {}
): Effect.Effect<PaginationCursorService, SchemaValidationError> => Effect.gen(function*() {
  const configuration = yield* Effect.try({
    try: () => {
      const descriptors = Object.getOwnPropertyDescriptors(options)
      for (const name of ["capacity", "lifetimeMs"]) {
        const descriptor = descriptors[name]
        if (descriptor !== undefined && !("value" in descriptor)) throw new TypeError(`${name} must be a data property`)
      }
      return {
        capacity: safeInteger(descriptors.capacity?.value, DEFAULT_CAPACITY, 1, "cursor capacity"),
        lifetimeMs: safeInteger(descriptors.lifetimeMs?.value, DEFAULT_LIFETIME_MS, 1, "cursor lifetimeMs")
      }
    },
    catch: (cause) => error("Invalid pagination cursor configuration", cause)
  })
  const serviceOwner = yield* randomOpaque128()
  const entries = new Map<string, StoredCursor>()

  const prune = (now: number) => {
    for (const [token, entry] of entries) {
      if (now >= entry.expiresAt) entries.delete(token)
    }
  }

  const issue: PaginationCursorService["issue"] = (state) => Effect.gen(function*() {
    const inspected = snapshotState(state)
    if (inspected === undefined) return yield* Effect.fail(error("Invalid pagination cursor state"))
    const now = yield* Clock.currentTimeMillis
    prune(now)
    while (entries.size >= configuration.capacity) {
      const oldest = entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    let token = yield* randomOpaque128()
    while (entries.has(token)) token = yield* randomOpaque128()
    const expiresAt = Math.min(Number.MAX_SAFE_INTEGER, now + configuration.lifetimeMs)
    entries.set(token, { state: inspected, expiresAt })
    return `mcp1.${serviceOwner}.${token}`
  })

  const resolve: PaginationCursorService["resolve"] = (cursor) => Effect.gen(function*() {
    if (typeof cursor !== "string") {
      return yield* Effect.fail(error("Invalid or expired pagination cursor"))
    }
    const match = CURSOR.exec(cursor)
    if (match === null || match[1] !== serviceOwner) {
      return yield* Effect.fail(error("Invalid or expired pagination cursor"))
    }
    const now = yield* Clock.currentTimeMillis
    prune(now)
    const entry = entries.get(match[2])
    if (entry === undefined) return yield* Effect.fail(error("Invalid or expired pagination cursor"))
    return cloneState(entry.state)
  })

  const invalidate: PaginationCursorService["invalidate"] = (collections) => Effect.try({
    try: () => {
      if (collections === undefined) {
        entries.clear()
        return
      }
      const descriptors = Object.getOwnPropertyDescriptors(collections) as Record<string, PropertyDescriptor>
      const length = descriptors.length
      if (!Array.isArray(collections) || length === undefined || !("value" in length) ||
        typeof length.value !== "number" || !Number.isSafeInteger(length.value) || length.value < 0) {
        throw new TypeError("Invalid pagination cursor invalidation selector")
      }
      const selected = new Set<PaginatedCollection>()
      for (let index = 0; index < length.value; index++) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !("value" in descriptor) ||
          (descriptor.value !== "tools" && descriptor.value !== "resources" &&
            descriptor.value !== "resourceTemplates" && descriptor.value !== "prompts")) {
          throw new TypeError("Invalid pagination cursor invalidation selector")
        }
        selected.add(descriptor.value)
      }
      for (const [token, entry] of entries) {
        if (selected.has(entry.state.collection)) entries.delete(token)
      }
    },
    catch: (cause) => error("Invalid pagination cursor invalidation selector", cause)
  })

  return Object.freeze({ issue, resolve, invalidate })
})

export const PaginationCursor = Object.freeze({ memory })

export interface NormalizedPaginationPolicy {
  readonly pageSize: number
  readonly ttlMs: number
  readonly cacheScope: "public" | "private"
}

export const normalizePaginationPolicy = (
  value: unknown
): NormalizedPaginationPolicy => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    if (value === undefined) return { pageSize: 100, ttlMs: 0, cacheScope: "private" }
    throw new TypeError("pagination must be an object")
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new TypeError("pagination must not have symbols")
  for (const name of Object.keys(descriptors)) {
    if (!("value" in descriptors[name])) throw new TypeError(`pagination ${name} must be a data property`)
  }
  const pageSize = safeInteger(descriptors.pageSize?.value, 100, 1, "pageSize")
  if (pageSize > 10_000) throw new TypeError("pageSize must be at most 10000")
  const ttlMs = safeInteger(descriptors.ttlMs?.value, 0, 0, "ttlMs")
  const cacheScope = descriptors.cacheScope?.value ?? "private"
  if (cacheScope !== "public" && cacheScope !== "private") throw new TypeError("cacheScope must be public or private")
  return Object.freeze({ pageSize, ttlMs, cacheScope })
}
