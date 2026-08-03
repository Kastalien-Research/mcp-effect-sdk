export interface FileMap {
  [path: string]: string
}
export interface EditFormat {
  name: string
  /** Instructions appended to the system prompt describing exactly how to emit edits. */
  formatInstructions: string
  /** Render current file contents into the user prompt. */
  renderFiles(files: FileMap): string
  /** Throws ParseError on malformed output; returns parsed edits otherwise. */
  parse(response: string): ParsedEdit[]
  /** Throws ApplyError when a parsed edit cannot be applied; returns new FileMap. */
  apply(edits: ParsedEdit[], files: FileMap): FileMap
}
export interface ParsedEdit {
  path: string
  payload: unknown
}
export class ParseError extends Error {
  readonly kind = "parse"
}
export class ApplyError extends Error {
  readonly kind = "apply"
}
