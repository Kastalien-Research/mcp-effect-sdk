export {
  AuthorizationChallenge,
  AuthorizationScope,
  AuthorizationScopeSet,
  ProtectedResourceMetadata
} from "./common.js"
export {
  AuthorizationPolicyError,
  BearerAuthorizationError,
  TokenVerificationError
} from "./protected-resource/errors.js"
export { AuthorizationPrincipal } from "./protected-resource/models.js"
export type {
  TokenVerificationRequest,
  TokenVerifierService
} from "./protected-resource/models.js"
export {
  extractBearerToken,
  insufficientScopeChallenge,
  requireAuthorizationScopes,
  serializeAuthorizationChallenge,
  TokenVerifier,
  unauthorizedChallenge,
  verifyBearerAuthorization,
  verifyToken
} from "./protected-resource/services.js"
