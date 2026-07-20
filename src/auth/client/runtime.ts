import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import {
  AuthorizationChallenge,
  type AuthorizationGrantHandle,
  type AuthorizationScope,
  AuthorizationScopeSet,
  snapshotDenseAuthorizationArray
} from "../common.js"
import { discoverAuthorizationServerMetadata, discoverProtectedResourceMetadata } from "./discovery.js"
import type { AuthorizationClientError } from "./errors.js"
import { AuthorizationProtocolError } from "./errors.js"
import type {
  AuthorizationChallengeRequest,
  AuthorizationClientService,
  AuthorizationRequest,
  StoredAuthorizationCredential,
  StoredAuthorizationGrant
} from "./models.js"
import {
  type AuthorizationResolutionConfiguration,
  type AuthorizationResolutionConfigurationSnapshot,
  type PreRegisteredAuthorizationCredential,
  snapshotAuthorizationResolutionConfiguration
} from "./registration.js"
import {
  resolveAuthorizationContext,
  resolveAuthorizationScopes,
  selectAuthorizationServer
} from "./resolution.js"
import {
  AuthorizationClient,
  AuthorizationClientStore,
  AuthorizationCrypto,
  AuthorizationHttpClient,
  AuthorizationInteraction
} from "./services.js"
import { refreshAuthorizationGrant, type TokenAudienceValidator, exchangeAuthorizationCode } from "./token.js"
import { performAuthorizationInteraction } from "./transaction.js"
import {
  type AuthorizationEndpointPolicy,
  isAllowedProtectedResource,
  isAuthorizationEndpointPolicy,
  isSafeRedirectIdentifier
} from "./uri.js"

export type { AuthorizationEndpointPolicy } from "./uri.js"
export type {
  AuthorizationResolutionConfiguration,
  PreRegisteredAuthorizationCredential
} from "./registration.js"
export type { TokenAudienceValidator, TokenAudienceValidationInput } from "./token.js"

export interface AuthorizationClientConfig {
  readonly protectedResource: string
  readonly requestedScopes: AuthorizationScopeSet
  readonly redirectUri: string
  readonly registration: AuthorizationResolutionConfiguration
  readonly validateAudience: TokenAudienceValidator
  readonly endpointPolicy?: AuthorizationEndpointPolicy
}

interface AuthorizationClientConfigSnapshot {
  readonly protectedResource: string
  readonly requestedScopes: AuthorizationScopeSet
  readonly redirectUri: string
  readonly registration: AuthorizationResolutionConfigurationSnapshot
  readonly validateAudience: TokenAudienceValidator
  readonly endpointPolicy: AuthorizationEndpointPolicy
}

const protocolFailure = (
  reason: ConstructorParameters<typeof AuthorizationProtocolError>[0]["reason"]
): AuthorizationProtocolError => new AuthorizationProtocolError({ reason })

const ownDataValue = (source: object, key: PropertyKey): unknown => {
  const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
  if (descriptor === undefined) return undefined
  if (!("value" in descriptor)) throw new TypeError("Invalid authorization runtime input")
  return descriptor.value
}

const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value)

const snapshotScopes = (value: unknown): AuthorizationScopeSet | undefined => {
  const snapshot = snapshotDenseAuthorizationArray(value, 0, 4096)
  if (snapshot._tag === "Failure") return undefined
  try {
    return Schema.decodeUnknownSync(AuthorizationScopeSet)(snapshot.values)
  } catch {
    return undefined
  }
}

const mergeScopes = (...sets: ReadonlyArray<AuthorizationScopeSet>): AuthorizationScopeSet => {
  const output: Array<AuthorizationScope> = []
  const seen = new Set<string>()
  for (const scopes of sets) {
    for (const scope of scopes) {
      if (seen.has(scope)) continue
      seen.add(scope)
      output.push(scope)
    }
  }
  return Object.freeze(output) as AuthorizationScopeSet
}

