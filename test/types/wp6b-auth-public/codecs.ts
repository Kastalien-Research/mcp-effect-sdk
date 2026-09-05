import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import { safeAuthorizationArray, safeOptionalAuthorizationField } from "../../../src/auth/common.js"

class Decoder extends Context.Service<Decoder, { readonly parse: (value: string) => number }>()("auth-test/Decoder") {}
class Encoder extends Context.Service<Encoder, { readonly format: (value: number) => string }>()("auth-test/Encoder") {}

const item = Schema.String.pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transformOrFail((value) => Effect.map(Effect.service(Decoder), (port) => port.parse(value))),
    encode: SchemaGetter.transformOrFail((value) => Effect.map(Effect.service(Encoder), (port) => port.format(value)))
  })
)
const codec = Schema.Struct({ values: safeOptionalAuthorizationField(safeAuthorizationArray(item)) })
const decode: Effect.Effect<typeof codec.Type, Schema.SchemaError, Decoder> = Schema.decodeUnknownEffect(codec)({})
const encode: Effect.Effect<typeof codec.Encoded, Schema.SchemaError, Encoder> = Schema.encodeEffect(codec)({})
// @ts-expect-error The decoder must not erase its service requirement.
const decodeWithoutServices: Effect.Effect<typeof codec.Type, Schema.SchemaError> = decode
// @ts-expect-error The encoder must not erase its distinct service requirement.
const encodeWithoutServices: Effect.Effect<typeof codec.Encoded, Schema.SchemaError> = encode
void decodeWithoutServices
void encodeWithoutServices
