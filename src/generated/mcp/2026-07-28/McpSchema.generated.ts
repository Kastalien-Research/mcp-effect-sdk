/**
 * Generated from vendored modelcontextprotocol schema.json for MCP draft 2026-07-28.
 * Do not edit manually.
 */

import * as Schema from "effect/Schema"

const optional = Schema.optional

const required = <Codec extends Schema.Schema.All>(codec: Codec): Codec =>
  (codec as Schema.Schema.AnyNoContext).pipe(Schema.filter(
    (value: unknown) => value !== undefined,
    { message: () => "Expected required property" }
  )) as unknown as Codec

const isOneOfMatch = (schema: Schema.Schema.All, input: unknown): boolean =>
  Schema.decodeUnknownEither(schema as Schema.Schema.AnyNoContext)(input)._tag === "Right"

const isTypeMatch = (schema: Schema.Schema.All, input: unknown): boolean =>
  Schema.encodeUnknownEither(schema as Schema.Schema.AnyNoContext)(input)._tag === "Right"

const mergeIntersectionValues = (left: unknown, right: unknown): unknown => {
  if (
    typeof left === "object" && left !== null && !Array.isArray(left)
    && typeof right === "object" && right !== null && !Array.isArray(right)
  ) {
    return Object.assign(Object.create(Object.getPrototypeOf(left)), left, right)
  }
  return left
}

type ExactIntersection<Left extends Schema.Schema.All, Right extends Schema.Schema.All> =
  Schema.Schema<
    Schema.Schema.Type<Left> & Schema.Schema.Type<Right>,
    Schema.Schema.Encoded<Left> & Schema.Schema.Encoded<Right>
  >

const exactIntersection = <
  Left extends Schema.Schema.All,
  Right extends Schema.Schema.All
>(
  left: Left,
  right: Right
): ExactIntersection<Left, Right> => {
  const encoded = Schema.Unknown.pipe(Schema.filter(
    (input) => isOneOfMatch(left, input) && isOneOfMatch(right, input),
    { message: () => "Expected a value matching every intersection member" }
  ))
  const decoded = Schema.Unknown.pipe(Schema.filter(
    (value) => isTypeMatch(left, value) && isTypeMatch(right, value),
    { message: () => "Expected a value matching every intersection member" }
  ))
  try {
    const representation = Schema.extend(
      left as Schema.Schema.Any,
      right as Schema.Schema.Any
    )
    return Schema.transform(encoded, decoded, {
      strict: true,
      decode: (input) => Schema.decodeUnknownSync(
        representation as unknown as Schema.Schema.AnyNoContext
      )(input),
      encode: (value) => {
        // Validate the original decoded value before the structural codec has
        // an opportunity to strip fields while encoding.
        Schema.encodeUnknownSync(left as Schema.Schema.AnyNoContext)(value)
        Schema.encodeUnknownSync(right as Schema.Schema.AnyNoContext)(value)
        return Schema.encodeUnknownSync(
          representation as unknown as Schema.Schema.AnyNoContext
        )(value)
      }
    }) as unknown as ExactIntersection<Left, Right>
  } catch {
    // Effect cannot structurally extend every valid JSON Schema intersection
    // (for example, Int with an integer literal). Decode and encode both
    // members, merging object representations so no member's fields or class
    // prototype are discarded.
    return Schema.transform(encoded, decoded, {
      strict: true,
      decode: (input) => mergeIntersectionValues(
        Schema.decodeUnknownSync(left as Schema.Schema.AnyNoContext)(input),
        Schema.decodeUnknownSync(right as Schema.Schema.AnyNoContext)(input)
      ),
      encode: (value) => mergeIntersectionValues(
        Schema.encodeUnknownSync(left as Schema.Schema.AnyNoContext)(value),
        Schema.encodeUnknownSync(right as Schema.Schema.AnyNoContext)(value)
      )
    }) as unknown as ExactIntersection<Left, Right>
  }
}

const withEncodedConstraint = <Codec extends Schema.Schema.All>(
  codec: Codec,
  constraint: Schema.Schema.All
): Codec => Schema.compose(
  constraint as Schema.Schema.AnyNoContext,
  codec as Schema.Schema.AnyNoContext,
  { strict: false }
) as unknown as Codec

const withEncodedBounds = <Codec extends Schema.Schema.All>(
  codec: Codec,
  bounds: {
    readonly minimum?: number
    readonly maximum?: number
    readonly minLength?: number
    readonly maxLength?: number
    readonly minItems?: number
    readonly maxItems?: number
  }
): Codec => withEncodedConstraint(codec, Schema.Unknown.pipe(Schema.filter(
  (input) => {
    if (typeof input === "number") {
      if (bounds.minimum !== undefined && input < bounds.minimum) return false
      if (bounds.maximum !== undefined && input > bounds.maximum) return false
    }
    if (typeof input === "string") {
      if (bounds.minLength !== undefined && input.length < bounds.minLength) return false
      if (bounds.maxLength !== undefined && input.length > bounds.maxLength) return false
    }
    if (Array.isArray(input)) {
      if (bounds.minItems !== undefined && input.length < bounds.minItems) return false
      if (bounds.maxItems !== undefined && input.length > bounds.maxItems) return false
    }
    return true
  },
  { message: () => "Expected encoded value to satisfy applicable bounds" }
)))

const typedObject = <
  Fields extends Schema.Struct.Fields,
  Value extends Schema.Schema.AnyNoContext
>(
  fields: Fields,
  fieldNames: ReadonlyArray<string>,
  value: Value
) => Schema.Struct(
  fields,
  Schema.Record({
    key: Schema.String.pipe(Schema.filter((key) => !fieldNames.includes(key))),
    value
  })
) as unknown as Schema.TypeLiteral<
  Fields,
  readonly [{ readonly key: typeof Schema.String; readonly value: typeof Schema.Unknown }]
>

const oneOf = <Members extends readonly [
  Schema.Schema.AnyNoContext,
  Schema.Schema.AnyNoContext,
  ...Schema.Schema.AnyNoContext[]
]>(...members: Members) =>
  Schema.compose(
    Schema.Unknown.pipe(Schema.filter(
      (input) => members.filter((member) => isOneOfMatch(member, input)).length === 1,
      { message: () => "Expected exactly one matching oneOf member" }
    )),
    Schema.Union(...members),
    { strict: false }
  )

export type JSONValue = string | number | boolean | null | JSONObject | JSONArray
export type JSONObject = { readonly [key: string]: JSONValue }
export type JSONArray = ReadonlyArray<JSONValue>

export const JSONValue: Schema.Schema<JSONValue> = Schema.suspend(() =>
  Schema.Union(Schema.String, Schema.Finite, Schema.Boolean, Schema.Null, JSONObject, JSONArray)
)
export const JSONObject: Schema.Schema<JSONObject> = Schema.Record({ key: Schema.String, value: JSONValue })
export const JSONArray: Schema.Schema<JSONArray> = Schema.Array(JSONValue)

export const Role = Schema.Literal("assistant", "user").annotations({
  "description": "The sender or recipient of messages and data in a conversation."
})

