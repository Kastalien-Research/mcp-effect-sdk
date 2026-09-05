import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { Deferred, Effect, Fiber, Layer, Option, Queue, Redacted, Ref, Stream, Tracer } from "effect"
import * as McpServer from "../../dist/McpServer.js"
import * as McpSchema from "../../dist/McpSchema.js"
import * as McpModern from "../../dist/McpModern.js"
import * as StreamableHttpClientTransport from "../../dist/transport/StreamableHttpClientTransport.js"

/** Mirrors `test/dispatcher/wp4-dispatcher.test.mjs`: the dispatcher refuses a
 * request whose params lack the released `_meta` envelope, so a span test that
 * omitted it would be testing rejection rather than instrumentation. */
const mcpRequest = (id, method) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: {
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/protocolVersion": "2026-07-28"
    }
  }
})

const mcpRequestWithParams = (id, method, params = {}) => {
  const base = mcpRequest(id, method)
  return {
    ...base,
    params: {
      ...base.params,
      ...params
    }
  }
}

const mcpNotification = (method, params = {}) => ({
  _tag: "Notification",
  jsonrpc: "2.0",
  method,
  params
})

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

let dispatcher
let spans
let client
let authToken
let authServices
let protectedResource
let loadError
try {
  dispatcher = await import(pathToFileURL(path.join(root, "dist/McpDispatcher.js")).href)
  spans = await import(pathToFileURL(path.join(root, "dist/observability/Spans.js")).href)
  client = await import(pathToFileURL(path.join(root, "dist/McpClient.js")).href)
  authToken = await import(pathToFileURL(path.join(root, "dist/auth/client/token.js")).href)
  authServices = await import(pathToFileURL(path.join(root, "dist/auth/client/services.js")).href)
  protectedResource = await import(pathToFileURL(path.join(root, "dist/auth/protected-resource.js")).href)
} catch (error) {
  loadError = error
}

const requireModules = () => {
  assert.ifError(loadError)
  assert.ok(dispatcher, "McpDispatcher module must exist")
  assert.ok(spans, "observability/Spans module must exist")
  assert.ok(client, "McpClient module must exist")
  assert.ok(authToken, "token module must exist")
  assert.ok(authServices, "auth services module must exist")
  assert.ok(protectedResource, "auth protected-resource module must exist")
}

const makeAuthStore = (options = {}) => {
  const calls = []
  const saved = []
  const credential = options.credential ?? {
    issuer: options.issuer ?? "https://issuer.example",
    clientId: options.clientId ?? "span-client",
    tokenEndpointAuthMethod: "client_secret_post",
    clientSecret: Redacted.make("span-client-secret")
  }
  const grant = options.grant ?? {
    issuer: options.issuer ?? "https://issuer.example",
    resource: options.resource ?? "https://resource.example/mcp",
    clientId: options.clientId ?? "span-client",
    scopes: ["tools.read", "tools.write"],
    tokenType: "Bearer",
    accessToken: Redacted.make("existing-access-token"),
    refreshToken: Redacted.make("existing-refresh-token")
  }
  return {
    calls,
    saved,
    service: {
      findCredential: (lookup) =>
        Effect.sync(() => {
          calls.push(["findCredential", lookup])
          return options.findCredential === undefined
            ? Option.some(options.credentialHandle ?? "credential-handle")
            : options.findCredential
        }),
      readCredential: (handle) =>
        Effect.sync(() => {
          calls.push(["readCredential", handle])
          return credential
        }),
      readGrant: (handle) =>
        Effect.sync(() => {
          calls.push(["readGrant", handle])
          return grant
        }),
      saveGrant: (value) =>
        Effect.sync(() => {
          calls.push(["saveGrant", value])
          saved.push(value)
          return options.savedGrantHandle ?? "saved-grant-handle"
        }),
      findGrant: () => Effect.succeed(Option.none()),
      removeGrant: () => Effect.void
    }
  }
}

const makeAuthHttp = (respond) => {
  const requests = []
  return {
    requests,
    service: {
      request: (request) =>
        Effect.suspend(() => {
          requests.push(request)
          return respond(request)
        })
    }
  }
}

const encoder = new TextEncoder()
const redactedUtf8 = (value) => Redacted.make(encoder.encode(value))

const jsonResponse = (status, body, headers = [["content-type", Redacted.make("application/json")]]) => ({
  status,
  headers,
  body: redactedUtf8(JSON.stringify(body))
})

const clientSuccess = (request, result) => ({
  _tag: "Success",
  response: {
    _tag: "SuccessResponse",
    jsonrpc: "2.0",
    id: request.id,
    result
  }
})

const snapshotSpan = (value) => ({
  name: value.name,
  parentName: Option.isSome(value.parent) ? value.parent.value.name : undefined,
  attributes: Object.fromEntries(value.attributes)
})

const makeSpanCollectorLayer = (collected) =>
  Layer.succeed(
    Tracer.Tracer,
    Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options)
        const observed = Object.assign(span, {
          parentName: Option.isSome(options.parent) ? options.parent.value.name : undefined
        })
        collected.push(observed)
        return span
      }
    })
  )

const captureClientToolCall = () =>
  Effect.gen(function* () {
    const captured = []
    const transport = {
      request: (request) =>
        Stream.fromEffect(
          Effect.gen(function* () {
            const span = yield* Effect.currentSpan.pipe(Effect.option)
            captured.push({
              method: request.method,
              span: Option.match(span, {
                onNone: () => undefined,
                onSome: snapshotSpan
              })
            })
            if (request.method === "server/discover") {
              return clientSuccess(request, {
                resultType: "complete",
                supportedVersions: ["2026-07-28"],
                capabilities: { tools: {} },
                _meta: {
                  "io.modelcontextprotocol/serverInfo": { name: "trace-client", version: "1.0.0" }
                },
                ttlMs: 0,
                cacheScope: "private"
              })
            }
            if (request.method === "tools/call") {
              return clientSuccess(request, {
                resultType: "complete",
                content: [{ type: "text", text: "ok" }]
              })
            }
            return clientSuccess(request, {
              resultType: "error",
              error: {
                code: -32603,
                message: "unsupported request method"
              }
            })
          })
        )
    }
    const spanClient = yield* client.make({
      transport,
      clientInfo: { name: "span-client", version: "1.0.0" }
    })
    const result = yield* spanClient.callTool({ name: "echo", arguments: {} })
    return { result, captured }
  }).pipe(Effect.scoped)

/**
 * Drives one request through a real client request stream and records the span
 * that was current in the send callback.
 */
const captureClientDispatchSpan = (request) =>
  Effect.gen(function* () {
    const captured = yield* Deferred.make()
    const client = yield* dispatcher.makeClientDispatcher({
      send: () =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            captured,
            Option.match(span, {
              onNone: () => undefined,
              onSome: (value) => {
                const parent = value.parent
                return {
                  name: value.name,
                  parentName: Option.isSome(parent) ? parent.value.name : undefined,
                  attributes: Object.fromEntries(value.attributes)
                }
              }
            })
          )
        })
    })
    const requestFiber = yield* Stream.runCollect(client.request(request)).pipe(Effect.forkScoped)
    const capturedSpan = yield* Deferred.await(captured).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () =>
          Effect.fail(new Error(`send never started for ${request.method}; request dispatch was not entered`))
      })
    )
    yield* Fiber.interrupt(requestFiber)
    return capturedSpan
  }).pipe(Effect.scoped)

/**
 * Drives one request through a real server dispatcher and reports the span that
 * was current while the handler ran. Reading `Effect.currentSpan` from inside
 * the handler is what makes this a test of the instrumentation rather than of a
 * tracer double: if the `withSpan` wrapper is removed, no span is current and
 * the assertions fail.
 */
const captureHandlerSpan = (request, handle = () => Effect.succeed({ resultType: "complete" })) =>
  Effect.gen(function* () {
    const captured = yield* Deferred.make()
    const served = yield* dispatcher.makeServerDispatcher({
      send: () => Effect.void,
      handle: () =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            captured,
            Option.match(span, {
              onNone: () => undefined,
              // `Span.attributes` is a ReadonlyMap, not a record — spreading it
              // silently yields `{}` and every attribute assertion passes
              // vacuously against `undefined`.
              onSome: snapshotSpan
            })
          )
          return yield* handle()
        })
    })
    yield* served.accept(request)
    // Bounded: if `accept` rejects the request before dispatch, the handler
    // never runs and an unbounded await would hang the suite instead of
    // reporting which request shape was refused.
    return yield* Deferred.await(captured).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () =>
          Effect.fail(new Error(`handler never ran for ${request.method}; request was refused before dispatch`))
      })
    )
  }).pipe(Effect.scoped)

