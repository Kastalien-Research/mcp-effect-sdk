import * as Schema from "effect/Schema"
import { SafeAuthorizationUri, SafeRedirectUri } from "../common.js"

export interface AuthorizationUriSnapshot {
  readonly value: string
  readonly scheme: string
  readonly authority: string
  readonly host: string
  readonly port?: string
  readonly origin: string
  readonly originKey: string
  readonly path: string
  readonly query?: string
  readonly fragment?: string
  readonly loopback: boolean
}

type UriResult =
  | { readonly _tag: "Success"; readonly value: AuthorizationUriSnapshot }
  | { readonly _tag: "Failure" }

const failure: UriResult = Object.freeze({ _tag: "Failure" })

const splitHostAndPort = (
  authority: string
): { readonly host: string; readonly port?: string } | undefined => {
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]")
    if (close < 0) return undefined
    const suffix = authority.slice(close + 1)
    if (suffix.length > 0 && !suffix.startsWith(":")) return undefined
    return {
      host: authority.slice(1, close),
      ...(suffix.length === 0 ? {} : { port: suffix.slice(1) })
    }
  }
  const separator = authority.lastIndexOf(":")
  if (separator < 0) return { host: authority }
  return { host: authority.slice(0, separator), port: authority.slice(separator + 1) }
}

const makeOriginKey = (scheme: string, host: string, port: string | undefined): string => {
  const normalizedScheme = scheme.toLowerCase()
  const normalizedHost = host.toLowerCase()
  const normalizedPort = port === undefined ||
      normalizedScheme === "https" && port === "443" ||
      normalizedScheme === "http" && port === "80"
    ? ""
    : `:${port}`
  return `${normalizedScheme}://${normalizedHost}${normalizedPort}`
}

export const parseAuthorizationUri = (value: unknown): UriResult => {
  try {
    if (!Schema.is(SafeAuthorizationUri)(value)) return failure
    const schemeEnd = value.indexOf("://")
    if (schemeEnd <= 0) return failure
    const scheme = value.slice(0, schemeEnd)
    const suffix = value.slice(schemeEnd + 3)
    const boundary = suffix.search(/[/?#]/)
    const authority = boundary < 0 ? suffix : suffix.slice(0, boundary)
    const hostAndPort = splitHostAndPort(authority)
    if (hostAndPort === undefined) return failure
    const remainder = boundary < 0 ? "" : suffix.slice(boundary)
    const fragmentAt = remainder.indexOf("#")
    const beforeFragment = fragmentAt < 0 ? remainder : remainder.slice(0, fragmentAt)
    const fragment = fragmentAt < 0 ? undefined : remainder.slice(fragmentAt + 1)
    const queryAt = beforeFragment.indexOf("?")
    const path = queryAt < 0 ? beforeFragment : beforeFragment.slice(0, queryAt)
    const query = queryAt < 0 ? undefined : beforeFragment.slice(queryAt + 1)
    const origin = `${scheme}://${authority}`
    const host = hostAndPort.host
    const normalizedHost = host.toLowerCase()
    return {
      _tag: "Success",
      value: Object.freeze({
        value,
        scheme,
        authority,
        host,
        ...(hostAndPort.port === undefined ? {} : { port: hostAndPort.port }),
        origin,
        originKey: makeOriginKey(scheme, host, hostAndPort.port),
        path,
        ...(query === undefined ? {} : { query }),
        ...(fragment === undefined ? {} : { fragment }),
        loopback: normalizedHost === "localhost" || normalizedHost === "127.0.0.1" ||
          normalizedHost === "::1"
      })
    }
  } catch {
    return failure
  }
}

export const isSafeHttpsIssuer = (value: unknown): value is string => {
  const parsed = parseAuthorizationUri(value)
  return parsed._tag === "Success" && parsed.value.scheme.toLowerCase() === "https" &&
    parsed.value.query === undefined && parsed.value.fragment === undefined
}

export const isSafeHttpsEndpoint = (value: unknown): value is string => {
  const parsed = parseAuthorizationUri(value)
  return parsed._tag === "Success" && parsed.value.scheme.toLowerCase() === "https" &&
    parsed.value.fragment === undefined
}

export const isSafeRedirectIdentifier = (value: unknown): value is string => {
  try {
    if (!Schema.is(SafeRedirectUri)(value)) return false
    const parsed = parseAuthorizationUri(value)
    if (parsed._tag === "Failure" || parsed.value.fragment !== undefined) return false
    const scheme = parsed.value.scheme.toLowerCase()
    return scheme === "https" || scheme === "http" && parsed.value.loopback
  } catch {
    return false
  }
}

export const isSafeClientMetadataIdentifier = (value: unknown): value is string => {
  const parsed = parseAuthorizationUri(value)
  return parsed._tag === "Success" && parsed.value.scheme.toLowerCase() === "https" &&
    parsed.value.path !== "" && parsed.value.path !== "/" &&
    parsed.value.query === undefined && parsed.value.fragment === undefined
}

export const protectedResourceMetadataCandidates = (
  protectedResource: AuthorizationUriSnapshot
): ReadonlyArray<string> => {
  const root = `${protectedResource.origin}/.well-known/oauth-protected-resource`
  if (protectedResource.path === "" || protectedResource.path === "/") return Object.freeze([root])
  return Object.freeze([`${root}${protectedResource.path}`, root])
}

export const authorizationServerMetadataCandidates = (
  issuer: AuthorizationUriSnapshot
): ReadonlyArray<string> => {
  const oauthRoot = `${issuer.origin}/.well-known/oauth-authorization-server`
  const oidcRoot = `${issuer.origin}/.well-known/openid-configuration`
  if (issuer.path === "" || issuer.path === "/") return Object.freeze([oauthRoot, oidcRoot])
  const appendedBase = issuer.value.endsWith("/") ? issuer.value.slice(0, -1) : issuer.value
  return Object.freeze([
    `${oauthRoot}${issuer.path}`,
    `${oidcRoot}${issuer.path}`,
    `${appendedBase}/.well-known/openid-configuration`
  ])
}

const canonicalPath = (path: string): string => {
  if (path === "" || path === "/") return ""
  return path.endsWith("/") ? path.slice(0, -1) : path
}

export const isSameOriginPathParent = (
  canonical: AuthorizationUriSnapshot,
  requested: AuthorizationUriSnapshot
): boolean => {
  if (canonical.originKey !== requested.originKey || canonical.query !== undefined ||
    canonical.fragment !== undefined) return false
  const parent = canonicalPath(canonical.path)
  const child = canonicalPath(requested.path)
  return parent === "" || child === parent || child.startsWith(`${parent}/`)
}
