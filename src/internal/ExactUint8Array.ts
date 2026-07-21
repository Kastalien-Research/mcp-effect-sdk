const Uint8ArrayConstructor = Uint8Array
const Uint8ArrayPrototype = Uint8Array.prototype
const TypedArrayPrototype = Object.getPrototypeOf(Uint8ArrayPrototype) as object
const ArrayBufferPrototype = ArrayBuffer.prototype

const arrayBufferIsView = ArrayBuffer.isView
const objectGetPrototypeOf = Object.getPrototypeOf
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors
const reflectApply = Reflect.apply
const reflectOwnKeys = Reflect.ownKeys

const intrinsicGetter = (target: object, key: PropertyKey): Function | undefined => {
  const descriptor = objectGetOwnPropertyDescriptor(target, key)
  return typeof descriptor?.get === "function" ? descriptor.get : undefined
}

const intrinsicMethod = (target: object, key: PropertyKey): Function | undefined => {
  const descriptor = objectGetOwnPropertyDescriptor(target, key)
  return typeof descriptor?.value === "function" ? descriptor.value : undefined
}

const typedArrayBrand = intrinsicGetter(TypedArrayPrototype, Symbol.toStringTag)
const typedArrayBuffer = intrinsicGetter(TypedArrayPrototype, "buffer")
const typedArrayByteLength = intrinsicGetter(TypedArrayPrototype, "byteLength")
const typedArrayByteOffset = intrinsicGetter(TypedArrayPrototype, "byteOffset")
const typedArrayLength = intrinsicGetter(TypedArrayPrototype, "length")
const typedArraySet = intrinsicMethod(TypedArrayPrototype, "set")
const arrayBufferByteLength = intrinsicGetter(ArrayBufferPrototype, "byteLength")
const arrayBufferResizable = intrinsicGetter(ArrayBufferPrototype, "resizable")

const applyIntrinsic = (
  intrinsic: Function | undefined,
  receiver: unknown,
  args: ReadonlyArray<unknown> = []
): unknown => {
  if (intrinsic === undefined) throw new TypeError("Required binary intrinsic is unavailable")
  return reflectApply(intrinsic, receiver, args)
}

export const notArrayBufferView = Symbol("NotArrayBufferView")
export const invalidExactUint8Array = Symbol("InvalidExactUint8Array")

/** Copies only fixed, non-shared, intrinsically branded Uint8Array views. */
export const cloneExactUint8Array = (
  value: object
): Uint8Array | typeof notArrayBufferView | typeof invalidExactUint8Array => {
  if (!arrayBufferIsView(value)) return notArrayBufferView

  try {
    if (objectGetPrototypeOf(value) !== Uint8ArrayPrototype ||
      applyIntrinsic(typedArrayBrand, value) !== "Uint8Array") {
      return invalidExactUint8Array
    }

    const backing = applyIntrinsic(typedArrayBuffer, value)
    if (typeof backing !== "object" || backing === null) return invalidExactUint8Array
    const backingByteLength = applyIntrinsic(arrayBufferByteLength, backing)
    const resizable = applyIntrinsic(arrayBufferResizable, backing)
    const byteLength = applyIntrinsic(typedArrayByteLength, value)
    const byteOffset = applyIntrinsic(typedArrayByteOffset, value)
    const length = applyIntrinsic(typedArrayLength, value)
    if (!Number.isSafeInteger(backingByteLength) || !Number.isSafeInteger(byteLength) ||
      !Number.isSafeInteger(byteOffset) || length !== byteLength || resizable !== false ||
      (byteOffset as number) + (byteLength as number) > (backingByteLength as number)) {
      return invalidExactUint8Array
    }

    const keys = reflectOwnKeys(value)
    if (keys.some((key) => typeof key !== "string") || keys.length !== byteLength) {
      return invalidExactUint8Array
    }

    const output = new Uint8ArrayConstructor(byteLength as number)
    applyIntrinsic(typedArraySet, output, [value])

    if (!arrayBufferIsView(value) || objectGetPrototypeOf(value) !== Uint8ArrayPrototype ||
      applyIntrinsic(typedArrayBrand, value) !== "Uint8Array" ||
      applyIntrinsic(typedArrayBuffer, value) !== backing ||
      applyIntrinsic(typedArrayByteLength, value) !== byteLength ||
      applyIntrinsic(typedArrayByteOffset, value) !== byteOffset ||
      applyIntrinsic(typedArrayLength, value) !== length ||
      applyIntrinsic(arrayBufferByteLength, backing) !== backingByteLength ||
      applyIntrinsic(arrayBufferResizable, backing) !== false) {
      return invalidExactUint8Array
    }

    const descriptors = objectGetOwnPropertyDescriptors(value)
    for (let index = 0; index < (byteLength as number); index++) {
      const descriptor = descriptors[String(index)]
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
        descriptor.value !== output[index]) {
        return invalidExactUint8Array
      }
    }
    return output
  } catch {
    return invalidExactUint8Array
  }
}
