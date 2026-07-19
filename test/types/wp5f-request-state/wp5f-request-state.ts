import * as Effect from "effect/Effect"
import {
  HarmlessRawRequestState,
  RequestStateReplayStore,
  SecureRequestState,
  type RequestStateError
} from "../../../src/server.js"

const key = new Uint8Array(32)
const program = Effect.gen(function*() {
  const replay = yield* RequestStateReplayStore.memory()
  const codec = yield* SecureRequestState.make({ key, ttlMs: 1_000 }).pipe(
    Effect.provideService(RequestStateReplayStore, replay)
  )
  const token: string = yield* codec.seal({ state: "x", principal: "p", purpose: "tools/call" })
  const state: string = yield* codec.open({ token, principal: "p", purpose: "tools/call" })
  const raw = yield* HarmlessRawRequestState.make(state)
  const value: string = raw.value
  return { token, value }
})

const errorProgram: Effect.Effect<unknown, RequestStateError> = program
void errorProgram

// @ts-expect-error key material must be bytes
SecureRequestState.make({ key: "secret", ttlMs: 1_000 })
// @ts-expect-error raw state never accepts arbitrary values
HarmlessRawRequestState.make({ state: "x" })
