import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type {
  AuthorizationCredentialHandle,
  AuthorizationGrantHandle,
  AuthorizationScope,
  AuthorizationScopeSet,
  AuthorizationServerMetadata,
  ProtectedResourceMetadata
} from "../common.js"
import { snapshotDenseAuthorizationArray } from "../common.js"
import {
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata
} from "./discovery.js"
import { AuthorizationProtocolError, AuthorizationStoreError } from "./errors.js"
import {
  type AuthorizationResolutionConfiguration,
  type PreRegisteredAuthorizationCredential,
  resolveAuthorizationCredential,
  snapshotAuthorizationResolutionConfiguration
} from "./registration.js"
import { AuthorizationClientStore } from "./services.js"
import { isSafeHttpsIssuer } from "./uri.js"

export interface SelectAuthorizationServerInput {
  readonly metadata: ProtectedResourceMetadata
  readonly preRegisteredCredentials: ReadonlyArray<PreRegisteredAuthorizationCredential>
}

export interface SelectedAuthorizationServer {
  readonly issuer: string
  readonly credentialHandle?: AuthorizationCredentialHandle
}

export interface ResolveAuthorizationScopesInput {
  readonly issuer: string
  readonly canonicalResource: string
  readonly protectedResourceMetadata: ProtectedResourceMetadata
  readonly requestedScopes: AuthorizationScopeSet
  readonly challengeScopes?: AuthorizationScopeSet
  readonly priorGrant?: AuthorizationGrantHandle
}

export interface ResolveAuthorizationContextInput {
  readonly protectedResource: string
  readonly resourceMetadataUri?: string
  readonly requestedScopes: AuthorizationScopeSet
  readonly challengeScopes?: AuthorizationScopeSet
  readonly priorGrant?: AuthorizationGrantHandle
  readonly configuration: AuthorizationResolutionConfiguration
}

export interface ResolvedAuthorizationContext {
  readonly protectedResourceMetadata: ProtectedResourceMetadata
  readonly authorizationServerMetadata: AuthorizationServerMetadata
  readonly issuer: string
  readonly canonicalResource: string
  readonly credentialHandle: AuthorizationCredentialHandle
  readonly scopes: AuthorizationScopeSet
}

const protocolFailure = (
  reason: ConstructorParameters<typeof AuthorizationProtocolError>[0]["reason"]
): AuthorizationProtocolError => new AuthorizationProtocolError({ reason })

const snapshotPreRegistrationIssuers = (value: unknown): ReadonlySet<string> | undefined => {
  const snapshot = snapshotDenseAuthorizationArray(value, 0, 4096)
  if (snapshot._tag === "Failure") return undefined
  const issuers = new Set<string>()
  try {
    for (const item of snapshot.values) {
      if (typeof item !== "object" || item === null) return undefined
      const descriptor = Reflect.getOwnPropertyDescriptor(item, "issuer")
      if (descriptor === undefined || !("value" in descriptor) ||
        !isSafeHttpsIssuer(descriptor.value)) return undefined
      issuers.add(descriptor.value)
    }
    return issuers
  } catch {
    return undefined
  }
}

export const selectAuthorizationServer = (
  input: SelectAuthorizationServerInput
): Effect.Effect<
  SelectedAuthorizationServer,
  AuthorizationProtocolError | AuthorizationStoreError,
  AuthorizationClientStore
> => Effect.gen(function*() {
  const advertised = input.metadata.authorizationServers
  for (const issuer of advertised) {
    if (!isSafeHttpsIssuer(issuer)) {
      return yield* Effect.fail(protocolFailure("UnsupportedAuthorizationServer"))
    }
  }
  const configuredIssuers = snapshotPreRegistrationIssuers(input.preRegisteredCredentials)
  if (configuredIssuers === undefined) {
    return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
  }
  for (const issuer of advertised) {
    if (configuredIssuers.has(issuer)) return Object.freeze({ issuer })
  }
  const store = yield* AuthorizationClientStore
  for (const issuer of advertised) {
    const found = yield* store.findCredential({ issuer })
    if (Option.isNone(found)) continue
    const credential = yield* store.readCredential(found.value)
    if (credential.issuer !== issuer) {
      return yield* Effect.fail(protocolFailure("CredentialIssuerMismatch"))
    }
    return Object.freeze({ issuer, credentialHandle: found.value })
  }
  return Object.freeze({ issuer: advertised[0]! })
})

const appendScopes = (
  output: Array<AuthorizationScope>,
  seen: Set<string>,
  scopes: AuthorizationScopeSet
): void => {
  for (const scope of scopes) {
    if (seen.has(scope)) continue
    seen.add(scope)
    output.push(scope)
  }
}

export const resolveAuthorizationScopes = (
  input: ResolveAuthorizationScopesInput
) => Effect.gen(function*() {
  const output: Array<AuthorizationScope> = []
  const seen = new Set<string>()
  if (input.priorGrant !== undefined) {
    const store = yield* AuthorizationClientStore
    const grant = yield* store.readGrant(input.priorGrant)
    if (grant.issuer !== input.issuer) {
      return yield* Effect.fail(protocolFailure("IssuerMismatch"))
    }
    if (grant.resource !== input.canonicalResource) {
      return yield* Effect.fail(protocolFailure("ResourceMismatch"))
    }
    appendScopes(output, seen, grant.scopes)
  }
  appendScopes(output, seen, input.requestedScopes)
  if (input.challengeScopes !== undefined) appendScopes(output, seen, input.challengeScopes)
  if (output.length === 0 && input.challengeScopes === undefined &&
    input.protectedResourceMetadata.scopesSupported !== undefined) {
    appendScopes(output, seen, input.protectedResourceMetadata.scopesSupported)
  }
  return Object.freeze(output) as AuthorizationScopeSet
})

export const resolveAuthorizationContext = (
  input: ResolveAuthorizationContextInput
) => Effect.gen(function*() {
  const configuration = snapshotAuthorizationResolutionConfiguration(input.configuration)
  if (configuration === undefined) {
    return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
  }
  const protectedResource = yield* discoverProtectedResourceMetadata({
    protectedResource: input.protectedResource,
    ...(input.resourceMetadataUri === undefined
      ? {}
      : { resourceMetadataUri: input.resourceMetadataUri })
  })
  const selected = yield* selectAuthorizationServer({
    metadata: protectedResource.metadata,
    preRegisteredCredentials: configuration.preRegisteredCredentials
  })
  const authorizationServerMetadata = yield* discoverAuthorizationServerMetadata(selected.issuer)
  const selectedCredentialHandle = selected.credentialHandle
  const scopes = yield* resolveAuthorizationScopes({
    issuer: selected.issuer,
    canonicalResource: protectedResource.canonicalResource,
    protectedResourceMetadata: protectedResource.metadata,
    requestedScopes: input.requestedScopes,
    ...(input.challengeScopes === undefined ? {} : { challengeScopes: input.challengeScopes }),
    ...(input.priorGrant === undefined ? {} : { priorGrant: input.priorGrant })
  })
  const credentialHandle = yield* resolveAuthorizationCredential({
    issuer: selected.issuer,
    authorizationServerMetadata,
    ...(selectedCredentialHandle === undefined
      ? {}
      : { selectedCredentialHandle }),
    scopes,
    configuration
  })
  return Object.freeze({
    protectedResourceMetadata: protectedResource.metadata,
    authorizationServerMetadata,
    issuer: selected.issuer,
    canonicalResource: protectedResource.canonicalResource,
    credentialHandle,
    scopes
  })
})