test("raw client dispatcher owns only the transport-send boundary", async () => {
  requireModules()

  const captured = await Effect.runPromise(captureClientDispatchSpan(mcpRequest(9, "tools/call")))

  assert.ok(captured, "a span must be current while the request sends")
  assert.equal(captured.name, spans.SpanName.transportSend)
  assert.equal(captured.parentName, undefined)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/call")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "9")
  assert.equal(captured.attributes[spans.SpanAttribute.transport], "stdio")
})

test("client transport send span wraps request writes and records transport kind", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const transportSpan = yield* Deferred.make()
      const request = mcpRequest(12, "tools/list")
      const client = yield* dispatcher.makeClientDispatcher({
        transport: "http",
        send: () =>
          Effect.gen(function* () {
            const span = yield* Effect.currentSpan.pipe(Effect.option)
            yield* Deferred.succeed(
              transportSpan,
              Option.match(span, {
                onNone: () => undefined,
                onSome: snapshotSpan
              })
            )
            return yield* Effect.void
          })
      })
      const requestFiber = yield* Stream.runCollect(client.request(request)).pipe(Effect.forkScoped)
      const captured = yield* Deferred.await(transportSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("transport send span was not entered"))
        })
      )
      yield* Fiber.interrupt(requestFiber)
      return captured
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "a transport-send span must be current while writing a request")
  assert.equal(captured.name, spans.SpanName.transportSend)
  assert.equal(captured.parentName, undefined)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "12")
  assert.equal(captured.attributes[spans.SpanAttribute.transport], "http")
})

test("logical client dispatch remains current for transports without their own receive span", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const transportReceiveSpan = yield* Deferred.make()
      const transport = {
        request: (request) =>
          Stream.fromEffect(
            Effect.gen(function* () {
              if (request.method === "tools/list") {
                const span = yield* Effect.currentSpan.pipe(Effect.option)
                yield* Deferred.succeed(
                  transportReceiveSpan,
                  Option.match(span, {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                )
              }
              if (request.method === "server/discover") {
                return clientSuccess(request, {
                  resultType: "complete",
                  supportedVersions: ["2026-07-28"],
                  capabilities: { tools: {} },
                  _meta: {
                    "io.modelcontextprotocol/serverInfo": { name: "span-client", version: "1.0.0" }
                  },
                  ttlMs: 0,
                  cacheScope: "private"
                })
              }
              return clientSuccess(request, {
                resultType: "complete",
                tools: [],
                ttlMs: 0,
                cacheScope: "private"
              })
            })
          )
      }

      const spanClient = yield* client.make({
        transport,
        clientInfo: { name: "span-client", version: "1.0.0" }
      })
      yield* spanClient.listTools()

      return yield* Deferred.await(transportReceiveSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("transport receive span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "the logical dispatch span must remain current while processing a tool-list response")
  assert.equal(captured.name, spans.SpanName.clientDispatch)
  assert.equal(captured.parentName, spans.SpanName.clientRequest)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.notEqual(captured.attributes[spans.SpanAttribute.requestId], "(none)")
})

test("client progress callback runs under a dedicated client.progress span", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const callbackSpan = yield* Deferred.make()
      const transport = {
        request: (request) =>
          Stream.fromIterable(
            request.method === "tools/call"
              ? [
                  {
                    _tag: "Notification",
                    notification: mcpNotification("notifications/progress", {
                      progressToken: "trace-progress-token",
                      progress: 1,
                      total: 1
                    })
                  },
                  clientSuccess(request, {
                    resultType: "complete",
                    content: [{ type: "text", text: "done" }]
                  })
                ]
              : [
                  clientSuccess(request, {
                    resultType: "complete",
                    supportedVersions: ["2026-07-28"],
                    capabilities: { tools: {} },
                    _meta: {
                      "io.modelcontextprotocol/serverInfo": { name: "span-client", version: "1.0.0" }
                    },
                    ttlMs: 0,
                    cacheScope: "private"
                  })
                ]
          )
      }
      const spanClient = yield* client.make({
        transport,
        clientInfo: { name: "span-client", version: "1.0.0" }
      })

      yield* spanClient.callTool(
        { name: "echo", arguments: {} },
        {
          progress: {
            token: "trace-progress-token",
            onProgress: () =>
              Effect.gen(function* () {
                const span = yield* Effect.currentSpan.pipe(Effect.option)
                yield* Deferred.succeed(
                  callbackSpan,
                  Option.match(span, {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                )
              })
          }
        }
      )

      return yield* Deferred.await(callbackSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("progress callback span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "a progress callback span must be current while delivering progress")
  assert.equal(captured.name, spans.SpanName.clientProgress)
  assert.equal(captured.parentName, spans.SpanName.clientDispatch)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/call")
  assert.notEqual(captured.attributes[spans.SpanAttribute.requestId], "(none)")
})

test("server transport send span wraps terminal responses", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const transportSpan = yield* Deferred.make()
      const server = yield* dispatcher.makeServerDispatcher({
        send: (message) =>
          Effect.gen(function* () {
            const span = yield* Effect.currentSpan.pipe(Effect.option)
            if (message._tag !== "SuccessResponse" && message._tag !== "ErrorResponse") {
              return yield* Effect.void
            }
            yield* Deferred.succeed(
              transportSpan,
              Option.match(span, {
                onNone: () => undefined,
                onSome: snapshotSpan
              })
            )
            return yield* Effect.void
          }),
        handle: () => Effect.succeed({ resultType: "complete" })
      })
      yield* server.accept(mcpRequest(13, "tools/list"))
      return yield* Deferred.await(transportSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("terminal send never entered transport span"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "server dispatch must emit a transport send span for terminal output")
  assert.equal(captured.name, spans.SpanName.transportSend)
  assert.equal(captured.parentName, spans.SpanName.serverDispatch)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "13")
  assert.equal(captured.attributes[spans.SpanAttribute.transport], "stdio")
})

test("authorization code exchange emits auth token exchange spans with authorization_code grant type", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const authSpan = yield* Deferred.make()
      const store = makeAuthStore()
      const http = makeAuthHttp(() =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            authSpan,
            Option.match(span, {
              onNone: () => undefined,
              onSome: snapshotSpan
            })
          )
          return jsonResponse(200, {
            access_token: "access-token-value",
            token_type: "Bearer",
            refresh_token: "refresh-token-value",
            scope: "tools.read tools.write",
            expires_in: 1200
          })
        })
      )

      yield* authToken
        .exchangeAuthorizationCode({
          authorization: {
            issuer: "https://issuer.example",
            resource: "https://resource.example/mcp",
            credentialHandle: "credential-handle",
            clientId: "span-client",
            redirectUri: "https://client.example/callback",
            scopes: ["tools.read", "tools.write"],
            authorizationCode: Redacted.make("auth-code-" + "x".repeat(32)),
            codeVerifier: Redacted.make("v".repeat(43))
          },
          authorizationServerMetadata: {
            issuer: "https://issuer.example",
            tokenEndpoint: "https://issuer.example/oauth/token"
          },
          validateAudience: () => Effect.succeed(["https://resource.example/mcp"])
        })
        .pipe(
          Effect.provideService(authServices.AuthorizationClientStore, store.service),
          Effect.provideService(authServices.AuthorizationHttpClient, http.service)
        )

      return yield* Deferred.await(authSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("auth token exchange span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "a span must be current while exchanging authorization codes")
  assert.equal(captured.name, spans.SpanName.authTokenExchange)
  assert.equal(captured.attributes[spans.SpanAttribute.grantType], "authorization_code")
  assert.equal(captured.parentName, undefined)
})

test("authorization-code exchange span attributes are bounded and exclude auth material", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const authSpan = yield* Deferred.make()
      const store = makeAuthStore()
      const http = makeAuthHttp(() =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            authSpan,
            Option.match(span, {
              onNone: () => undefined,
              onSome: snapshotSpan
            })
          )
          return jsonResponse(200, {
            access_token: "access-token-value",
            token_type: "Bearer",
            refresh_token: "refresh-token-value",
            scope: "tools.read tools.write",
            expires_in: 1200
          })
        })
      )

      yield* authToken
        .exchangeAuthorizationCode({
          authorization: {
            issuer: "https://issuer.example",
            resource: "https://resource.example/mcp",
            credentialHandle: "credential-handle",
            clientId: "span-client",
            redirectUri: "https://client.example/callback",
            scopes: ["tools.read", "tools.write"],
            authorizationCode: Redacted.make("auth-code-" + "x".repeat(32)),
            codeVerifier: Redacted.make("v".repeat(43))
          },
          authorizationServerMetadata: {
            issuer: "https://issuer.example",
            tokenEndpoint: "https://issuer.example/oauth/token"
          },
          validateAudience: () => Effect.succeed(["https://resource.example/mcp"])
        })
        .pipe(
          Effect.provideService(authServices.AuthorizationClientStore, store.service),
          Effect.provideService(authServices.AuthorizationHttpClient, http.service)
        )

      return yield* Deferred.await(authSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("auth token exchange span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  const keys = Object.keys(captured.attributes)
  assert.deepEqual(keys.sort(), [spans.SpanAttribute.grantType].sort())
  assert.equal(captured.attributes[spans.SpanAttribute.grantType], "authorization_code")
})

test("refresh grant exchange emits auth token exchange spans with refresh_token grant type", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const authSpan = yield* Deferred.make()
      const store = makeAuthStore()
      const http = makeAuthHttp(() =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            authSpan,
            Option.match(span, {
              onNone: () => undefined,
              onSome: snapshotSpan
            })
          )
          return jsonResponse(200, {
            access_token: "access-token-2",
            token_type: "Bearer",
            refresh_token: "refresh-token-2",
            scope: "tools.read tools.write",
            expires_in: 1200
          })
        })
      )

      yield* authToken
        .refreshAuthorizationGrant({
          grant: "existing-grant-handle",
          authorizationServerMetadata: {
            issuer: "https://issuer.example",
            tokenEndpoint: "https://issuer.example/oauth/token"
          },
          validateAudience: () => Effect.succeed(["https://resource.example/mcp"])
        })
        .pipe(
          Effect.provideService(authServices.AuthorizationClientStore, store.service),
          Effect.provideService(authServices.AuthorizationHttpClient, http.service)
        )

      return yield* Deferred.await(authSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("auth token refresh span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "a span must be current while refreshing authorization grants")
  assert.equal(captured.name, spans.SpanName.authTokenExchange)
  assert.equal(captured.attributes[spans.SpanAttribute.grantType], "refresh_token")
  assert.equal(captured.parentName, undefined)
})

