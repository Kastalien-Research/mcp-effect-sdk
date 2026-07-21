import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type {
  AuthorizationGrantHandle
} from "../common.js"
import type { AuthorizationClientError } from "./errors.js"
import type {
  AuthorizationChallengeRequest,
  AuthorizationClientService,
  AuthorizationClientStoreService,
  AuthorizationCryptoService,
  AuthorizationHttpClientService,
  AuthorizationInteractionService,
  AuthorizationRequest
} from "./models.js"

export class AuthorizationHttpClient extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationHttpClient"
)<AuthorizationHttpClient, AuthorizationHttpClientService>() {}

export class AuthorizationCrypto extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationCrypto"
)<AuthorizationCrypto, AuthorizationCryptoService>() {}

export class AuthorizationInteraction extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationInteraction"
)<AuthorizationInteraction, AuthorizationInteractionService>() {}

export class AuthorizationClientStore extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationClientStore"
)<AuthorizationClientStore, AuthorizationClientStoreService>() {}

export class AuthorizationClient extends Context.Tag(
  "mcp-effect-sdk/auth/client/AuthorizationClient"
)<AuthorizationClient, AuthorizationClientService>() {}

export const currentAuthorizationGrant = (
  request: AuthorizationRequest
): Effect.Effect<
  Option.Option<AuthorizationGrantHandle>,
  AuthorizationClientError,
  AuthorizationClient
> => Effect.flatMap(AuthorizationClient, (client) => client.currentGrant(request))

export const acquireAuthorization = (
  request: AuthorizationRequest
): Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError, AuthorizationClient> =>
  Effect.flatMap(AuthorizationClient, (client) => client.acquire(request))

export const respondToAuthorizationChallenge = (
  request: AuthorizationChallengeRequest
): Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError, AuthorizationClient> =>
  Effect.flatMap(AuthorizationClient, (client) => client.respondToChallenge(request))
