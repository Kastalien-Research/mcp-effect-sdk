import assert from "node:assert/strict"
import { inspect } from "node:util"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Client from "../../dist/auth/client.js"
import * as HttpClient from "../../dist/transport/StreamableHttpClientTransport.js"

const endpoint = "https://mcp.example.test/endpoint"
const metadata = "https://mcp.example.test/.well-known/oauth-protected-resource"
const protocolMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
}

const request = (id, method = "resources/list", params = {}) => ({
  _tag: "Request",
  jsonrpc: "2.0",
  id,
  method,
  params: { ...params, _meta: { ...protocolMeta } }
})

const success = (id, result = { resultType: "complete", resources: [] }) => ({
  jsonrpc: "2.0",
  id,
  result
})

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: init.status ?? 200,
  headers: { "content-type": "application/json", ...init.headers }
})

const challengeResponse = (status, challenge) => new Response(null, {
  status,
  headers: { "www-authenticate": challenge }
})

const grant = (value) => Schema.decodeUnknownSync(Client.AuthorizationGrantHandle)(value)
const scopes = (values) => Schema.decodeUnknownSync(Client.AuthorizationScopeSet)(values)

const authorizationFixture = ({
  initialGrant = Option.none(),
  tokenByGrant = new Map(),
  onRespond = () => Effect.succeed(grant("grant-after-challenge"))
} = {}) => {
  const calls = []
  const client = {
    currentGrant: (input) => Effect.sync(() => {
      calls.push(["currentGrant", input])
      return initialGrant
    }),
    acquire: (input) => Effect.sync(() => {
      calls.push(["acquire", input])
      return grant("grant-acquired")
    }),
    respondToChallenge: (input) => Effect.suspend(() => {
      calls.push(["respondToChallenge", input])
      return onRespond(input)
    })
  }
  const store = {
    readGrant: (handle) => Effect.sync(() => {
      calls.push(["readGrant", handle])
      const token = tokenByGrant.get(handle)
      assert.equal(typeof token, "string", `missing test token for ${handle}`)
      return {
        issuer: "https://issuer.example.test",
        resource: endpoint,
        clientId: "client-one",
        scopes: scopes(["files.read"]),
        tokenType: "Bearer",
        accessToken: Redacted.make(token)
      }
    })
  }
  return {
    calls,
    options: {
      client,
      store,
      protectedResource: endpoint,
      requestedScopes: scopes(["files.read"])
    }
  }
}

const run = (options, message) => Effect.runPromise(Effect.scoped(
  Effect.gen(function*() {
    const transport = yield* HttpClient.make(options)
    return yield* transport.request(message).pipe(Stream.runCollect)
  })
))

test("a valid 401 Bearer challenge authorizes once and caller Authorization cannot bypass SDK auth", async () => {
  const nextGrant = grant("grant-after-challenge")
  const fixture = authorizationFixture({
    tokenByGrant: new Map([[nextGrant, "WP6E_CLIENT_TOKEN_SENTINEL"]]),
    onRespond: () => Effect.succeed(nextGrant)
  })
  const sentAuthorization = []
  let calls = 0
  const frames = await run({
    url: endpoint,
    headers: { authorization: "Bearer caller-must-not-win" },
    authorization: fixture.options,
    fetch: async (_input, init) => {
      calls += 1
      sentAuthorization.push(new Headers(init.headers).get("authorization"))
      return calls === 1
        ? challengeResponse(401, `Bearer resource_metadata="${metadata}", scope="files.write"`)
        : jsonResponse(success("valid-401"))
    }
  }, request("valid-401"))

  assert.equal(Chunk.toReadonlyArray(frames)[0].response.id, "valid-401")
  assert.deepEqual(sentAuthorization, [null, "Bearer WP6E_CLIENT_TOKEN_SENTINEL"])
  const challengeCall = fixture.calls.find(([operation]) => operation === "respondToChallenge")
  assert.ok(challengeCall)
  assert.equal(challengeCall[1].protectedResource, endpoint)
  assert.equal(challengeCall[1].challenge.status, 401)
  assert.deepEqual(challengeCall[1].challenge.scopes, ["files.write"])
  assert.equal(challengeCall[1].challenge.resourceMetadata, metadata)
  assert.equal(challengeCall[1].priorGrant, undefined)
})

