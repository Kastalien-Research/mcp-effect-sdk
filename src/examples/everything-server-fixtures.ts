import * as Schema from "effect/Schema"

const jsonSchemaAddress = Schema.Struct({
  street: Schema.String,
  city: Schema.String
}).annotations({
  identifier: "address",
  jsonSchema: { $anchor: "addressDef" }
})

export const jsonSchema202012Parameters = Schema.Struct({
  name: Schema.optional(Schema.String),
  address: Schema.optional(jsonSchemaAddress),
  contactMethod: Schema.optional(Schema.Literal("phone", "email")),
  phone: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String)
}).pipe(Schema.filter(
  (value) => value.contactMethod === "phone"
    ? value.phone !== undefined
    : value.email !== undefined,
  { message: () => "phone or email is required for the selected contact method" }
)).annotations({
  jsonSchema: {
    allOf: [{ anyOf: [{ required: ["phone"] }, { required: ["email"] }] }],
    if: {
      properties: { contactMethod: { const: "phone" } },
      required: ["contactMethod"]
    },
    then: { required: ["phone"] },
    else: { required: ["email"] },
    additionalProperties: false
  }
})