const snapshotConfig = (value: unknown): AuthorizationClientConfigSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    Reflect.ownKeys(value)
    const endpointPolicy = ownDataValue(value, "endpointPolicy") ?? "https-only"
    const protectedResource = ownDataValue(value, "protectedResource")
    const requestedScopes = snapshotScopes(ownDataValue(value, "requestedScopes"))
    const redirectUri = ownDataValue(value, "redirectUri")
    const validateAudience = ownDataValue(value, "validateAudience")
    if (!isAuthorizationEndpointPolicy(endpointPolicy) ||
      !isAllowedProtectedResource(protectedResource, endpointPolicy) ||
      requestedScopes === undefined || !isSafeRedirectIdentifier(redirectUri) ||
      typeof validateAudience !== "function") return undefined
    const registration = snapshotAuthorizationResolutionConfiguration(
      ownDataValue(value, "registration"),
      endpointPolicy
    )
    if (registration === undefined || !registration.redirectUris.includes(redirectUri)) return undefined
    return Object.freeze({
      protectedResource,
      requestedScopes,
      redirectUri,
      registration,
      validateAudience: validateAudience as TokenAudienceValidator,
      endpointPolicy
    })
  } catch {
    return undefined
  }
}

interface RequestSnapshot {
  readonly protectedResource: string
  readonly requestedScopes: AuthorizationScopeSet
}

const snapshotRequest = (
  value: unknown,
  config: AuthorizationClientConfigSnapshot
): RequestSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const protectedResource = ownDataValue(value, "protectedResource")
    const requestedScopes = snapshotScopes(ownDataValue(value, "requestedScopes"))
    return protectedResource === config.protectedResource && requestedScopes !== undefined
      ? Object.freeze({ protectedResource, requestedScopes })
      : undefined
  } catch {
    return undefined
  }
}

interface ChallengeSnapshot {
  readonly protectedResource: string
  readonly challenge: AuthorizationChallenge
  readonly priorGrant?: AuthorizationGrantHandle
}

const snapshotChallenge = (
  value: unknown,
  config: AuthorizationClientConfigSnapshot
): ChallengeSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const protectedResource = ownDataValue(value, "protectedResource")
    const rawChallenge = ownDataValue(value, "challenge")
    const priorGrant = ownDataValue(value, "priorGrant")
    if (protectedResource !== config.protectedResource ||
      priorGrant !== undefined && !boundedText(priorGrant, 4096) ||
      typeof rawChallenge !== "object" || rawChallenge === null) return undefined
    const challengeSnapshot: Record<string, unknown> = {}
    for (const key of ["scheme", "status", "error", "errorDescription", "scopes", "resourceMetadata"]) {
      const descriptor = Reflect.getOwnPropertyDescriptor(rawChallenge, key)
      if (descriptor === undefined) continue
      if (!("value" in descriptor)) return undefined
      challengeSnapshot[key] = descriptor.value
    }
    const challenge = Schema.decodeUnknownSync(AuthorizationChallenge)(challengeSnapshot)
    return Object.freeze({
      protectedResource,
      challenge,
      ...(priorGrant === undefined ? {} : { priorGrant: priorGrant as AuthorizationGrantHandle })
    })
  } catch {
    return undefined
  }
}

interface CredentialSnapshot {
  readonly issuer: string
  readonly clientId: string
}

const snapshotCredential = (value: unknown): CredentialSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const clientId = ownDataValue(value, "clientId")
    return boundedText(issuer, 2048) && boundedText(clientId, 2048)
      ? Object.freeze({ issuer, clientId })
      : undefined
  } catch {
    return undefined
  }
}

interface GrantSnapshot {
  readonly issuer: string
  readonly resource: string
  readonly clientId: string
  readonly scopes: AuthorizationScopeSet
  readonly refreshToken: boolean
  readonly expiresAt?: number
}

const snapshotGrant = (value: unknown): GrantSnapshot | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined
    const issuer = ownDataValue(value, "issuer")
    const resource = ownDataValue(value, "resource")
    const clientId = ownDataValue(value, "clientId")
    const scopes = snapshotScopes(ownDataValue(value, "scopes"))
    const expiresAt = ownDataValue(value, "expiresAt")
    const refreshToken = ownDataValue(value, "refreshToken")
    if (!boundedText(issuer, 2048) || !boundedText(resource, 2048) ||
      !boundedText(clientId, 2048) || scopes === undefined ||
      expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || (expiresAt as number) < 0) ||
      refreshToken !== undefined && !Redacted.isRedacted(refreshToken)) return undefined
    return Object.freeze({
      issuer,
      resource,
      clientId,
      scopes,
      refreshToken: refreshToken !== undefined,
      ...(expiresAt === undefined ? {} : { expiresAt: expiresAt as number })
    })
  } catch {
    return undefined
  }
}

