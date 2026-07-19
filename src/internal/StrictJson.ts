import * as Schema from "effect/Schema"
import type { JsonValue } from "../McpErrors.js"

export const invalidStrictJson = Symbol("InvalidStrictJson")

export const cloneStrictJson = (
  value: unknown,
  seen: Set<object> = new Set()
): JsonValue | typeof invalidStrictJson => cloneJson(value, seen, false)

export const cloneSchemaJson = (
  value: unknown,
  seen: Set<object> = new Set()
): JsonValue | typeof invalidStrictJson => cloneJson(value, seen, true)

const cloneJson = (
  value: unknown,
  seen: Set<object>,
  allowSchemaClasses: boolean
): JsonValue | typeof invalidStrictJson => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : invalidStrictJson
  if (typeof value !== "object" || seen.has(value)) return invalidStrictJson

  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return invalidStrictJson
    const keys = Reflect.ownKeys(value)
    const elementKeys = keys.filter((key) => key !== "length")
    if (elementKeys.some((key) => typeof key !== "string") || elementKeys.length !== value.length) {
      return invalidStrictJson
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    seen.add(value)
    try {
      const output: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidStrictJson
        }
        const item = cloneJson(descriptor.value, seen, allowSchemaClasses)
        if (item === invalidStrictJson) return invalidStrictJson
        output.push(item)
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  if (prototype !== Object.prototype && prototype !== null) {
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")
    if (!allowSchemaClasses || constructor === undefined || !("value" in constructor) ||
      !Schema.isSchema(constructor.value)) {
      return invalidStrictJson
    }
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return invalidStrictJson
  const descriptors = Object.getOwnPropertyDescriptors(value)
  seen.add(value)
  try {
    const output: Record<string, JsonValue> = {}
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidStrictJson
      }
      const item = cloneJson(descriptor.value, seen, allowSchemaClasses)
      if (item === invalidStrictJson) return invalidStrictJson
      defineJsonProperty(output, key, item)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

export const defineJsonProperty = (
  target: Record<string, JsonValue>,
  key: string,
  value: JsonValue
): void => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}