test("403 retries only for a valid insufficient_scope challenge and carries the prior grant", async () => {
  const oldGrant = grant("grant-before-step-up")
  const newGrant = grant("grant-after-step-up")
  const tokenByGrant = new Map([
    [oldGrant, "old-step-up-token"],
    [newGrant, "new-step-up-token"]
  ])
  const fixture = authorizationFixture({
    initialGrant: Option.some(oldGrant),
    tokenByGrant,
    onRespond: () => Effect.succeed(newGrant)
  })
  const sentAuthorization = []
  let calls = 0
  await run({
    url: endpoint,
    authorization: fixture.options,
    fetch: async (_input, init) => {
      calls += 1
      sentAuthorization.push(new Headers(init.headers).get("authorization"))
      return calls === 1
        ? challengeResponse(403, `Bearer error="insufficient_scope", scope="files.write admin", resource_metadata="${metadata}"`)
        : jsonResponse(success("step-up"))
    }
  }, request("step-up"))

  assert.deepEqual(sentAuthorization, ["Bearer old-step-up-token", "Bearer new-step-up-token"])
  const challengeCall = fixture.calls.find(([operation]) => operation === "respondToChallenge")
  assert.equal(challengeCall[1].priorGrant, oldGrant)
  assert.deepEqual(challengeCall[1].challenge.scopes, ["files.write", "admin"])

  let forbiddenCalls = 0
  const genericFixture = authorizationFixture()
  const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* HttpClient.make({
      url: endpoint,
      authorization: genericFixture.options,
      fetch: async () => {
        forbiddenCalls += 1
        return new Response(null, { status: 403 })
      }
    })
    return yield* transport.request(request("generic-403")).pipe(Stream.runDrain, Effect.either)
  })))
  assert.equal(outcome._tag, "Left")
  assert.equal(outcome.left.status, 403)
  assert.equal(forbiddenCalls, 1)
  assert.equal(genericFixture.calls.some(([operation]) => operation === "respondToChallenge"), false)
})

test("invalid or non-Bearer challenges never start authorization", async () => {
  for (const [label, status, header] of [
    ["basic", 401, "Basic realm=\"mcp\""],
    ["malformed-scope", 401, "Bearer scope=\"one  two\""],
    ["wrong-403-error", 403, "Bearer error=\"invalid_token\""],
    ["missing-header", 401, undefined]
  ]) {
    const fixture = authorizationFixture()
    let calls = 0
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const transport = yield* HttpClient.make({
        url: endpoint,
        authorization: fixture.options,
        fetch: async () => {
          calls += 1
          return new Response(null, {
            status,
            ...(header === undefined ? {} : { headers: { "www-authenticate": header } })
          })
        }
      })
      return yield* transport.request(request(label)).pipe(Stream.runDrain, Effect.either)
    })))
    assert.equal(outcome._tag, "Left", label)
    assert.equal(calls, 1, label)
    assert.equal(fixture.calls.some(([operation]) => operation === "respondToChallenge"), false, label)
  }
})

test("a Bearer challenge is selected from a standards-valid multi-scheme header", async () => {
  for (const [label, header] of [
    ["bearer-second", `Basic realm="legacy", Bearer resource_metadata="${metadata}", scope="files.write"`],
    ["bearer-first", `Bearer resource_metadata="${metadata}", scope="files.write", Basic realm="legacy"`]
  ]) {
    const nextGrant = grant(`grant-${label}`)
    const fixture = authorizationFixture({
      tokenByGrant: new Map([[nextGrant, `token-${label}`]]),
      onRespond: () => Effect.succeed(nextGrant)
    })
    let calls = 0
    await run({
      url: endpoint,
      authorization: fixture.options,
      fetch: async () => {
        calls += 1
        return calls === 1
          ? challengeResponse(401, header)
          : jsonResponse(success(label))
      }
    }, request(label))
    assert.equal(calls, 2, label)
    const challengeCall = fixture.calls.find(([operation]) => operation === "respondToChallenge")
    assert.ok(challengeCall, label)
    assert.deepEqual(challengeCall[1].challenge.scopes, ["files.write"], label)
  }
})

