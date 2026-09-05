import * as Schema from "effect/Schema"

const jsonSchemaAddress = Schema.Struct({
  street: Schema.String,
  city: Schema.String
}).annotate({ identifier: "address", $anchor: "addressDef" })

export const jsonSchema202012Parameters = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  address: Schema.optionalKey(jsonSchemaAddress),
  contactMethod: Schema.optionalKey(Schema.Literals(["phone", "email"])),
  phone: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String)
})
  // Applicators stay on the object they describe. A filter's toJsonSchema
  // fragment is an allOf member in Effect v4, which changes these keywords' scope.
  .annotate({
    allOf: [{ anyOf: [{ required: ["phone"] }, { required: ["email"] }] }],
    if: { properties: { contactMethod: { const: "phone" } }, required: ["contactMethod"] },
    then: { required: ["phone"] },
    else: { required: ["email"] }
  })
  .check(
    Schema.makeFilter(
      (value) => (value.contactMethod === "phone" ? value.phone !== undefined : value.email !== undefined),
      { message: "phone or email is required for the selected contact method" }
    )
  )
