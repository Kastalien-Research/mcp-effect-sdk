const UNRESERVED = /^[A-Za-z0-9._~-]$/
const HEX = "0123456789ABCDEF"
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

export const snapshotExactBytes = (value: unknown, length: number): Uint8Array | undefined => {
  try {
    if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
      return undefined
    }
    const keys = Reflect.ownKeys(value)
    if (keys.length !== length) return undefined
    const output = new Uint8Array(length)
    const seen = new Set<number>()
    for (const key of keys) {
      if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) return undefined
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || seen.has(index)) {
        return undefined
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !("value" in descriptor) ||
        !Number.isInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 255) {
        return undefined
      }
      seen.add(index)
      output[index] = descriptor.value
    }
    return seen.size === length ? output : undefined
  } catch {
    return undefined
  }
}

export const encodeBase64Url = (bytes: Uint8Array): string => {
  let output = ""
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!
    const second = index + 1 < bytes.length ? bytes[index + 1]! : undefined
    const third = index + 2 < bytes.length ? bytes[index + 2]! : undefined
    output += BASE64URL[first >> 2]!
    output += BASE64URL[(first & 0x03) << 4 | (second === undefined ? 0 : second >> 4)]!
    if (second !== undefined) {
      output += BASE64URL[(second & 0x0f) << 2 | (third === undefined ? 0 : third >> 6)]!
    }
    if (third !== undefined) output += BASE64URL[third & 0x3f]!
  }
  return output
}

export const encodeUtf8 = (value: string, maximumBytes = 1024 * 1024): Uint8Array | undefined => {
  try {
    const output: Array<number> = []
    for (let index = 0; index < value.length; index += 1) {
      const first = value.charCodeAt(index)
      let codePoint = first
      if (first >= 0xd800 && first <= 0xdbff) {
        if (index + 1 >= value.length) return undefined
        const second = value.charCodeAt(index + 1)
        if (second < 0xdc00 || second > 0xdfff) return undefined
        codePoint = 0x10000 + (first - 0xd800) * 0x400 + second - 0xdc00
        index += 1
      } else if (first >= 0xdc00 && first <= 0xdfff) {
        return undefined
      }
      if (codePoint <= 0x7f) {
        output.push(codePoint)
      } else if (codePoint <= 0x7ff) {
        output.push(0xc0 | codePoint >> 6, 0x80 | codePoint & 0x3f)
      } else if (codePoint <= 0xffff) {
        output.push(
          0xe0 | codePoint >> 12,
          0x80 | codePoint >> 6 & 0x3f,
          0x80 | codePoint & 0x3f
        )
      } else {
        output.push(
          0xf0 | codePoint >> 18,
          0x80 | codePoint >> 12 & 0x3f,
          0x80 | codePoint >> 6 & 0x3f,
          0x80 | codePoint & 0x3f
        )
      }
      if (output.length > maximumBytes) return undefined
    }
    return Uint8Array.from(output)
  } catch {
    return undefined
  }
}

const decodeUtf8 = (bytes: ReadonlyArray<number>): string | undefined => {
  try {
    let output = ""
    for (let index = 0; index < bytes.length;) {
      const first = bytes[index]!
      if (first <= 0x7f) {
        output += String.fromCharCode(first)
        index += 1
        continue
      }
      if (first >= 0xc2 && first <= 0xdf) {
        if (index + 1 >= bytes.length) return undefined
        const second = bytes[index + 1]!
        if ((second & 0xc0) !== 0x80) return undefined
        output += String.fromCharCode((first & 0x1f) << 6 | second & 0x3f)
        index += 2
        continue
      }
      if (first >= 0xe0 && first <= 0xef) {
        if (index + 2 >= bytes.length) return undefined
        const second = bytes[index + 1]!
        const third = bytes[index + 2]!
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 ||
          first === 0xe0 && second < 0xa0 || first === 0xed && second >= 0xa0) return undefined
        output += String.fromCharCode((first & 0x0f) << 12 | (second & 0x3f) << 6 | third & 0x3f)
        index += 3
        continue
      }
      if (first >= 0xf0 && first <= 0xf4) {
        if (index + 3 >= bytes.length) return undefined
        const second = bytes[index + 1]!
        const third = bytes[index + 2]!
        const fourth = bytes[index + 3]!
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 ||
          (fourth & 0xc0) !== 0x80 || first === 0xf0 && second < 0x90 ||
          first === 0xf4 && second >= 0x90) return undefined
        const codePoint = (first & 0x07) << 18 | (second & 0x3f) << 12 |
          (third & 0x3f) << 6 | fourth & 0x3f
        output += String.fromCodePoint(codePoint)
        index += 4
        continue
      }
      return undefined
    }
    return output
  } catch {
    return undefined
  }
}

export const percentEncode = (value: string): string | undefined => {
  const bytes = encodeUtf8(value, 64 * 1024)
  if (bytes === undefined) return undefined
  let output = ""
  for (const byte of bytes) {
    const character = String.fromCharCode(byte)
    output += UNRESERVED.test(character)
      ? character
      : `%${HEX[byte >> 4]}${HEX[byte & 0x0f]}`
  }
  return output
}

export const encodeForm = (
  entries: ReadonlyArray<readonly [string, string]>
): string | undefined => {
  if (entries.length > 32) return undefined
  const output: Array<string> = []
  for (const [name, value] of entries) {
    const encodedName = percentEncode(name)
    const encodedValue = percentEncode(value)
    if (encodedName === undefined || encodedValue === undefined) return undefined
    output.push(`${encodedName}=${encodedValue}`)
  }
  const form = output.join("&")
  return form.length <= 128 * 1024 ? form : undefined
}

const decodeComponent = (value: string): string | undefined => {
  const bytes: Array<number> = []
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (value[index] === "+") {
      bytes.push(0x20)
      continue
    }
    if (value[index] === "%") {
      if (index + 2 >= value.length || !/^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
        return undefined
      }
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16))
      index += 2
      continue
    }
    if (code > 0x7f) return undefined
    bytes.push(code)
  }
  return decodeUtf8(bytes)
}

export const decodeForm = (
  value: string,
  maximumLength = 64 * 1024
): Readonly<Record<string, string>> | undefined => {
  try {
    if (value.length > maximumLength || /[\u0000-\u001f\u007f]/.test(value)) return undefined
    const output: Record<string, string> = Object.create(null)
    if (value.length === 0) return Object.freeze(output)
    const fields = value.split("&")
    if (fields.length > 32) return undefined
    for (const field of fields) {
      const separator = field.indexOf("=")
      const rawName = separator < 0 ? field : field.slice(0, separator)
      const rawValue = separator < 0 ? "" : field.slice(separator + 1)
      const name = decodeComponent(rawName)
      const decoded = decodeComponent(rawValue)
      if (name === undefined || decoded === undefined || name.length === 0 || name.length > 128 ||
        decoded.length > 16 * 1024 || Object.prototype.hasOwnProperty.call(output, name)) {
        return undefined
      }
      Object.defineProperty(output, name, {
        configurable: false,
        enumerable: true,
        value: decoded,
        writable: false
      })
    }
    return Object.freeze(output)
  } catch {
    return undefined
  }
}
