import assert from "node:assert/strict"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Server from "../../dist/server.js"

const key = () => Uint8Array.from({ length: 32 }, (_, index) => index + 1)

const makeCodec = (options = {}) =>
  Effect.gen(function* () {
    const replay = yield* Server.RequestStateReplayStore.memory(options.replay)
    return yield* Server.SecureRequestState.make({
      key: key(),
      ttlMs: 1_000,
      now: () => options.now?.value ?? 10_000
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay))
  })

test("secure request state is opaque, canonical, principal/purpose bound, and key-copying", async () => {
  const sourceKey = key()
  const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
  const codec = await Effect.runPromise(
    Server.SecureRequestState.make({
      key: sourceKey,
      ttlMs: 1_000,
      now: () => 10_000
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay))
  )
  sourceKey.fill(0)
  const token = await Effect.runPromise(
    codec.seal({
      state: "private-state",
      principal: "principal-a",
      purpose: "tools/call:approval"
    })
  )
  assert.match(token, /^[A-Za-z0-9_-]+$/)
  assert.equal(token.includes("private-state"), false)
  assert.equal(
    await Effect.runPromise(
      codec.open({
        token,
        principal: "principal-a",
        purpose: "tools/call:approval"
      })
    ),
    "private-state"
  )

  for (const change of [
    { principal: "principal-b", purpose: "tools/call:approval" },
    { principal: "principal-a", purpose: "prompts/get:approval" }
  ]) {
    const fresh = await Effect.runPromise(
      codec.seal({
        state: "private-state",
        principal: "principal-a",
        purpose: "tools/call:approval"
      })
    )
    const failure = await Effect.runPromise(codec.open({ token: fresh, ...change }).pipe(Effect.result))
    assert.equal(failure._tag, "Failure")
    assert.equal(failure.failure.reason, "AuthenticationFailed")
    assert.equal(JSON.stringify(failure.failure).includes("private-state"), false)
  }

  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`
  const failure = await Effect.runPromise(
    codec
      .open({
        token: tampered,
        principal: "principal-a",
        purpose: "tools/call:approval"
      })
      .pipe(Effect.result)
  )
  assert.equal(failure._tag, "Failure")
})

test("secure request state rejects expiry, future issuance, replay, and store exhaustion", async () => {
  const clock = { value: 20_000 }
  const codec = await Effect.runPromise(makeCodec({ now: clock, replay: { capacity: 1 } }))
  const first = await Effect.runPromise(codec.seal({ state: "one", principal: "p", purpose: "x" }))
  const second = await Effect.runPromise(codec.seal({ state: "two", principal: "p", purpose: "x" }))
  assert.equal(await Effect.runPromise(codec.open({ token: first, principal: "p", purpose: "x" })), "one")
  const replay = await Effect.runPromise(codec.open({ token: first, principal: "p", purpose: "x" }).pipe(Effect.result))
  assert.equal(replay._tag, "Failure")
  assert.equal(replay.failure.reason, "Replay")
  const full = await Effect.runPromise(codec.open({ token: second, principal: "p", purpose: "x" }).pipe(Effect.result))
  assert.equal(full._tag, "Failure")
  assert.equal(full.failure.reason, "ReplayStoreFull")

  const expiring = await Effect.runPromise(makeCodec({ now: clock }))
  const expired = await Effect.runPromise(expiring.seal({ state: "x", principal: "p", purpose: "x" }))
  clock.value += 1_000
  const expiry = await Effect.runPromise(
    expiring.open({ token: expired, principal: "p", purpose: "x" }).pipe(Effect.result)
  )
  assert.equal(expiry._tag, "Failure")
  assert.equal(expiry.failure.reason, "Expired")
  clock.value = 19_999
  const future = await Effect.runPromise(
    expiring.open({ token: expired, principal: "p", purpose: "x" }).pipe(Effect.result)
  )
  assert.equal(future._tag, "Failure")
  assert.equal(future.failure.reason, "FutureIssued")
})

test("exactly one concurrent replay consumer wins", async () => {
  const codec = await Effect.runPromise(makeCodec())
  const token = await Effect.runPromise(codec.seal({ state: "winner", principal: "p", purpose: "x" }))
  const exits = await Effect.runPromise(
    Effect.all(
      [
        codec.open({ token, principal: "p", purpose: "x" }).pipe(Effect.exit),
        codec.open({ token, principal: "p", purpose: "x" }).pipe(Effect.exit)
      ],
      { concurrency: 2 }
    )
  )
  assert.equal(exits.filter(Exit.isSuccess).length, 1)
  assert.equal(exits.filter(Exit.isFailure).length, 1)
})

test("configuration and input bounds fail typed without coercion", async () => {
  const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
  for (const options of [
    { key: new Uint8Array(31), ttlMs: 1_000 },
    { key: key(), ttlMs: 0 },
    { key: key(), ttlMs: 300_001 }
  ]) {
    const outcome = await Effect.runPromise(
      Server.SecureRequestState.make(options).pipe(
        Effect.provideService(Server.RequestStateReplayStore, replay),
        Effect.result
      )
    )
    assert.equal(outcome._tag, "Failure")
    assert.equal(outcome.failure.reason, "InvalidConfiguration")
  }
  const codec = await Effect.runPromise(makeCodec())
  for (const input of [
    { state: "x", principal: "", purpose: "x" },
    { state: "x", principal: "p", purpose: "" },
    { state: "x".repeat(8_193), principal: "p", purpose: "x" },
    { state: 1, principal: "p", purpose: "x" },
    { state: "x", principal: "\uD800", purpose: "x" },
    { state: "x", principal: "p", purpose: "\uD800" },
    { state: "\uD800", principal: "p", purpose: "x" }
  ]) {
    const outcome = await Effect.runPromise(codec.seal(input).pipe(Effect.result))
    assert.equal(outcome._tag, "Failure")
    assert.equal(outcome.failure._tag, "RequestStateError")
  }
})

test("invalid key-length temporary copies are zeroed without mutating caller bytes", async () => {
  const callerKey = Uint8Array.from({ length: 31 }, (_, index) => index + 1)
  const before = callerKey.slice()
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
  const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, "fill")
  let zeroedTemporary = false
  Object.defineProperty(typedArrayPrototype, "fill", {
    ...descriptor,
    value(value, ...rest) {
      if (this !== callerKey && this.byteLength === 31 && value === 0) zeroedTemporary = true
      return Reflect.apply(descriptor.value, this, [value, ...rest])
    }
  })
  try {
    const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
    const outcome = await Effect.runPromise(
      Server.SecureRequestState.make({
        key: callerKey,
        ttlMs: 1_000
      }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay), Effect.result)
    )
    assert.equal(outcome._tag, "Failure")
  } finally {
    Object.defineProperty(typedArrayPrototype, "fill", descriptor)
  }
  assert.equal(zeroedTemporary, true)
  assert.deepEqual(callerKey, before)
})

test("five-minute TTL defaults and hostile boundaries fail through RequestStateError", async () => {
  const clock = { value: 100 }
  const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
  const codec = await Effect.runPromise(
    Server.SecureRequestState.make({
      key: key(),
      now: () => clock.value
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay))
  )
  const before = await Effect.runPromise(codec.seal({ state: "before", principal: "p", purpose: "x" }))
  const at = await Effect.runPromise(codec.seal({ state: "at", principal: "p", purpose: "x" }))
  clock.value = 300_099
  assert.equal(await Effect.runPromise(codec.open({ token: before, principal: "p", purpose: "x" })), "before")
  clock.value = 300_100
  const expired = await Effect.runPromise(codec.open({ token: at, principal: "p", purpose: "x" }).pipe(Effect.result))
  assert.equal(expired._tag, "Failure")
  assert.equal(expired.failure.reason, "Expired")

  const hostileValues = [
    Server.RequestStateReplayStore.memory(
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error("memory trap")
          }
        }
      )
    ),
    Server.SecureRequestState.make(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("make trap")
          }
        }
      )
    ).pipe(Effect.provideService(Server.RequestStateReplayStore, replay)),
    codec.seal(
      Object.defineProperty({ state: "x", purpose: "x" }, "principal", {
        enumerable: true,
        get: () => {
          throw new Error("seal getter")
        }
      })
    ),
    codec.open(
      Object.defineProperty({ token: before, purpose: "x" }, "principal", {
        enumerable: true,
        get: () => {
          throw new Error("open getter")
        }
      })
    )
  ]
  for (const effect of hostileValues) {
    const exit = await Effect.runPromiseExit(effect)
    assert.equal(exit._tag, "Failure")
    assert.equal(exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect).length, 0)
    assert.equal(
      Array.from(exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error))[0]?._tag,
      "RequestStateError"
    )
  }
})

test("replay-store defects are contained with their complete Cause", async () => {
  const store = Server.RequestStateReplayStore.of({
    consume: () => Effect.die(new Error("store defect"))
  })
  const codec = await Effect.runPromise(
    Server.SecureRequestState.make({
      key: key(),
      ttlMs: 1_000,
      now: () => 10_000
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, store))
  )
  const token = await Effect.runPromise(codec.seal({ state: "x", principal: "p", purpose: "x" }))
  const outcome = await Effect.runPromise(codec.open({ token, principal: "p", purpose: "x" }).pipe(Effect.result))
  assert.equal(outcome._tag, "Failure")
  assert.equal(outcome.failure.reason, "ReplayStoreFailure")
  assert.equal(outcome.failure.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect).length, 1)

  const throwing = Server.RequestStateReplayStore.of({
    consume: () => {
      throw new Error("store throw")
    }
  })
  const throwingCodec = await Effect.runPromise(
    Server.SecureRequestState.make({
      key: key(),
      ttlMs: 1_000,
      now: () => 10_000
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, throwing))
  )
  const throwingToken = await Effect.runPromise(
    throwingCodec.seal({
      state: "x",
      principal: "p",
      purpose: "x"
    })
  )
  const throwingOutcome = await Effect.runPromise(
    throwingCodec
      .open({
        token: throwingToken,
        principal: "p",
        purpose: "x"
      })
      .pipe(Effect.result)
  )
  assert.equal(throwingOutcome._tag, "Failure")
  assert.equal(throwingOutcome.failure.reason, "ReplayStoreFailure")
  assert.equal(throwingOutcome.failure.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect).length, 1)

  for (const consume of [
    () => Effect.interrupt,
    () => Effect.failCause(Cause.combine(Cause.fail(new Error("store failure")), Cause.interrupt(2)))
  ]) {
    const interrupting = Server.RequestStateReplayStore.of({ consume })
    const interruptingCodec = await Effect.runPromise(
      Server.SecureRequestState.make({
        key: key(),
        ttlMs: 1_000,
        now: () => 10_000
      }).pipe(Effect.provideService(Server.RequestStateReplayStore, interrupting))
    )
    const interruptingToken = await Effect.runPromise(
      interruptingCodec.seal({
        state: "x",
        principal: "p",
        purpose: "x"
      })
    )
    const exit = await Effect.runPromiseExit(
      interruptingCodec.open({
        token: interruptingToken,
        principal: "p",
        purpose: "x"
      })
    )
    assert.equal(exit._tag, "Failure")
    assert.equal(Array.from(Cause.interruptors(exit.cause)).length > 0, true)
  }
})

test("missing WebCrypto is typed and harmless raw state is explicit and bounded", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined })
  try {
    const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
    const outcome = await Effect.runPromise(
      Server.SecureRequestState.make({
        key: key(),
        ttlMs: 1_000
      }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay), Effect.result)
    )
    assert.equal(outcome._tag, "Failure")
    assert.equal(outcome.failure.reason, "CryptoUnavailable")
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "crypto")
    else Object.defineProperty(globalThis, "crypto", descriptor)
  }

  const raw = await Effect.runPromise(Server.HarmlessRawRequestState.make("retry-only"))
  assert.equal(raw._tag, "HarmlessRawRequestState")
  assert.equal(raw.value, "retry-only")
  const rejected = await Effect.runPromise(Server.HarmlessRawRequestState.make("x".repeat(8_193)).pipe(Effect.result))
  assert.equal(rejected._tag, "Failure")
  const malformed = await Effect.runPromise(Server.HarmlessRawRequestState.make("\uD800").pipe(Effect.result))
  assert.equal(malformed._tag, "Failure")
})
