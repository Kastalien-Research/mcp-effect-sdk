export const resolve = (specifier, context, nextResolve) => {
  if (specifier === "@effect/platform" || specifier.startsWith("@effect/platform/")) {
    throw new Error(`Core import reached optional peer: ${specifier}`)
  }
  return nextResolve(specifier, context)
}