test("refresh grant exchange span attributes are bounded and exclude auth material", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const authSpan = yield* Deferred.make()
      const store = makeAuthStore()
      const http = makeAuthHttp(() =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            authSpan,
            Option.match(span, {
              onNone: () => undefined,
              onSome: snapshotSpan
            })
          )
          return jsonResponse(200, {
            access_token: "access-token-2",
            token_type: "Bearer",
            refresh_token: "refresh-token-2",
            scope: "tools.read tools.write",
            expires_in: 1200
          })
        })
      )

      yield* authToken
        .refreshAuthorizationGrant({
          grant: "existing-grant-handle",
          authorizationServerMetadata: {
            issuer: "https://issuer.example",
            tokenEndpoint: "https://issuer.example/oauth/token"
          },
          validateAudience: () => Effect.succeed(["https://resource.example/mcp"])
        })
        .pipe(
          Effect.provideService(authServices.AuthorizationClientStore, store.service),
          Effect.provideService(authServices.AuthorizationHttpClient, http.service)
        )

      return yield* Deferred.await(authSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("auth token refresh span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.deepEqual(Object.keys(captured.attributes).sort(), [spans.SpanAttribute.grantType].sort())
  assert.equal(captured.attributes[spans.SpanAttribute.grantType], "refresh_token")
})

test("authorization callback exchange emits the same auth token exchange span with authorization_code grant type", async () => {
  requireModules()

  const state = Redacted.make("S".repeat(43))
  const codeVerifier = Redacted.make("V".repeat(43))
  const transactionHandle = "transaction-handle"
  const callbackParameters = Redacted.make(`code=callback-auth-code&state=${Redacted.value(state)}`)
  const store = makeAuthStore({
    credential: {
      issuer: "https://issuer.example",
      clientId: "span-client",
      tokenEndpointAuthMethod: "client_secret_post",
      clientSecret: Redacted.make("span-client-secret")
    }
  })
  const callbackStore = {
    calls: store.calls,
    saved: store.saved,
    service: {
      ...store.service,
      takeTransaction: () =>
        Effect.sync(() => ({
          issuer: "https://issuer.example",
          resource: "https://resource.example/mcp",
          credentialHandle: "credential-handle",
          clientId: "span-client",
          authorizationResponseIssParameterRequired: false,
          redirectUri: "https://client.example/callback",
          scopes: ["tools.read", "tools.write"],
          state,
          codeVerifier,
          createdAt: 0
        })),
      saveTransaction: (value) => Effect.succeed(value),
      saveGrant: store.service.saveGrant
    }
  }
  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const callbackSpan = yield* Deferred.make()
      const http = makeAuthHttp(() =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            callbackSpan,
            Option.match(span, {
              onNone: () => undefined,
              onSome: snapshotSpan
            })
          )
          return jsonResponse(200, {
            access_token: "access-token-callback",
            token_type: "Bearer",
            refresh_token: "refresh-token-callback",
            scope: "tools.read tools.write",
            expires_in: 1200
          })
        })
      )

      yield* authToken
        .exchangeAuthorizationCallback({
          callback: {
            transaction: transactionHandle,
            redirectUri: "https://client.example/callback",
            parameters: callbackParameters
          },
          authorizationServerMetadata: {
            issuer: "https://issuer.example",
            tokenEndpoint: "https://issuer.example/oauth/token"
          },
          endpointPolicy: "https-only",
          validateAudience: () => Effect.succeed(["https://resource.example/mcp"])
        })
        .pipe(
          Effect.provideService(authServices.AuthorizationClientStore, callbackStore.service),
          Effect.provideService(authServices.AuthorizationHttpClient, http.service)
        )

      return yield* Deferred.await(callbackSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("authorization callback exchange span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "a span must be current while processing authorization callback exchange")
  assert.equal(captured.name, spans.SpanName.authTokenExchange)
  assert.equal(captured.attributes[spans.SpanAttribute.grantType], "authorization_code")
  assert.equal(captured.parentName, undefined)
})

test("authorization callback exchange span attributes are bounded and exclude auth material", async () => {
  requireModules()

  const state = Redacted.make("S".repeat(43))
  const codeVerifier = Redacted.make("V".repeat(43))
  const transactionHandle = "transaction-handle"
  const callbackParameters = Redacted.make(`code=callback-auth-code&state=${Redacted.value(state)}`)
  const store = makeAuthStore({
    credential: {
      issuer: "https://issuer.example",
      clientId: "span-client",
      tokenEndpointAuthMethod: "client_secret_post",
      clientSecret: Redacted.make("span-client-secret")
    }
  })
  const callbackStore = {
    calls: store.calls,
    saved: store.saved,
    service: {
      ...store.service,
      takeTransaction: () =>
        Effect.sync(() => ({
          issuer: "https://issuer.example",
          resource: "https://resource.example/mcp",
          credentialHandle: "credential-handle",
          clientId: "span-client",
          authorizationResponseIssParameterRequired: false,
          redirectUri: "https://client.example/callback",
          scopes: ["tools.read", "tools.write"],
          state,
          codeVerifier,
          createdAt: 0
        })),
      saveTransaction: (value) => Effect.succeed(value),
      saveGrant: store.service.saveGrant
    }
  }
  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const callbackSpan = yield* Deferred.make()
      const http = makeAuthHttp(() =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          yield* Deferred.succeed(
            callbackSpan,
            Option.match(span, {
              onNone: () => undefined,
              onSome: snapshotSpan
            })
          )
          return jsonResponse(200, {
            access_token: "access-token-callback",
            token_type: "Bearer",
            refresh_token: "refresh-token-callback",
            scope: "tools.read tools.write",
            expires_in: 1200
          })
        })
      )

      yield* authToken
        .exchangeAuthorizationCallback({
          callback: {
            transaction: transactionHandle,
            redirectUri: "https://client.example/callback",
            parameters: callbackParameters
          },
          authorizationServerMetadata: {
            issuer: "https://issuer.example",
            tokenEndpoint: "https://issuer.example/oauth/token"
          },
          endpointPolicy: "https-only",
          validateAudience: () => Effect.succeed(["https://resource.example/mcp"])
        })
        .pipe(
          Effect.provideService(authServices.AuthorizationClientStore, callbackStore.service),
          Effect.provideService(authServices.AuthorizationHttpClient, http.service)
        )

      return yield* Deferred.await(callbackSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("authorization callback exchange span was not entered"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.deepEqual(Object.keys(captured.attributes).sort(), [spans.SpanAttribute.grantType].sort())
  assert.equal(captured.attributes[spans.SpanAttribute.grantType], "authorization_code")
})

