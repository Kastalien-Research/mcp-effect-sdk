/** High-level stateful MCP 2025-11-25 server connection. */
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import type * as Scope from "effect/Scope"
import type {
  ClientCapabilities,
  Implementation,
  InitializeRequestParams,
  ServerCapabilities
} from "../generated/mcp/2025-11-25/McpSchema.generated.js"
import { LEGACY_PROTOCOL_VERSION } from "./LegacyClient.js"
import {
  LegacyConnectionError,
  make as makeConnection,
  type LegacyConnection,
  type LegacyDuplexTransport,
  type LegacyNotificationHandler,
  type LegacyRequestHandler
} from "./Connection.js"

export type LegacyServerLifecycle = "uninitialized" | "initializing" | "initialized" | "closed"

export interface LegacyServerOptions<E> {
  readonly transport: LegacyDuplexTransport<E>
  readonly serverInfo: Implementation
  readonly capabilities?: ServerCapabilities
  readonly instructions?: string
  readonly requestHandlers?: Readonly<Record<string, LegacyRequestHandler>>
  readonly notificationHandlers?: Readonly<Record<string, LegacyNotificationHandler>>
}

export interface LegacyServer {
  readonly protocolVersion: typeof LEGACY_PROTOCOL_VERSION
  readonly connection: LegacyConnection
  readonly lifecycle: Effect.Effect<LegacyServerLifecycle>
  readonly clientInfo: Effect.Effect<Implementation | undefined>
  readonly clientCapabilities: Effect.Effect<ClientCapabilities | undefined>
  readonly request: LegacyConnection["request"]
  readonly notify: LegacyConnection["notify"]
  readonly close: LegacyConnection["close"]
}

const protocolFailure = (message: string) => new LegacyConnectionError({ stage: "Protocol", message, code: -32600 })

const permitsClientRequest = (capabilities: ServerCapabilities, method: string): boolean => {
  if (method === "initialize" || method === "ping") return true
  if (method === "completion/complete") return capabilities.completions !== undefined
  if (method === "logging/setLevel") return capabilities.logging !== undefined
  if (method.startsWith("prompts/")) return capabilities.prompts !== undefined
  if (method.startsWith("resources/")) return capabilities.resources !== undefined
  if (method.startsWith("tools/")) return capabilities.tools !== undefined
  if (method.startsWith("tasks/")) return capabilities.tasks !== undefined
  return false
}

const clientAdvertised = (capabilities: ClientCapabilities | undefined, method: string): boolean => {
  if (method === "ping") return true
  if (capabilities === undefined) return false
  if (method === "roots/list") return capabilities.roots !== undefined
  if (method === "sampling/createMessage") return capabilities.sampling !== undefined
  if (method === "elicitation/create") return capabilities.elicitation !== undefined
  if (method.startsWith("tasks/")) return capabilities.tasks !== undefined
  return false
}

export const make = <E>(options: LegacyServerOptions<E>): Effect.Effect<LegacyServer, never, Scope.Scope> =>
  Effect.gen(function* () {
    const lifecycle = yield* Ref.make<LegacyServerLifecycle>("uninitialized")
    const clientInfo = yield* Ref.make<Implementation | undefined>(undefined)
    const clientCapabilities = yield* Ref.make<ClientCapabilities | undefined>(undefined)
    const capabilities = options.capabilities ?? {}
    const initialize: LegacyRequestHandler = (value) =>
      Effect.gen(function* () {
        const params = value as InitializeRequestParams
        if ((yield* Ref.get(lifecycle)) !== "uninitialized") {
          return yield* Effect.fail(protocolFailure("initialize may only be sent once"))
        }
        yield* Ref.set(lifecycle, "initializing")
        yield* Ref.set(clientInfo, params.clientInfo)
        yield* Ref.set(clientCapabilities, params.capabilities)
        return {
          protocolVersion:
            params.protocolVersion === LEGACY_PROTOCOL_VERSION ? LEGACY_PROTOCOL_VERSION : LEGACY_PROTOCOL_VERSION,
          capabilities,
          serverInfo: options.serverInfo,
          ...(options.instructions === undefined ? {} : { instructions: options.instructions })
        }
      })

    const guard =
      (method: string, handler: LegacyRequestHandler): LegacyRequestHandler =>
      (params, context) =>
        Ref.get(lifecycle).pipe(
          Effect.flatMap((state) =>
            state === "initialized" || (state === "initializing" && method === "ping")
              ? handler(params, context)
              : Effect.fail(protocolFailure(`${method} is not allowed before notifications/initialized`))
          )
        )

    const requestHandlers: Record<string, LegacyRequestHandler> = {
      initialize,
      ping: guard("ping", () => Effect.succeed({}))
    }
    for (const [method, handler] of Object.entries(options.requestHandlers ?? {})) {
      if (method !== "initialize") {
        requestHandlers[method] = guard(
          method,
          permitsClientRequest(capabilities, method)
            ? handler
            : () =>
                Effect.fail(
                  new LegacyConnectionError({
                    stage: "Protocol",
                    code: -32601,
                    message: `Server capability not declared for ${method}`
                  })
                )
        )
      }
    }

    const initialized: LegacyNotificationHandler = () =>
      Ref.get(lifecycle).pipe(
        Effect.flatMap((state) =>
          state === "initializing"
            ? Ref.set(lifecycle, "initialized")
            : Effect.fail(protocolFailure("notifications/initialized is out of order"))
        )
      )

    const connection = yield* makeConnection({
      role: "server",
      transport: options.transport,
      requestHandlers,
      notificationHandlers: {
        ...(options.notificationHandlers ?? {}),
        "notifications/initialized": initialized
      }
    })

    const request: LegacyConnection["request"] = (method, params) =>
      Effect.all([Ref.get(lifecycle), Ref.get(clientCapabilities)]).pipe(
        Effect.flatMap(([state, advertised]) =>
          state === "initialized" && clientAdvertised(advertised, method)
            ? connection.request(method, params)
            : Effect.fail(protocolFailure("Server cannot issue an unnegotiated request"))
        )
      )
    const notify: LegacyConnection["notify"] = (method, params) =>
      Ref.get(lifecycle).pipe(
        Effect.flatMap((state) =>
          state === "initialized"
            ? connection.notify(method, params)
            : Effect.fail(protocolFailure("Server cannot notify before initialization"))
        )
      )
    const close = connection.close.pipe(Effect.ensuring(Ref.set(lifecycle, "closed")))

    return {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      connection,
      lifecycle: Ref.get(lifecycle),
      clientInfo: Ref.get(clientInfo),
      clientCapabilities: Ref.get(clientCapabilities),
      request,
      notify,
      close
    }
  })