const assertChallengeGrammar = async (label, header) => {
  const nextGrant = grant(`grant-${label}`)
  const fixture = authorizationFixture({
    tokenByGrant: new Map([[nextGrant, `token-${label}`]]),
    onRespond: () => Effect.succeed(nextGrant)
  })
  let calls = 0
  await run({
    url: endpoint,
    authorization: fixture.options,
    fetch: async () => {
      calls += 1
      return calls === 1
        ? challengeResponse(401, header)
        : jsonResponse(success(label))
    }
  }, request(label))
  assert.equal(calls, 2)
  const challengeCall = fixture.calls.find(([operation]) => operation === "respondToChallenge")
  assert.ok(challengeCall)
  assert.deepEqual(challengeCall[1].challenge.scopes, ["files.write"])
}

test("a digit-leading HTTP token scheme after Bearer is recognized as a challenge boundary", async () => {
  await assertChallengeGrammar(
    "digit-scheme-after",
    `Bearer resource_metadata="${metadata}", scope="files.write", 9Scheme abc`
  )
})

test("HTTP token punctuation is accepted in extension auth-parameter names", async () => {
  await assertChallengeGrammar(
    "extension-param",
    `Bearer x.y="extension", resource_metadata="${metadata}", scope="files.write"`
  )
})

test("authorization and HeaderMismatch recovery each retain one independent non-multiplying budget", async () => {
  const initialGrant = grant("grant-old-budget")
  const refreshedGrant = grant("grant-new-budget")
  const fixture = authorizationFixture({
    initialGrant: Option.some(initialGrant),
    tokenByGrant: new Map([
      [initialGrant, "old-budget-token"],
      [refreshedGrant, "new-budget-token"]
    ]),
    onRespond: () => Effect.succeed(refreshedGrant)
  })
  let calls = 0
  const methods = []
  const frames = await run({
    url: endpoint,
    authorization: fixture.options,
    fetch: async (_input, init) => {
      calls += 1
      const body = JSON.parse(init.body)
      methods.push(body.method)
      if (calls === 1) {
        return challengeResponse(401, `Bearer resource_metadata="${metadata}"`)
      }
      if (calls === 2) {
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32020, message: "header mismatch" }
        }, { status: 400 })
      }
      if (calls === 3) {
        return jsonResponse(success(body.id, {
          resultType: "complete",
          cacheScope: "private",
          ttlMs: 0,
          tools: [{ name: "deploy", inputSchema: { type: "object", properties: {} } }]
        }))
      }
      return jsonResponse(success(body.id, { resultType: "complete", content: [] }))
    }
  }, request("independent-budgets", "tools/call", { name: "deploy", arguments: {} }))

  assert.equal(Chunk.toReadonlyArray(frames).at(-1)._tag, "Success")
  assert.equal(calls, 4)
  assert.deepEqual(methods, ["tools/call", "tools/call", "tools/list", "tools/call"])
  assert.equal(fixture.calls.filter(([operation]) => operation === "respondToChallenge").length, 1)
})

test("HeaderMismatch refresh may authorize once before the successful original retry", async () => {
  const initialGrant = grant("grant-before-refresh-auth")
  const refreshedGrant = grant("grant-after-refresh-auth")
  const fixture = authorizationFixture({
    initialGrant: Option.some(initialGrant),
    tokenByGrant: new Map([
      [initialGrant, "token-before-refresh-auth"],
      [refreshedGrant, "token-after-refresh-auth"]
    ]),
    onRespond: () => Effect.succeed(refreshedGrant)
  })
  const methods = []
  const sentAuthorization = []
  let calls = 0
  const frames = await run({
    url: endpoint,
    authorization: fixture.options,
    fetch: async (_input, init) => {
      calls += 1
      const body = JSON.parse(init.body)
      methods.push(body.method)
      sentAuthorization.push(new Headers(init.headers).get("authorization"))
      if (calls === 1) {
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32020, message: "header mismatch" }
        }, { status: 400 })
      }
      if (calls === 2) {
        return challengeResponse(401, `Bearer resource_metadata="${metadata}"`)
      }
      if (calls === 3) {
        return jsonResponse(success(body.id, {
          resultType: "complete",
          cacheScope: "private",
          ttlMs: 0,
          tools: [{ name: "deploy", inputSchema: { type: "object", properties: {} } }]
        }))
      }
      return jsonResponse(success(body.id, { resultType: "complete", content: [] }))
    }
  }, request("refresh-before-auth", "tools/call", { name: "deploy", arguments: {} }))

  assert.equal(Chunk.toReadonlyArray(frames).at(-1)._tag, "Success")
  assert.equal(calls, 4)
  assert.deepEqual(methods, ["tools/call", "tools/list", "tools/list", "tools/call"])
  assert.deepEqual(sentAuthorization, [
    "Bearer token-before-refresh-auth",
    "Bearer token-before-refresh-auth",
    "Bearer token-after-refresh-auth",
    "Bearer token-after-refresh-auth"
  ])
  assert.equal(fixture.calls.filter(([operation]) => operation === "respondToChallenge").length, 1)
})