test("protected-resource bearer verification emits auth bearer verify span", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const bearerSpan = yield* Deferred.make()
      const principal = new protectedResource.AuthorizationPrincipal({
        subject: "trace-subject",
        audiences: ["https://resource.example/mcp"],
        scopes: ["tools.read"]
      })
      const verified = yield* protectedResource
        .verifyBearerAuthorization({
          authorizationHeader: "Bearer tracing-token",
          protectedResource: "https://resource.example",
          requiredScopes: ["tools.read"]
        })
        .pipe(
          Effect.provideService(protectedResource.TokenVerifier, {
            verify: (_request) =>
              Effect.gen(function* () {
                const span = yield* Effect.currentSpan.pipe(Effect.option)
                yield* Deferred.succeed(
                  bearerSpan,
                  Option.match(span, {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                )
                return principal
              })
          })
        )
      return {
        verified,
        span: yield* Deferred.await(bearerSpan).pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () => Effect.fail(new Error("bearer verification span was not entered"))
          })
        )
      }
    }).pipe(Effect.scoped)
  )

  assert.equal(captured.verified.subject, "trace-subject")
  assert.equal(captured.span.name, spans.SpanName.authBearerVerify)
  assert.equal(captured.span.parentName, undefined)
})

test("protected-resource scope policy emits auth scope policy span", async () => {
  requireModules()

  const collectedSpans = []
  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const principal = new protectedResource.AuthorizationPrincipal({
        subject: "scope-subject",
        audiences: ["https://resource.example/mcp"],
        scopes: ["tools.read", "tools.write"]
      })

      yield* protectedResource.requireAuthorizationScopes(principal, ["tools.read"])
      return collectedSpans.find((span) => span.name === spans.SpanName.authScopePolicy)
    }).pipe(Effect.provide(makeSpanCollectorLayer(collectedSpans)), Effect.scoped)
  )

  assert.ok(captured)
  assert.equal(captured.name, spans.SpanName.authScopePolicy)
  assert.equal(captured.parentName, undefined)
  assert.deepEqual(Object.keys(captured.attributes).length, 0)
})

test("protected-resource scope insufficiency fails verification without leaking bearer token into span context", async () => {
  requireModules()

  const collectedSpans = []
  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const bearerSpan = yield* Deferred.make()
      const principal = new protectedResource.AuthorizationPrincipal({
        subject: "trace-subject",
        audiences: ["https://resource.example/mcp"],
        scopes: ["tools.read"]
      })
      const result = yield* protectedResource
        .verifyBearerAuthorization({
          authorizationHeader: "Bearer tracing-token",
          protectedResource: "https://resource.example",
          requiredScopes: ["tools.write"]
        })
        .pipe(
          Effect.provideService(protectedResource.TokenVerifier, {
            verify: (_request) =>
              Effect.gen(function* () {
                const span = yield* Effect.currentSpan.pipe(Effect.option)
                yield* Deferred.succeed(
                  bearerSpan,
                  Option.match(span, {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                )
                return principal
              })
          }),
          Effect.result
        )
      return {
        result,
        span: yield* Deferred.await(bearerSpan).pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () => Effect.fail(new Error("bearer verification span was not entered for insufficient-scope flow"))
          })
        ),
        scopeSpan: collectedSpans.find((span) => span.name === spans.SpanName.authScopePolicy)
      }
    }).pipe(Effect.provide(makeSpanCollectorLayer(collectedSpans)), Effect.scoped)
  )

  assert.equal(captured.result._tag, "Failure")
  assert.equal(captured.span.name, spans.SpanName.authBearerVerify)
  assert.equal(captured.span.parentName, undefined)
  assert.equal(captured.result.failure instanceof protectedResource.AuthorizationPolicyError, true)
  assert.ok(captured.scopeSpan)
  assert.equal(captured.scopeSpan.name, spans.SpanName.authScopePolicy)
  assert.equal(captured.scopeSpan.parentName, spans.SpanName.authBearerVerify)
})

test("server dispatch runs the handler inside an mcp.server.dispatch span", async () => {
  requireModules()

  const captured = await Effect.runPromise(captureHandlerSpan(mcpRequest(7, "tools/list")))

  assert.ok(captured, "a span must be current while the handler runs")
  assert.equal(captured.name, spans.SpanName.serverDispatch)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "7")
})

test("server dispatch span is present even when handler fails", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    captureHandlerSpan(mcpRequest(8, "tools/list"), () => Effect.fail(new Error("fixture client handler failure")))
  )

  assert.ok(captured, "a span must be current while failing handler runs")
  assert.equal(captured.name, spans.SpanName.serverDispatch)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "8")
})

test("server dispatch span is present even when handler throws synchronously", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    captureHandlerSpan(mcpRequest(9, "tools/list"), () => {
      throw new Error("fixture synchronous handler throw")
    })
  )

  assert.ok(captured, "a span must be current while a synchronous throw handler runs")
  assert.equal(captured.name, spans.SpanName.serverDispatch)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "9")
})

test("server dispatch span is active while context notificationSink writes notifications", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const notificationSpan = yield* Deferred.make()
      const server = yield* dispatcher.makeServerDispatcher({
        send: (message) =>
          Effect.gen(function* () {
            if (message._tag === "Notification") {
              const span = yield* Effect.currentSpan.pipe(Effect.option)
              yield* Deferred.succeed(
                notificationSpan,
                Option.match(span, {
                  onNone: () => undefined,
                  onSome: snapshotSpan
                })
              )
            }
            return yield* Effect.void
          }),
        handle: () =>
          Effect.gen(function* () {
            const context = yield* dispatcher.McpRequestContext
            yield* context.notificationSink(mcpNotification("notifications/message", { text: "hello" }))
            return { resultType: "complete" }
          })
      })

      yield* server.accept(mcpRequest(12, "tools/list"))
      return yield* Deferred.await(notificationSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("notificationSink did not run with an active request span"))
        })
      )
    }).pipe(Effect.scoped)
  )

  assert.ok(captured, "a span must be current while notificationSink writes")
  assert.equal(captured.name, spans.SpanName.transportSend)
  assert.equal(captured.parentName, spans.SpanName.serverDispatch)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "notifications/message")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "(none)")
})

test("server dispatch span is present during interruption without terminal emission", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const capturedSpan = yield* Deferred.make()
      const interrupted = yield* Deferred.make()
      const sent = yield* Ref.make(false)
      const server = yield* dispatcher.makeServerDispatcher({
        send: () => Ref.set(sent, true).pipe(Effect.asVoid),
        handle: () =>
          Effect.gen(function* () {
            const span = yield* Effect.currentSpan.pipe(Effect.option)
            yield* Deferred.succeed(
              capturedSpan,
              Option.match(span, {
                onNone: () => undefined,
                onSome: snapshotSpan
              })
            )
            return yield* Effect.never
          }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)))
      })

      yield* server.accept(mcpRequest("interrupt-running", "tools/list"))
      const spanValue = yield* Deferred.await(capturedSpan).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("handler never started for interrupting request"))
        })
      )
      yield* server.accept(mcpNotification("notifications/cancelled", { requestId: "interrupt-running" }))
      yield* Deferred.await(interrupted).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("request interrupt was not observed by handler"))
        })
      )
      return {
        spanValue,
        sent: yield* Ref.get(sent)
      }
    }).pipe(Effect.scoped)
  )

  assert.ok(captured.spanValue, "a span must be current while interrupted handler runs")
  assert.equal(captured.spanValue.name, spans.SpanName.serverDispatch)
  assert.equal(captured.spanValue.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.spanValue.attributes[spans.SpanAttribute.requestId], "interrupt-running")
  assert.equal(captured.sent, false)
})