const scopesEqual = (left: AuthorizationScopeSet, right: AuthorizationScopeSet): boolean =>
  left.length === right.length && left.every((scope, index) => scope === right[index])

const makeService = (
  config: AuthorizationClientConfigSnapshot
): Effect.Effect<
  AuthorizationClientService,
  AuthorizationClientError,
  AuthorizationHttpClient | AuthorizationCrypto | AuthorizationInteraction | AuthorizationClientStore
> => Effect.gen(function*() {
  const http = yield* AuthorizationHttpClient
  const crypto = yield* AuthorizationCrypto
  const interaction = yield* AuthorizationInteraction
  const store = yield* AuthorizationClientStore
  const validatedResourceMetadataUri = yield* Ref.make<Option.Option<string>>(Option.none())
  const rememberedGrantHandle = yield* Ref.make<Option.Option<AuthorizationGrantHandle>>(Option.none())

  const withPorts = <A>(effect: Effect.Effect<A, AuthorizationClientError,
    AuthorizationHttpClient | AuthorizationCrypto | AuthorizationInteraction | AuthorizationClientStore>) =>
    effect.pipe(
      Effect.provideService(AuthorizationHttpClient, http),
      Effect.provideService(AuthorizationCrypto, crypto),
      Effect.provideService(AuthorizationInteraction, interaction),
      Effect.provideService(AuthorizationClientStore, store)
    )

  const forgetGrant = (handle: AuthorizationGrantHandle) => Ref.update(
    rememberedGrantHandle,
    (remembered) => Option.isSome(remembered) && remembered.value === handle
      ? Option.none()
      : remembered
  )

  const removeGrant = (handle: AuthorizationGrantHandle) => store.removeGrant(handle).pipe(
    Effect.ensuring(forgetGrant(handle))
  )

  const containsScopes = (
    granted: AuthorizationScopeSet,
    required: AuthorizationScopeSet
  ): boolean => required.every((scope) => granted.includes(scope))

  const validGrantBinding = (
    grant: GrantSnapshot,
    issuer: string,
    canonicalResource: string,
    clientId: string
  ): boolean => grant.issuer === issuer && grant.resource === canonicalResource &&
    grant.clientId === clientId

  const useGrant = (
    handle: AuthorizationGrantHandle,
    grant: GrantSnapshot,
    issuer: string,
    canonicalResource: string,
    clientId: string,
    requiredScopes: AuthorizationScopeSet
  ) => Effect.gen(function*() {
      if (!validGrantBinding(grant, issuer, canonicalResource, clientId)) {
        return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
      }
      const now = yield* Clock.currentTimeMillis
      if (grant.expiresAt === undefined || grant.expiresAt > now) {
        yield* Ref.set(rememberedGrantHandle, Option.some(handle))
        return Option.some(handle)
      }
      if (!grant.refreshToken) {
        yield* removeGrant(handle)
        return Option.none<AuthorizationGrantHandle>()
      }
      const refresh = Effect.gen(function*() {
        const metadata = yield* discoverAuthorizationServerMetadata(issuer, config.endpointPolicy)
        const refreshed = yield* refreshAuthorizationGrant({
          grant: handle,
          authorizationServerMetadata: metadata,
          validateAudience: config.validateAudience,
          receivedAt: now,
          endpointPolicy: config.endpointPolicy
        })
        const refreshedGrant = snapshotGrant(yield* store.readGrant(refreshed))
        if (refreshedGrant === undefined ||
          !validGrantBinding(refreshedGrant, issuer, canonicalResource, clientId) ||
          !containsScopes(refreshedGrant.scopes, requiredScopes)) {
          if (refreshed !== handle) {
            yield* removeGrant(refreshed).pipe(Effect.catchAll(() => Effect.void))
          }
          return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
        }
        if (refreshed !== handle) yield* removeGrant(handle)
        yield* Ref.set(rememberedGrantHandle, Option.some(refreshed))
        return Option.some(refreshed)
      })
      return yield* refresh.pipe(
        Effect.tapError(() => removeGrant(handle).pipe(Effect.catchAll(() => Effect.void)))
      )
    })

  const currentGrantCore = (request: RequestSnapshot) => Effect.gen(function*() {
    const requestedScopes = mergeScopes(config.requestedScopes, request.requestedScopes)
    const rememberedMetadataUri = yield* Ref.get(validatedResourceMetadataUri)
    const discovered = yield* Effect.either(discoverProtectedResourceMetadata({
      protectedResource: config.protectedResource,
      endpointPolicy: config.endpointPolicy,
      ...(Option.isNone(rememberedMetadataUri)
        ? {}
        : { resourceMetadataUri: rememberedMetadataUri.value })
    }))
    if (discovered._tag === "Left") {
      const error = discovered.left
      if (Option.isNone(rememberedMetadataUri) &&
        error._tag === "AuthorizationProtocolError" && error.reason === "DiscoveryFailed" &&
        error.status === undefined) return Option.none<AuthorizationGrantHandle>()
      return yield* Effect.fail(error)
    }
    const protectedResource = discovered.right
    const selected = yield* selectAuthorizationServer({
      metadata: protectedResource.metadata,
      preRegisteredCredentials: config.registration.preRegisteredCredentials,
      endpointPolicy: config.endpointPolicy
    })
    let credentialHandle = selected.credentialHandle
    if (credentialHandle === undefined) {
      const preregistered = config.registration.preRegisteredCredentials.find(
        (credential) => credential.issuer === selected.issuer
      )
      const found = yield* store.findCredential({
        issuer: selected.issuer,
        ...(preregistered === undefined ? {} : { clientId: preregistered.clientId })
      })
      if (Option.isNone(found)) return Option.none<AuthorizationGrantHandle>()
      credentialHandle = found.value
    }
    const credential = snapshotCredential(yield* store.readCredential(credentialHandle))
    if (credential === undefined || credential.issuer !== selected.issuer) {
      return yield* Effect.fail(protocolFailure("CredentialIssuerMismatch"))
    }
    const remembered = yield* Ref.get(rememberedGrantHandle)
    if (Option.isSome(remembered)) {
      const grant = snapshotGrant(yield* store.readGrant(remembered.value))
      if (grant === undefined || !validGrantBinding(
        grant,
        selected.issuer,
        protectedResource.canonicalResource,
        credential.clientId
      )) {
        return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
      }
      if (containsScopes(grant.scopes, requestedScopes)) {
        return yield* useGrant(
          remembered.value,
          grant,
          selected.issuer,
          protectedResource.canonicalResource,
          credential.clientId,
          requestedScopes
        )
      }
    }
    const resolvedScopes = yield* resolveAuthorizationScopes({
      issuer: selected.issuer,
      canonicalResource: protectedResource.canonicalResource,
      protectedResourceMetadata: protectedResource.metadata,
      requestedScopes
    })
    const found = yield* store.findGrant({
      issuer: selected.issuer,
      resource: protectedResource.canonicalResource,
      clientId: credential.clientId,
      scopes: resolvedScopes
    })
    if (Option.isNone(found)) return Option.none<AuthorizationGrantHandle>()
    const grant = snapshotGrant(yield* store.readGrant(found.value))
    if (grant === undefined || grant.issuer !== selected.issuer ||
      grant.resource !== protectedResource.canonicalResource ||
      grant.clientId !== credential.clientId || !scopesEqual(grant.scopes, resolvedScopes)) {
      return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
    }
    return yield* useGrant(
      found.value,
      grant,
      selected.issuer,
      protectedResource.canonicalResource,
      credential.clientId,
      resolvedScopes
    )
  })

  const validatePriorBeforeAuthorization = (
    prior: { readonly handle: AuthorizationGrantHandle; readonly grant: GrantSnapshot },
    resourceMetadataUri: string | undefined,
    remove: boolean
  ) => Effect.gen(function*() {
    const protectedResource = yield* discoverProtectedResourceMetadata({
      protectedResource: config.protectedResource,
      endpointPolicy: config.endpointPolicy,
      ...(resourceMetadataUri === undefined ? {} : { resourceMetadataUri })
    })
    const selected = yield* selectAuthorizationServer({
      metadata: protectedResource.metadata,
      preRegisteredCredentials: config.registration.preRegisteredCredentials,
      endpointPolicy: config.endpointPolicy
    })
    let selectedClientId = config.registration.preRegisteredCredentials.find(
      (credential) => credential.issuer === selected.issuer
    )?.clientId
    if (selectedClientId === undefined && selected.credentialHandle !== undefined) {
      selectedClientId = snapshotCredential(
        yield* store.readCredential(selected.credentialHandle)
      )?.clientId
    }
    if (prior.grant.issuer !== selected.issuer ||
      prior.grant.resource !== protectedResource.canonicalResource ||
      selectedClientId === undefined || prior.grant.clientId !== selectedClientId) {
      return yield* Effect.fail(protocolFailure("InvalidChallenge"))
    }
    if (remove) yield* removeGrant(prior.handle)
  })

  const authorize = (
    requestedScopes: AuthorizationScopeSet,
    options: {
      readonly resourceMetadataUri?: string
      readonly challengeScopes?: AuthorizationScopeSet
      readonly prior?: {
        readonly handle: AuthorizationGrantHandle
        readonly grant: GrantSnapshot
        readonly remove: boolean
      }
    } = {}
  ) => Effect.gen(function*() {
    const context = yield* resolveAuthorizationContext({
      protectedResource: config.protectedResource,
      requestedScopes,
      ...(options.challengeScopes === undefined
        ? {}
        : { challengeScopes: options.challengeScopes }),
      configuration: config.registration,
      endpointPolicy: config.endpointPolicy,
      ...(options.resourceMetadataUri === undefined
        ? {}
        : { resourceMetadataUri: options.resourceMetadataUri })
    })
    if (options.prior !== undefined) {
      const selectedCredential = snapshotCredential(
        yield* store.readCredential(context.credentialHandle)
      )
      if (selectedCredential === undefined ||
        options.prior.grant.issuer !== context.issuer ||
        options.prior.grant.resource !== context.canonicalResource ||
        options.prior.grant.clientId !== selectedCredential.clientId) {
        return yield* Effect.fail(protocolFailure("InvalidChallenge"))
      }
      if (options.prior.remove) yield* store.removeGrant(options.prior.handle)
    }
    const createdAt = yield* Clock.currentTimeMillis
    const authorization = yield* performAuthorizationInteraction({
      authorizationServerMetadata: context.authorizationServerMetadata,
      issuer: context.issuer,
      canonicalResource: context.canonicalResource,
      credentialHandle: context.credentialHandle,
      scopes: context.scopes,
      redirectUri: config.redirectUri,
      createdAt,
      endpointPolicy: config.endpointPolicy
    })
    const receivedAt = yield* Clock.currentTimeMillis
    const grant = yield* exchangeAuthorizationCode({
      authorization,
      authorizationServerMetadata: context.authorizationServerMetadata,
      validateAudience: config.validateAudience,
      receivedAt,
      endpointPolicy: config.endpointPolicy
    })
    const storedGrant = snapshotGrant(yield* store.readGrant(grant))
    const storedCredential = snapshotCredential(
      yield* store.readCredential(context.credentialHandle)
    )
    if (storedGrant === undefined || storedCredential === undefined ||
      !validGrantBinding(
        storedGrant,
        context.issuer,
        context.canonicalResource,
        storedCredential.clientId
      ) || !containsScopes(storedGrant.scopes, context.scopes)) {
      return yield* Effect.fail(protocolFailure("InvalidConfiguration"))
    }
    yield* Ref.set(rememberedGrantHandle, Option.some(grant))
    if (options.resourceMetadataUri !== undefined) {
      yield* Ref.set(validatedResourceMetadataUri, Option.some(options.resourceMetadataUri))
    }
    return grant
  })

  const currentGrant = (request: AuthorizationRequest) => {
    const snapshot = snapshotRequest(request, config)
    return snapshot === undefined
      ? Effect.fail(protocolFailure("InvalidConfiguration"))
      : withPorts(currentGrantCore(snapshot))
  }

  const acquire = (request: AuthorizationRequest) => {
    const snapshot = snapshotRequest(request, config)
    if (snapshot === undefined) return Effect.fail(protocolFailure("InvalidConfiguration"))
    return withPorts(Effect.gen(function*() {
      const current = yield* currentGrantCore(snapshot)
      if (Option.isSome(current)) return current.value
      return yield* authorize(mergeScopes(config.requestedScopes, snapshot.requestedScopes))
    }))
  }

  const respondToChallenge = (request: AuthorizationChallengeRequest) => {
    const snapshot = snapshotChallenge(request, config)
    if (snapshot === undefined) return Effect.fail(protocolFailure("InvalidChallenge"))
    const challenge = snapshot.challenge
    const validInvalidToken = challenge.status === 401 &&
      (challenge.error === undefined || challenge.error === "invalid_token")
    const validInsufficientScope = challenge.status === 403 &&
      challenge.error === "insufficient_scope"
    if (!validInvalidToken && !validInsufficientScope) {
      return Effect.fail(protocolFailure("InvalidChallenge"))
    }
    return withPorts(Effect.gen(function*() {
      let prior: { readonly handle: AuthorizationGrantHandle; readonly grant: GrantSnapshot } |
        undefined
      if (snapshot.priorGrant !== undefined) {
        const grant = snapshotGrant(yield* store.readGrant(snapshot.priorGrant))
        if (grant === undefined) return yield* Effect.fail(protocolFailure("InvalidChallenge"))
        prior = Object.freeze({ handle: snapshot.priorGrant, grant })
        yield* validatePriorBeforeAuthorization(
          prior,
          challenge.resourceMetadata,
          validInvalidToken
        )
      }
      if (validInvalidToken) {
        const priorScopes = prior?.grant.scopes ?? Object.freeze([]) as AuthorizationScopeSet
        return yield* authorize(
          mergeScopes(priorScopes, config.requestedScopes),
          {
            ...(challenge.scopes === undefined ? {} : { challengeScopes: challenge.scopes }),
            ...(challenge.resourceMetadata === undefined
              ? {}
              : { resourceMetadataUri: challenge.resourceMetadata }),
            ...(prior === undefined ? {} : {
              prior: { handle: prior.handle, grant: prior.grant, remove: false }
            })
          }
        )
      }
      return yield* authorize(mergeScopes(
        prior?.grant.scopes ?? Object.freeze([]) as AuthorizationScopeSet,
        config.requestedScopes
      ), {
        ...(challenge.scopes === undefined ? {} : { challengeScopes: challenge.scopes }),
        ...(challenge.resourceMetadata === undefined
          ? {}
          : { resourceMetadataUri: challenge.resourceMetadata }),
        ...(prior === undefined ? {} : {
          prior: { handle: prior.handle, grant: prior.grant, remove: false }
        })
      })
    }))
  }

  return Object.freeze({ currentGrant, acquire, respondToChallenge })
})

export const makeAuthorizationClient = (
  config: AuthorizationClientConfig
): Effect.Effect<
  AuthorizationClientService,
  AuthorizationClientError,
  AuthorizationHttpClient | AuthorizationCrypto | AuthorizationInteraction | AuthorizationClientStore
> => {
  const snapshot = snapshotConfig(config)
  return snapshot === undefined
    ? Effect.fail(protocolFailure("InvalidConfiguration"))
    : makeService(snapshot)
}

export const layerAuthorizationClient = (
  config: AuthorizationClientConfig
): Layer.Layer<
  AuthorizationClient,
  AuthorizationClientError,
  AuthorizationHttpClient | AuthorizationCrypto | AuthorizationInteraction | AuthorizationClientStore
> => Layer.effect(AuthorizationClient, makeAuthorizationClient(config))