test("authorization interruption remains interruption and aborts the request scope", async () => {
  const fixture = authorizationFixture({ onRespond: () => Effect.interrupt })
  let fetchSignal
  const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
    const transport = yield* HttpClient.make({
      url: endpoint,
      authorization: fixture.options,
      fetch: async (_input, init) => {
        fetchSignal = init.signal
        return challengeResponse(401, `Bearer resource_metadata="${metadata}"`)
      }
    })
    return yield* transport.request(request("interrupt-auth")).pipe(Stream.runDrain)
  })))
  assert.equal(Exit.isFailure(exit), true)
  assert.equal(Cause.isInterruptedOnly(exit.cause), true, inspect(exit.cause))
  assert.equal(fetchSignal instanceof AbortSignal, true)
  assert.equal(fetchSignal.aborted, true)
})

test("a rejected retry never exposes a Redacted access token in the transport error", async () => {
  const sentinel = "WP6E_REJECTED_TOKEN_SENTINEL"
  const nextGrant = grant("grant-rejected")
  const fixture = authorizationFixture({
    tokenByGrant: new Map([[nextGrant, sentinel]]),
    onRespond: () => Effect.succeed(nextGrant)
  })
  let calls = 0
  const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* HttpClient.make({
      url: endpoint,
      authorization: fixture.options,
      fetch: async () => {
        calls += 1
        return challengeResponse(401, `Bearer resource_metadata="${metadata}"`)
      }
    })
    return yield* transport.request(request("safe-error")).pipe(Stream.runDrain, Effect.either)
  })))
  assert.equal(outcome._tag, "Left")
  assert.equal(calls, 2)
  assert.equal(inspect(outcome.left, { depth: 8 }).includes(sentinel), false)
  assert.equal(JSON.stringify(outcome.left).includes(sentinel), false)
})

test("authorized fetch rejection drops arbitrary causes while an unauthenticated rejection retains its cause", async () => {
  const sentinel = "WP6E_AUTHORIZED_FETCH_CAUSE_SENTINEL"
  const current = grant("grant-authorized-fetch-rejection")
  const fixture = authorizationFixture({
    initialGrant: Option.some(current),
    tokenByGrant: new Map([[current, sentinel]])
  })
  const authorized = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* HttpClient.make({
      url: endpoint,
      authorization: fixture.options,
      fetch: async (_input, init) => {
        throw { observedAuthorization: new Headers(init.headers).get("authorization") }
      }
    })
    return yield* transport.request(request("authorized-fetch-rejection")).pipe(
      Stream.runDrain,
      Effect.either
    )
  })))
  assert.equal(authorized._tag, "Left")
  assert.equal(Object.hasOwn(authorized.left, "cause"), false)
  assert.equal(inspect(authorized.left, { depth: 8 }).includes(sentinel), false)

  const ordinaryCause = { reason: "ordinary-fetch-rejection" }
  const unauthenticated = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const transport = yield* HttpClient.make({
      url: endpoint,
      fetch: async () => {
        throw ordinaryCause
      }
    })
    return yield* transport.request(request("unauthenticated-fetch-rejection")).pipe(
      Stream.runDrain,
      Effect.either
    )
  })))
  assert.equal(unauthenticated._tag, "Left")
  assert.strictEqual(unauthenticated.left.cause, ordinaryCause)
})
