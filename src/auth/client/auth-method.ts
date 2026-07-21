import { snapshotDenseAuthorizationArray } from "../common.js"

export type TokenEndpointAuthMethod =
  | "none"
  | "client_secret_post"
  | "client_secret_basic"

export const isTokenEndpointAuthMethod = (
  value: unknown
): value is TokenEndpointAuthMethod => value === "none" ||
  value === "client_secret_post" ||
  value === "client_secret_basic"

export const isTokenEndpointAuthMethodCompatible = (
  method: TokenEndpointAuthMethod,
  hasClientSecret: boolean
): boolean => method === "none" ? !hasClientSecret : hasClientSecret

const snapshotAdvertisedMethods = (
  value: unknown
): ReadonlyArray<string> | undefined => {
  const snapshot = snapshotDenseAuthorizationArray(value, 0, 64)
  if (snapshot._tag === "Failure") return undefined
  const methods: Array<string> = []
  for (const method of snapshot.values) {
    if (typeof method !== "string" || method.length === 0 || method.length > 128 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(method)) return undefined
    methods.push(method)
  }
  return Object.freeze(methods)
}

export const selectTokenEndpointAuthMethod = (
  configuredMethod: unknown,
  hasClientSecret: boolean,
  advertisedMethods: unknown
): TokenEndpointAuthMethod | undefined => {
  if (configuredMethod !== undefined) {
    if (!isTokenEndpointAuthMethod(configuredMethod) ||
      !isTokenEndpointAuthMethodCompatible(configuredMethod, hasClientSecret)) return undefined
    if (advertisedMethods === undefined) return configuredMethod
    const advertised = snapshotAdvertisedMethods(advertisedMethods)
    return advertised?.includes(configuredMethod) === true ? configuredMethod : undefined
  }

  if (advertisedMethods === undefined) {
    return hasClientSecret ? "client_secret_basic" : "none"
  }
  const advertised = snapshotAdvertisedMethods(advertisedMethods)
  if (advertised === undefined) return undefined
  if (hasClientSecret) {
    if (advertised.includes("client_secret_basic")) return "client_secret_basic"
    if (advertised.includes("client_secret_post")) return "client_secret_post"
    return undefined
  }
  return advertised.includes("none") ? "none" : undefined
}
