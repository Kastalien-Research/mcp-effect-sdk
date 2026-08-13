/** High-level stateful MCP 2025-11-25 client. */
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import type * as Scope from "effect/Scope"
import type {
  ClientCapabilities,
  Implementation,
  InitializeResult,
  ServerCapabilities
} from "../generated/mcp/2025-11-25/McpSchema.generated.js"
import {
  LegacyConnectionError,
  make as makeConnection,
  type LegacyConnection,
  type LegacyDuplexTransport,
  type LegacyNotificationHandler,
  type LegacyRequestHandler
} from "./Connection.js"

export const LEGACY_PROTOCOL_VERSION = "2025-11-25" as const
const LEGACY_COMPATIBLE_PROTOCOL_VERSIONS = new Set([LEGACY_PROTOCOL_VERSION, "2025-03-26"])

export interface LegacyClientOptions<E> {
  readonly transport: LegacyDuplexTransport<E>
  readonly clientInfo: Implementation
  readonly capabilities?: ClientCapabilities
  readonly instructions?: string
  readonly requestHandlers?: Readonly<Record<string, LegacyRequestHandler>>
  readonly notificationHandlers?: Readonly<Record<string, LegacyNotificationHandler>>
}

export interface LegacyClient {
  readonly protocolVersion: string
  readonly serverInfo: Implementation
  readonly serverCapabilities: ServerCapabilities
  readonly instructions?: string
  readonly connection: LegacyConnection
  readonly request: LegacyConnection["request"]
  readonly notify: LegacyConnection["notify"]
  readonly close: LegacyConnection["close"]
}

const permitsServerRequest = (capabilities: ClientCapabilities, method: string): boolean => {
  if (method === "ping") return true
  if (method === "roots/list") return capabilities.roots !== undefined
  if (method === "sampling/createMessage") return capabilities.sampling !== undefined
  if (method === "elicitation/create") return capabilities.elicitation !== undefined
  if (method.startsWith("tasks/")) return capabilities.tasks !== undefined
  return false
}

const serverAdvertised = (capabilities: ServerCapabilities, method: string): boolean => {
  if (method === "ping") return true
  if (method === "completion/complete") return capabilities.completions !== undefined
  if (method === "logging/setLevel") return capabilities.logging !== undefined
  if (method.startsWith("prompts/")) return capabilities.prompts !== undefined
  if (method.startsWith("resources/")) return capabilities.resources !== undefined
  if (method.startsWith("tools/")) return capabilities.tools !== undefined
  if (method.startsWith("tasks/")) return capabilities.tasks !== undefined
  return false
}

const isExpiredSession = (value: unknown, seen = new Set<object>()): boolean => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return false
  seen.add(value)
  try {
    const record = value as Record<PropertyKey, unknown>
    if (record.status === 404) return true
    return isExpiredSession(record.cause, seen)
  } catch {
    return false
  }
}

export const make = <E>(
  options: LegacyClientOptions<E>
): Effect.Effect<LegacyClient, LegacyConnectionError, Scope.Scope> =>
  Effect.gen(function* () {
    const initialized = yield* Ref.make(false)
    const initializationLock = yield* Effect.makeSemaphore(1)
    const capabilities = options.capabilities ?? {}
    const requestHandlers: Record<string, LegacyRequestHandler> = {
      ping: () => Effect.succeed({})
    }
    for (const [method, handler] of Object.entries(options.requestHandlers ?? {})) {
      requestHandlers[method] = permitsServerRequest(capabilities, method)
        ? handler
        : () =>
            Effect.fail(
              new LegacyConnectionError({
                stage: "Protocol",
                code: -32601,
                message: `Client capability not declared for ${method}`
              })
            )
    }
    const connection = yield* makeConnection({
      role: "client",
      transport: options.transport,
      requestHandlers,
      notificationHandlers: options.notificationHandlers
    })
    const initialize = (): Effect.Effect<InitializeResult, LegacyConnectionError> =>
      connection.request("initialize", {
        protocolVersion: LEGACY_PROTOCOL_VERSION,
        capabilities,
        clientInfo: options.clientInfo
      }) as Effect.Effect<InitializeResult, LegacyConnectionError>
    const result = yield* initialize()
    if (!LEGACY_COMPATIBLE_PROTOCOL_VERSIONS.has(result.protocolVersion)) {
      yield* connection.close
      return yield* Effect.fail(
        new LegacyConnectionError({
          stage: "Protocol",
          message: `Server selected unsupported MCP protocol version ${result.protocolVersion}`
        })
      )
    }
    const versionSelector = options.transport as LegacyDuplexTransport<E> & {
      readonly selectProtocolVersion?: (version: string) => Effect.Effect<void>
    }
    if (versionSelector.selectProtocolVersion !== undefined) {
      yield* versionSelector.selectProtocolVersion(result.protocolVersion)
    }
    yield* connection.notify("notifications/initialized", {})
    yield* Ref.set(initialized, true)

    const request: LegacyConnection["request"] = (method, params) =>
      Ref.get(initialized).pipe(
        Effect.flatMap((ready) =>
          ready && serverAdvertised(result.capabilities, method)
            ? connection.request(method, params).pipe(
                Effect.catchIf(isExpiredSession, () =>
                  initializationLock.withPermits(1)(
                    initialize().pipe(
                      Effect.flatMap((next) =>
                        next.protocolVersion === LEGACY_PROTOCOL_VERSION
                          ? connection.notify("notifications/initialized", {})
                          : Effect.fail(
                              new LegacyConnectionError({
                                stage: "Protocol",
                                message: `Server selected unsupported MCP protocol version ${next.protocolVersion}`
                              })
                            )
                      ),
                      Effect.zipRight(connection.request(method, params))
                    )
                  )
                )
              )
            : Effect.fail(
                new LegacyConnectionError({
                  stage: "Protocol",
                  message: ready ? `Server capability not declared for ${method}` : "Client is not initialized"
                })
              )
        )
      )
    const notify: LegacyConnection["notify"] = (method, params) =>
      Ref.get(initialized).pipe(
        Effect.flatMap((ready) =>
          ready
            ? connection.notify(method, params)
            : Effect.fail(new LegacyConnectionError({ stage: "Protocol", message: "Client is not initialized" }))
        )
      )

    return {
      protocolVersion: result.protocolVersion,
      serverInfo: result.serverInfo,
      serverCapabilities: result.capabilities,
      ...(result.instructions === undefined ? {} : { instructions: result.instructions }),
      connection,
      request,
      notify,
      close: connection.close
    }
  })
