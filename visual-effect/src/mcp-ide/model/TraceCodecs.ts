export const TRACE_IDENTIFIER_MAX_LENGTH = 128
export const TRACE_REFERENCE_MAX_LENGTH = 256
export const TRACE_LABEL_MAX_LENGTH = 512
export const TRACE_METADATA_MAX_LENGTH = 256

const hasControlCharacters = (value: string): boolean =>
  [...value].some(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || (code >= 127 && code <= 159)
  })

const isBoundedControlFreeString = (value: unknown, maximumLength: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  !hasControlCharacters(value)

export const isTraceIdentifier = (value: unknown): value is string =>
  isBoundedControlFreeString(value, TRACE_IDENTIFIER_MAX_LENGTH) && value.trim() === value

export const isTraceReference = (value: unknown): value is string =>
  isBoundedControlFreeString(value, TRACE_REFERENCE_MAX_LENGTH) && value.trim() === value

export const isTraceLabel = (value: unknown): value is string =>
  isBoundedControlFreeString(value, TRACE_LABEL_MAX_LENGTH) && value.trim().length > 0

export const isTraceMetadata = (value: unknown): value is string =>
  isBoundedControlFreeString(value, TRACE_METADATA_MAX_LENGTH) && value.trim().length > 0
