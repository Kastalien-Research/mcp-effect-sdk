import assert from "node:assert/strict"
import { test } from "node:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberId from "effect/FiberId"
import * as Server from "../../dist/server.js"

const key = () => Uint8Array.from({ length: 32 }, (_, index) => index + 1)

const makeCodec = (options = {}) => Effect.gen(function*() {
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
  const codec = await Effect.runPromise(Server.SecureRequestState.make({
    key: sourceKey,
    ttlMs: 1_000,
    now: () => 10_000
  }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay)))
  sourceKey.fill(0)
  const token = await Effect.runPromise(codec.seal({
    state: "private-state",
    principal: "principal-a",
    purpose: "tools/call:approval"
  }))
  assert.match(token, /^[A-Za-z0-9_-]+$/)
  assert.equal(token.includes("private-state"), false)
  assert.equal(await Effect.runPromise(codec.open({
    token,
    principal: "principal-a",
    purpose: "tools/call:approval"
  })), "private-state")

  for (const change of [
    { principal: "principal-b", purpose: "tools/call:approval" },
    { principal: "principal-a", purpose: "prompts/get:approval" }
  ]) {
    const fresh = await Effect.runPromise(codec.seal({
      state: "private-state", principal: "principal-a", purpose: "tools/call:approval"
    }))
    const failure = await Effect.runPromise(codec.open({ token: fresh, ...change }).pipe(Effect.either))
    assert.equal(failure._tag, "Left")
    assert.equal(failure.left.reason, "AuthenticationFailed")
    assert.equal(JSON.stringify(failure.left).includes("private-state"), false)
  }

  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`
  const failure = await Effect.runPromise(codec.open({
    token: tampered, principal: "principal-a", purpose: "tools/call:approval"
  }).pipe(Effect.either))
  assert.equal(failure._tag, "Left")
})

test("secure request state rejects expiry, future issuance, replay, and store exhaustion", async () => {
  const clock = { value: 20_000 }
  const codec = await Effect.runPromise(makeCodec({ now: clock, replay: { capacity: 1 } }))
  const first = await Effect.runPromise(codec.seal({ state: "one", principal: "p", purpose: "x" }))
  const second = await Effect.runPromise(codec.seal({ state: "two", principal: "p", purpose: "x" }))
  assert.equal(await Effect.runPromise(codec.open({ token: first, principal: "p", purpose: "x" })), "one")
  const replay = await Effect.runPromise(codec.open({ token: first, principal: "p", purpose: "x" }).pipe(Effect.either))
  assert.equal(replay._tag, "Left")
  assert.equal(replay.left.reason, "Replay")
  const full = await Effect.runPromise(codec.open({ token: second, principal: "p", purpose: "x" }).pipe(Effect.either))
  assert.equal(full._tag, "Left")
  assert.equal(full.left.reason, "ReplayStoreFull")

  const expiring = await Effect.runPromise(makeCodec({ now: clock }))
  const expired = await Effect.runPromise(expiring.seal({ state: "x", principal: "p", purpose: "x" }))
  clock.value += 1_000
  const expiry = await Effect.runPromise(expiring.open({ token: expired, principal: "p", purpose: "x" }).pipe(Effect.either))
  assert.equal(expiry._tag, "Left")
  assert.equal(expiry.left.reason, "Expired")
  clock.value = 19_999
  const future = await Effect.runPromise(expiring.open({ token: expired, principal: "p", purpose: "x" }).pipe(Effect.either))
  assert.equal(future._tag, "Left")
  assert.equal(future.left.reason, "FutureIssued")
})

test("exactly one concurrent replay consumer wins", async () => {
  const codec = await Effect.runPromise(makeCodec())
  const token = await Effect.runPromise(codec.seal({ state: "winner", principal: "p", purpose: "x" }))
  const exits = await Effect.runPromise(Effect.all([
    codec.open({ token, principal: "p", purpose: "x" }).pipe(Effect.exit),
    codec.open({ token, principal: "p", purpose: "x" }).pipe(Effect.exit)
  ], { concurrency: 2 }))
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
    const outcome = await Effect.runPromise(Server.SecureRequestState.make(options).pipe(
      Effect.provideService(Server.RequestStateReplayStore, replay),
      Effect.either
    ))
    assert.equal(outcome._tag, "Left")
    assert.equal(outcome.left.reason, "InvalidConfiguration")
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
    const outcome = await Effect.runPromise(codec.seal(input).pipe(Effect.either))
    assert.equal(outcome._tag, "Left")
    assert.equal(outcome.left._tag, "RequestStateError")
  }
})

test("invalid key-length temporary copies are zeroed without mutating caller bytes", async () => {
  const callerKey = Uint8Array.from({ length: 31 }, (_, index) => index + 1)
  const before = callerKey.slice()
  const descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "fill")
  let zeroedTemporary = false
  Object.defineProperty(Uint8Array.prototype, "fill", {
    ...descriptor,
    value(value, ...rest) {
      if (this !== callerKey && this.byteLength === 31 && value === 0) zeroedTemporary = true
      return Reflect.apply(descriptor.value, this, [value, ...rest])
    }
  })
  try {
    const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
    const outcome = await Effect.runPromise(Server.SecureRequestState.make({
      key: callerKey, ttlMs: 1_000
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay), Effect.either))
    assert.equal(outcome._tag, "Left")
  } finally {
    Object.defineProperty(Uint8Array.prototype, "fill", descriptor)
  }
  assert.equal(zeroedTemporary, true)
  assert.deepEqual(callerKey, before)
})

test("five-minute TTL defaults and hostile boundaries fail through RequestStateError", async () => {
  const clock = { value: 100 }
  const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
  const codec = await Effect.runPromise(Server.SecureRequestState.make({
    key: key(), now: () => clock.value
  }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay)))
  const before = await Effect.runPromise(codec.seal({ state: "before", principal: "p", purpose: "x" }))
  const at = await Effect.runPromise(codec.seal({ state: "at", principal: "p", purpose: "x" }))
  clock.value = 300_099
  assert.equal(await Effect.runPromise(codec.open({ token: before, principal: "p", purpose: "x" })), "before")
  clock.value = 300_100
  const expired = await Effect.runPromise(codec.open({ token: at, principal: "p", purpose: "x" }).pipe(Effect.either))
  assert.equal(expired._tag, "Left")
  assert.equal(expired.left.reason, "Expired")

  const hostileValues = [
    Server.RequestStateReplayStore.memory(new Proxy({}, { ownKeys: () => { throw new Error("memory trap") } })),
    Server.SecureRequestState.make(new Proxy({}, { get: () => { throw new Error("make trap") } })).pipe(
      Effect.provideService(Server.RequestStateReplayStore, replay)
    ),
    codec.seal(Object.defineProperty({ state: "x", purpose: "x" }, "principal", {
      enumerable: true, get: () => { throw new Error("seal getter") }
    })),
    codec.open(Object.defineProperty({ token: before, purpose: "x" }, "principal", {
      enumerable: true, get: () => { throw new Error("open getter") }
    }))
  ]
  for (const effect of hostileValues) {
    const exit = await Effect.runPromiseExit(effect)
    assert.equal(exit._tag, "Failure")
    assert.equal(Cause.defects(exit.cause).length, 0)
    assert.equal(Array.from(Cause.failures(exit.cause))[0]?._tag, "RequestStateError")
  }
})

test("replay-store defects are contained with their complete Cause", async () => {
  const store = Server.RequestStateReplayStore.of({
    consume: () => Effect.die(new Error("store defect"))
  })
  const codec = await Effect.runPromise(Server.SecureRequestState.make({
    key: key(), ttlMs: 1_000, now: () => 10_000
  }).pipe(Effect.provideService(Server.RequestStateReplayStore, store)))
  const token = await Effect.runPromise(codec.seal({ state: "x", principal: "p", purpose: "x" }))
  const outcome = await Effect.runPromise(codec.open({ token, principal: "p", purpose: "x" }).pipe(Effect.either))
  assert.equal(outcome._tag, "Left")
  assert.equal(outcome.left.reason, "ReplayStoreFailure")
  assert.equal(Cause.defects(outcome.left.cause).length, 1)

  const throwing = Server.RequestStateReplayStore.of({
    consume: () => { throw new Error("store throw") }
  })
  const throwingCodec = await Effect.runPromise(Server.SecureRequestState.make({
    key: key(), ttlMs: 1_000, now: () => 10_000
  }).pipe(Effect.provideService(Server.RequestStateReplayStore, throwing)))
  const throwingToken = await Effect.runPromise(throwingCodec.seal({
    state: "x", principal: "p", purpose: "x"
  }))
  const throwingOutcome = await Effect.runPromise(throwingCodec.open({
    token: throwingToken, principal: "p", purpose: "x"
  }).pipe(Effect.either))
  assert.equal(throwingOutcome._tag, "Left")
  assert.equal(throwingOutcome.left.reason, "ReplayStoreFailure")
  assert.equal(Cause.defects(throwingOutcome.left.cause).length, 1)

  for (const consume of [
    () => Effect.interrupt,
    () => Effect.failCause(Cause.parallel(
      Cause.fail(new Error("store failure")),
      Cause.interrupt(FiberId.make(2, 0))
    ))
  ]) {
    const interrupting = Server.RequestStateReplayStore.of({ consume })
    const interruptingCodec = await Effect.runPromise(Server.SecureRequestState.make({
      key: key(), ttlMs: 1_000, now: () => 10_000
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, interrupting)))
    const interruptingToken = await Effect.runPromise(interruptingCodec.seal({
      state: "x", principal: "p", purpose: "x"
    }))
    const exit = await Effect.runPromiseExit(interruptingCodec.open({
      token: interruptingToken, principal: "p", purpose: "x"
    }))
    assert.equal(exit._tag, "Failure")
    assert.equal(Array.from(Cause.interruptors(exit.cause)).length > 0, true)
  }
})

test("missing WebCrypto is typed and harmless raw state is explicit and bounded", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined })
  try {
    const replay = await Effect.runPromise(Server.RequestStateReplayStore.memory())
    const outcome = await Effect.runPromise(Server.SecureRequestState.make({
      key: key(), ttlMs: 1_000
    }).pipe(Effect.provideService(Server.RequestStateReplayStore, replay), Effect.either))
    assert.equal(outcome._tag, "Left")
    assert.equal(outcome.left.reason, "CryptoUnavailable")
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "crypto")
    else Object.defineProperty(globalThis, "crypto", descriptor)
  }

  const raw = await Effect.runPromise(Server.HarmlessRawRequestState.make("retry-only"))
  assert.equal(raw._tag, "HarmlessRawRequestState")
  assert.equal(raw.value, "retry-only")
  const rejected = await Effect.runPromise(Server.HarmlessRawRequestState.make("x".repeat(8_193)).pipe(Effect.either))
  assert.equal(rejected._tag, "Left")
  const malformed = await Effect.runPromise(Server.HarmlessRawRequestState.make("\uD800").pipe(Effect.either))
  assert.equal(malformed._tag, "Left")
})
