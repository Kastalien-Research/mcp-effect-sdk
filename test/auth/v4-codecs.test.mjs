import assert from "node:assert/strict"
import { test } from "node:test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import { safeAuthorizationArray, safeOptionalAuthorizationField } from "../../dist/auth/common.js"

test("authorization containers preserve directional transformations and services in v4", () => {
  const Decoder = Context.Service("auth-test/Decoder")
  const Encoder = Context.Service("auth-test/Encoder")
  const item = Schema.String.pipe(
    Schema.decodeTo(Schema.Number, {
      decode: SchemaGetter.transformOrFail((value) => Effect.map(Effect.service(Decoder), (parse) => parse(value))),
      encode: SchemaGetter.transformOrFail((value) => Effect.map(Effect.service(Encoder), (format) => format(value)))
    })
  )
  const codec = Schema.Struct({ values: safeOptionalAuthorizationField(safeAuthorizationArray(item)) })
  const decoded = Effect.runSync(
    Schema.decodeUnknownEffect(codec)({ values: ["10", "20"] }).pipe(Effect.provideService(Decoder, Number))
  )
  assert.deepEqual(decoded, { values: [10, 20] })
  assert.equal(Object.isFrozen(decoded.values), true)
  const encoded = Effect.runSync(
    Schema.encodeEffect(codec)(decoded).pipe(Effect.provideService(Encoder, (value) => value.toFixed(1)))
  )
  assert.deepEqual(encoded, { values: ["10.0", "20.0"] })
  assert.deepEqual(Schema.decodeUnknownSync(Schema.toType(codec))({}), {})
  assert.deepEqual(Schema.decodeUnknownSync(Schema.toType(codec))({ values: undefined }), { values: undefined })
})