test("unsupported method is handled by dispatcher without invoking handler span", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const handlerSpans = []
      const server = yield* dispatcher.makeServerDispatcher({
        send: () => Effect.void,
        handle: () =>
          Effect.gen(function* () {
            const span = yield* Effect.currentSpan.pipe(Effect.option)
            handlerSpans.push(
              Option.match(span, {
                onNone: () => undefined,
                onSome: snapshotSpan
              })
            )
            return { resultType: "complete" }
          })
      })
      yield* server.accept(mcpRequest("unsupported", "ghost/method"))
      return handlerSpans
    }).pipe(Effect.scoped)
  )

  assert.equal(captured.length, 0, "unknown methods should complete without running handler span")
})

test("unsupported method emits a protocol error terminal and skips handler execution", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const terminal = yield* Deferred.make()
      let handlerInvoked = false
      const server = yield* dispatcher.makeServerDispatcher({
        send: (message) => Deferred.succeed(terminal, message),
        handle: () => {
          handlerInvoked = true
          return Effect.succeed({ resultType: "complete" })
        }
      })

      yield* server.accept(mcpRequest("unsupported", "ghost/method"))
      const message = yield* Deferred.await(terminal)
      return { message, handlerInvoked }
    }).pipe(Effect.scoped)
  )

  assert.equal(captured.message._tag, "ErrorResponse")
  assert.equal(captured.message.id, "unsupported")
  assert.equal(captured.message.error.code, -32601)
  assert.equal(captured.message.error.message, "Unknown method: ghost/method")
  assert.equal(captured.handlerInvoked, false)
})

test("tools/call handlers execute under server.tool.call spans with request metadata", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const toolSpan = yield* Deferred.make()
      const server = yield* McpServer.make({
        serverInfo: { name: "span-server", version: "1.0.0" },
        handlers: Effect.gen(function* () {
          yield* McpServer.registerTool({
            name: "trace-tool",
            description: "Tool for span assertions",
            content: () =>
              Effect.gen(function* () {
                const span = yield* Effect.currentSpan.pipe(Effect.option)
                return yield* Deferred.succeed(
                  toolSpan,
                  Option.match(span, {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                ).pipe(Effect.as("ok"))
              })
          })
        })
      })

      const send = yield* Deferred.make()
      const dispatcher = yield* McpServer.makeDispatcher({
        send: (message) => Deferred.succeed(send, message),
        transport: "stdio"
      }).pipe(Effect.provideService(McpServer.McpServer, server))

      yield* dispatcher.accept(
        mcpRequestWithParams(88, "tools/call", {
          name: "trace-tool",
          arguments: {}
        })
      )

      const response = yield* Deferred.await(send)
      return { response, toolSpan: yield* Deferred.await(toolSpan) }
    }).pipe(Effect.scoped)
  )

  assert.equal(captured.response._tag, "SuccessResponse")
  assert.equal(captured.response.result.resultType, "complete")
  assert.equal(captured.toolSpan.name, spans.SpanName.serverToolCall)
  assert.equal(captured.toolSpan.parentName, spans.SpanName.serverDispatch)
  assert.equal(captured.toolSpan.attributes[spans.SpanAttribute.method], "tools/call")
  assert.equal(captured.toolSpan.attributes[spans.SpanAttribute.toolName], "trace-tool")
  assert.equal(captured.toolSpan.attributes[spans.SpanAttribute.requestId], "88")
})

test("resources/read handlers execute under server.resource.read spans", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const resourceSpan = yield* Deferred.make()
      const server = yield* McpServer.make({
        serverInfo: { name: "span-server", version: "1.0.0" },
        handlers: Effect.gen(function* () {
          yield* McpServer.registerResource({
            uri: "trace://resource",
            name: "trace-resource",
            title: "Trace Resource",
            content: Effect.gen(function* () {
              const span = yield* Effect.currentSpan.pipe(Effect.option)
              yield* Deferred.succeed(
                resourceSpan,
                Option.match(span, {
                  onNone: () => undefined,
                  onSome: snapshotSpan
                })
              )
              return new McpSchema.TextResourceContents({
                mimeType: "text/plain",
                text: "resource-body",
                uri: "trace://resource"
              })
            })
          })
        })
      })

      const send = yield* Deferred.make()
      const dispatcher = yield* McpServer.makeDispatcher({
        send: (message) => Deferred.succeed(send, message),
        transport: "stdio"
      }).pipe(Effect.provideService(McpServer.McpServer, server))

      yield* dispatcher.accept(
        mcpRequestWithParams(89, "resources/read", {
          uri: "trace://resource"
        })
      )

      const response = yield* Deferred.await(send)
      return { response, resourceSpan: yield* Deferred.await(resourceSpan) }
    }).pipe(Effect.scoped)
  )

  assert.equal(captured.response._tag, "SuccessResponse")
  assert.equal(captured.response.result.resultType, "complete")
  assert.equal(captured.resourceSpan.name, spans.SpanName.serverResourceRead)
  assert.equal(captured.resourceSpan.parentName, spans.SpanName.serverDispatch)
  assert.equal(captured.resourceSpan.attributes[spans.SpanAttribute.method], "resources/read")
  assert.equal(Object.hasOwn(captured.resourceSpan.attributes, "mcp.uri"), false)
  assert.equal(captured.resourceSpan.attributes[spans.SpanAttribute.requestId], "89")
})

test("prompts/get handlers execute under server.prompt.get spans", async () => {
  requireModules()

  const captured = await Effect.runPromise(
    Effect.gen(function* () {
      const promptSpan = yield* Deferred.make()
      const server = yield* McpServer.make({
        serverInfo: { name: "span-server", version: "1.0.0" },
        handlers: Effect.gen(function* () {
          yield* McpServer.registerPrompt({
            name: "trace-prompt",
            description: "Prompt for span assertions",
            content: () =>
              Effect.gen(function* () {
                const span = yield* Effect.currentSpan.pipe(Effect.option)
                yield* Deferred.succeed(
                  promptSpan,
                  Option.match(span, {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                )
                return { messages: [] }
              })
          })
        })
      })

      const send = yield* Deferred.make()
      const dispatcher = yield* McpServer.makeDispatcher({
        send: (message) => Deferred.succeed(send, message),
        transport: "stdio"
      }).pipe(Effect.provideService(McpServer.McpServer, server))

      yield* dispatcher.accept(
        mcpRequestWithParams(90, "prompts/get", {
          name: "trace-prompt"
        })
      )

      const response = yield* Deferred.await(send)
      return { response, promptSpan: yield* Deferred.await(promptSpan) }
    }).pipe(Effect.scoped)
  )

  assert.equal(captured.response._tag, "SuccessResponse")
  assert.equal(captured.response.result.resultType, "complete")
  assert.equal(captured.promptSpan.name, spans.SpanName.serverPromptGet)
  assert.equal(captured.promptSpan.parentName, spans.SpanName.serverDispatch)
  assert.equal(captured.promptSpan.attributes[spans.SpanAttribute.method], "prompts/get")
  assert.equal(captured.promptSpan.attributes[spans.SpanAttribute.promptName], "trace-prompt")
  assert.equal(captured.promptSpan.attributes[spans.SpanAttribute.requestId], "90")
})

test("server dispatch spans inherit mcp.transport.receive context", async () => {
  requireModules()

  const captured = await Effect.runPromise(captureHandlerSpan(mcpRequest(77, "tools/list")))

  assert.ok(captured, "a span must be current while the handler runs")
  assert.equal(captured.name, spans.SpanName.serverDispatch)
  assert.equal(captured.parentName, spans.SpanName.transportReceive)
  assert.equal(captured.attributes[spans.SpanAttribute.method], "tools/list")
  assert.equal(captured.attributes[spans.SpanAttribute.requestId], "77")
})

test("span attributes carry protocol metadata and never carry secrets", async () => {
  requireModules()

  const captured = await Effect.runPromise(captureHandlerSpan(mcpRequest(1, "tools/list")))

  // A trace routinely leaves the trust boundary that the payload does not, so
  // the guard is on the whole attribute bag rather than on a known bad key.
  const forbidden = /token|secret|authorization|password|credential|cookie|api[_-]?key/i
  for (const [key, value] of Object.entries(captured.attributes)) {
    assert.ok(!forbidden.test(key), `span attribute key must not look secret-bearing: ${key}`)
    assert.ok(!forbidden.test(String(value)), `span attribute ${key} must not carry a secret-looking value`)
    assert.ok(key.startsWith("mcp."), `span attribute ${key} must use the mcp. namespace`)
  }
})

test("all completed spans from a server tool-call request are secret-safe", async () => {
  requireModules()

  const forbidden = /token|secret|authorization|password|credential|cookie|api[_-]?key/i
  const collectedSpans = []

  await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* McpServer.make({
        serverInfo: { name: "span-all-server", version: "1.0.0" },
        handlers: Effect.gen(function* () {
          yield* McpServer.registerTool({
            name: "trace-tool",
            description: "Span-safe test tool",
            content: () => Effect.succeed("ok")
          })
        })
      })
      const send = yield* Deferred.make()
      const dispatcher = yield* McpServer.makeDispatcher({
        send: (message) => Deferred.succeed(send, message),
        transport: "stdio"
      }).pipe(Effect.provideService(McpServer.McpServer, server))

      yield* dispatcher.accept(
        mcpRequestWithParams(99, "tools/call", {
          name: "trace-tool",
          arguments: {}
        })
      )
      yield* Deferred.await(send)
    }).pipe(Effect.provide(makeSpanCollectorLayer(collectedSpans)), Effect.scoped)
  )

  const completed = collectedSpans.filter((span) => span.status?._tag === "Ended")
  assert.ok(completed.length > 0, "tool-call execution should emit completed spans")

  for (const span of completed) {
    for (const [key, value] of span.attributes) {
      assert.ok(!forbidden.test(key), `span attribute key must not look secret-bearing: ${key}`)
      assert.ok(!forbidden.test(String(value)), `span attribute ${key} must not carry a secret-looking value`)
      assert.ok(key.startsWith("mcp."), `span attribute ${key} must use the mcp. namespace`)
    }
  }
})

