import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  AuthorizationServerMetadata,
  ProtectedResourceMetadata
} from "../common.js"
import {
  AuthorizationDecodeError,
  AuthorizationProtocolError
} from "./errors.js"
import { decodeJsonObject, snapshotHttpReply } from "./json.js"
import { AuthorizationHttpClient } from "./services.js"
import {
  authorizationServerMetadataCandidates,
  isSafeHttpsEndpoint,
  isSafeHttpsIssuer,
  isSameOriginPathParent,
  parseAuthorizationUri,
  protectedResourceMetadataCandidates
} from "./uri.js"

export interface DiscoverProtectedResourceMetadataInput {
  readonly protectedResource: string
  readonly resourceMetadataUri?: string
}

export interface DiscoveredProtectedResourceMetadata {
  readonly metadata: ProtectedResourceMetadata
  readonly canonicalResource: string
}

const decodeFailure = (
  model: "ProtectedResourceMetadata" | "AuthorizationServerMetadata"
): AuthorizationDecodeError => new AuthorizationDecodeError({ model, issues: [] })

const protocolFailure = (
  reason: ConstructorParameters<typeof AuthorizationProtocolError>[0]["reason"],
  fields: { readonly status?: number; readonly issuer?: string; readonly resource?: string } = {}
): AuthorizationProtocolError => new AuthorizationProtocolError({ reason, ...fields })

export const discoverProtectedResourceMetadata = (
  input: DiscoverProtectedResourceMetadataInput
) => Effect.gen(function*() {
  const requested = parseAuthorizationUri(input.protectedResource)
  if (requested._tag === "Failure" || requested.value.scheme.toLowerCase() !== "https" ||
    requested.value.fragment !== undefined) {
    return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
  }
  let candidates: ReadonlyArray<string>
  if (input.resourceMetadataUri !== undefined) {
    if (!isSafeHttpsEndpoint(input.resourceMetadataUri)) {
      return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
    }
    candidates = Object.freeze([input.resourceMetadataUri])
  } else {
    candidates = protectedResourceMetadataCandidates(requested.value)
  }

  const http = yield* AuthorizationHttpClient
  for (const candidate of candidates) {
    const rawReply = yield* http.request({ method: "GET", url: candidate, headers: [] })
    const reply = snapshotHttpReply(rawReply)
    if (reply._tag === "Failure") {
      return yield* Effect.fail(decodeFailure("ProtectedResourceMetadata"))
    }
    if (reply.value.status === 404) continue
    if (reply.value.status < 200 || reply.value.status >= 300) {
      return yield* Effect.fail(protocolFailure("DiscoveryFailed", { status: reply.value.status }))
    }
    const json = decodeJsonObject(reply.value.body)
    if (json._tag === "Failure") {
      return yield* Effect.fail(decodeFailure("ProtectedResourceMetadata"))
    }
    const metadata = yield* Schema.decodeUnknown(ProtectedResourceMetadata)(json.value).pipe(
      Effect.mapError(() => decodeFailure("ProtectedResourceMetadata"))
    )
    const canonical = parseAuthorizationUri(metadata.resource)
    if (canonical._tag === "Failure" ||
      !isSameOriginPathParent(canonical.value, requested.value)) {
      return yield* Effect.fail(protocolFailure("ResourceMismatch"))
    }
    return Object.freeze({ metadata, canonicalResource: metadata.resource })
  }
  return yield* Effect.fail(protocolFailure("DiscoveryFailed"))
})

export const discoverAuthorizationServerMetadata = (issuer: string) => Effect.gen(function*() {
  if (!isSafeHttpsIssuer(issuer)) {
    return yield* Effect.fail(protocolFailure("UnsupportedAuthorizationServer"))
  }
  const parsedIssuer = parseAuthorizationUri(issuer)
  if (parsedIssuer._tag === "Failure") {
    return yield* Effect.fail(protocolFailure("UnsupportedAuthorizationServer"))
  }
  const http = yield* AuthorizationHttpClient
  for (const candidate of authorizationServerMetadataCandidates(parsedIssuer.value)) {
    const rawReply = yield* http.request({ method: "GET", url: candidate, headers: [] })
    const reply = snapshotHttpReply(rawReply)
    if (reply._tag === "Failure") {
      return yield* Effect.fail(decodeFailure("AuthorizationServerMetadata"))
    }
    if (reply.value.status === 404) continue
    if (reply.value.status < 200 || reply.value.status >= 300) {
      return yield* Effect.fail(protocolFailure("DiscoveryFailed", { status: reply.value.status }))
    }
    const json = decodeJsonObject(reply.value.body)
    if (json._tag === "Failure") {
      return yield* Effect.fail(decodeFailure("AuthorizationServerMetadata"))
    }
    const metadata = yield* Schema.decodeUnknown(AuthorizationServerMetadata)(json.value).pipe(
      Effect.mapError(() => decodeFailure("AuthorizationServerMetadata"))
    )
    if (metadata.issuer !== issuer) {
      return yield* Effect.fail(protocolFailure("IssuerMismatch"))
    }
    if (!isSafeHttpsEndpoint(metadata.tokenEndpoint) ||
      metadata.authorizationEndpoint !== undefined &&
        !isSafeHttpsEndpoint(metadata.authorizationEndpoint) ||
      metadata.registrationEndpoint !== undefined &&
        !isSafeHttpsEndpoint(metadata.registrationEndpoint)) {
      return yield* Effect.fail(protocolFailure("UnsupportedAuthorizationServer"))
    }
    return metadata
  }
  return yield* Effect.fail(protocolFailure("DiscoveryFailed"))
})
