/** Snapshot constructor options without invoking accessors or ordinary property reads. */
export const snapshotConstructorOptions = (
  value: unknown
): Readonly<Record<string, unknown>> => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError("Constructor options must be an object")
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new TypeError("Constructor options must not contain symbol properties")
  }

  const snapshot = Object.create(null) as Record<string, unknown>
  for (const name of Object.keys(descriptors)) {
    const descriptor = descriptors[name]
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`Constructor option ${name} must be a data property`)
    }
    Object.defineProperty(snapshot, name, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: descriptor.value
    })
  }
  return snapshot
}