test("malicious tokens, headers, URIs, paths, arguments, and results never enter span attributes", async () => {
  requireModules()

  const sentinel = "DO_NOT_EXPORT_TOKEN_4f32a98d"
  const maliciousName = `tool-${sentinel}`
  const maliciousUri = `file:///home/private/${sentinel}/credentials.json`
  const maliciousId = `request/${sentinel}`
  const collectedSpans = []

  await Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* McpServer.make({
        serverInfo: { name: "privacy-server", version: "1.0.0" },
        handlers: Effect.gen(function* () {
          yield* McpServer.registerTool({
            name: maliciousName,
            description: "Privacy fixture",
            content: () => Effect.succeed(`result:${sentinel}`)
          })
          yield* McpServer.registerResource({
            uri: maliciousUri,
            name: "privacy-resource",
            content: Effect.succeed(
              new McpSchema.TextResourceContents({
                uri: maliciousUri,
                text: `resource-result:${sentinel}`
              })
            )
          })
        })
      })
      const terminals = yield* Queue.unbounded()
      const serverDispatcher = yield* McpServer.makeDispatcher({
        send: (message) => Queue.offer(terminals, message).pipe(Effect.asVoid),
        transport: "stdio"
      }).pipe(Effect.provideService(McpServer.McpServer, server))

      yield* serverDispatcher.accept(
        mcpRequestWithParams(maliciousId, "tools/call", {
          name: maliciousName,
          arguments: {
            authorization: `Bearer ${sentinel}`,
            path: `/home/private/${sentinel}`
          }
        })
      )
      yield* Queue.take(terminals)

      yield* serverDispatcher.accept(
        mcpRequestWithParams(`resource-${sentinel}`, "resources/read", {
          uri: maliciousUri
        })
      )
      yield* Queue.take(terminals)

      const http = yield* StreamableHttpClientTransport.make({
        url: "https://example.invalid/mcp",
        headers: {
          "x-private-header": sentinel
        },
        fetch: async (_url, init) => {
          const request = JSON.parse(String(init?.body))
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                resultType: "complete",
                tools: [],
                ttlMs: 0,
                cacheScope: "private",
                data: sentinel
              }
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "x-private-response-header": sentinel
              }
            }
          )
        }
      })
      yield* http.request(mcpRequest(maliciousId, "tools/list")).pipe(Stream.runCollect)

      yield* protectedResource
        .verifyBearerAuthorization({
          authorizationHeader: `Bearer ${sentinel}`,
          protectedResource: maliciousUri,
          requiredScopes: ["tools.read"]
        })
        .pipe(
          Effect.provideService(protectedResource.TokenVerifier, {
            verify: () =>
              Effect.succeed(
                new protectedResource.AuthorizationPrincipal({
                  subject: sentinel,
                  audiences: [maliciousUri],
                  scopes: ["tools.read"]
                })
              )
          })
        )
    }).pipe(Effect.provide(makeSpanCollectorLayer(collectedSpans)), Effect.scoped)
  )

  assert.ok(collectedSpans.length > 0, "privacy workflow should emit spans")
  for (const span of collectedSpans) {
    for (const [key, value] of span.attributes) {
      assert.equal(String(key).includes(sentinel), false, `span key leaked sentinel: ${key}`)
      assert.equal(String(value).includes(sentinel), false, `span ${span.name} leaked sentinel through ${key}`)
    }
  }
})

test("requestIdAttribute reports absent ids without inventing one", () => {
  requireModules()

  assert.equal(spans.requestIdAttribute(7), "7")
  assert.equal(spans.requestIdAttribute("abc"), "abc")
  // Notifications have no id; "(none)" keeps a trace from implying one was sent.
  assert.equal(spans.requestIdAttribute(undefined), "(none)")
  assert.equal(spans.requestIdAttribute(null), "(none)")
})

test("tool-call requests include mcp.client.tool.call and mcp.client.dispatch with stable request metadata", async () => {
  requireModules()

  const { result, captured } = await Effect.runPromise(captureClientToolCall())

  assert.equal(result.content[0].text, "ok")
  const toolDispatch = captured.find(
    ({ method, span }) => method === "tools/call" && span !== undefined && span.name === spans.SpanName.clientDispatch
  )
  assert.ok(toolDispatch !== undefined, "a client dispatch span must wrap the tool call send")
  assert.equal(toolDispatch.span.name, spans.SpanName.clientDispatch)
  assert.equal(toolDispatch.span.parentName, spans.SpanName.clientToolCall)
  assert.equal(toolDispatch.span.attributes[spans.SpanAttribute.method], "tools/call")
  assert.notEqual(toolDispatch.span.attributes[spans.SpanAttribute.requestId], "(none)")
})

test("non-tool request uses mcp.client.request as request parent of mcp.client.dispatch", async () => {
  requireModules()

  const { result, seen } = await Effect.runPromise(
    Effect.gen(function* () {
      const seen = []
      const transport = {
        request: (request) =>
          Stream.fromEffect(
            Effect.gen(function* () {
              const span = yield* Effect.currentSpan.pipe(Effect.option)
              seen.push({
                method: request.method,
                span: Option.match(span, {
                  onNone: () => undefined,
                  onSome: snapshotSpan
                })
              })
              if (request.method === "server/discover") {
                return clientSuccess(request, {
                  resultType: "complete",
                  supportedVersions: ["2026-07-28"],
                  capabilities: { tools: {} },
                  _meta: {
                    "io.modelcontextprotocol/serverInfo": { name: "span-client", version: "1.0.0" }
                  },
                  ttlMs: 0,
                  cacheScope: "private"
                })
              }
              if (request.method === "tools/list") {
                return clientSuccess(request, {
                  resultType: "complete",
                  tools: [],
                  ttlMs: 0,
                  cacheScope: "private"
                })
              }
              return clientSuccess(request, {
                resultType: "error",
                error: {
                  code: -32603,
                  message: "unsupported request method"
                }
              })
            })
          )
      }
      const spanClient = yield* client.make({
        transport,
        clientInfo: { name: "span-client", version: "1.0.0" }
      })
      const result = yield* spanClient.listTools()
      return { result, seen }
    }).pipe(Effect.scoped)
  )

  assert.equal(result.resultType, "complete")
  assert.deepEqual(result.tools, [])
  assert.equal(result.ttlMs, 0)
  assert.equal(result.cacheScope, "private")
  const listDispatch = seen.find(
    ({ method, span }) => method === "tools/list" && span !== undefined && span.name === spans.SpanName.clientDispatch
  )
  assert.ok(listDispatch !== undefined, "a non-tool request must emit a client dispatch span for its send")
  assert.equal(listDispatch.span.parentName, spans.SpanName.clientRequest)
  assert.equal(listDispatch.span.attributes[spans.SpanAttribute.method], "tools/list")
  assert.notEqual(listDispatch.span.attributes[spans.SpanAttribute.requestId], "(none)")
})

