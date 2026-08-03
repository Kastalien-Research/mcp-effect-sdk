import { ApplyError, ParseError } from "./types.js"
import type { EditFormat, FileMap, ParsedEdit } from "./types.js"

const FORMAT_INSTRUCTIONS = `Emit one block per file you create or change. Never emit anything else.
For each file: write its path alone on a line, then a fenced code block.
The fenced block must contain the file's ENTIRE new content, not a diff.
Use the real file path exactly as given (case-sensitive, no leading ./).
Do not add prose, explanations, or extra commentary before, between, or after blocks.
Do not truncate the file or use "// ... unchanged" placeholders — write every line.
Omit files you are not creating or changing.
Example:
src/example.ts
\`\`\`ts
export const example = 1
\`\`\`
`

const BLOCK_RE = /^(\S+\.\w+)\n```[a-zA-Z0-9]*\n([\s\S]*?)\n```/gm

function parse(response: string): ParsedEdit[] {
  const normalized = response.replace(/\r\n/g, "\n")
  const edits: ParsedEdit[] = []
  for (const match of normalized.matchAll(BLOCK_RE)) {
    const path = match[1]
    const content = match[2]
    if (path === undefined || content === undefined) continue
    edits.push({ path, payload: content })
  }
  if (edits.length === 0) {
    throw new ParseError("whole: no fenced file blocks found in response")
  }
  return edits
}

function apply(edits: ParsedEdit[], files: FileMap): FileMap {
  const result: FileMap = { ...files }
  for (const edit of edits) {
    if (typeof edit.payload !== "string") {
      throw new ApplyError(`${edit.path}: malformed payload for whole format`)
    }
    result[edit.path] = edit.payload
  }
  return result
}

function renderFiles(files: FileMap): string {
  return Object.entries(files)
    .map(([path, content]) => `${path}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n")
}

export const whole: EditFormat = {
  name: "whole",
  formatInstructions: FORMAT_INSTRUCTIONS,
  renderFiles,
  parse,
  apply
}
