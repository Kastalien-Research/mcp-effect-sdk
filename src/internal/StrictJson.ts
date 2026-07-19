import * as Schema from "effect/Schema"
import type { JsonValue } from "../McpErrors.js"
import {
  cloneExactUint8Array,
  invalidExactUint8Array,
  notArrayBufferView
} from "./ExactUint8Array.js"

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

  if (mode === "schema-data") {
    const bytes = cloneExactUint8Array(value)
    if (bytes !== notArrayBufferView) {
      return bytes === invalidExactUint8Array ? invalidStrictJson : bytes
    }
  }
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