test("client tool request spans one logical request across MRTR rounds", async () => {
  requireModules()

  const { result, captures, requestPayloads } = await Effect.runPromise(
    Effect.gen(function* () {
      const captures = []
      const requestPayloads = []
      let count = 0
      const transport = {
        request: (request) =>
          Stream.fromEffect(
            Effect.gen(function* () {
              const span = yield* Effect.currentSpan.pipe(Effect.option)
              if (request.method === "tools/call") {
                captures.push({
                  method: request.method,
                  requestId: request.id,
                  span: Option.match(span, {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                })
                requestPayloads.push(Object.freeze({ ...request.params }))
                if (count === 0) {
                  count += 1
                  return clientSuccess(request, {
                    resultType: "input_required",
                    requestState: "round-one",
                    inputRequests: {
                      roots: {
                        method: "roots/list",
                        params: {}
                      }
                    }
                  })
                }
                return clientSuccess(request, {
                  resultType: "complete",
                  content: [{ type: "text", text: "all good" }]
                })
              }
              if (request.method === "server/discover") {
                return clientSuccess(request, {
                  resultType: "complete",
                  supportedVersions: ["2026-07-28"],
                  capabilities: { tools: {} },
                  _meta: {
                    "io.modelcontextprotocol/serverInfo": { name: "span-client", version: "1.0.0" }
                  },
                  ttlMs: 0,
                  cacheScope: "private"
                })
              }
              return clientSuccess(request, {
                resultType: "error",
                error: {
                  code: -32603,
                  message: "unsupported request method"
                }
              })
            })
          )
      }

      const spanClient = yield* client.make({
        transport,
        clientInfo: { name: "span-client", version: "1.0.0" },
        inputRequired: { mode: "automatic", roots: { list: Effect.succeed({ roots: [] }) } }
      })
      const result = yield* spanClient.callTool({ name: "echo", arguments: {} })
      return { result, captures, requestPayloads }
    }).pipe(Effect.scoped)
  )

  assert.equal(result.resultType, "complete")
  assert.equal(result.content[0].text, "all good")
  const requestDispatches = captures.filter(
    ({ method, span }) => method === "tools/call" && span !== undefined && span.name === spans.SpanName.clientDispatch
  )
  assert.equal(requestDispatches.length, 2, "an input_required roundtrip should produce two clientDispatch spans")
  assert.equal(requestDispatches[0].span.parentName, spans.SpanName.clientToolCall)
  assert.equal(requestDispatches[1].span.parentName, spans.SpanName.clientToolCall)
  assert.equal(
    String(requestDispatches[0].requestId),
    requestDispatches[0].span.attributes[spans.SpanAttribute.requestId]
  )
  assert.equal(
    String(requestDispatches[1].requestId),
    requestDispatches[1].span.attributes[spans.SpanAttribute.requestId]
  )
  assert.notEqual(
    requestDispatches[0].requestId,
    requestDispatches[1].requestId,
    "each MRTR dispatch should use a distinct protocol request id"
  )
  assert.equal(requestPayloads.length, 2)
  assert.equal(Object.hasOwn(requestPayloads[0], "inputResponses"), false)
  assert.equal(Object.hasOwn(requestPayloads[0], "requestState"), false)
  assert.deepEqual(
    { ...requestPayloads[1].inputResponses },
    {
      roots: { roots: [] }
    }
  )
  assert.equal(requestPayloads[1].requestState, "round-one")
})

test("manual input-required policy returns input_required without retries", async () => {
  requireModules()

  const { result, payloads, dispatches } = await Effect.runPromise(
    Effect.gen(function* () {
      const dispatches = []
      const payloads = []
      const transport = {
        request: (request) =>
          Stream.fromEffect(
            Effect.gen(function* () {
              if (request.method === "tools/call") {
                dispatches.push({
                  method: request.method,
                  requestId: request.id,
                  span: Option.match(yield* Effect.currentSpan.pipe(Effect.option), {
                    onNone: () => undefined,
                    onSome: snapshotSpan
                  })
                })
                payloads.push(Object.freeze({ ...request.params }))
                return clientSuccess(request, {
                  resultType: "input_required",
                  inputRequests: {
                    roots: {
                      method: "roots/list",
                      params: {}
                    }
                  }
                })
              }
              if (request.method === "server/discover") {
                return clientSuccess(request, {
                  resultType: "complete",
                  supportedVersions: ["2026-07-28"],
                  capabilities: { tools: {} },
                  _meta: {
                    "io.modelcontextprotocol/serverInfo": { name: "span-client", version: "1.0.0" }
                  },
                  ttlMs: 0,
                  cacheScope: "private"
                })
              }
              return clientSuccess(request, {
                resultType: "error",
                error: {
                  code: -32603,
                  message: "unsupported request method"
                }
              })
            })
          )
      }

      const spanClient = yield* client.make({
        transport,
        clientInfo: { name: "span-client", version: "1.0.0" },
        inputRequired: { mode: "manual" }
      })
      const result = yield* spanClient.callTool({ name: "echo", arguments: {} })
      return { result, dispatches, payloads }
    }).pipe(Effect.scoped)
  )

  assert.equal(result.resultType, "input_required")
  const toolDispatches = dispatches.filter(
    ({ method, span }) => method === "tools/call" && span !== undefined && span.name === spans.SpanName.clientDispatch
  )
  assert.equal(toolDispatches.length, 1, "manual policy should not retry input_required rounds")
  assert.equal(toolDispatches[0].span.parentName, spans.SpanName.clientToolCall)
  assert.equal(Object.hasOwn(payloads[0], "inputResponses"), false)
  assert.equal(Object.hasOwn(payloads[0], "requestState"), false)
})

test("client dispatch span remains current on transport failure and preserves request metadata", async () => {
  requireModules()

  const captured = []
  const transport = {
    request: (request) =>
      Stream.fromEffect(
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan.pipe(Effect.option)
          captured.push(
            Option.match(span, {
              onNone: () => undefined,
              onSome: snapshotSpan
            })
          )
          if (request.method === "server/discover") {
            return clientSuccess(request, {
              resultType: "complete",
              supportedVersions: ["2026-07-28"],
              capabilities: { tools: {} },
              _meta: {
                "io.modelcontextprotocol/serverInfo": { name: "span-client", version: "1.0.0" }
              },
              ttlMs: 0,
              cacheScope: "private"
            })
          }
          return yield* Effect.fail(new Error("transport failure"))
        })
      )
  }

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const spanClient = yield* client.make({
          transport,
          clientInfo: { name: "span-client", version: "1.0.0" }
        })
        yield* spanClient.listTools()
      }).pipe(Effect.scoped)
    )
    assert.fail("transport failure should reject the client call")
  } catch {
    // expected transport-level failure
  }

  const dispatchSpan = captured.find(
    (value) =>
      value !== undefined &&
      value.name === spans.SpanName.clientDispatch &&
      value.attributes[spans.SpanAttribute.method] === "tools/list"
  )
  assert.ok(dispatchSpan !== undefined, "a client dispatch span must remain active during transport failure")
  assert.equal(dispatchSpan.parentName, spans.SpanName.clientRequest)
  assert.equal(dispatchSpan.attributes[spans.SpanAttribute.method], "tools/list")
  assert.notEqual(dispatchSpan.attributes[spans.SpanAttribute.requestId], "(none)")
})