const AnnotationsOpenFields = Schema.Struct({
  "audience": optional(Schema.Array(Role).annotations({
  "description": "Describes who the intended audience of this object or data is.\n\nIt can include multiple entries to indicate content useful for multiple audiences (e.g., `[\"user\", \"assistant\"]`)."
})),
  "lastModified": optional(Schema.String.annotations({
  "description": "The moment the resource was last modified, as an ISO 8601 formatted string.\n\nShould be an ISO 8601 formatted string (e.g., \"2025-01-12T15:00:58Z\").\n\nExamples: last activity timestamp in an open file, timestamp when the resource\nwas attached, etc."
})),
  "priority": optional(withEncodedBounds(Schema.Finite, {
  "minimum": 0,
  "maximum": 1
}).annotations({
  "description": "Describes how important this data is for operating the server.\n\nA value of 1 means \"most important,\" and indicates that the data is\neffectively required, while 0 means \"least important,\" and indicates that\nthe data is entirely optional."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const AnnotationsClassFields = AnnotationsOpenFields

export class Annotations extends Schema.Class<Annotations>("mcp/generated/2026-07-28/Annotations")(
AnnotationsClassFields as unknown as Schema.Struct<typeof AnnotationsOpenFields.fields>, {
  "description": "Optional annotations for the client. The client can use annotations to inform how objects are used or displayed"
}
) {
  constructor(props: Schema.Schema.Type<typeof AnnotationsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const MetaObject = Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
  "description": "Represents the contents of a `_meta` field, which clients and servers use to attach additional metadata to their interactions.\n\nCertain key names are reserved by MCP for protocol-level metadata; implementations MUST NOT make assumptions about values at these keys. Additionally, specific schema definitions may reserve particular names for purpose-specific metadata, as declared in those definitions.\n\nValid keys have two segments:\n\n**Prefix:**\n- Optional — if specified, MUST be a series of _labels_ separated by dots (`.`), followed by a slash (`/`).\n- Labels MUST start with a letter and end with a letter or digit. Interior characters may be letters, digits, or hyphens (`-`).\n- Implementations SHOULD use reverse DNS notation (e.g., `com.example/` rather than `example.com/`).\n- Any prefix where the second label is `modelcontextprotocol` or `mcp` is **reserved** for MCP use. For example: `io.modelcontextprotocol/`, `dev.mcp/`, `org.modelcontextprotocol.api/`, and `com.mcp.tools/` are all reserved. However, `com.example.mcp/` is NOT reserved, as the second label is `example`.\n\n**Name:**\n- Unless empty, MUST start and end with an alphanumeric character (`[a-z0-9A-Z]`).\n- Interior characters may be alphanumeric, hyphens (`-`), underscores (`_`), or dots (`.`)."
})

const AudioContentOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(Annotations.annotations({
  "description": "Optional annotations for the client."
})),
  "data": Schema.Uint8ArrayFromBase64.annotations({
  "description": "The base64-encoded audio data."
}),
  "mimeType": Schema.String.annotations({
  "description": "The MIME type of the audio. Different providers may support different audio types."
}),
  "type": Schema.Literal("audio")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const AudioContentClassFields = AudioContentOpenFields

export class AudioContent extends Schema.Class<AudioContent>("mcp/generated/2026-07-28/AudioContent")(
AudioContentClassFields as unknown as Schema.Struct<typeof AudioContentOpenFields.fields>, {
  "description": "Audio provided to or from an LLM."
}
) {
  constructor(props: Schema.Schema.Type<typeof AudioContentOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const BaseMetadataOpenFields = Schema.Struct({
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const BaseMetadataClassFields = BaseMetadataOpenFields

export class BaseMetadata extends Schema.Class<BaseMetadata>("mcp/generated/2026-07-28/BaseMetadata")(
BaseMetadataClassFields as unknown as Schema.Struct<typeof BaseMetadataOpenFields.fields>, {
  "description": "Base interface for metadata with name (identifier) and title (display name) properties."
}
) {
  constructor(props: Schema.Schema.Type<typeof BaseMetadataOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const BlobResourceContentsOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "blob": Schema.Uint8ArrayFromBase64.annotations({
  "description": "A base64-encoded string representing the binary data of the item."
}),
  "mimeType": optional(Schema.String.annotations({
  "description": "The MIME type of this resource, if known."
})),
  "uri": Schema.String.annotations({
  "description": "The URI of this resource."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const BlobResourceContentsClassFields = BlobResourceContentsOpenFields

export class BlobResourceContents extends Schema.Class<BlobResourceContents>("mcp/generated/2026-07-28/BlobResourceContents")(
BlobResourceContentsClassFields as unknown as Schema.Struct<typeof BlobResourceContentsOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof BlobResourceContentsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const BooleanSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.Boolean),
  "description": optional(Schema.String),
  "title": optional(Schema.String),
  "type": Schema.Literal("boolean")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const BooleanSchemaClassFields = BooleanSchemaOpenFields

export class BooleanSchema extends Schema.Class<BooleanSchema>("mcp/generated/2026-07-28/BooleanSchema")(
BooleanSchemaClassFields as unknown as Schema.Struct<typeof BooleanSchemaOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof BooleanSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const IconOpenFields = Schema.Struct({
  "mimeType": optional(Schema.String.annotations({
  "description": "Optional MIME type override if the source MIME type is missing or generic.\nFor example: `\"image/png\"`, `\"image/jpeg\"`, or `\"image/svg+xml\"`."
})),
  "sizes": optional(Schema.Array(Schema.String).annotations({
  "description": "Optional array of strings that specify sizes at which the icon can be used.\nEach string should be in WxH format (e.g., `\"48x48\"`, `\"96x96\"`) or `\"any\"` for scalable formats like SVG.\n\nIf not provided, the client should assume that the icon can be used at any size."
})),
  "src": Schema.String.annotations({
  "description": "A standard URI pointing to an icon resource. May be an HTTP/HTTPS URL or a\n`data:` URI with Base64-encoded image data.\n\nConsumers SHOULD take steps to ensure URLs serving icons are from the\nsame domain as the client/server or a trusted domain.\n\nConsumers SHOULD take appropriate precautions when consuming SVGs as they can contain\nexecutable JavaScript."
}),
  "theme": optional(Schema.Literal("dark", "light").annotations({
  "description": "Optional specifier for the theme this icon is designed for. `\"light\"` indicates\nthe icon is designed to be used with a light background, and `\"dark\"` indicates\nthe icon is designed to be used with a dark background.\n\nIf not provided, the client should assume the icon can be used with any theme."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const IconClassFields = IconOpenFields

export class Icon extends Schema.Class<Icon>("mcp/generated/2026-07-28/Icon")(
IconClassFields as unknown as Schema.Struct<typeof IconOpenFields.fields>, {
  "description": "An optionally-sized icon that can be displayed in a user interface."
}
) {
  constructor(props: Schema.Schema.Type<typeof IconOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ImplementationOpenFields = Schema.Struct({
  "description": optional(Schema.String.annotations({
  "description": "An optional human-readable description of what this implementation does.\n\nThis can be used by clients or servers to provide context about their purpose\nand capabilities. For example, a server might describe the types of resources\nor tools it provides, while a client might describe its intended use case."
})),
  "icons": optional(Schema.Array(Icon).annotations({
  "description": "Optional set of sized icons that the client can display in a user interface.\n\nClients that support rendering icons MUST support at least the following MIME types:\n- `image/png` - PNG images (safe, universal compatibility)\n- `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)\n\nClients that support rendering icons SHOULD also support:\n- `image/svg+xml` - SVG images (scalable but requires security precautions)\n- `image/webp` - WebP images (modern, efficient format)"
})),
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
})),
  "version": Schema.String.annotations({
  "description": "The version of this implementation."
}),
  "websiteUrl": optional(Schema.String.annotations({
  "description": "An optional URL of the website for this implementation."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ImplementationClassFields = ImplementationOpenFields

export class Implementation extends Schema.Class<Implementation>("mcp/generated/2026-07-28/Implementation")(
ImplementationClassFields as unknown as Schema.Struct<typeof ImplementationOpenFields.fields>, {
  "description": "Describes the MCP implementation."
}
) {
  constructor(props: Schema.Schema.Type<typeof ImplementationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ResultMetaObject = typedObject({ "io.modelcontextprotocol/serverInfo": optional(Implementation.annotations({
  "description": "Identifies the server software producing the response. Servers SHOULD\ninclude this field on every response unless specifically configured not\nto do so.\n\nThe {@link Implementation} schema requires `name` and `version`; other\nfields are optional.\n\nThe value is self-reported by the server and is not verified by the\nprotocol. It is intended for display, logging, and debugging. Clients\nSHOULD NOT use it to change their behavior, and SHOULD NOT rely on it for\nsecurity decisions."
})) }, [
  "io.modelcontextprotocol/serverInfo"
] as const, Schema.Unknown).annotations({
  "description": "Extends {@link MetaObject} with additional result-specific fields. All key naming rules from `MetaObject` apply."
})

const CacheableResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "cacheScope": Schema.Literal("private", "public").annotations({
  "description": "Indicates the intended scope of the cached response, analogous to HTTP\n`Cache-Control: public` vs `Cache-Control: private`.\n\n- `\"public\"`: The response does not contain user-specific data. Any\n  client or intermediary (e.g., shared gateway, caching proxy) MAY cache\n  the response and serve it across authorization contexts.\n- `\"private\"`: The response MAY be cached and reused only within the\n  same authorization context. Caches MUST NOT be shared across\n  authorization contexts (e.g., a different access token requires a\n  different cache)."
}),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "ttlMs": withEncodedBounds(Schema.Int, {
  "minimum": 0
}).annotations({
  "description": "A hint from the server indicating how long (in milliseconds) the\nclient MAY cache this response before re-fetching. Semantics are\nanalogous to HTTP Cache-Control max-age.\n\n- If 0, The response SHOULD be considered immediately stale,\n  The client MAY re-fetch every time the result is needed.\n- If positive, the client SHOULD consider the result fresh for this many\n  milliseconds after receiving the response."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CacheableResultClassFields = CacheableResultOpenFields

export class CacheableResult extends Schema.Class<CacheableResult>("mcp/generated/2026-07-28/CacheableResult")(
CacheableResultClassFields as unknown as Schema.Struct<typeof CacheableResultOpenFields.fields>, {
  "description": "A result that supports a time-to-live (TTL) hint for client-side caching."
}
) {
  constructor(props: Schema.Schema.Type<typeof CacheableResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const RequestId = Schema.Union(Schema.String, Schema.Int).annotations({
  "description": "A uniquely identifying ID for a request in JSON-RPC."
})

const ClientCapabilitiesOpenFields = Schema.Struct({
  "elicitation": optional(Schema.Struct({ "form": optional(JSONObject), "url": optional(JSONObject) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Present if the client supports elicitation from the server."
})),
  "experimental": optional(typedObject({  }, [] as const, JSONObject).annotations({
  "description": "Experimental, non-standard capabilities that the client supports."
})),
  "extensions": optional(typedObject({  }, [] as const, JSONObject).annotations({
  "description": "Optional MCP extensions that the client supports. Keys are extension identifiers\n(e.g., \"io.modelcontextprotocol/oauth-client-credentials\"), and values are\nper-extension settings objects. An empty object indicates support with no settings.\n\nKeys MUST follow the {@link MetaObject`_meta` key naming rules}, with a\nmandatory prefix."
})),
  "roots": optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
  "description": "Present if the client supports listing roots."
})),
  "sampling": optional(Schema.Struct({ "context": optional(JSONObject.annotations({
  "description": "Whether the client supports context inclusion via `includeContext` parameter.\nIf not declared, servers SHOULD only use `includeContext: \"none\"` (or omit it)."
})), "tools": optional(JSONObject.annotations({
  "description": "Whether the client supports tool use via `tools` and `toolChoice` parameters."
})) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Present if the client supports sampling from an LLM."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ClientCapabilitiesClassFields = ClientCapabilitiesOpenFields

export class ClientCapabilities extends Schema.Class<ClientCapabilities>("mcp/generated/2026-07-28/ClientCapabilities")(
ClientCapabilitiesClassFields as unknown as Schema.Struct<typeof ClientCapabilitiesOpenFields.fields>, {
  "description": "Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities."
}
) {
  constructor(props: Schema.Schema.Type<typeof ClientCapabilitiesOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const LoggingLevel = Schema.Literal("alert", "critical", "debug", "emergency", "error", "info", "notice", "warning").annotations({
  "description": "The severity of a log message.\n\nThese map to syslog message severities, as specified in RFC-5424:\nhttps://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1"
})

export const ProgressToken = Schema.Union(Schema.String, Schema.Int).annotations({
  "description": "A progress token, used to associate progress notifications with the original request."
})

export const RequestMetaObject = typedObject({ "io.modelcontextprotocol/clientCapabilities": ClientCapabilities.annotations({
  "description": "The client's capabilities for this specific request. Required.\n\nCapabilities are declared per-request rather than once at initialization;\nan empty object means the client supports no optional capabilities.\nServers MUST NOT infer capabilities from prior requests."
}), "io.modelcontextprotocol/clientInfo": optional(Implementation.annotations({
  "description": "Identifies the client software making the request. Clients SHOULD\ninclude this field on every request unless specifically configured not\nto do so.\n\nThe {@link Implementation} schema requires `name` and `version`; other\nfields are optional.\n\nThe value is self-reported by the client and is not verified by the\nprotocol. It is intended for display, logging, and debugging. Servers\nSHOULD NOT use it to change their behavior, and SHOULD NOT rely on it for\nsecurity decisions."
})), "io.modelcontextprotocol/logLevel": optional(LoggingLevel.annotations({
  "description": "The desired log level for this request. Optional.\n\nIf absent, the server MUST NOT send any {@link LoggingMessageNotificationnotifications/message}\nnotifications for this request. The client opts in to log messages by\nexplicitly setting a level. Replaces the former `logging/setLevel` RPC."
})), "io.modelcontextprotocol/protocolVersion": Schema.String.annotations({
  "description": "The MCP Protocol Version being used for this request. Required.\n\nFor the HTTP transport, this value MUST match the `MCP-Protocol-Version`\nheader; otherwise the server MUST return a `400 Bad Request`. If the\nserver does not support the requested version, it MUST return an\n{@link UnsupportedProtocolVersionError}."
}), "progressToken": optional(ProgressToken.annotations({
  "description": "If specified, the caller is requesting out-of-band progress notifications for this request (as represented by {@link ProgressNotificationnotifications/progress}). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications."
})) }, [
  "io.modelcontextprotocol/clientCapabilities",
  "io.modelcontextprotocol/clientInfo",
  "io.modelcontextprotocol/logLevel",
  "io.modelcontextprotocol/protocolVersion",
  "progressToken"
] as const, Schema.Unknown).annotations({
  "description": "Extends {@link MetaObject} with additional request-specific fields. All key naming rules from `MetaObject` apply."
})

const TextContentOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(Annotations.annotations({
  "description": "Optional annotations for the client."
})),
  "text": Schema.String.annotations({
  "description": "The text content of the message."
}),
  "type": Schema.Literal("text")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const TextContentClassFields = TextContentOpenFields

export class TextContent extends Schema.Class<TextContent>("mcp/generated/2026-07-28/TextContent")(
TextContentClassFields as unknown as Schema.Struct<typeof TextContentOpenFields.fields>, {
  "description": "Text provided to or from an LLM."
}
) {
  constructor(props: Schema.Schema.Type<typeof TextContentOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ImageContentOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(Annotations.annotations({
  "description": "Optional annotations for the client."
})),
  "data": Schema.Uint8ArrayFromBase64.annotations({
  "description": "The base64-encoded image data."
}),
  "mimeType": Schema.String.annotations({
  "description": "The MIME type of the image. Different providers may support different image types."
}),
  "type": Schema.Literal("image")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ImageContentClassFields = ImageContentOpenFields

export class ImageContent extends Schema.Class<ImageContent>("mcp/generated/2026-07-28/ImageContent")(
ImageContentClassFields as unknown as Schema.Struct<typeof ImageContentOpenFields.fields>, {
  "description": "An image provided to or from an LLM."
}
) {
  constructor(props: Schema.Schema.Type<typeof ImageContentOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ToolUseContentOpenFields = Schema.Struct({
  "_meta": optional(MetaObject.annotations({
  "description": "Optional metadata about the tool use. Clients SHOULD preserve this field when\nincluding tool uses in subsequent sampling requests to enable caching optimizations."
})),
  "id": Schema.String.annotations({
  "description": "A unique identifier for this tool use.\n\nThis ID is used to match tool results to their corresponding tool uses."
}),
  "input": typedObject({  }, [] as const, Schema.Unknown).annotations({
  "description": "The arguments to pass to the tool, conforming to the tool's input schema."
}),
  "name": Schema.String.annotations({
  "description": "The name of the tool to call."
}),
  "type": Schema.Literal("tool_use")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ToolUseContentClassFields = ToolUseContentOpenFields

export class ToolUseContent extends Schema.Class<ToolUseContent>("mcp/generated/2026-07-28/ToolUseContent")(
ToolUseContentClassFields as unknown as Schema.Struct<typeof ToolUseContentOpenFields.fields>, {
  "description": "A request from the assistant to call a tool."
}
) {
  constructor(props: Schema.Schema.Type<typeof ToolUseContentOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceLinkOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(Annotations.annotations({
  "description": "Optional annotations for the client."
})),
  "description": optional(Schema.String.annotations({
  "description": "A description of what this resource represents.\n\nThis can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a \"hint\" to the model."
})),
  "icons": optional(Schema.Array(Icon).annotations({
  "description": "Optional set of sized icons that the client can display in a user interface.\n\nClients that support rendering icons MUST support at least the following MIME types:\n- `image/png` - PNG images (safe, universal compatibility)\n- `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)\n\nClients that support rendering icons SHOULD also support:\n- `image/svg+xml` - SVG images (scalable but requires security precautions)\n- `image/webp` - WebP images (modern, efficient format)"
})),
  "mimeType": optional(Schema.String.annotations({
  "description": "The MIME type of this resource, if known."
})),
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "size": optional(Schema.Int.annotations({
  "description": "The size of the raw resource content, in bytes (i.e., before base64 encoding or any tokenization), if known.\n\nThis can be used by Hosts to display file sizes and estimate context window usage."
})),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
})),
  "type": Schema.Literal("resource_link"),
  "uri": Schema.String.annotations({
  "description": "The URI of this resource."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceLinkClassFields = ResourceLinkOpenFields

export class ResourceLink extends Schema.Class<ResourceLink>("mcp/generated/2026-07-28/ResourceLink")(
ResourceLinkClassFields as unknown as Schema.Struct<typeof ResourceLinkOpenFields.fields>, {
  "description": "A resource that the server is capable of reading, included in a prompt or tool call result.\n\nNote: resource links returned by tools are not guaranteed to appear in the results of {@link ListResourcesRequestresources/list} requests."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceLinkOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const TextResourceContentsOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "mimeType": optional(Schema.String.annotations({
  "description": "The MIME type of this resource, if known."
})),
  "text": Schema.String.annotations({
  "description": "The text of the item. This must only be set if the item can actually be represented as text (not binary data)."
}),
  "uri": Schema.String.annotations({
  "description": "The URI of this resource."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const TextResourceContentsClassFields = TextResourceContentsOpenFields

export class TextResourceContents extends Schema.Class<TextResourceContents>("mcp/generated/2026-07-28/TextResourceContents")(
TextResourceContentsClassFields as unknown as Schema.Struct<typeof TextResourceContentsOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof TextResourceContentsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const EmbeddedResourceOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(Annotations.annotations({
  "description": "Optional annotations for the client."
})),
  "resource": Schema.Union(TextResourceContents, BlobResourceContents),
  "type": Schema.Literal("resource")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const EmbeddedResourceClassFields = EmbeddedResourceOpenFields

export class EmbeddedResource extends Schema.Class<EmbeddedResource>("mcp/generated/2026-07-28/EmbeddedResource")(
EmbeddedResourceClassFields as unknown as Schema.Struct<typeof EmbeddedResourceOpenFields.fields>, {
  "description": "The contents of a resource, embedded into a prompt or tool call result.\n\nIt is up to the client how best to render embedded resources for the benefit\nof the LLM and/or the user."
}
) {
  constructor(props: Schema.Schema.Type<typeof EmbeddedResourceOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ContentBlock = Schema.Union(TextContent, ImageContent, AudioContent, ResourceLink, EmbeddedResource)

const ToolResultContentOpenFields = Schema.Struct({
  "_meta": optional(MetaObject.annotations({
  "description": "Optional metadata about the tool result. Clients SHOULD preserve this field when\nincluding tool results in subsequent sampling requests to enable caching optimizations."
})),
  "content": Schema.Array(ContentBlock).annotations({
  "description": "The unstructured result content of the tool use.\n\nThis has the same format as {@link CallToolResult.content} and can include text, images,\naudio, resource links, and embedded resources."
}),
  "isError": optional(Schema.Boolean.annotations({
  "description": "Whether the tool use resulted in an error.\n\nIf true, the content typically describes the error that occurred.\nDefault: false"
})),
  "structuredContent": optional(Schema.Unknown.annotations({
  "description": "An optional structured result value.\n\nThis can be any JSON value (object, array, string, number, boolean, or null).\nIf the tool defined an {@link Tool.outputSchema}, this SHOULD conform to that schema."
})),
  "toolUseId": Schema.String.annotations({
  "description": "The ID of the tool use this result corresponds to.\n\nThis MUST match the ID from a previous {@link ToolUseContent}."
}),
  "type": Schema.Literal("tool_result")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ToolResultContentClassFields = ToolResultContentOpenFields

export class ToolResultContent extends Schema.Class<ToolResultContent>("mcp/generated/2026-07-28/ToolResultContent")(
ToolResultContentClassFields as unknown as Schema.Struct<typeof ToolResultContentOpenFields.fields>, {
  "description": "The result of a tool use, provided by the user back to the assistant."
}
) {
  constructor(props: Schema.Schema.Type<typeof ToolResultContentOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const SamplingMessageContentBlock = Schema.Union(TextContent, ImageContent, AudioContent, ToolUseContent, ToolResultContent)

const CreateMessageResultOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "content": Schema.Union(TextContent, ImageContent, AudioContent, ToolUseContent, ToolResultContent, Schema.Array(SamplingMessageContentBlock)),
  "model": Schema.String.annotations({
  "description": "The name of the model that generated the message."
}),
  "role": Role,
  "stopReason": optional(Schema.String.annotations({
  "description": "The reason why sampling stopped, if known.\n\nStandard values:\n- `\"endTurn\"`: Natural end of the assistant's turn\n- `\"stopSequence\"`: A stop sequence was encountered\n- `\"maxTokens\"`: Maximum token limit was reached\n- `\"toolUse\"`: The model wants to use one or more tools\n\nThis field is an open string to allow for provider-specific stop reasons."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CreateMessageResultClassFields = CreateMessageResultOpenFields

export class CreateMessageResult extends Schema.Class<CreateMessageResult>("mcp/generated/2026-07-28/CreateMessageResult")(
CreateMessageResultClassFields as unknown as Schema.Struct<typeof CreateMessageResultOpenFields.fields>, {
  "description": "The result returned by the client for a {@link CreateMessageRequestsampling/createMessage} request.\nThe client should inform the user before returning the sampled message, to allow them\nto inspect the response (human in the loop) and decide whether to allow the server to see it."
}
) {
  constructor(props: Schema.Schema.Type<typeof CreateMessageResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const RootOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "name": optional(Schema.String.annotations({
  "description": "An optional name for the root. This can be used to provide a human-readable\nidentifier for the root, which may be useful for display purposes or for\nreferencing the root in other parts of the application."
})),
  "uri": Schema.String.annotations({
  "description": "The URI identifying the root. This *must* start with `file://` for now.\nThis restriction may be relaxed in future versions of the protocol to allow\nother URI schemes."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const RootClassFields = RootOpenFields

export class Root extends Schema.Class<Root>("mcp/generated/2026-07-28/Root")(
RootClassFields as unknown as Schema.Struct<typeof RootOpenFields.fields>, {
  "description": "Represents a root directory or file that the server can operate on."
}
) {
  constructor(props: Schema.Schema.Type<typeof RootOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListRootsResultOpenFields = Schema.Struct({
  "roots": Schema.Array(Root)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListRootsResultClassFields = ListRootsResultOpenFields

export class ListRootsResult extends Schema.Class<ListRootsResult>("mcp/generated/2026-07-28/ListRootsResult")(
ListRootsResultClassFields as unknown as Schema.Struct<typeof ListRootsResultOpenFields.fields>, {
  "description": "The result returned by the client for a {@link ListRootsRequestroots/list} request.\nThis result contains an array of {@link Root} objects, each representing a root directory\nor file that the server can operate on."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListRootsResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ElicitResultOpenFields = Schema.Struct({
  "action": Schema.Literal("accept", "cancel", "decline").annotations({
  "description": "The user action in response to the elicitation.\n- `\"accept\"`: User submitted the form/confirmed the action\n- `\"decline\"`: User explicitly declined the action\n- `\"cancel\"`: User dismissed without making an explicit choice"
}),
  "content": optional(typedObject({  }, [] as const, Schema.Union(Schema.Array(Schema.String), Schema.Union(Schema.String, Schema.Int, Schema.Boolean))).annotations({
  "description": "The submitted form data, only present when action is `\"accept\"` and mode was `\"form\"`.\nContains values matching the requested schema.\nOmitted for out-of-band mode responses."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ElicitResultClassFields = ElicitResultOpenFields

export class ElicitResult extends Schema.Class<ElicitResult>("mcp/generated/2026-07-28/ElicitResult")(
ElicitResultClassFields as unknown as Schema.Struct<typeof ElicitResultOpenFields.fields>, {
  "description": "The result returned by the client for an {@link ElicitRequestelicitation/create} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ElicitResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const InputResponse = Schema.Union(CreateMessageResult, ListRootsResult, ElicitResult)

export const InputResponses = typedObject({  }, [] as const, InputResponse).annotations({
  "description": "A map of client responses to server-initiated requests.\nKeys correspond to the keys in the {@link InputRequests} map;\nvalues are the client's result for each request."
})

const CallToolRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "arguments": optional(typedObject({  }, [] as const, Schema.Unknown).annotations({
  "description": "Arguments to use for the tool call."
})),
  "inputResponses": optional(InputResponses),
  "name": Schema.String.annotations({
  "description": "The name of the tool."
}),
  "requestState": optional(Schema.String)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CallToolRequestParamsClassFields = CallToolRequestParamsOpenFields

export class CallToolRequestParams extends Schema.Class<CallToolRequestParams>("mcp/generated/2026-07-28/CallToolRequestParams")(
CallToolRequestParamsClassFields as unknown as Schema.Struct<typeof CallToolRequestParamsOpenFields.fields>, {
  "description": "Parameters for a `tools/call` request."
}
) {
  constructor(props: Schema.Schema.Type<typeof CallToolRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CallToolRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("tools/call"),
  "params": CallToolRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CallToolRequestClassFields = CallToolRequestOpenFields

export class CallToolRequest extends Schema.Class<CallToolRequest>("mcp/generated/2026-07-28/CallToolRequest")(
CallToolRequestClassFields as unknown as Schema.Struct<typeof CallToolRequestOpenFields.fields>, {
  "description": "Used by the client to invoke a tool provided by the server."
}
) {
  constructor(props: Schema.Schema.Type<typeof CallToolRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CallToolResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "content": Schema.Array(ContentBlock).annotations({
  "description": "A list of content objects that represent the unstructured result of the tool call."
}),
  "isError": optional(Schema.Boolean.annotations({
  "description": "Whether the tool call ended in an error.\n\nIf not set, this is assumed to be false (the call was successful).\n\nAny errors that originate from the tool SHOULD be reported inside the result\nobject, with `isError` set to true, _not_ as an MCP protocol-level error\nresponse. Otherwise, the LLM would not be able to see that an error occurred\nand self-correct.\n\nHowever, any errors in _finding_ the tool, an error indicating that the\nserver does not support tool calls, or any other exceptional conditions,\nshould be reported as an MCP error response."
})),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "structuredContent": optional(Schema.Unknown.annotations({
  "description": "An optional JSON value that represents the structured result of the tool call.\n\nThis can be any JSON value (object, array, string, number, boolean, or null)\nthat conforms to the tool's outputSchema if one is defined."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CallToolResultClassFields = CallToolResultOpenFields

export class CallToolResult extends Schema.Class<CallToolResult>("mcp/generated/2026-07-28/CallToolResult")(
CallToolResultClassFields as unknown as Schema.Struct<typeof CallToolResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link CallToolRequesttools/call} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof CallToolResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const SamplingMessageOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "content": Schema.Union(TextContent, ImageContent, AudioContent, ToolUseContent, ToolResultContent, Schema.Array(SamplingMessageContentBlock)),
  "role": Role
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const SamplingMessageClassFields = SamplingMessageOpenFields

export class SamplingMessage extends Schema.Class<SamplingMessage>("mcp/generated/2026-07-28/SamplingMessage")(
SamplingMessageClassFields as unknown as Schema.Struct<typeof SamplingMessageOpenFields.fields>, {
  "description": "Describes a message issued to or received from an LLM API."
}
) {
  constructor(props: Schema.Schema.Type<typeof SamplingMessageOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ModelHintOpenFields = Schema.Struct({
  "name": optional(Schema.String.annotations({
  "description": "A hint for a model name.\n\nThe client SHOULD treat this as a substring of a model name; for example:\n - `claude-3-5-sonnet` should match `claude-3-5-sonnet-20241022`\n - `sonnet` should match `claude-3-5-sonnet-20241022`, `claude-3-sonnet-20240229`, etc.\n - `claude` should match any Claude model\n\nThe client MAY also map the string to a different provider's model name or a different model family, as long as it fills a similar niche; for example:\n - `gemini-1.5-flash` could match `claude-3-haiku-20240307`"
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ModelHintClassFields = ModelHintOpenFields

export class ModelHint extends Schema.Class<ModelHint>("mcp/generated/2026-07-28/ModelHint")(
ModelHintClassFields as unknown as Schema.Struct<typeof ModelHintOpenFields.fields>, {
  "description": "Hints to use for model selection.\n\nKeys not declared here are currently left unspecified by the spec and are up\nto the client to interpret."
}
) {
  constructor(props: Schema.Schema.Type<typeof ModelHintOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ModelPreferencesOpenFields = Schema.Struct({
  "costPriority": optional(withEncodedBounds(Schema.Finite, {
  "minimum": 0,
  "maximum": 1
}).annotations({
  "description": "How much to prioritize cost when selecting a model. A value of 0 means cost\nis not important, while a value of 1 means cost is the most important\nfactor."
})),
  "hints": optional(Schema.Array(ModelHint).annotations({
  "description": "Optional hints to use for model selection.\n\nIf multiple hints are specified, the client MUST evaluate them in order\n(such that the first match is taken).\n\nThe client SHOULD prioritize these hints over the numeric priorities, but\nMAY still use the priorities to select from ambiguous matches."
})),
  "intelligencePriority": optional(withEncodedBounds(Schema.Finite, {
  "minimum": 0,
  "maximum": 1
}).annotations({
  "description": "How much to prioritize intelligence and capabilities when selecting a\nmodel. A value of 0 means intelligence is not important, while a value of 1\nmeans intelligence is the most important factor."
})),
  "speedPriority": optional(withEncodedBounds(Schema.Finite, {
  "minimum": 0,
  "maximum": 1
}).annotations({
  "description": "How much to prioritize sampling speed (latency) when selecting a model. A\nvalue of 0 means speed is not important, while a value of 1 means speed is\nthe most important factor."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ModelPreferencesClassFields = ModelPreferencesOpenFields

export class ModelPreferences extends Schema.Class<ModelPreferences>("mcp/generated/2026-07-28/ModelPreferences")(
ModelPreferencesClassFields as unknown as Schema.Struct<typeof ModelPreferencesOpenFields.fields>, {
  "description": "The server's preferences for model selection, requested of the client during sampling.\n\nBecause LLMs can vary along multiple dimensions, choosing the \"best\" model is\nrarely straightforward.  Different models excel in different areas—some are\nfaster but less capable, others are more capable but more expensive, and so\non. This interface allows servers to express their priorities across multiple\ndimensions to help clients make an appropriate selection for their use case.\n\nThese preferences are always advisory. The client MAY ignore them. It is also\nup to the client to decide how to interpret these preferences and how to\nbalance them against other considerations."
}
) {
  constructor(props: Schema.Schema.Type<typeof ModelPreferencesOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ToolChoiceOpenFields = Schema.Struct({
  "mode": optional(Schema.Literal("auto", "none", "required").annotations({
  "description": "Controls the tool use ability of the model:\n- `\"auto\"`: Model decides whether to use tools (default)\n- `\"required\"`: Model MUST use at least one tool before completing\n- `\"none\"`: Model MUST NOT use any tools"
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ToolChoiceClassFields = ToolChoiceOpenFields

export class ToolChoice extends Schema.Class<ToolChoice>("mcp/generated/2026-07-28/ToolChoice")(
ToolChoiceClassFields as unknown as Schema.Struct<typeof ToolChoiceOpenFields.fields>, {
  "description": "Controls tool selection behavior for sampling requests."
}
) {
  constructor(props: Schema.Schema.Type<typeof ToolChoiceOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ToolAnnotationsOpenFields = Schema.Struct({
  "destructiveHint": optional(Schema.Boolean.annotations({
  "description": "If true, the tool may perform destructive updates to its environment.\nIf false, the tool performs only additive updates.\n\n(This property is meaningful only when `readOnlyHint == false`)\n\nDefault: true"
})),
  "idempotentHint": optional(Schema.Boolean.annotations({
  "description": "If true, calling the tool repeatedly with the same arguments\nwill have no additional effect on its environment.\n\n(This property is meaningful only when `readOnlyHint == false`)\n\nDefault: false"
})),
  "openWorldHint": optional(Schema.Boolean.annotations({
  "description": "If true, this tool may interact with an \"open world\" of external\nentities. If false, the tool's domain of interaction is closed.\nFor example, the world of a web search tool is open, whereas that\nof a memory tool is not.\n\nDefault: true"
})),
  "readOnlyHint": optional(Schema.Boolean.annotations({
  "description": "If true, the tool does not modify its environment.\n\nDefault: false"
})),
  "title": optional(Schema.String.annotations({
  "description": "A human-readable title for the tool."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ToolAnnotationsClassFields = ToolAnnotationsOpenFields

export class ToolAnnotations extends Schema.Class<ToolAnnotations>("mcp/generated/2026-07-28/ToolAnnotations")(
ToolAnnotationsClassFields as unknown as Schema.Struct<typeof ToolAnnotationsOpenFields.fields>, {
  "description": "Additional properties describing a {@link Tool} to clients.\n\nNOTE: all properties in `ToolAnnotations` are **hints**.\nThey are not guaranteed to provide a faithful description of\ntool behavior (including descriptive properties like `title`).\n\nClients should never make tool use decisions based on `ToolAnnotations`\nreceived from untrusted servers."
}
) {
  constructor(props: Schema.Schema.Type<typeof ToolAnnotationsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ToolOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(ToolAnnotations.annotations({
  "description": "Optional additional tool information.\n\nDisplay name precedence order is: `title`, `annotations.title`, then `name`."
})),
  "description": optional(Schema.String.annotations({
  "description": "A human-readable description of the tool.\n\nThis can be used by clients to improve the LLM's understanding of available tools. It can be thought of like a \"hint\" to the model."
})),
  "icons": optional(Schema.Array(Icon).annotations({
  "description": "Optional set of sized icons that the client can display in a user interface.\n\nClients that support rendering icons MUST support at least the following MIME types:\n- `image/png` - PNG images (safe, universal compatibility)\n- `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)\n\nClients that support rendering icons SHOULD also support:\n- `image/svg+xml` - SVG images (scalable but requires security precautions)\n- `image/webp` - WebP images (modern, efficient format)"
})),
  "inputSchema": typedObject({ "$schema": optional(Schema.String), "type": Schema.Literal("object") }, [
  "$schema",
  "type"
] as const, Schema.Unknown).annotations({
  "description": "A JSON Schema object defining the expected parameters for the tool.\n\nTool arguments are always JSON objects, so `type: \"object\"` is required at the root.\nBeyond that, any JSON Schema 2020-12 keyword may appear alongside `type` — including\ncomposition keywords (`oneOf`, `anyOf`, `allOf`, `not`), conditional keywords\n(`if`/`then`/`else`), reference keywords (`$ref`, `$defs`, `$anchor`), and any other\nstandard validation or annotation keywords.\n\nProperty schemas may carry an `x-mcp-header` annotation to mirror the\nargument value into an HTTP header on the Streamable HTTP transport. See\nthe Streamable HTTP transport specification for the validity and\nextraction rules.\n\nDefaults to JSON Schema 2020-12 when no explicit `$schema` is provided."
}),
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "outputSchema": optional(typedObject({ "$schema": optional(Schema.String) }, [
  "$schema"
] as const, Schema.Unknown).annotations({
  "description": "An optional JSON Schema object defining the structure of the tool's output returned in\nthe structuredContent field of a {@link CallToolResult}. This can be any valid JSON Schema 2020-12.\n\nDefaults to JSON Schema 2020-12 when no explicit `$schema` is provided."
})),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ToolClassFields = ToolOpenFields

export class Tool extends Schema.Class<Tool>("mcp/generated/2026-07-28/Tool")(
ToolClassFields as unknown as Schema.Struct<typeof ToolOpenFields.fields>, {
  "description": "Definition for a tool the client can call."
}
) {
  constructor(props: Schema.Schema.Type<typeof ToolOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CreateMessageRequestParamsOpenFields = Schema.Struct({
  "includeContext": optional(Schema.Literal("allServers", "none", "thisServer").annotations({
  "description": "A request to include context from one or more MCP servers (including the caller), to be attached to the prompt.\nThe client MAY ignore this request.\n\nDefault is `\"none\"`. The values `\"thisServer\"` and `\"allServers\"` are deprecated (SEP-2596): servers SHOULD\nomit this field or use `\"none\"`, and SHOULD only use the deprecated values if the client declares\n{@link ClientCapabilities.sampling.context}."
})),
  "maxTokens": Schema.Int.annotations({
  "description": "The requested maximum number of tokens to sample (to prevent runaway completions).\n\nThe client MAY choose to sample fewer tokens than the requested maximum."
}),
  "messages": Schema.Array(SamplingMessage),
  "metadata": optional(JSONObject.annotations({
  "description": "Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific."
})),
  "modelPreferences": optional(ModelPreferences.annotations({
  "description": "The server's preferences for which model to select. The client MAY ignore these preferences."
})),
  "stopSequences": optional(Schema.Array(Schema.String)),
  "systemPrompt": optional(Schema.String.annotations({
  "description": "An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt."
})),
  "temperature": optional(Schema.Finite),
  "toolChoice": optional(ToolChoice.annotations({
  "description": "Controls how the model uses tools.\nThe client MUST return an error if this field is provided but {@link ClientCapabilities.sampling.tools} is not declared.\nDefault is `{ mode: \"auto\" }`."
})),
  "tools": optional(Schema.Array(Tool).annotations({
  "description": "Tools that the model may use during generation.\nThe client MUST return an error if this field is provided but {@link ClientCapabilities.sampling.tools} is not declared."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CreateMessageRequestParamsClassFields = CreateMessageRequestParamsOpenFields

export class CreateMessageRequestParams extends Schema.Class<CreateMessageRequestParams>("mcp/generated/2026-07-28/CreateMessageRequestParams")(
CreateMessageRequestParamsClassFields as unknown as Schema.Struct<typeof CreateMessageRequestParamsOpenFields.fields>, {
  "description": "Parameters for a `sampling/createMessage` request."
}
) {
  constructor(props: Schema.Schema.Type<typeof CreateMessageRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CreateMessageRequestOpenFields = Schema.Struct({
  "method": Schema.Literal("sampling/createMessage"),
  "params": CreateMessageRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CreateMessageRequestClassFields = CreateMessageRequestOpenFields

export class CreateMessageRequest extends Schema.Class<CreateMessageRequest>("mcp/generated/2026-07-28/CreateMessageRequest")(
CreateMessageRequestClassFields as unknown as Schema.Struct<typeof CreateMessageRequestOpenFields.fields>, {
  "description": "A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it."
}
) {
  constructor(props: Schema.Schema.Type<typeof CreateMessageRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ListRootsRequestParams = Schema.Struct({ "_meta": optional(MetaObject) }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))

const ListRootsRequestOpenFields = Schema.Struct({
  "method": Schema.Literal("roots/list"),
  "params": optional(ListRootsRequestParams)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListRootsRequestClassFields = ListRootsRequestOpenFields

export class ListRootsRequest extends Schema.Class<ListRootsRequest>("mcp/generated/2026-07-28/ListRootsRequest")(
ListRootsRequestClassFields as unknown as Schema.Struct<typeof ListRootsRequestOpenFields.fields>, {
  "description": "Sent from the server to request a list of root URIs from the client. Roots allow\nservers to ask for specific directories or files to operate on. A common example\nfor roots is providing a set of repositories or directories a server should operate\non.\n\nThis request is typically used when the server needs to understand the file system\nstructure or access specific locations that the client has permission to read from."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListRootsRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const StringSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.String),
  "description": optional(Schema.String),
  "format": optional(Schema.Literal("date", "date-time", "email", "uri")),
  "maxLength": optional(Schema.Int),
  "minLength": optional(Schema.Int),
  "title": optional(Schema.String),
  "type": Schema.Literal("string")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const StringSchemaClassFields = StringSchemaOpenFields

export class StringSchema extends Schema.Class<StringSchema>("mcp/generated/2026-07-28/StringSchema")(
StringSchemaClassFields as unknown as Schema.Struct<typeof StringSchemaOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof StringSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const NumberSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.Finite),
  "description": optional(Schema.String),
  "maximum": optional(Schema.Finite),
  "minimum": optional(Schema.Finite),
  "title": optional(Schema.String),
  "type": Schema.Literal("integer", "number")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const NumberSchemaClassFields = NumberSchemaOpenFields

export class NumberSchema extends Schema.Class<NumberSchema>("mcp/generated/2026-07-28/NumberSchema")(
NumberSchemaClassFields as unknown as Schema.Struct<typeof NumberSchemaOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof NumberSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const UntitledSingleSelectEnumSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.String.annotations({
  "description": "Optional default value."
})),
  "description": optional(Schema.String.annotations({
  "description": "Optional description for the enum field."
})),
  "enum": Schema.Array(Schema.String).annotations({
  "description": "Array of enum values to choose from."
}),
  "title": optional(Schema.String.annotations({
  "description": "Optional title for the enum field."
})),
  "type": Schema.Literal("string")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const UntitledSingleSelectEnumSchemaClassFields = UntitledSingleSelectEnumSchemaOpenFields

export class UntitledSingleSelectEnumSchema extends Schema.Class<UntitledSingleSelectEnumSchema>("mcp/generated/2026-07-28/UntitledSingleSelectEnumSchema")(
UntitledSingleSelectEnumSchemaClassFields as unknown as Schema.Struct<typeof UntitledSingleSelectEnumSchemaOpenFields.fields>, {
  "description": "Schema for single-selection enumeration without display titles for options."
}
) {
  constructor(props: Schema.Schema.Type<typeof UntitledSingleSelectEnumSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const TitledSingleSelectEnumSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.String.annotations({
  "description": "Optional default value."
})),
  "description": optional(Schema.String.annotations({
  "description": "Optional description for the enum field."
})),
  "oneOf": Schema.Array(Schema.Struct({ "const": Schema.String.annotations({
  "description": "The enum value."
}), "title": Schema.String.annotations({
  "description": "Display label for this option."
}) }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))).annotations({
  "description": "Array of enum options with values and display labels."
}),
  "title": optional(Schema.String.annotations({
  "description": "Optional title for the enum field."
})),
  "type": Schema.Literal("string")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const TitledSingleSelectEnumSchemaClassFields = TitledSingleSelectEnumSchemaOpenFields

export class TitledSingleSelectEnumSchema extends Schema.Class<TitledSingleSelectEnumSchema>("mcp/generated/2026-07-28/TitledSingleSelectEnumSchema")(
TitledSingleSelectEnumSchemaClassFields as unknown as Schema.Struct<typeof TitledSingleSelectEnumSchemaOpenFields.fields>, {
  "description": "Schema for single-selection enumeration with display titles for each option."
}
) {
  constructor(props: Schema.Schema.Type<typeof TitledSingleSelectEnumSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const UntitledMultiSelectEnumSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.Array(Schema.String).annotations({
  "description": "Optional default value."
})),
  "description": optional(Schema.String.annotations({
  "description": "Optional description for the enum field."
})),
  "items": Schema.Struct({ "enum": Schema.Array(Schema.String).annotations({
  "description": "Array of enum values to choose from."
}), "type": Schema.Literal("string") }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Schema for the array items."
}),
  "maxItems": optional(Schema.Int.annotations({
  "description": "Maximum number of items to select."
})),
  "minItems": optional(Schema.Int.annotations({
  "description": "Minimum number of items to select."
})),
  "title": optional(Schema.String.annotations({
  "description": "Optional title for the enum field."
})),
  "type": Schema.Literal("array")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const UntitledMultiSelectEnumSchemaClassFields = UntitledMultiSelectEnumSchemaOpenFields

export class UntitledMultiSelectEnumSchema extends Schema.Class<UntitledMultiSelectEnumSchema>("mcp/generated/2026-07-28/UntitledMultiSelectEnumSchema")(
UntitledMultiSelectEnumSchemaClassFields as unknown as Schema.Struct<typeof UntitledMultiSelectEnumSchemaOpenFields.fields>, {
  "description": "Schema for multiple-selection enumeration without display titles for options."
}
) {
  constructor(props: Schema.Schema.Type<typeof UntitledMultiSelectEnumSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const TitledMultiSelectEnumSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.Array(Schema.String).annotations({
  "description": "Optional default value."
})),
  "description": optional(Schema.String.annotations({
  "description": "Optional description for the enum field."
})),
  "items": Schema.Struct({ "anyOf": Schema.Array(Schema.Struct({ "const": Schema.String.annotations({
  "description": "The constant enum value."
}), "title": Schema.String.annotations({
  "description": "Display title for this option."
}) }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))).annotations({
  "description": "Array of enum options with values and display labels."
}) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Schema for array items with enum options and display labels."
}),
  "maxItems": optional(Schema.Int.annotations({
  "description": "Maximum number of items to select."
})),
  "minItems": optional(Schema.Int.annotations({
  "description": "Minimum number of items to select."
})),
  "title": optional(Schema.String.annotations({
  "description": "Optional title for the enum field."
})),
  "type": Schema.Literal("array")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const TitledMultiSelectEnumSchemaClassFields = TitledMultiSelectEnumSchemaOpenFields

export class TitledMultiSelectEnumSchema extends Schema.Class<TitledMultiSelectEnumSchema>("mcp/generated/2026-07-28/TitledMultiSelectEnumSchema")(
TitledMultiSelectEnumSchemaClassFields as unknown as Schema.Struct<typeof TitledMultiSelectEnumSchemaOpenFields.fields>, {
  "description": "Schema for multiple-selection enumeration with display titles for each option."
}
) {
  constructor(props: Schema.Schema.Type<typeof TitledMultiSelectEnumSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const LegacyTitledEnumSchemaOpenFields = Schema.Struct({
  "default": optional(Schema.String),
  "description": optional(Schema.String),
  "enum": Schema.Array(Schema.String),
  "enumNames": optional(Schema.Array(Schema.String).annotations({
  "description": "(Legacy) Display names for enum values.\nNon-standard according to JSON schema 2020-12."
})),
  "title": optional(Schema.String),
  "type": Schema.Literal("string")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const LegacyTitledEnumSchemaClassFields = LegacyTitledEnumSchemaOpenFields

export class LegacyTitledEnumSchema extends Schema.Class<LegacyTitledEnumSchema>("mcp/generated/2026-07-28/LegacyTitledEnumSchema")(
LegacyTitledEnumSchemaClassFields as unknown as Schema.Struct<typeof LegacyTitledEnumSchemaOpenFields.fields>, {
  "description": "Use {@link TitledSingleSelectEnumSchema} instead.\nThis interface will be removed in a future version."
}
) {
  constructor(props: Schema.Schema.Type<typeof LegacyTitledEnumSchemaOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const SingleSelectEnumSchema = Schema.Union(UntitledSingleSelectEnumSchema, TitledSingleSelectEnumSchema)

export const MultiSelectEnumSchema = Schema.Union(UntitledMultiSelectEnumSchema, TitledMultiSelectEnumSchema)

export const EnumSchema = Schema.Union(SingleSelectEnumSchema, MultiSelectEnumSchema, LegacyTitledEnumSchema)

export const PrimitiveSchemaDefinition = Schema.Union(StringSchema, NumberSchema, BooleanSchema, EnumSchema)

const ElicitRequestFormParamsOpenFields = Schema.Struct({
  "message": Schema.String.annotations({
  "description": "The message to present to the user describing what information is being requested."
}),
  "mode": optional(Schema.Literal("form").annotations({
  "description": "The elicitation mode."
})),
  "requestedSchema": Schema.Struct({ "$schema": optional(Schema.String), "properties": typedObject({  }, [] as const, PrimitiveSchemaDefinition), "required": optional(Schema.Array(Schema.String)), "type": Schema.Literal("object") }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "A restricted subset of JSON Schema.\nOnly top-level properties are allowed, without nesting."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ElicitRequestFormParamsClassFields = ElicitRequestFormParamsOpenFields

export class ElicitRequestFormParams extends Schema.Class<ElicitRequestFormParams>("mcp/generated/2026-07-28/ElicitRequestFormParams")(
ElicitRequestFormParamsClassFields as unknown as Schema.Struct<typeof ElicitRequestFormParamsOpenFields.fields>, {
  "description": "The parameters for a request to elicit non-sensitive information from the user via a form in the client."
}
) {
  constructor(props: Schema.Schema.Type<typeof ElicitRequestFormParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ElicitRequestURLParamsOpenFields = Schema.Struct({
  "message": Schema.String.annotations({
  "description": "The message to present to the user explaining why the interaction is needed."
}),
  "mode": Schema.Literal("url").annotations({
  "description": "The elicitation mode."
}),
  "url": Schema.String.annotations({
  "description": "The URL that the user should navigate to."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ElicitRequestURLParamsClassFields = ElicitRequestURLParamsOpenFields

export class ElicitRequestURLParams extends Schema.Class<ElicitRequestURLParams>("mcp/generated/2026-07-28/ElicitRequestURLParams")(
ElicitRequestURLParamsClassFields as unknown as Schema.Struct<typeof ElicitRequestURLParamsOpenFields.fields>, {
  "description": "The parameters for a request to elicit information from the user via a URL in the client."
}
) {
  constructor(props: Schema.Schema.Type<typeof ElicitRequestURLParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ElicitRequestParams = Schema.Union(ElicitRequestFormParams, ElicitRequestURLParams)

const ElicitRequestOpenFields = Schema.Struct({
  "method": Schema.Literal("elicitation/create"),
  "params": ElicitRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ElicitRequestClassFields = ElicitRequestOpenFields

export class ElicitRequest extends Schema.Class<ElicitRequest>("mcp/generated/2026-07-28/ElicitRequest")(
ElicitRequestClassFields as unknown as Schema.Struct<typeof ElicitRequestOpenFields.fields>, {
  "description": "A request from the server to elicit additional information from the user via the client."
}
) {
  constructor(props: Schema.Schema.Type<typeof ElicitRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const InputRequest = Schema.Union(CreateMessageRequest, ListRootsRequest, ElicitRequest)

export const InputRequests = typedObject({  }, [] as const, InputRequest).annotations({
  "description": "A map of server-initiated requests that the client must fulfill.\nKeys are server-assigned identifiers; values are the request objects."
})

const InputRequiredResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "inputRequests": optional(InputRequests),
  "requestState": optional(Schema.String),
  "resultType": Schema.Literal("input_required").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const InputRequiredResultClassFields = InputRequiredResultOpenFields.pipe(Schema.filter(
  (value) => value["inputRequests"] !== undefined || value["requestState"] !== undefined,
  { message: () => "At least one of `inputRequests` or `requestState` MUST be present." }
))

export class InputRequiredResult extends Schema.Class<InputRequiredResult>("mcp/generated/2026-07-28/InputRequiredResult")(
InputRequiredResultClassFields as unknown as Schema.Struct<typeof InputRequiredResultOpenFields.fields>, {
  "description": "An InputRequiredResult sent by the server to indicate that additional input is needed\nbefore the request can be completed.\n\nAt least one of `inputRequests` or `requestState` MUST be present."
}
) {
  constructor(props: Schema.Schema.Type<typeof InputRequiredResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CallToolResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": Schema.Union(InputRequiredResult, CallToolResult)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CallToolResultResponseClassFields = CallToolResultResponseOpenFields

export class CallToolResultResponse extends Schema.Class<CallToolResultResponse>("mcp/generated/2026-07-28/CallToolResultResponse")(
CallToolResultResponseClassFields as unknown as Schema.Struct<typeof CallToolResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link CallToolRequesttools/call} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof CallToolResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const NotificationMetaObject = typedObject({ "io.modelcontextprotocol/subscriptionId": optional(RequestId.annotations({
  "description": "Identifies the subscription stream a notification was delivered on. The\nserver MUST include this key on every notification delivered via a\n{@link SubscriptionsListenRequestsubscriptions/listen} stream, so the\nclient can correlate the notification with the originating subscription.\nThe key is absent on notifications not delivered via a subscription\nstream (e.g. progress notifications for an in-flight request), which is\nwhy it is optional here.\n\nThe value is the JSON-RPC ID of the `subscriptions/listen` request that\nopened the stream."
})) }, [
  "io.modelcontextprotocol/subscriptionId"
] as const, Schema.Unknown).annotations({
  "description": "Extends {@link MetaObject} with additional notification-specific fields. All key naming rules from `MetaObject` apply."
})

const CancelledNotificationParamsOpenFields = Schema.Struct({
  "_meta": optional(NotificationMetaObject),
  "reason": optional(Schema.String.annotations({
  "description": "An optional string describing the reason for the cancellation. This MAY be logged or presented to the user."
})),
  "requestId": RequestId.annotations({
  "description": "The ID of the request to cancel.\n\nThis MUST correspond to the ID of a request the client previously issued."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CancelledNotificationParamsClassFields = CancelledNotificationParamsOpenFields

export class CancelledNotificationParams extends Schema.Class<CancelledNotificationParams>("mcp/generated/2026-07-28/CancelledNotificationParams")(
CancelledNotificationParamsClassFields as unknown as Schema.Struct<typeof CancelledNotificationParamsOpenFields.fields>, {
  "description": "Parameters for a `notifications/cancelled` notification."
}
) {
  constructor(props: Schema.Schema.Type<typeof CancelledNotificationParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CancelledNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/cancelled"),
  "params": CancelledNotificationParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CancelledNotificationClassFields = CancelledNotificationOpenFields

export class CancelledNotification extends Schema.Class<CancelledNotification>("mcp/generated/2026-07-28/CancelledNotification")(
CancelledNotificationClassFields as unknown as Schema.Struct<typeof CancelledNotificationOpenFields.fields>, {
  "description": "This notification is sent by the client to indicate that it is cancelling a request it previously issued.\n\nOn stdio, the server also sends this notification, solely to terminate a {@link SubscriptionsListenRequestsubscriptions/listen} stream: it references the ID of the `subscriptions/listen` request that opened the stream. Servers MUST NOT use this notification to cancel any other request.\n\nThe request SHOULD still be in-flight, but due to communication latency, it is always possible that this notification MAY arrive after the request has already finished.\n\nThis notification indicates that the result will be unused, so any associated processing SHOULD cease."
}
) {
  constructor(props: Schema.Schema.Type<typeof CancelledNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ClientNotification = CancelledNotification

const RequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const RequestParamsClassFields = RequestParamsOpenFields

export class RequestParams extends Schema.Class<RequestParams>("mcp/generated/2026-07-28/RequestParams")(
RequestParamsClassFields as unknown as Schema.Struct<typeof RequestParamsOpenFields.fields>, {
  "description": "Common params for any request."
}
) {
  constructor(props: Schema.Schema.Type<typeof RequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const DiscoverRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("server/discover"),
  "params": RequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const DiscoverRequestClassFields = DiscoverRequestOpenFields

export class DiscoverRequest extends Schema.Class<DiscoverRequest>("mcp/generated/2026-07-28/DiscoverRequest")(
DiscoverRequestClassFields as unknown as Schema.Struct<typeof DiscoverRequestOpenFields.fields>, {
  "description": "A request from the client asking the server to advertise its supported\nprotocol versions, capabilities, and other metadata. Servers **MUST**\nimplement `server/discover`. Clients **MAY** call it but are not required\nto — version negotiation can also happen inline via per-request `_meta`."
}
) {
  constructor(props: Schema.Schema.Type<typeof DiscoverRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const PaginatedRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "cursor": optional(Schema.String.annotations({
  "description": "An opaque token representing the current pagination position.\nIf provided, the server should return results starting after this cursor."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PaginatedRequestParamsClassFields = PaginatedRequestParamsOpenFields

export class PaginatedRequestParams extends Schema.Class<PaginatedRequestParams>("mcp/generated/2026-07-28/PaginatedRequestParams")(
PaginatedRequestParamsClassFields as unknown as Schema.Struct<typeof PaginatedRequestParamsOpenFields.fields>, {
  "description": "Common params for paginated requests."
}
) {
  constructor(props: Schema.Schema.Type<typeof PaginatedRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListResourcesRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("resources/list"),
  "params": PaginatedRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListResourcesRequestClassFields = ListResourcesRequestOpenFields

export class ListResourcesRequest extends Schema.Class<ListResourcesRequest>("mcp/generated/2026-07-28/ListResourcesRequest")(
ListResourcesRequestClassFields as unknown as Schema.Struct<typeof ListResourcesRequestOpenFields.fields>, {
  "description": "Sent from the client to request a list of resources the server has."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListResourcesRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListResourceTemplatesRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("resources/templates/list"),
  "params": PaginatedRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListResourceTemplatesRequestClassFields = ListResourceTemplatesRequestOpenFields

export class ListResourceTemplatesRequest extends Schema.Class<ListResourceTemplatesRequest>("mcp/generated/2026-07-28/ListResourceTemplatesRequest")(
ListResourceTemplatesRequestClassFields as unknown as Schema.Struct<typeof ListResourceTemplatesRequestOpenFields.fields>, {
  "description": "Sent from the client to request a list of resource templates the server has."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListResourceTemplatesRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ReadResourceRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "inputResponses": optional(InputResponses),
  "requestState": optional(Schema.String),
  "uri": Schema.String.annotations({
  "description": "The URI of the resource. The URI can use any protocol; it is up to the server how to interpret it."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ReadResourceRequestParamsClassFields = ReadResourceRequestParamsOpenFields

export class ReadResourceRequestParams extends Schema.Class<ReadResourceRequestParams>("mcp/generated/2026-07-28/ReadResourceRequestParams")(
ReadResourceRequestParamsClassFields as unknown as Schema.Struct<typeof ReadResourceRequestParamsOpenFields.fields>, {
  "description": "Parameters for a `resources/read` request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ReadResourceRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ReadResourceRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("resources/read"),
  "params": ReadResourceRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ReadResourceRequestClassFields = ReadResourceRequestOpenFields

export class ReadResourceRequest extends Schema.Class<ReadResourceRequest>("mcp/generated/2026-07-28/ReadResourceRequest")(
ReadResourceRequestClassFields as unknown as Schema.Struct<typeof ReadResourceRequestOpenFields.fields>, {
  "description": "Sent from the client to the server, to read a specific resource URI."
}
) {
  constructor(props: Schema.Schema.Type<typeof ReadResourceRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const SubscriptionFilterOpenFields = Schema.Struct({
  "promptsListChanged": optional(Schema.Boolean.annotations({
  "description": "If true, receive {@link PromptListChangedNotificationnotifications/prompts/list_changed}."
})),
  "resourcesListChanged": optional(Schema.Boolean.annotations({
  "description": "If true, receive {@link ResourceListChangedNotificationnotifications/resources/list_changed}."
})),
  "resourceSubscriptions": optional(Schema.Array(Schema.String).annotations({
  "description": "Subscribe to {@link ResourceUpdatedNotificationnotifications/resources/updated} for these resource URIs.\nReplaces the former `resources/subscribe` RPC."
})),
  "toolsListChanged": optional(Schema.Boolean.annotations({
  "description": "If true, receive {@link ToolListChangedNotificationnotifications/tools/list_changed}."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const SubscriptionFilterClassFields = SubscriptionFilterOpenFields

export class SubscriptionFilter extends Schema.Class<SubscriptionFilter>("mcp/generated/2026-07-28/SubscriptionFilter")(
SubscriptionFilterClassFields as unknown as Schema.Struct<typeof SubscriptionFilterOpenFields.fields>, {
  "description": "The set of notification types a client may opt in to on a\n{@link SubscriptionsListenRequestsubscriptions/listen} request.\n\nEach notification type is **opt-in**; the server **MUST NOT** send\nnotification types the client has not explicitly requested here."
}
) {
  constructor(props: Schema.Schema.Type<typeof SubscriptionFilterOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const SubscriptionsListenRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "notifications": SubscriptionFilter.annotations({
  "description": "The notifications the client opts in to on this stream. The server\n**MUST NOT** send notification types the client has not explicitly\nrequested."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const SubscriptionsListenRequestParamsClassFields = SubscriptionsListenRequestParamsOpenFields

export class SubscriptionsListenRequestParams extends Schema.Class<SubscriptionsListenRequestParams>("mcp/generated/2026-07-28/SubscriptionsListenRequestParams")(
SubscriptionsListenRequestParamsClassFields as unknown as Schema.Struct<typeof SubscriptionsListenRequestParamsOpenFields.fields>, {
  "description": "Parameters for a {@link SubscriptionsListenRequestsubscriptions/listen} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof SubscriptionsListenRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const SubscriptionsListenRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("subscriptions/listen"),
  "params": SubscriptionsListenRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const SubscriptionsListenRequestClassFields = SubscriptionsListenRequestOpenFields

export class SubscriptionsListenRequest extends Schema.Class<SubscriptionsListenRequest>("mcp/generated/2026-07-28/SubscriptionsListenRequest")(
SubscriptionsListenRequestClassFields as unknown as Schema.Struct<typeof SubscriptionsListenRequestOpenFields.fields>, {
  "description": "Sent from the client to open a long-lived channel for receiving notifications\noutside the context of a specific request. Replaces the previous HTTP GET\nendpoint and ensures consistent behavior between HTTP and STDIO."
}
) {
  constructor(props: Schema.Schema.Type<typeof SubscriptionsListenRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListPromptsRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("prompts/list"),
  "params": PaginatedRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListPromptsRequestClassFields = ListPromptsRequestOpenFields

export class ListPromptsRequest extends Schema.Class<ListPromptsRequest>("mcp/generated/2026-07-28/ListPromptsRequest")(
ListPromptsRequestClassFields as unknown as Schema.Struct<typeof ListPromptsRequestOpenFields.fields>, {
  "description": "Sent from the client to request a list of prompts and prompt templates the server has."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListPromptsRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const GetPromptRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "arguments": optional(typedObject({  }, [] as const, Schema.String).annotations({
  "description": "Arguments to use for templating the prompt."
})),
  "inputResponses": optional(InputResponses),
  "name": Schema.String.annotations({
  "description": "The name of the prompt or prompt template."
}),
  "requestState": optional(Schema.String)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const GetPromptRequestParamsClassFields = GetPromptRequestParamsOpenFields

export class GetPromptRequestParams extends Schema.Class<GetPromptRequestParams>("mcp/generated/2026-07-28/GetPromptRequestParams")(
GetPromptRequestParamsClassFields as unknown as Schema.Struct<typeof GetPromptRequestParamsOpenFields.fields>, {
  "description": "Parameters for a `prompts/get` request."
}
) {
  constructor(props: Schema.Schema.Type<typeof GetPromptRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const GetPromptRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("prompts/get"),
  "params": GetPromptRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const GetPromptRequestClassFields = GetPromptRequestOpenFields

export class GetPromptRequest extends Schema.Class<GetPromptRequest>("mcp/generated/2026-07-28/GetPromptRequest")(
GetPromptRequestClassFields as unknown as Schema.Struct<typeof GetPromptRequestOpenFields.fields>, {
  "description": "Used by the client to get a prompt provided by the server."
}
) {
  constructor(props: Schema.Schema.Type<typeof GetPromptRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListToolsRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("tools/list"),
  "params": PaginatedRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListToolsRequestClassFields = ListToolsRequestOpenFields

export class ListToolsRequest extends Schema.Class<ListToolsRequest>("mcp/generated/2026-07-28/ListToolsRequest")(
ListToolsRequestClassFields as unknown as Schema.Struct<typeof ListToolsRequestOpenFields.fields>, {
  "description": "Sent from the client to request a list of tools the server has."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListToolsRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const PromptReferenceOpenFields = Schema.Struct({
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
})),
  "type": Schema.Literal("ref/prompt")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PromptReferenceClassFields = PromptReferenceOpenFields

export class PromptReference extends Schema.Class<PromptReference>("mcp/generated/2026-07-28/PromptReference")(
PromptReferenceClassFields as unknown as Schema.Struct<typeof PromptReferenceOpenFields.fields>, {
  "description": "Identifies a prompt."
}
) {
  constructor(props: Schema.Schema.Type<typeof PromptReferenceOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceTemplateReferenceOpenFields = Schema.Struct({
  "type": Schema.Literal("ref/resource"),
  "uri": Schema.String.annotations({
  "description": "The URI or URI template of the resource."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceTemplateReferenceClassFields = ResourceTemplateReferenceOpenFields

export class ResourceTemplateReference extends Schema.Class<ResourceTemplateReference>("mcp/generated/2026-07-28/ResourceTemplateReference")(
ResourceTemplateReferenceClassFields as unknown as Schema.Struct<typeof ResourceTemplateReferenceOpenFields.fields>, {
  "description": "A reference to a resource or resource template definition."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceTemplateReferenceOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CompleteRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "argument": Schema.Struct({ "name": Schema.String.annotations({
  "description": "The name of the argument"
}), "value": Schema.String.annotations({
  "description": "The value of the argument to use for completion matching."
}) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "The argument's information"
}),
  "context": optional(Schema.Struct({ "arguments": optional(typedObject({  }, [] as const, Schema.String).annotations({
  "description": "Previously-resolved variables in a URI template or prompt."
})) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Additional, optional context for completions"
})),
  "ref": Schema.Union(PromptReference, ResourceTemplateReference)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CompleteRequestParamsClassFields = CompleteRequestParamsOpenFields

export class CompleteRequestParams extends Schema.Class<CompleteRequestParams>("mcp/generated/2026-07-28/CompleteRequestParams")(
CompleteRequestParamsClassFields as unknown as Schema.Struct<typeof CompleteRequestParamsOpenFields.fields>, {
  "description": "Parameters for a `completion/complete` request."
}
) {
  constructor(props: Schema.Schema.Type<typeof CompleteRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CompleteRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("completion/complete"),
  "params": CompleteRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CompleteRequestClassFields = CompleteRequestOpenFields

export class CompleteRequest extends Schema.Class<CompleteRequest>("mcp/generated/2026-07-28/CompleteRequest")(
CompleteRequestClassFields as unknown as Schema.Struct<typeof CompleteRequestOpenFields.fields>, {
  "description": "A request from the client to the server, to ask for completion options."
}
) {
  constructor(props: Schema.Schema.Type<typeof CompleteRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ClientRequest = Schema.Union(DiscoverRequest, CompleteRequest, GetPromptRequest, ListPromptsRequest, ListResourcesRequest, ListResourceTemplatesRequest, ReadResourceRequest, SubscriptionsListenRequest, CallToolRequest, ListToolsRequest)

export const Result = typedObject({ "_meta": optional(ResultMetaObject), "resultType": Schema.String.annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}) }, [
  "_meta",
  "resultType"
] as const, Schema.Unknown).annotations({
  "description": "Common result fields."
})

export const EmptyResult = typedObject({ "_meta": optional(ResultMetaObject), "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}) }, [
  "_meta",
  "resultType"
] as const, Schema.Unknown).annotations({
  "description": "Common result fields."
})

export const ClientResult = EmptyResult

const CompleteResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "completion": Schema.Struct({ "hasMore": optional(Schema.Boolean.annotations({
  "description": "Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown."
})), "total": optional(Schema.Int.annotations({
  "description": "The total number of completion options available. This can exceed the number of values actually sent in the response."
})), "values": withEncodedBounds(Schema.Array(Schema.String), {
  "maxItems": 100
}).annotations({
  "description": "An array of completion values. Must not exceed 100 items."
}) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CompleteResultClassFields = CompleteResultOpenFields

export class CompleteResult extends Schema.Class<CompleteResult>("mcp/generated/2026-07-28/CompleteResult")(
CompleteResultClassFields as unknown as Schema.Struct<typeof CompleteResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link CompleteRequestcompletion/complete} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof CompleteResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const CompleteResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": CompleteResult
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const CompleteResultResponseClassFields = CompleteResultResponseOpenFields

export class CompleteResultResponse extends Schema.Class<CompleteResultResponse>("mcp/generated/2026-07-28/CompleteResultResponse")(
CompleteResultResponseClassFields as unknown as Schema.Struct<typeof CompleteResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link CompleteRequestcompletion/complete} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof CompleteResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const Cursor = Schema.String.annotations({
  "description": "An opaque token used to represent a cursor for pagination."
})

const ServerCapabilitiesOpenFields = Schema.Struct({
  "completions": optional(JSONObject.annotations({
  "description": "Present if the server supports argument autocompletion suggestions."
})),
  "experimental": optional(typedObject({  }, [] as const, JSONObject).annotations({
  "description": "Experimental, non-standard capabilities that the server supports."
})),
  "extensions": optional(typedObject({  }, [] as const, JSONObject).annotations({
  "description": "Optional MCP extensions that the server supports. Keys are extension identifiers\n(e.g., \"io.modelcontextprotocol/tasks\"), and values are per-extension settings\nobjects. An empty object indicates support with no settings.\n\nKeys MUST follow the {@link MetaObject`_meta` key naming rules}, with a\nmandatory prefix."
})),
  "logging": optional(JSONObject.annotations({
  "description": "Present if the server supports sending log messages to the client."
})),
  "prompts": optional(Schema.Struct({ "listChanged": optional(Schema.Boolean.annotations({
  "description": "Whether this server supports notifications for changes to the prompt list."
})) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Present if the server offers any prompt templates."
})),
  "resources": optional(Schema.Struct({ "listChanged": optional(Schema.Boolean.annotations({
  "description": "Whether this server supports notifications for changes to the resource list."
})), "subscribe": optional(Schema.Boolean.annotations({
  "description": "Whether this server supports subscribing to resource updates."
})) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Present if the server offers any resources to read."
})),
  "tools": optional(Schema.Struct({ "listChanged": optional(Schema.Boolean.annotations({
  "description": "Whether this server supports notifications for changes to the tool list."
})) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
  "description": "Present if the server offers any tools to call."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ServerCapabilitiesClassFields = ServerCapabilitiesOpenFields

export class ServerCapabilities extends Schema.Class<ServerCapabilities>("mcp/generated/2026-07-28/ServerCapabilities")(
ServerCapabilitiesClassFields as unknown as Schema.Struct<typeof ServerCapabilitiesOpenFields.fields>, {
  "description": "Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities."
}
) {
  constructor(props: Schema.Schema.Type<typeof ServerCapabilitiesOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const DiscoverResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "cacheScope": Schema.Literal("private", "public").annotations({
  "description": "Indicates the intended scope of the cached response, analogous to HTTP\n`Cache-Control: public` vs `Cache-Control: private`.\n\n- `\"public\"`: The response does not contain user-specific data. Any\n  client or intermediary (e.g., shared gateway, caching proxy) MAY cache\n  the response and serve it across authorization contexts.\n- `\"private\"`: The response MAY be cached and reused only within the\n  same authorization context. Caches MUST NOT be shared across\n  authorization contexts (e.g., a different access token requires a\n  different cache)."
}),
  "capabilities": ServerCapabilities.annotations({
  "description": "The capabilities of the server."
}),
  "instructions": optional(Schema.String.annotations({
  "description": "Natural-language guidance describing the server and its features.\n\nThis can be used by clients to improve an LLM's understanding of\navailable tools (e.g., by including it in a system prompt). It should\nfocus on information that helps the model use the server effectively\nand should not duplicate information already in tool descriptions."
})),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "supportedVersions": Schema.Array(Schema.String).annotations({
  "description": "MCP Protocol Versions this server supports. The client should choose a\nversion from this list for use in subsequent requests."
}),
  "ttlMs": withEncodedBounds(Schema.Int, {
  "minimum": 0
}).annotations({
  "description": "A hint from the server indicating how long (in milliseconds) the\nclient MAY cache this response before re-fetching. Semantics are\nanalogous to HTTP Cache-Control max-age.\n\n- If 0, The response SHOULD be considered immediately stale,\n  The client MAY re-fetch every time the result is needed.\n- If positive, the client SHOULD consider the result fresh for this many\n  milliseconds after receiving the response."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const DiscoverResultClassFields = DiscoverResultOpenFields

export class DiscoverResult extends Schema.Class<DiscoverResult>("mcp/generated/2026-07-28/DiscoverResult")(
DiscoverResultClassFields as unknown as Schema.Struct<typeof DiscoverResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link DiscoverRequestserver/discover} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof DiscoverResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const DiscoverResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": DiscoverResult
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const DiscoverResultResponseClassFields = DiscoverResultResponseOpenFields

export class DiscoverResultResponse extends Schema.Class<DiscoverResultResponse>("mcp/generated/2026-07-28/DiscoverResultResponse")(
DiscoverResultResponseClassFields as unknown as Schema.Struct<typeof DiscoverResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link DiscoverRequestserver/discover} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof DiscoverResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ErrorOpenFields = Schema.Struct({
  "code": Schema.Int.annotations({
  "description": "The error type that occurred."
}),
  "data": optional(Schema.Unknown.annotations({
  "description": "Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.)."
})),
  "message": Schema.String.annotations({
  "description": "A short description of the error. The message SHOULD be limited to a concise single sentence."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ErrorClassFields = ErrorOpenFields

export class Error extends Schema.Class<Error>("mcp/generated/2026-07-28/Error")(
ErrorClassFields as unknown as Schema.Struct<typeof ErrorOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof ErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const PromptMessageOpenFields = Schema.Struct({
  "content": ContentBlock,
  "role": Role
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PromptMessageClassFields = PromptMessageOpenFields

export class PromptMessage extends Schema.Class<PromptMessage>("mcp/generated/2026-07-28/PromptMessage")(
PromptMessageClassFields as unknown as Schema.Struct<typeof PromptMessageOpenFields.fields>, {
  "description": "Describes a message returned as part of a prompt.\n\nThis is similar to {@link SamplingMessage}, but also supports the embedding of\nresources from the MCP server."
}
) {
  constructor(props: Schema.Schema.Type<typeof PromptMessageOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const GetPromptResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "description": optional(Schema.String.annotations({
  "description": "An optional description for the prompt."
})),
  "messages": Schema.Array(PromptMessage),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const GetPromptResultClassFields = GetPromptResultOpenFields

export class GetPromptResult extends Schema.Class<GetPromptResult>("mcp/generated/2026-07-28/GetPromptResult")(
GetPromptResultClassFields as unknown as Schema.Struct<typeof GetPromptResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link GetPromptRequestprompts/get} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof GetPromptResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const GetPromptResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": Schema.Union(InputRequiredResult, GetPromptResult)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const GetPromptResultResponseClassFields = GetPromptResultResponseOpenFields

export class GetPromptResultResponse extends Schema.Class<GetPromptResultResponse>("mcp/generated/2026-07-28/GetPromptResultResponse")(
GetPromptResultResponseClassFields as unknown as Schema.Struct<typeof GetPromptResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link GetPromptRequestprompts/get} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof GetPromptResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const HeaderMismatchErrorOpenFields = Schema.Struct({
  "error": exactIntersection(Error, Schema.Struct({ "code": Schema.Literal(-32020) }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
  "id": optional(RequestId),
  "jsonrpc": Schema.Literal("2.0")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const HeaderMismatchErrorClassFields = HeaderMismatchErrorOpenFields

export class HeaderMismatchError extends Schema.Class<HeaderMismatchError>("mcp/generated/2026-07-28/HeaderMismatchError")(
HeaderMismatchErrorClassFields as unknown as Schema.Struct<typeof HeaderMismatchErrorOpenFields.fields>, {
  "description": "Returned when a server rejects a request because the values in the HTTP\nheaders do not match the corresponding values in the request body, or\nbecause required headers are missing or malformed. For HTTP, the response\nstatus code MUST be `400 Bad Request`."
}
) {
  constructor(props: Schema.Schema.Type<typeof HeaderMismatchErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const IconsOpenFields = Schema.Struct({
  "icons": optional(Schema.Array(Icon).annotations({
  "description": "Optional set of sized icons that the client can display in a user interface.\n\nClients that support rendering icons MUST support at least the following MIME types:\n- `image/png` - PNG images (safe, universal compatibility)\n- `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)\n\nClients that support rendering icons SHOULD also support:\n- `image/svg+xml` - SVG images (scalable but requires security precautions)\n- `image/webp` - WebP images (modern, efficient format)"
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const IconsClassFields = IconsOpenFields

export class Icons extends Schema.Class<Icons>("mcp/generated/2026-07-28/Icons")(
IconsClassFields as unknown as Schema.Struct<typeof IconsOpenFields.fields>, {
  "description": "Base interface to add `icons` property."
}
) {
  constructor(props: Schema.Schema.Type<typeof IconsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const InputResponseRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "inputResponses": optional(InputResponses),
  "requestState": optional(Schema.String)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const InputResponseRequestParamsClassFields = InputResponseRequestParamsOpenFields

export class InputResponseRequestParams extends Schema.Class<InputResponseRequestParams>("mcp/generated/2026-07-28/InputResponseRequestParams")(
InputResponseRequestParamsClassFields as unknown as Schema.Struct<typeof InputResponseRequestParamsOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof InputResponseRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const InternalErrorOpenFields = Schema.Struct({
  "code": Schema.Literal(-32603).annotations({
  "description": "The error type that occurred."
}),
  "data": optional(Schema.Unknown.annotations({
  "description": "Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.)."
})),
  "message": Schema.String.annotations({
  "description": "A short description of the error. The message SHOULD be limited to a concise single sentence."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const InternalErrorClassFields = InternalErrorOpenFields

export class InternalError extends Schema.Class<InternalError>("mcp/generated/2026-07-28/InternalError")(
InternalErrorClassFields as unknown as Schema.Struct<typeof InternalErrorOpenFields.fields>, {
  "description": "A JSON-RPC error indicating that an internal error occurred on the receiver. This error is returned when the receiver encounters an unexpected condition that prevents it from fulfilling the request."
}
) {
  constructor(props: Schema.Schema.Type<typeof InternalErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const InvalidParamsErrorOpenFields = Schema.Struct({
  "code": Schema.Literal(-32602).annotations({
  "description": "The error type that occurred."
}),
  "data": optional(Schema.Unknown.annotations({
  "description": "Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.)."
})),
  "message": Schema.String.annotations({
  "description": "A short description of the error. The message SHOULD be limited to a concise single sentence."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const InvalidParamsErrorClassFields = InvalidParamsErrorOpenFields

export class InvalidParamsError extends Schema.Class<InvalidParamsError>("mcp/generated/2026-07-28/InvalidParamsError")(
InvalidParamsErrorClassFields as unknown as Schema.Struct<typeof InvalidParamsErrorOpenFields.fields>, {
  "description": "A JSON-RPC error indicating that the method parameters are invalid or malformed.\n\nIn MCP, this error is returned in various contexts when request parameters fail validation:\n\n- **Tools**: Unknown tool name or invalid tool arguments\n- **Prompts**: Unknown prompt name or missing required arguments\n- **Pagination**: Invalid or expired cursor values\n- **Logging**: Invalid log level\n- **Elicitation**: Server requests an elicitation mode not declared in client capabilities\n- **Sampling**: Missing tool result or tool results mixed with other content"
}
) {
  constructor(props: Schema.Schema.Type<typeof InvalidParamsErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const InvalidRequestErrorOpenFields = Schema.Struct({
  "code": Schema.Literal(-32600).annotations({
  "description": "The error type that occurred."
}),
  "data": optional(Schema.Unknown.annotations({
  "description": "Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.)."
})),
  "message": Schema.String.annotations({
  "description": "A short description of the error. The message SHOULD be limited to a concise single sentence."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const InvalidRequestErrorClassFields = InvalidRequestErrorOpenFields

export class InvalidRequestError extends Schema.Class<InvalidRequestError>("mcp/generated/2026-07-28/InvalidRequestError")(
InvalidRequestErrorClassFields as unknown as Schema.Struct<typeof InvalidRequestErrorOpenFields.fields>, {
  "description": "A JSON-RPC error indicating that the request is not a valid request object. This error is returned when the message structure does not conform to the JSON-RPC 2.0 specification requirements for a request (e.g., missing required fields like `jsonrpc` or `method`, or using invalid types for these fields)."
}
) {
  constructor(props: Schema.Schema.Type<typeof InvalidRequestErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const JSONRPCErrorResponseOpenFields = Schema.Struct({
  "error": Error,
  "id": optional(RequestId),
  "jsonrpc": Schema.Literal("2.0")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const JSONRPCErrorResponseClassFields = JSONRPCErrorResponseOpenFields

export class JSONRPCErrorResponse extends Schema.Class<JSONRPCErrorResponse>("mcp/generated/2026-07-28/JSONRPCErrorResponse")(
JSONRPCErrorResponseClassFields as unknown as Schema.Struct<typeof JSONRPCErrorResponseOpenFields.fields>, {
  "description": "A response to a request that indicates an error occurred."
}
) {
  constructor(props: Schema.Schema.Type<typeof JSONRPCErrorResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const JSONRPCRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.String,
  "params": optional(typedObject({  }, [] as const, Schema.Unknown))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const JSONRPCRequestClassFields = JSONRPCRequestOpenFields

export class JSONRPCRequest extends Schema.Class<JSONRPCRequest>("mcp/generated/2026-07-28/JSONRPCRequest")(
JSONRPCRequestClassFields as unknown as Schema.Struct<typeof JSONRPCRequestOpenFields.fields>, {
  "description": "A request that expects a response."
}
) {
  constructor(props: Schema.Schema.Type<typeof JSONRPCRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const JSONRPCNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.String,
  "params": optional(typedObject({  }, [] as const, Schema.Unknown))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const JSONRPCNotificationClassFields = JSONRPCNotificationOpenFields

export class JSONRPCNotification extends Schema.Class<JSONRPCNotification>("mcp/generated/2026-07-28/JSONRPCNotification")(
JSONRPCNotificationClassFields as unknown as Schema.Struct<typeof JSONRPCNotificationOpenFields.fields>, {
  "description": "A notification which does not expect a response."
}
) {
  constructor(props: Schema.Schema.Type<typeof JSONRPCNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const JSONRPCResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": Result
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const JSONRPCResultResponseClassFields = JSONRPCResultResponseOpenFields

export class JSONRPCResultResponse extends Schema.Class<JSONRPCResultResponse>("mcp/generated/2026-07-28/JSONRPCResultResponse")(
JSONRPCResultResponseClassFields as unknown as Schema.Struct<typeof JSONRPCResultResponseOpenFields.fields>, {
  "description": "A successful (non-error) response to a request."
}
) {
  constructor(props: Schema.Schema.Type<typeof JSONRPCResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const JSONRPCResponse = Schema.Union(JSONRPCResultResponse, JSONRPCErrorResponse)

export const JSONRPCMessage = Schema.Union(JSONRPCRequest, JSONRPCNotification, JSONRPCResponse)

const PromptArgumentOpenFields = Schema.Struct({
  "description": optional(Schema.String.annotations({
  "description": "A human-readable description of the argument."
})),
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "required": optional(Schema.Boolean.annotations({
  "description": "Whether this argument must be provided."
})),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PromptArgumentClassFields = PromptArgumentOpenFields

export class PromptArgument extends Schema.Class<PromptArgument>("mcp/generated/2026-07-28/PromptArgument")(
PromptArgumentClassFields as unknown as Schema.Struct<typeof PromptArgumentOpenFields.fields>, {
  "description": "Describes an argument that a prompt can accept."
}
) {
  constructor(props: Schema.Schema.Type<typeof PromptArgumentOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const PromptOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "arguments": optional(Schema.Array(PromptArgument).annotations({
  "description": "A list of arguments to use for templating the prompt."
})),
  "description": optional(Schema.String.annotations({
  "description": "An optional description of what this prompt provides"
})),
  "icons": optional(Schema.Array(Icon).annotations({
  "description": "Optional set of sized icons that the client can display in a user interface.\n\nClients that support rendering icons MUST support at least the following MIME types:\n- `image/png` - PNG images (safe, universal compatibility)\n- `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)\n\nClients that support rendering icons SHOULD also support:\n- `image/svg+xml` - SVG images (scalable but requires security precautions)\n- `image/webp` - WebP images (modern, efficient format)"
})),
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PromptClassFields = PromptOpenFields

export class Prompt extends Schema.Class<Prompt>("mcp/generated/2026-07-28/Prompt")(
PromptClassFields as unknown as Schema.Struct<typeof PromptOpenFields.fields>, {
  "description": "A prompt or prompt template that the server offers."
}
) {
  constructor(props: Schema.Schema.Type<typeof PromptOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListPromptsResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "cacheScope": Schema.Literal("private", "public").annotations({
  "description": "Indicates the intended scope of the cached response, analogous to HTTP\n`Cache-Control: public` vs `Cache-Control: private`.\n\n- `\"public\"`: The response does not contain user-specific data. Any\n  client or intermediary (e.g., shared gateway, caching proxy) MAY cache\n  the response and serve it across authorization contexts.\n- `\"private\"`: The response MAY be cached and reused only within the\n  same authorization context. Caches MUST NOT be shared across\n  authorization contexts (e.g., a different access token requires a\n  different cache)."
}),
  "nextCursor": optional(Schema.String.annotations({
  "description": "An opaque token representing the pagination position after the last returned result.\nIf present, there may be more results available."
})),
  "prompts": Schema.Array(Prompt),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "ttlMs": withEncodedBounds(Schema.Int, {
  "minimum": 0
}).annotations({
  "description": "A hint from the server indicating how long (in milliseconds) the\nclient MAY cache this response before re-fetching. Semantics are\nanalogous to HTTP Cache-Control max-age.\n\n- If 0, The response SHOULD be considered immediately stale,\n  The client MAY re-fetch every time the result is needed.\n- If positive, the client SHOULD consider the result fresh for this many\n  milliseconds after receiving the response."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListPromptsResultClassFields = ListPromptsResultOpenFields

export class ListPromptsResult extends Schema.Class<ListPromptsResult>("mcp/generated/2026-07-28/ListPromptsResult")(
ListPromptsResultClassFields as unknown as Schema.Struct<typeof ListPromptsResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link ListPromptsRequestprompts/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListPromptsResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListPromptsResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": ListPromptsResult
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListPromptsResultResponseClassFields = ListPromptsResultResponseOpenFields

export class ListPromptsResultResponse extends Schema.Class<ListPromptsResultResponse>("mcp/generated/2026-07-28/ListPromptsResultResponse")(
ListPromptsResultResponseClassFields as unknown as Schema.Struct<typeof ListPromptsResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link ListPromptsRequestprompts/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListPromptsResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(Annotations.annotations({
  "description": "Optional annotations for the client."
})),
  "description": optional(Schema.String.annotations({
  "description": "A description of what this resource represents.\n\nThis can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a \"hint\" to the model."
})),
  "icons": optional(Schema.Array(Icon).annotations({
  "description": "Optional set of sized icons that the client can display in a user interface.\n\nClients that support rendering icons MUST support at least the following MIME types:\n- `image/png` - PNG images (safe, universal compatibility)\n- `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)\n\nClients that support rendering icons SHOULD also support:\n- `image/svg+xml` - SVG images (scalable but requires security precautions)\n- `image/webp` - WebP images (modern, efficient format)"
})),
  "mimeType": optional(Schema.String.annotations({
  "description": "The MIME type of this resource, if known."
})),
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "size": optional(Schema.Int.annotations({
  "description": "The size of the raw resource content, in bytes (i.e., before base64 encoding or any tokenization), if known.\n\nThis can be used by Hosts to display file sizes and estimate context window usage."
})),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
})),
  "uri": Schema.String.annotations({
  "description": "The URI of this resource."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceClassFields = ResourceOpenFields

export class Resource extends Schema.Class<Resource>("mcp/generated/2026-07-28/Resource")(
ResourceClassFields as unknown as Schema.Struct<typeof ResourceOpenFields.fields>, {
  "description": "A known resource that the server is capable of reading."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListResourcesResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "cacheScope": Schema.Literal("private", "public").annotations({
  "description": "Indicates the intended scope of the cached response, analogous to HTTP\n`Cache-Control: public` vs `Cache-Control: private`.\n\n- `\"public\"`: The response does not contain user-specific data. Any\n  client or intermediary (e.g., shared gateway, caching proxy) MAY cache\n  the response and serve it across authorization contexts.\n- `\"private\"`: The response MAY be cached and reused only within the\n  same authorization context. Caches MUST NOT be shared across\n  authorization contexts (e.g., a different access token requires a\n  different cache)."
}),
  "nextCursor": optional(Schema.String.annotations({
  "description": "An opaque token representing the pagination position after the last returned result.\nIf present, there may be more results available."
})),
  "resources": Schema.Array(Resource),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "ttlMs": withEncodedBounds(Schema.Int, {
  "minimum": 0
}).annotations({
  "description": "A hint from the server indicating how long (in milliseconds) the\nclient MAY cache this response before re-fetching. Semantics are\nanalogous to HTTP Cache-Control max-age.\n\n- If 0, The response SHOULD be considered immediately stale,\n  The client MAY re-fetch every time the result is needed.\n- If positive, the client SHOULD consider the result fresh for this many\n  milliseconds after receiving the response."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListResourcesResultClassFields = ListResourcesResultOpenFields

export class ListResourcesResult extends Schema.Class<ListResourcesResult>("mcp/generated/2026-07-28/ListResourcesResult")(
ListResourcesResultClassFields as unknown as Schema.Struct<typeof ListResourcesResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link ListResourcesRequestresources/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListResourcesResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListResourcesResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": ListResourcesResult
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListResourcesResultResponseClassFields = ListResourcesResultResponseOpenFields

export class ListResourcesResultResponse extends Schema.Class<ListResourcesResultResponse>("mcp/generated/2026-07-28/ListResourcesResultResponse")(
ListResourcesResultResponseClassFields as unknown as Schema.Struct<typeof ListResourcesResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link ListResourcesRequestresources/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListResourcesResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceTemplateOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "annotations": optional(Annotations.annotations({
  "description": "Optional annotations for the client."
})),
  "description": optional(Schema.String.annotations({
  "description": "A description of what this template is for.\n\nThis can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a \"hint\" to the model."
})),
  "icons": optional(Schema.Array(Icon).annotations({
  "description": "Optional set of sized icons that the client can display in a user interface.\n\nClients that support rendering icons MUST support at least the following MIME types:\n- `image/png` - PNG images (safe, universal compatibility)\n- `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)\n\nClients that support rendering icons SHOULD also support:\n- `image/svg+xml` - SVG images (scalable but requires security precautions)\n- `image/webp` - WebP images (modern, efficient format)"
})),
  "mimeType": optional(Schema.String.annotations({
  "description": "The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type."
})),
  "name": Schema.String.annotations({
  "description": "Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present)."
}),
  "title": optional(Schema.String.annotations({
  "description": "Intended for UI and end-user contexts — optimized to be human-readable and easily understood,\neven by those unfamiliar with domain-specific terminology.\n\nIf not provided, the name should be used for display (except for {@link Tool},\nwhere `annotations.title` should be given precedence over using `name`,\nif present)."
})),
  "uriTemplate": Schema.String.annotations({
  "description": "A URI template (according to RFC 6570) that can be used to construct resource URIs."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceTemplateClassFields = ResourceTemplateOpenFields

export class ResourceTemplate extends Schema.Class<ResourceTemplate>("mcp/generated/2026-07-28/ResourceTemplate")(
ResourceTemplateClassFields as unknown as Schema.Struct<typeof ResourceTemplateOpenFields.fields>, {
  "description": "A template description for resources available on the server."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceTemplateOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListResourceTemplatesResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "cacheScope": Schema.Literal("private", "public").annotations({
  "description": "Indicates the intended scope of the cached response, analogous to HTTP\n`Cache-Control: public` vs `Cache-Control: private`.\n\n- `\"public\"`: The response does not contain user-specific data. Any\n  client or intermediary (e.g., shared gateway, caching proxy) MAY cache\n  the response and serve it across authorization contexts.\n- `\"private\"`: The response MAY be cached and reused only within the\n  same authorization context. Caches MUST NOT be shared across\n  authorization contexts (e.g., a different access token requires a\n  different cache)."
}),
  "nextCursor": optional(Schema.String.annotations({
  "description": "An opaque token representing the pagination position after the last returned result.\nIf present, there may be more results available."
})),
  "resourceTemplates": Schema.Array(ResourceTemplate),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "ttlMs": withEncodedBounds(Schema.Int, {
  "minimum": 0
}).annotations({
  "description": "A hint from the server indicating how long (in milliseconds) the\nclient MAY cache this response before re-fetching. Semantics are\nanalogous to HTTP Cache-Control max-age.\n\n- If 0, The response SHOULD be considered immediately stale,\n  The client MAY re-fetch every time the result is needed.\n- If positive, the client SHOULD consider the result fresh for this many\n  milliseconds after receiving the response."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListResourceTemplatesResultClassFields = ListResourceTemplatesResultOpenFields

export class ListResourceTemplatesResult extends Schema.Class<ListResourceTemplatesResult>("mcp/generated/2026-07-28/ListResourceTemplatesResult")(
ListResourceTemplatesResultClassFields as unknown as Schema.Struct<typeof ListResourceTemplatesResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link ListResourceTemplatesRequestresources/templates/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListResourceTemplatesResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListResourceTemplatesResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": ListResourceTemplatesResult
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListResourceTemplatesResultResponseClassFields = ListResourceTemplatesResultResponseOpenFields

export class ListResourceTemplatesResultResponse extends Schema.Class<ListResourceTemplatesResultResponse>("mcp/generated/2026-07-28/ListResourceTemplatesResultResponse")(
ListResourceTemplatesResultResponseClassFields as unknown as Schema.Struct<typeof ListResourceTemplatesResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link ListResourceTemplatesRequestresources/templates/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListResourceTemplatesResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListToolsResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "cacheScope": Schema.Literal("private", "public").annotations({
  "description": "Indicates the intended scope of the cached response, analogous to HTTP\n`Cache-Control: public` vs `Cache-Control: private`.\n\n- `\"public\"`: The response does not contain user-specific data. Any\n  client or intermediary (e.g., shared gateway, caching proxy) MAY cache\n  the response and serve it across authorization contexts.\n- `\"private\"`: The response MAY be cached and reused only within the\n  same authorization context. Caches MUST NOT be shared across\n  authorization contexts (e.g., a different access token requires a\n  different cache)."
}),
  "nextCursor": optional(Schema.String.annotations({
  "description": "An opaque token representing the pagination position after the last returned result.\nIf present, there may be more results available."
})),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "tools": Schema.Array(Tool),
  "ttlMs": withEncodedBounds(Schema.Int, {
  "minimum": 0
}).annotations({
  "description": "A hint from the server indicating how long (in milliseconds) the\nclient MAY cache this response before re-fetching. Semantics are\nanalogous to HTTP Cache-Control max-age.\n\n- If 0, The response SHOULD be considered immediately stale,\n  The client MAY re-fetch every time the result is needed.\n- If positive, the client SHOULD consider the result fresh for this many\n  milliseconds after receiving the response."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListToolsResultClassFields = ListToolsResultOpenFields

export class ListToolsResult extends Schema.Class<ListToolsResult>("mcp/generated/2026-07-28/ListToolsResult")(
ListToolsResultClassFields as unknown as Schema.Struct<typeof ListToolsResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link ListToolsRequesttools/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListToolsResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ListToolsResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": ListToolsResult
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ListToolsResultResponseClassFields = ListToolsResultResponseOpenFields

export class ListToolsResultResponse extends Schema.Class<ListToolsResultResponse>("mcp/generated/2026-07-28/ListToolsResultResponse")(
ListToolsResultResponseClassFields as unknown as Schema.Struct<typeof ListToolsResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link ListToolsRequesttools/list} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ListToolsResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const LoggingMessageNotificationParamsOpenFields = Schema.Struct({
  "_meta": optional(NotificationMetaObject),
  "data": Schema.Unknown.annotations({
  "description": "The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here."
}),
  "level": LoggingLevel.annotations({
  "description": "The severity of this log message."
}),
  "logger": optional(Schema.String.annotations({
  "description": "An optional name of the logger issuing this message."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const LoggingMessageNotificationParamsClassFields = LoggingMessageNotificationParamsOpenFields

export class LoggingMessageNotificationParams extends Schema.Class<LoggingMessageNotificationParams>("mcp/generated/2026-07-28/LoggingMessageNotificationParams")(
LoggingMessageNotificationParamsClassFields as unknown as Schema.Struct<typeof LoggingMessageNotificationParamsOpenFields.fields>, {
  "description": "Parameters for a `notifications/message` notification."
}
) {
  constructor(props: Schema.Schema.Type<typeof LoggingMessageNotificationParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const LoggingMessageNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/message"),
  "params": LoggingMessageNotificationParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const LoggingMessageNotificationClassFields = LoggingMessageNotificationOpenFields

export class LoggingMessageNotification extends Schema.Class<LoggingMessageNotification>("mcp/generated/2026-07-28/LoggingMessageNotification")(
LoggingMessageNotificationClassFields as unknown as Schema.Struct<typeof LoggingMessageNotificationOpenFields.fields>, {
  "description": "JSONRPCNotification of a log message passed from server to client. The client opts in by setting `\"io.modelcontextprotocol/logLevel\"` in a request's `_meta`."
}
) {
  constructor(props: Schema.Schema.Type<typeof LoggingMessageNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const MethodNotFoundErrorOpenFields = Schema.Struct({
  "code": Schema.Literal(-32601).annotations({
  "description": "The error type that occurred."
}),
  "data": optional(Schema.Unknown.annotations({
  "description": "Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.)."
})),
  "message": Schema.String.annotations({
  "description": "A short description of the error. The message SHOULD be limited to a concise single sentence."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const MethodNotFoundErrorClassFields = MethodNotFoundErrorOpenFields

export class MethodNotFoundError extends Schema.Class<MethodNotFoundError>("mcp/generated/2026-07-28/MethodNotFoundError")(
MethodNotFoundErrorClassFields as unknown as Schema.Struct<typeof MethodNotFoundErrorOpenFields.fields>, {
  "description": "A JSON-RPC error indicating that the requested method does not exist or is not available.\n\nIn MCP, a server returns this error when a client invokes a method the server does not implement — either a genuinely unknown method, or one gated behind a server capability the server did not advertise (e.g., calling `prompts/list` when the `prompts` capability was not advertised).\n\nA request that requires a client capability the client did not declare is signalled instead by {@link MissingRequiredClientCapabilityError} (`-32021`)."
}
) {
  constructor(props: Schema.Schema.Type<typeof MethodNotFoundErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const MissingRequiredClientCapabilityErrorOpenFields = Schema.Struct({
  "error": exactIntersection(Error, Schema.Struct({ "code": Schema.Literal(-32021), "data": Schema.Struct({ "requiredCapabilities": ClientCapabilities.annotations({
  "description": "The capabilities the server requires from the client to process this request."
}) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })) }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
  "id": optional(RequestId),
  "jsonrpc": Schema.Literal("2.0")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const MissingRequiredClientCapabilityErrorClassFields = MissingRequiredClientCapabilityErrorOpenFields

export class MissingRequiredClientCapabilityError extends Schema.Class<MissingRequiredClientCapabilityError>("mcp/generated/2026-07-28/MissingRequiredClientCapabilityError")(
MissingRequiredClientCapabilityErrorClassFields as unknown as Schema.Struct<typeof MissingRequiredClientCapabilityErrorOpenFields.fields>, {
  "description": "Returned when processing a request requires a capability the client did not\ndeclare in `clientCapabilities`. For HTTP, the response status code MUST be\n`400 Bad Request`."
}
) {
  constructor(props: Schema.Schema.Type<typeof MissingRequiredClientCapabilityErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const NotificationOpenFields = Schema.Struct({
  "method": Schema.String,
  "params": optional(typedObject({  }, [] as const, Schema.Unknown))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const NotificationClassFields = NotificationOpenFields

export class Notification extends Schema.Class<Notification>("mcp/generated/2026-07-28/Notification")(
NotificationClassFields as unknown as Schema.Struct<typeof NotificationOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof NotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const NotificationParamsOpenFields = Schema.Struct({
  "_meta": optional(NotificationMetaObject)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const NotificationParamsClassFields = NotificationParamsOpenFields

export class NotificationParams extends Schema.Class<NotificationParams>("mcp/generated/2026-07-28/NotificationParams")(
NotificationParamsClassFields as unknown as Schema.Struct<typeof NotificationParamsOpenFields.fields>, {
  "description": "Common params for any notification."
}
) {
  constructor(props: Schema.Schema.Type<typeof NotificationParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const PaginatedRequestOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.String,
  "params": PaginatedRequestParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PaginatedRequestClassFields = PaginatedRequestOpenFields

export class PaginatedRequest extends Schema.Class<PaginatedRequest>("mcp/generated/2026-07-28/PaginatedRequest")(
PaginatedRequestClassFields as unknown as Schema.Struct<typeof PaginatedRequestOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof PaginatedRequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const PaginatedResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "nextCursor": optional(Schema.String.annotations({
  "description": "An opaque token representing the pagination position after the last returned result.\nIf present, there may be more results available."
})),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PaginatedResultClassFields = PaginatedResultOpenFields

export class PaginatedResult extends Schema.Class<PaginatedResult>("mcp/generated/2026-07-28/PaginatedResult")(
PaginatedResultClassFields as unknown as Schema.Struct<typeof PaginatedResultOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof PaginatedResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ParseErrorOpenFields = Schema.Struct({
  "code": Schema.Literal(-32700).annotations({
  "description": "The error type that occurred."
}),
  "data": optional(Schema.Unknown.annotations({
  "description": "Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.)."
})),
  "message": Schema.String.annotations({
  "description": "A short description of the error. The message SHOULD be limited to a concise single sentence."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ParseErrorClassFields = ParseErrorOpenFields

export class ParseError extends Schema.Class<ParseError>("mcp/generated/2026-07-28/ParseError")(
ParseErrorClassFields as unknown as Schema.Struct<typeof ParseErrorOpenFields.fields>, {
  "description": "A JSON-RPC error indicating that invalid JSON was received by the server. This error is returned when the server cannot parse the JSON text of a message."
}
) {
  constructor(props: Schema.Schema.Type<typeof ParseErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ProgressNotificationParamsOpenFields = Schema.Struct({
  "_meta": optional(NotificationMetaObject),
  "message": optional(Schema.String.annotations({
  "description": "An optional message describing the current progress."
})),
  "progress": Schema.Finite.annotations({
  "description": "The progress thus far. This should increase every time progress is made, even if the total is unknown."
}),
  "progressToken": ProgressToken.annotations({
  "description": "The progress token which was given in the initial request, used to associate this notification with the request that is proceeding."
}),
  "total": optional(Schema.Finite.annotations({
  "description": "Total number of items to process (or total progress required), if known."
}))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ProgressNotificationParamsClassFields = ProgressNotificationParamsOpenFields

export class ProgressNotificationParams extends Schema.Class<ProgressNotificationParams>("mcp/generated/2026-07-28/ProgressNotificationParams")(
ProgressNotificationParamsClassFields as unknown as Schema.Struct<typeof ProgressNotificationParamsOpenFields.fields>, {
  "description": "Parameters for a {@link ProgressNotificationnotifications/progress} notification."
}
) {
  constructor(props: Schema.Schema.Type<typeof ProgressNotificationParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ProgressNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/progress"),
  "params": ProgressNotificationParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ProgressNotificationClassFields = ProgressNotificationOpenFields

export class ProgressNotification extends Schema.Class<ProgressNotification>("mcp/generated/2026-07-28/ProgressNotification")(
ProgressNotificationClassFields as unknown as Schema.Struct<typeof ProgressNotificationOpenFields.fields>, {
  "description": "An out-of-band notification used to inform the receiver of a progress update for a long-running request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ProgressNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const PromptListChangedNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/prompts/list_changed"),
  "params": optional(NotificationParams)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const PromptListChangedNotificationClassFields = PromptListChangedNotificationOpenFields

export class PromptListChangedNotification extends Schema.Class<PromptListChangedNotification>("mcp/generated/2026-07-28/PromptListChangedNotification")(
PromptListChangedNotificationClassFields as unknown as Schema.Struct<typeof PromptListChangedNotificationOpenFields.fields>, {
  "description": "An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This is only delivered on a {@link SubscriptionsListenRequestsubscriptions/listen} stream when the client requested it via the `promptsListChanged` filter field."
}
) {
  constructor(props: Schema.Schema.Type<typeof PromptListChangedNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ReadResourceResultOpenFields = Schema.Struct({
  "_meta": optional(ResultMetaObject),
  "cacheScope": Schema.Literal("private", "public").annotations({
  "description": "Indicates the intended scope of the cached response, analogous to HTTP\n`Cache-Control: public` vs `Cache-Control: private`.\n\n- `\"public\"`: The response does not contain user-specific data. Any\n  client or intermediary (e.g., shared gateway, caching proxy) MAY cache\n  the response and serve it across authorization contexts.\n- `\"private\"`: The response MAY be cached and reused only within the\n  same authorization context. Caches MUST NOT be shared across\n  authorization contexts (e.g., a different access token requires a\n  different cache)."
}),
  "contents": Schema.Array(Schema.Union(TextResourceContents, BlobResourceContents)),
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
}),
  "ttlMs": withEncodedBounds(Schema.Int, {
  "minimum": 0
}).annotations({
  "description": "A hint from the server indicating how long (in milliseconds) the\nclient MAY cache this response before re-fetching. Semantics are\nanalogous to HTTP Cache-Control max-age.\n\n- If 0, The response SHOULD be considered immediately stale,\n  The client MAY re-fetch every time the result is needed.\n- If positive, the client SHOULD consider the result fresh for this many\n  milliseconds after receiving the response."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ReadResourceResultClassFields = ReadResourceResultOpenFields

export class ReadResourceResult extends Schema.Class<ReadResourceResult>("mcp/generated/2026-07-28/ReadResourceResult")(
ReadResourceResultClassFields as unknown as Schema.Struct<typeof ReadResourceResultOpenFields.fields>, {
  "description": "The result returned by the server for a {@link ReadResourceRequestresources/read} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ReadResourceResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ReadResourceResultResponseOpenFields = Schema.Struct({
  "id": RequestId,
  "jsonrpc": Schema.Literal("2.0"),
  "result": Schema.Union(InputRequiredResult, ReadResourceResult)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ReadResourceResultResponseClassFields = ReadResourceResultResponseOpenFields

export class ReadResourceResultResponse extends Schema.Class<ReadResourceResultResponse>("mcp/generated/2026-07-28/ReadResourceResultResponse")(
ReadResourceResultResponseClassFields as unknown as Schema.Struct<typeof ReadResourceResultResponseOpenFields.fields>, {
  "description": "A successful response from the server for a {@link ReadResourceRequestresources/read} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ReadResourceResultResponseOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const RequestOpenFields = Schema.Struct({
  "method": Schema.String,
  "params": optional(typedObject({  }, [] as const, Schema.Unknown))
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const RequestClassFields = RequestOpenFields

export class Request extends Schema.Class<Request>("mcp/generated/2026-07-28/Request")(
RequestClassFields as unknown as Schema.Struct<typeof RequestOpenFields.fields>
) {
  constructor(props: Schema.Schema.Type<typeof RequestOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceContentsOpenFields = Schema.Struct({
  "_meta": optional(MetaObject),
  "mimeType": optional(Schema.String.annotations({
  "description": "The MIME type of this resource, if known."
})),
  "uri": Schema.String.annotations({
  "description": "The URI of this resource."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceContentsClassFields = ResourceContentsOpenFields

export class ResourceContents extends Schema.Class<ResourceContents>("mcp/generated/2026-07-28/ResourceContents")(
ResourceContentsClassFields as unknown as Schema.Struct<typeof ResourceContentsOpenFields.fields>, {
  "description": "The contents of a specific resource or sub-resource."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceContentsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceListChangedNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/resources/list_changed"),
  "params": optional(NotificationParams)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceListChangedNotificationClassFields = ResourceListChangedNotificationOpenFields

export class ResourceListChangedNotification extends Schema.Class<ResourceListChangedNotification>("mcp/generated/2026-07-28/ResourceListChangedNotification")(
ResourceListChangedNotificationClassFields as unknown as Schema.Struct<typeof ResourceListChangedNotificationOpenFields.fields>, {
  "description": "An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This is only delivered on a {@link SubscriptionsListenRequestsubscriptions/listen} stream when the client requested it via the `resourcesListChanged` filter field."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceListChangedNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceRequestParamsOpenFields = Schema.Struct({
  "_meta": RequestMetaObject,
  "uri": Schema.String.annotations({
  "description": "The URI of the resource. The URI can use any protocol; it is up to the server how to interpret it."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceRequestParamsClassFields = ResourceRequestParamsOpenFields

export class ResourceRequestParams extends Schema.Class<ResourceRequestParams>("mcp/generated/2026-07-28/ResourceRequestParams")(
ResourceRequestParamsClassFields as unknown as Schema.Struct<typeof ResourceRequestParamsOpenFields.fields>, {
  "description": "Common params for resource-related requests."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceRequestParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceUpdatedNotificationParamsOpenFields = Schema.Struct({
  "_meta": optional(NotificationMetaObject),
  "uri": Schema.String.annotations({
  "description": "The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceUpdatedNotificationParamsClassFields = ResourceUpdatedNotificationParamsOpenFields

export class ResourceUpdatedNotificationParams extends Schema.Class<ResourceUpdatedNotificationParams>("mcp/generated/2026-07-28/ResourceUpdatedNotificationParams")(
ResourceUpdatedNotificationParamsClassFields as unknown as Schema.Struct<typeof ResourceUpdatedNotificationParamsOpenFields.fields>, {
  "description": "Parameters for a `notifications/resources/updated` notification."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceUpdatedNotificationParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ResourceUpdatedNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/resources/updated"),
  "params": ResourceUpdatedNotificationParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ResourceUpdatedNotificationClassFields = ResourceUpdatedNotificationOpenFields

export class ResourceUpdatedNotification extends Schema.Class<ResourceUpdatedNotification>("mcp/generated/2026-07-28/ResourceUpdatedNotification")(
ResourceUpdatedNotificationClassFields as unknown as Schema.Struct<typeof ResourceUpdatedNotificationOpenFields.fields>, {
  "description": "A notification from the server to the client, informing it that a resource has changed and may need to be read again. This is only sent for resources the client opted in to via the `resourceSubscriptions` field of a {@link SubscriptionsListenRequestsubscriptions/listen} request."
}
) {
  constructor(props: Schema.Schema.Type<typeof ResourceUpdatedNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ResultType = Schema.String.annotations({
  "description": "Indicates the type of a {@link Result} object, allowing the client to\ndetermine how to parse the response.\n\ncomplete - the request completed successfully and the result contains the final content.\ninput_required - the request requires additional input and the result contains an {@link InputRequiredResult} object with instructions for the client to provide additional input before retrying the original request."
})

const SubscriptionsAcknowledgedNotificationParamsOpenFields = Schema.Struct({
  "_meta": optional(NotificationMetaObject),
  "notifications": SubscriptionFilter.annotations({
  "description": "The subset of requested notification types the server agreed to honor.\nOnly includes notification types the server actually supports; if the\nclient requested an unsupported type (e.g., `promptsListChanged` when\nthe server has no prompts), it is omitted from this set."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const SubscriptionsAcknowledgedNotificationParamsClassFields = SubscriptionsAcknowledgedNotificationParamsOpenFields

export class SubscriptionsAcknowledgedNotificationParams extends Schema.Class<SubscriptionsAcknowledgedNotificationParams>("mcp/generated/2026-07-28/SubscriptionsAcknowledgedNotificationParams")(
SubscriptionsAcknowledgedNotificationParamsClassFields as unknown as Schema.Struct<typeof SubscriptionsAcknowledgedNotificationParamsOpenFields.fields>, {
  "description": "Parameters for a {@link SubscriptionsAcknowledgedNotificationnotifications/subscriptions/acknowledged} notification."
}
) {
  constructor(props: Schema.Schema.Type<typeof SubscriptionsAcknowledgedNotificationParamsOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const SubscriptionsAcknowledgedNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/subscriptions/acknowledged"),
  "params": SubscriptionsAcknowledgedNotificationParams
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const SubscriptionsAcknowledgedNotificationClassFields = SubscriptionsAcknowledgedNotificationOpenFields

export class SubscriptionsAcknowledgedNotification extends Schema.Class<SubscriptionsAcknowledgedNotification>("mcp/generated/2026-07-28/SubscriptionsAcknowledgedNotification")(
SubscriptionsAcknowledgedNotificationClassFields as unknown as Schema.Struct<typeof SubscriptionsAcknowledgedNotificationOpenFields.fields>, {
  "description": "Sent by the server to acknowledge that a\n{@link SubscriptionsListenRequestsubscriptions/listen} subscription has been\nestablished and to report which notification types it agreed to honor.\n\nThis notification MUST be the first message the server sends carrying the\nsubscription's ID in `io.modelcontextprotocol/subscriptionId`. The server MUST\nNOT send any notification on the subscription before acknowledging it. On\nstdio, where every subscription shares one channel, this ordering is defined\nper subscription ID and not per channel: messages belonging to other\nsubscriptions MAY be interleaved before it."
}
) {
  constructor(props: Schema.Schema.Type<typeof SubscriptionsAcknowledgedNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

const ToolListChangedNotificationOpenFields = Schema.Struct({
  "jsonrpc": Schema.Literal("2.0"),
  "method": Schema.Literal("notifications/tools/list_changed"),
  "params": optional(NotificationParams)
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const ToolListChangedNotificationClassFields = ToolListChangedNotificationOpenFields

export class ToolListChangedNotification extends Schema.Class<ToolListChangedNotification>("mcp/generated/2026-07-28/ToolListChangedNotification")(
ToolListChangedNotificationClassFields as unknown as Schema.Struct<typeof ToolListChangedNotificationOpenFields.fields>, {
  "description": "An optional notification from the server to the client, informing it that the list of tools it offers has changed. This is only delivered on a {@link SubscriptionsListenRequestsubscriptions/listen} stream when the client requested it via the `toolsListChanged` filter field."
}
) {
  constructor(props: Schema.Schema.Type<typeof ToolListChangedNotificationOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ServerNotification = Schema.Union(CancelledNotification, ProgressNotification, LoggingMessageNotification, ResourceUpdatedNotification, ResourceListChangedNotification, ToolListChangedNotification, PromptListChangedNotification, SubscriptionsAcknowledgedNotification)

export const SubscriptionsListenResultMeta = typedObject({ "io.modelcontextprotocol/serverInfo": optional(Implementation.annotations({
  "description": "Identifies the server software producing the response. Servers SHOULD\ninclude this field on every response unless specifically configured not\nto do so.\n\nThe {@link Implementation} schema requires `name` and `version`; other\nfields are optional.\n\nThe value is self-reported by the server and is not verified by the\nprotocol. It is intended for display, logging, and debugging. Clients\nSHOULD NOT use it to change their behavior, and SHOULD NOT rely on it for\nsecurity decisions."
})), "io.modelcontextprotocol/subscriptionId": RequestId.annotations({
  "description": "Identifies the subscription stream this response closes, so the client can\ncorrelate it with the originating subscription — mirroring the same key on\nthe stream's notifications. The value is the JSON-RPC ID of the\n`subscriptions/listen` request that opened the stream (and equals this\nresponse's `id`)."
}) }, [
  "io.modelcontextprotocol/serverInfo",
  "io.modelcontextprotocol/subscriptionId"
] as const, Schema.Unknown).annotations({
  "description": "Extends {@link ResultMetaObject} with the subscription-stream identifier carried by a\n{@link SubscriptionsListenResult}. All key naming rules from `MetaObject` apply."
})

const SubscriptionsListenResultOpenFields = Schema.Struct({
  "_meta": SubscriptionsListenResultMeta,
  "resultType": Schema.Literal("complete").annotations({
  "description": "Indicates the type of the result, which allows the client to determine\nhow to parse the result object.\n\nServers implementing this protocol version MUST include this field.\nFor backward compatibility, when a client receives a result from a\nserver implementing an earlier protocol version (which does not include\n`resultType`), the client MUST treat the absent field as `\"complete\"`."
})
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const SubscriptionsListenResultClassFields = SubscriptionsListenResultOpenFields

export class SubscriptionsListenResult extends Schema.Class<SubscriptionsListenResult>("mcp/generated/2026-07-28/SubscriptionsListenResult")(
SubscriptionsListenResultClassFields as unknown as Schema.Struct<typeof SubscriptionsListenResultOpenFields.fields>, {
  "description": "The response to a {@link SubscriptionsListenRequestsubscriptions/listen}\nrequest, signalling that the subscription has ended gracefully (for example,\nduring server shutdown). Because the listen stream is long-lived, this result\nis sent only when the server tears the subscription down; an abrupt transport\nclose carries no response. The result body is otherwise empty."
}
) {
  constructor(props: Schema.Schema.Type<typeof SubscriptionsListenResultOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

export const ServerResult = Schema.Union(EmptyResult, DiscoverResult, CompleteResult, GetPromptResult, ListPromptsResult, ListResourceTemplatesResult, ListResourcesResult, ReadResourceResult, SubscriptionsListenResult, CallToolResult, ListToolsResult, InputRequiredResult)

const UnsupportedProtocolVersionErrorOpenFields = Schema.Struct({
  "error": exactIntersection(Error, Schema.Struct({ "code": Schema.Literal(-32022), "data": Schema.Struct({ "requested": Schema.String.annotations({
  "description": "The protocol version that was requested by the client."
}), "supported": Schema.Array(Schema.String).annotations({
  "description": "Protocol versions the server supports. The client should choose a\nmutually supported version from this list and retry."
}) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })) }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
  "id": optional(RequestId),
  "jsonrpc": Schema.Literal("2.0")
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const UnsupportedProtocolVersionErrorClassFields = UnsupportedProtocolVersionErrorOpenFields

export class UnsupportedProtocolVersionError extends Schema.Class<UnsupportedProtocolVersionError>("mcp/generated/2026-07-28/UnsupportedProtocolVersionError")(
UnsupportedProtocolVersionErrorClassFields as unknown as Schema.Struct<typeof UnsupportedProtocolVersionErrorOpenFields.fields>, {
  "description": "Returned when the request's protocol version is unknown to the server or\nunsupported (e.g., a known experimental or draft version the server has\nchosen not to implement). For HTTP, the response status code MUST be\n`400 Bad Request`."
}
) {
  constructor(props: Schema.Schema.Type<typeof UnsupportedProtocolVersionErrorOpenFields>, options?: Schema.MakeOptions) {
    super(props, options)
  }

  readonly [key: string]: unknown
}

// MCP draft $defs codec registry generated from schema.json. Do not edit.
export const MCP_SCHEMA_VERSION = "2026-07-28" as const

export const MCP_SCHEMA_DEFINITION_NAMES = [
  "Annotations",
  "AudioContent",
  "BaseMetadata",
  "BlobResourceContents",
  "BooleanSchema",
  "CacheableResult",
  "CallToolRequest",
  "CallToolRequestParams",
  "CallToolResult",
  "CallToolResultResponse",
  "CancelledNotification",
  "CancelledNotificationParams",
  "ClientCapabilities",
  "ClientNotification",
  "ClientRequest",
  "ClientResult",
  "CompleteRequest",
  "CompleteRequestParams",
  "CompleteResult",
  "CompleteResultResponse",
  "ContentBlock",
  "CreateMessageRequest",
  "CreateMessageRequestParams",
  "CreateMessageResult",
  "Cursor",
  "DiscoverRequest",
  "DiscoverResult",
  "DiscoverResultResponse",
  "ElicitRequest",
  "ElicitRequestFormParams",
  "ElicitRequestParams",
  "ElicitRequestURLParams",
  "ElicitResult",
  "EmbeddedResource",
  "EmptyResult",
  "EnumSchema",
  "Error",
  "GetPromptRequest",
  "GetPromptRequestParams",
  "GetPromptResult",
  "GetPromptResultResponse",
  "HeaderMismatchError",
  "Icon",
  "Icons",
  "ImageContent",
  "Implementation",
  "InputRequest",
  "InputRequests",
  "InputRequiredResult",
  "InputResponse",
  "InputResponseRequestParams",
  "InputResponses",
  "InternalError",
  "InvalidParamsError",
  "InvalidRequestError",
  "JSONArray",
  "JSONObject",
  "JSONRPCErrorResponse",
  "JSONRPCMessage",
  "JSONRPCNotification",
  "JSONRPCRequest",
  "JSONRPCResponse",
  "JSONRPCResultResponse",
  "JSONValue",
  "LegacyTitledEnumSchema",
  "ListPromptsRequest",
  "ListPromptsResult",
  "ListPromptsResultResponse",
  "ListResourcesRequest",
  "ListResourcesResult",
  "ListResourcesResultResponse",
  "ListResourceTemplatesRequest",
  "ListResourceTemplatesResult",
  "ListResourceTemplatesResultResponse",
  "ListRootsRequest",
  "ListRootsResult",
  "ListToolsRequest",
  "ListToolsResult",
  "ListToolsResultResponse",
  "LoggingLevel",
  "LoggingMessageNotification",
  "LoggingMessageNotificationParams",
  "MetaObject",
  "MethodNotFoundError",
  "MissingRequiredClientCapabilityError",
  "ModelHint",
  "ModelPreferences",
  "MultiSelectEnumSchema",
  "Notification",
  "NotificationMetaObject",
  "NotificationParams",
  "NumberSchema",
  "PaginatedRequest",
  "PaginatedRequestParams",
  "PaginatedResult",
  "ParseError",
  "PrimitiveSchemaDefinition",
  "ProgressNotification",
  "ProgressNotificationParams",
  "ProgressToken",
  "Prompt",
  "PromptArgument",
  "PromptListChangedNotification",
  "PromptMessage",
  "PromptReference",
  "ReadResourceRequest",
  "ReadResourceRequestParams",
  "ReadResourceResult",
  "ReadResourceResultResponse",
  "Request",
  "RequestId",
  "RequestMetaObject",
  "RequestParams",
  "Resource",
  "ResourceContents",
  "ResourceLink",
  "ResourceListChangedNotification",
  "ResourceRequestParams",
  "ResourceTemplate",
  "ResourceTemplateReference",
  "ResourceUpdatedNotification",
  "ResourceUpdatedNotificationParams",
  "Result",
  "ResultMetaObject",
  "ResultType",
  "Role",
  "Root",
  "SamplingMessage",
  "SamplingMessageContentBlock",
  "ServerCapabilities",
  "ServerNotification",
  "ServerResult",
  "SingleSelectEnumSchema",
  "StringSchema",
  "SubscriptionFilter",
  "SubscriptionsAcknowledgedNotification",
  "SubscriptionsAcknowledgedNotificationParams",
  "SubscriptionsListenRequest",
  "SubscriptionsListenRequestParams",
  "SubscriptionsListenResult",
  "SubscriptionsListenResultMeta",
  "TextContent",
  "TextResourceContents",
  "TitledMultiSelectEnumSchema",
  "TitledSingleSelectEnumSchema",
  "Tool",
  "ToolAnnotations",
  "ToolChoice",
  "ToolListChangedNotification",
  "ToolResultContent",
  "ToolUseContent",
  "UnsupportedProtocolVersionError",
  "UntitledMultiSelectEnumSchema",
  "UntitledSingleSelectEnumSchema"
] as const
export type McpSchemaDefinitionName = typeof MCP_SCHEMA_DEFINITION_NAMES[number]

export const MCP_SCHEMA_NAMED_ALIAS_MEMBERS = {
  "JSONRPCMessage": [
    "JSONRPCRequest",
    "JSONRPCNotification",
    "JSONRPCResponse"
  ],
  "JSONRPCResponse": [
    "JSONRPCResultResponse",
    "JSONRPCErrorResponse"
  ],
  "EmptyResult": [
    "Result"
  ],
  "InputRequest": [
    "CreateMessageRequest",
    "ListRootsRequest",
    "ElicitRequest"
  ],
  "InputResponse": [
    "CreateMessageResult",
    "ListRootsResult",
    "ElicitResult"
  ],
  "SamplingMessageContentBlock": [
    "TextContent",
    "ImageContent",
    "AudioContent",
    "ToolUseContent",
    "ToolResultContent"
  ],
  "ContentBlock": [
    "TextContent",
    "ImageContent",
    "AudioContent",
    "ResourceLink",
    "EmbeddedResource"
  ],
  "ElicitRequestParams": [
    "ElicitRequestFormParams",
    "ElicitRequestURLParams"
  ],
  "PrimitiveSchemaDefinition": [
    "StringSchema",
    "NumberSchema",
    "BooleanSchema",
    "EnumSchema"
  ],
  "SingleSelectEnumSchema": [
    "UntitledSingleSelectEnumSchema",
    "TitledSingleSelectEnumSchema"
  ],
  "MultiSelectEnumSchema": [
    "UntitledMultiSelectEnumSchema",
    "TitledMultiSelectEnumSchema"
  ],
  "EnumSchema": [
    "SingleSelectEnumSchema",
    "MultiSelectEnumSchema",
    "LegacyTitledEnumSchema"
  ],
  "ClientRequest": [
    "DiscoverRequest",
    "CompleteRequest",
    "GetPromptRequest",
    "ListPromptsRequest",
    "ListResourcesRequest",
    "ListResourceTemplatesRequest",
    "ReadResourceRequest",
    "SubscriptionsListenRequest",
    "CallToolRequest",
    "ListToolsRequest"
  ],
  "ClientNotification": [
    "CancelledNotification"
  ],
  "ClientResult": [
    "EmptyResult"
  ],
  "ServerNotification": [
    "CancelledNotification",
    "ProgressNotification",
    "LoggingMessageNotification",
    "ResourceUpdatedNotification",
    "ResourceListChangedNotification",
    "ToolListChangedNotification",
    "PromptListChangedNotification",
    "SubscriptionsAcknowledgedNotification"
  ],
  "ServerResult": [
    "EmptyResult",
    "DiscoverResult",
    "CompleteResult",
    "GetPromptResult",
    "ListPromptsResult",
    "ListResourceTemplatesResult",
    "ListResourcesResult",
    "ReadResourceResult",
    "SubscriptionsListenResult",
    "CallToolResult",
    "ListToolsResult",
    "InputRequiredResult"
  ]
} as const

export const MCP_SCHEMA_CODECS = {
  "Annotations": Annotations,
  "AudioContent": AudioContent,
  "BaseMetadata": BaseMetadata,
  "BlobResourceContents": BlobResourceContents,
  "BooleanSchema": BooleanSchema,
  "CacheableResult": CacheableResult,
  "CallToolRequest": CallToolRequest,
  "CallToolRequestParams": CallToolRequestParams,
  "CallToolResult": CallToolResult,
  "CallToolResultResponse": CallToolResultResponse,
  "CancelledNotification": CancelledNotification,
  "CancelledNotificationParams": CancelledNotificationParams,
  "ClientCapabilities": ClientCapabilities,
  "ClientNotification": ClientNotification,
  "ClientRequest": ClientRequest,
  "ClientResult": ClientResult,
  "CompleteRequest": CompleteRequest,
  "CompleteRequestParams": CompleteRequestParams,
  "CompleteResult": CompleteResult,
  "CompleteResultResponse": CompleteResultResponse,
  "ContentBlock": ContentBlock,
  "CreateMessageRequest": CreateMessageRequest,
  "CreateMessageRequestParams": CreateMessageRequestParams,
  "CreateMessageResult": CreateMessageResult,
  "Cursor": Cursor,
  "DiscoverRequest": DiscoverRequest,
  "DiscoverResult": DiscoverResult,
  "DiscoverResultResponse": DiscoverResultResponse,
  "ElicitRequest": ElicitRequest,
  "ElicitRequestFormParams": ElicitRequestFormParams,
  "ElicitRequestParams": ElicitRequestParams,
  "ElicitRequestURLParams": ElicitRequestURLParams,
  "ElicitResult": ElicitResult,
  "EmbeddedResource": EmbeddedResource,
  "EmptyResult": EmptyResult,
  "EnumSchema": EnumSchema,
  "Error": Error,
  "GetPromptRequest": GetPromptRequest,
  "GetPromptRequestParams": GetPromptRequestParams,
  "GetPromptResult": GetPromptResult,
  "GetPromptResultResponse": GetPromptResultResponse,
  "HeaderMismatchError": HeaderMismatchError,
  "Icon": Icon,
  "Icons": Icons,
  "ImageContent": ImageContent,
  "Implementation": Implementation,
  "InputRequest": InputRequest,
  "InputRequests": InputRequests,
  "InputRequiredResult": InputRequiredResult,
  "InputResponse": InputResponse,
  "InputResponseRequestParams": InputResponseRequestParams,
  "InputResponses": InputResponses,
  "InternalError": InternalError,
  "InvalidParamsError": InvalidParamsError,
  "InvalidRequestError": InvalidRequestError,
  "JSONArray": JSONArray,
  "JSONObject": JSONObject,
  "JSONRPCErrorResponse": JSONRPCErrorResponse,
  "JSONRPCMessage": JSONRPCMessage,
  "JSONRPCNotification": JSONRPCNotification,
  "JSONRPCRequest": JSONRPCRequest,
  "JSONRPCResponse": JSONRPCResponse,
  "JSONRPCResultResponse": JSONRPCResultResponse,
  "JSONValue": JSONValue,
  "LegacyTitledEnumSchema": LegacyTitledEnumSchema,
  "ListPromptsRequest": ListPromptsRequest,
  "ListPromptsResult": ListPromptsResult,
  "ListPromptsResultResponse": ListPromptsResultResponse,
  "ListResourcesRequest": ListResourcesRequest,
  "ListResourcesResult": ListResourcesResult,
  "ListResourcesResultResponse": ListResourcesResultResponse,
  "ListResourceTemplatesRequest": ListResourceTemplatesRequest,
  "ListResourceTemplatesResult": ListResourceTemplatesResult,
  "ListResourceTemplatesResultResponse": ListResourceTemplatesResultResponse,
  "ListRootsRequest": ListRootsRequest,
  "ListRootsResult": ListRootsResult,
  "ListToolsRequest": ListToolsRequest,
  "ListToolsResult": ListToolsResult,
  "ListToolsResultResponse": ListToolsResultResponse,
  "LoggingLevel": LoggingLevel,
  "LoggingMessageNotification": LoggingMessageNotification,
  "LoggingMessageNotificationParams": LoggingMessageNotificationParams,
  "MetaObject": MetaObject,
  "MethodNotFoundError": MethodNotFoundError,
  "MissingRequiredClientCapabilityError": MissingRequiredClientCapabilityError,
  "ModelHint": ModelHint,
  "ModelPreferences": ModelPreferences,
  "MultiSelectEnumSchema": MultiSelectEnumSchema,
  "Notification": Notification,
  "NotificationMetaObject": NotificationMetaObject,
  "NotificationParams": NotificationParams,
  "NumberSchema": NumberSchema,
  "PaginatedRequest": PaginatedRequest,
  "PaginatedRequestParams": PaginatedRequestParams,
  "PaginatedResult": PaginatedResult,
  "ParseError": ParseError,
  "PrimitiveSchemaDefinition": PrimitiveSchemaDefinition,
  "ProgressNotification": ProgressNotification,
  "ProgressNotificationParams": ProgressNotificationParams,
  "ProgressToken": ProgressToken,
  "Prompt": Prompt,
  "PromptArgument": PromptArgument,
  "PromptListChangedNotification": PromptListChangedNotification,
  "PromptMessage": PromptMessage,
  "PromptReference": PromptReference,
  "ReadResourceRequest": ReadResourceRequest,
  "ReadResourceRequestParams": ReadResourceRequestParams,
  "ReadResourceResult": ReadResourceResult,
  "ReadResourceResultResponse": ReadResourceResultResponse,
  "Request": Request,
  "RequestId": RequestId,
  "RequestMetaObject": RequestMetaObject,
  "RequestParams": RequestParams,
  "Resource": Resource,
  "ResourceContents": ResourceContents,
  "ResourceLink": ResourceLink,
  "ResourceListChangedNotification": ResourceListChangedNotification,
  "ResourceRequestParams": ResourceRequestParams,
  "ResourceTemplate": ResourceTemplate,
  "ResourceTemplateReference": ResourceTemplateReference,
  "ResourceUpdatedNotification": ResourceUpdatedNotification,
  "ResourceUpdatedNotificationParams": ResourceUpdatedNotificationParams,
  "Result": Result,
  "ResultMetaObject": ResultMetaObject,
  "ResultType": ResultType,
  "Role": Role,
  "Root": Root,
  "SamplingMessage": SamplingMessage,
  "SamplingMessageContentBlock": SamplingMessageContentBlock,
  "ServerCapabilities": ServerCapabilities,
  "ServerNotification": ServerNotification,
  "ServerResult": ServerResult,
  "SingleSelectEnumSchema": SingleSelectEnumSchema,
  "StringSchema": StringSchema,
  "SubscriptionFilter": SubscriptionFilter,
  "SubscriptionsAcknowledgedNotification": SubscriptionsAcknowledgedNotification,
  "SubscriptionsAcknowledgedNotificationParams": SubscriptionsAcknowledgedNotificationParams,
  "SubscriptionsListenRequest": SubscriptionsListenRequest,
  "SubscriptionsListenRequestParams": SubscriptionsListenRequestParams,
  "SubscriptionsListenResult": SubscriptionsListenResult,
  "SubscriptionsListenResultMeta": SubscriptionsListenResultMeta,
  "TextContent": TextContent,
  "TextResourceContents": TextResourceContents,
  "TitledMultiSelectEnumSchema": TitledMultiSelectEnumSchema,
  "TitledSingleSelectEnumSchema": TitledSingleSelectEnumSchema,
  "Tool": Tool,
  "ToolAnnotations": ToolAnnotations,
  "ToolChoice": ToolChoice,
  "ToolListChangedNotification": ToolListChangedNotification,
  "ToolResultContent": ToolResultContent,
  "ToolUseContent": ToolUseContent,
  "UnsupportedProtocolVersionError": UnsupportedProtocolVersionError,
  "UntitledMultiSelectEnumSchema": UntitledMultiSelectEnumSchema,
  "UntitledSingleSelectEnumSchema": UntitledSingleSelectEnumSchema
} as const satisfies { readonly [Name in McpSchemaDefinitionName]: Schema.Schema.All }
