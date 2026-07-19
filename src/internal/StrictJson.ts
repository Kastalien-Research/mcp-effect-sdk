import * as Schema from "effect/Schema"
import type { JsonValue } from "../McpErrors.js"

export const invalidStrictJson = Symbol("InvalidStrictJson")

type CloneMode = "strict-wire" | "schema-data"
type SchemaData = null | string | number | boolean | Uint8Array | SchemaData[] | { [key: string]: SchemaData }

export const cloneStrictJson = (
  value: unknown,
  seen: Set<object> = new Set()
): JsonValue | typeof invalidStrictJson => cloneJson(value, seen, "strict-wire") as
  | JsonValue
  | typeof invalidStrictJson

export const cloneSchemaJson = (
  value: unknown,
  seen: Set<object> = new Set()
): SchemaData | typeof invalidStrictJson => cloneJson(value, seen, "schema-data")

const cloneJson = (
  value: unknown,
  seen: Set<object>,
  mode: CloneMode
): SchemaData | typeof invalidStrictJson => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : invalidStrictJson
  if (typeof value !== "object" || seen.has(value)) return invalidStrictJson

  const prototype = Object.getPrototypeOf(value)
  if (mode === "schema-data" && value instanceof Uint8Array) {
    if (prototype !== Uint8Array.prototype) return invalidStrictJson
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== "string") || keys.length !== value.length) {
      return invalidStrictJson
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const output = new Uint8Array(value.length)
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[String(index)]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
        !Number.isInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 255) {
        return invalidStrictJson
      }
      output[index] = descriptor.value
    }
    return output
  }
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
      const output: SchemaData[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidStrictJson
        }
        const item = cloneJson(descriptor.value, seen, mode)
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
    if (mode !== "schema-data" || constructor === undefined || !("value" in constructor) ||
      !Schema.isSchema(constructor.value)) {
      return invalidStrictJson
    }
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return invalidStrictJson
  const descriptors = Object.getOwnPropertyDescriptors(value)
  seen.add(value)
  try {
    const output: Record<string, SchemaData> = mode === "schema-data" &&
        prototype !== Object.prototype && prototype !== null
      ? Object.create(prototype) as Record<string, SchemaData>
      : {}
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidStrictJson
      }
      const item = cloneJson(descriptor.value, seen, mode)
      if (item === invalidStrictJson) return invalidStrictJson
      defineDataProperty(output, key, item)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

const defineDataProperty = <A>(target: Record<string, A>, key: string, value: A): void => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}

export const defineJsonProperty = (
  target: Record<string, JsonValue>,
  key: string,
  value: JsonValue
): void => defineDataProperty(target, key, value)