test("transport failure still yields a completed client-dispatch span", async () => {
  requireModules()

  const collectedSpans = []
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* client
        .make({
          transport: {
            request: (request) =>
              Stream.fromEffect(
                Effect.gen(function* () {
                  if (request.method === "server/discover") {
                    return clientSuccess(request, {
                      resultType: "complete",
                      supportedVersions: ["2026-07-28"],
                      capabilities: { tools: {} },
                      _meta: {
                        "io.modelcontextprotocol/serverInfo": { name: "span-client", version: "1.0.0" }
                      },
                      ttlMs: 0,
                      cacheScope: "private"
                    })
                  }
                  return yield* Effect.fail(new Error("transport down"))
                })
              )
          },
          clientInfo: { name: "span-client", version: "1.0.0" }
        })
        .pipe(Effect.flatMap((spanClient) => spanClient.listTools()))
    }).pipe(Effect.scoped, Effect.result, Effect.provide(makeSpanCollectorLayer(collectedSpans)))
  )

  const requestSpan = collectedSpans.find(
    (span) =>
      span.name === spans.SpanName.clientRequest && span.attributes.get(spans.SpanAttribute.method) === "tools/list"
  )
  const dispatchSpan = collectedSpans.find(
    (span) =>
      span.name === spans.SpanName.clientDispatch && span.attributes.get(spans.SpanAttribute.method) === "tools/list"
  )
  assert.ok(requestSpan !== undefined, "request span should still be observed on transport failure")
  assert.ok(dispatchSpan !== undefined, "dispatch span should still be observed on transport failure")
  assert.equal(requestSpan.status._tag, "Ended")
  assert.equal(dispatchSpan.status._tag, "Ended")
  assert.equal(dispatchSpan.attributes.get(spans.SpanAttribute.method), "tools/list")
  assert.equal(dispatchSpan.parentName, spans.SpanName.clientRequest)
})

test("all public span names are emitted by representative observability workflows", async () => {
  requireModules()

  const observedSpanNames = new Set()
  const observedSpans = []
  const collectorLayer = Layer.succeed(
    Tracer.Tracer,
    Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options)
        observedSpanNames.add(options.name)
        observedSpans.push(span)
        return span
      }
    })
  )

  await Effect.runPromise(
    Effect.gen(function* () {
      const authStore = makeAuthStore({ clientId: "all-names-client" })
      const authHttp = makeAuthHttp(() =>
        Effect.succeed(
          jsonResponse(200, {
            access_token: "all-names-client-token",
            token_type: "Bearer",
            refresh_token: "all-names-refresh-token",
            scope: "tools.read tools.write",
            expires_in: 3600
          })
        )
      )

      const server = yield* McpServer.make({
        serverInfo: {
          name: "all-names-observability-server",
          version: "1.0.0"
        },
        handlers: Effect.gen(function* () {
          yield* McpServer.registerTool({
            name: "echo",
            description: "Tool for emitting server callspan",
            content: () => Effect.succeed("ok")
          })
          yield* McpServer.registerResource({
            uri: "trace://resource",
            name: "Trace Resource",
            title: "Trace Resource",
            content: Effect.succeed(
              new McpSchema.TextResourceContents({
                mimeType: "text/plain",
                text: "resource",
                uri: "trace://resource"
              })
            )
          })
          yield* McpServer.registerPrompt({
            name: "trace-prompt",
            description: "Prompt for all-names check",
            content: () => Effect.succeed({ messages: [] })
          })
        })
      })
      const collectedMessages = []
      const threeTerminals = yield* Deferred.make()
      const dispatcher = yield* McpServer.makeDispatcher({
        send: (message) =>
          Effect.sync(() => {
            collectedMessages.push(message)
            return collectedMessages.length
          }).pipe(
            Effect.flatMap((count) => (count >= 3 ? Deferred.succeed(threeTerminals, undefined) : Effect.void)),
            Effect.asVoid
          ),
        transport: "stdio"
      }).pipe(Effect.provideService(McpServer.McpServer, server))

      yield* dispatcher.accept(mcpRequestWithParams(201, "tools/call", { name: "echo", arguments: {} }))
      yield* dispatcher.accept(mcpRequestWithParams(202, "resources/read", { uri: "trace://resource" }))
      yield* dispatcher.accept(mcpRequestWithParams(203, "prompts/get", { name: "trace-prompt" }))
      yield* Deferred.await(threeTerminals).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("server workflows did not emit three terminal messages"))
        })
      )

      const clientSpan = yield* client.make({
        transport: {
          request: (request) =>
            request.method === "tools/call"
              ? Stream.fromIterable([
                  {
                    _tag: "Notification",
                    notification: mcpNotification("notifications/progress", {
                      progressToken: "all-names-progress-token",
                      progress: 1,
                      total: 1
                    })
                  },
                  clientSuccess(request, {
                    resultType: "complete",
                    content: [{ type: "text", text: "ok" }]
                  })
                ])
              : Stream.fromEffect(
                  Effect.sync(() => {
                    if (request.method === "server/discover") {
                      return clientSuccess(request, {
                        resultType: "complete",
                        supportedVersions: [McpModern.MODERN_PROTOCOL_VERSION],
                        capabilities: {
                          tools: {},
                          resources: {},
                          prompts: {},
                          logMessages: true
                        },
                        _meta: {
                          "io.modelcontextprotocol/serverInfo": {
                            name: "all-names-observability-server",
                            version: "1.0.0"
                          }
                        },
                        ttlMs: 0,
                        cacheScope: "private"
                      })
                    }
                    if (request.method === "tools/list") {
                      return clientSuccess(request, {
                        resultType: "complete",
                        tools: [],
                        ttlMs: 0,
                        cacheScope: "private"
                      })
                    }
                    return clientSuccess(request, {
                      resultType: "error",
                      error: {
                        code: -32601,
                        message: `unexpected method ${request.method}`
                      }
                    })
                  })
                )
        },
        clientInfo: { name: "all-names-observability-client", version: "1.0.0" },
        inputRequired: { mode: "manual" }
      })

      yield* clientSpan.listTools()
      yield* clientSpan.callTool(
        { name: "echo", arguments: {} },
        {
          progress: {
            token: "all-names-progress-token",
            onProgress: () => Effect.void
          }
        }
      )

      yield* authToken
        .exchangeAuthorizationCode({
          authorization: {
            issuer: "https://issuer.example",
            resource: "https://resource.example/mcp",
            credentialHandle: "credential-handle",
            clientId: "all-names-client",
            redirectUri: "https://client.example/callback",
            scopes: ["tools.read", "tools.write"],
            authorizationCode: Redacted.make("code-" + "x".repeat(32)),
            codeVerifier: Redacted.make("v".repeat(43))
          },
          authorizationServerMetadata: {
            issuer: "https://issuer.example",
            tokenEndpoint: "https://issuer.example/oauth/token"
          },
          validateAudience: () => Effect.succeed(["https://resource.example/mcp"])
        })
        .pipe(
          Effect.provideService(authServices.AuthorizationClientStore, authStore.service),
          Effect.provideService(authServices.AuthorizationHttpClient, authHttp.service)
        )

      yield* protectedResource
        .verifyBearerAuthorization({
          authorizationHeader: "Bearer all-names-verification-token",
          protectedResource: "https://resource.example",
          requiredScopes: ["tools.write"]
        })
        .pipe(
          Effect.provideService(protectedResource.TokenVerifier, {
            verify: () =>
              Effect.succeed(
                new protectedResource.AuthorizationPrincipal({
                  subject: "scope-subject",
                  audiences: ["https://resource.example/mcp"],
                  scopes: ["tools.read"]
                })
              )
          }),
          Effect.result
        )
    }).pipe(Effect.provide(collectorLayer), Effect.scoped)
  )

  for (const expected of Object.values(spans.SpanName)) {
    assert.ok(observedSpanNames.has(expected), `public span name ${expected} should be emitted by validated workflows`)
  }

  const publicSpanNames = new Set(Object.values(spans.SpanName))
  for (const observed of observedSpans) {
    if (!publicSpanNames.has(observed.name)) continue
    assert.equal(
      observed.attributes.has("code.stacktrace"),
      false,
      `public span ${observed.name} should not add stack trace attributes`
    )
  }
})
