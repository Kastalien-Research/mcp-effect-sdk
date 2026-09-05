import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type { AuthorizationGrantHandle } from "../common.js"
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

export class AuthorizationHttpClient extends Context.Service<AuthorizationHttpClient, AuthorizationHttpClientService>()(
  "mcp-effect-sdk/auth/client/AuthorizationHttpClient"
) {}

export class AuthorizationCrypto extends Context.Service<AuthorizationCrypto, AuthorizationCryptoService>()(
  "mcp-effect-sdk/auth/client/AuthorizationCrypto"
) {}

export class AuthorizationInteraction extends Context.Service<
  AuthorizationInteraction,
  AuthorizationInteractionService
>()("mcp-effect-sdk/auth/client/AuthorizationInteraction") {}

export class AuthorizationClientStore extends Context.Service<
  AuthorizationClientStore,
  AuthorizationClientStoreService
>()("mcp-effect-sdk/auth/client/AuthorizationClientStore") {}

export class AuthorizationClient extends Context.Service<AuthorizationClient, AuthorizationClientService>()(
  "mcp-effect-sdk/auth/client/AuthorizationClient"
) {}

export const currentAuthorizationGrant = (
  request: AuthorizationRequest
): Effect.Effect<Option.Option<AuthorizationGrantHandle>, AuthorizationClientError, AuthorizationClient> =>
  Effect.flatMap(Effect.service(AuthorizationClient), (client) => client.currentGrant(request))

export const acquireAuthorization = (
  request: AuthorizationRequest
): Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError, AuthorizationClient> =>
  Effect.flatMap(Effect.service(AuthorizationClient), (client) => client.acquire(request))

export const respondToAuthorizationChallenge = (
  request: AuthorizationChallengeRequest
): Effect.Effect<AuthorizationGrantHandle, AuthorizationClientError, AuthorizationClient> =>
  Effect.flatMap(Effect.service(AuthorizationClient), (client) => client.respondToChallenge(request))
