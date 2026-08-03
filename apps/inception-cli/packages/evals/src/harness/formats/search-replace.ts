import { ApplyError, ParseError } from "./types.js"
import type { EditFormat, FileMap, ParsedEdit } from "./types.js"

const FORMAT_INSTRUCTIONS = `Emit one or more SEARCH/REPLACE blocks. Never emit anything else.
For each block: write the file path alone on a line, then exactly this shape:
<<<<<<< SEARCH
(the exact existing text to find, verbatim, including whitespace)
=======
(the new text to put in its place)
>>>>>>> REPLACE
SEARCH text must match the file's current content EXACTLY and UNIQUELY —
copy it character-for-character, do not paraphrase or reindent it.
To create a new file, leave SEARCH empty and put the full new content in REPLACE.
Keep each SEARCH block as small as possible while still being unique in the file.
Do not add prose, explanations, or commentary before, between, or after blocks.
Emit multiple blocks (even against the same file) for multiple changes.
`

const SEARCH_MARKER = "<<<<<<< SEARCH"
const DIVIDER = "======="
const REPLACE_MARKER = ">>>>>>> REPLACE"

interface SearchReplacePayload {
  search: string
  replace: string
}

function parse(response: string): ParsedEdit[] {
  const normalized = response.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const edits: ParsedEdit[] = []
  let sawMarker = false
  let i = 0
  while (i < lines.length) {
    if (lines[i] === SEARCH_MARKER) {
      sawMarker = true
      const pathLine = i > 0 ? lines[i - 1] : undefined
      if (pathLine === undefined || pathLine.trim() === "") {
        throw new ParseError("search-replace: missing path line before <<<<<<< SEARCH marker")
      }
      const path = pathLine.trim()

      let j = i + 1
      const searchLines: string[] = []
      while (j < lines.length && lines[j] !== DIVIDER) {
        searchLines.push(lines[j] ?? "")
        j++
      }
      if (j >= lines.length) {
        throw new ParseError(`search-replace: missing ======= divider in block for ${path}`)
      }

      let k = j + 1
      const replaceLines: string[] = []
      while (k < lines.length && lines[k] !== REPLACE_MARKER) {
        replaceLines.push(lines[k] ?? "")
        k++
      }
      if (k >= lines.length) {
        throw new ParseError(`search-replace: unterminated block (missing >>>>>>> REPLACE) for ${path}`)
      }

      edits.push({
        path,
        payload: { search: searchLines.join("\n"), replace: replaceLines.join("\n") } satisfies SearchReplacePayload
      })
      i = k + 1
      continue
    }
    i++
  }
  if (!sawMarker) {
    throw new ParseError("search-replace: no <<<<<<< SEARCH blocks found in response")
  }
  return edits
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

function apply(edits: ParsedEdit[], files: FileMap): FileMap {
  const result: FileMap = { ...files }
  for (const edit of edits) {
    const payload = edit.payload as SearchReplacePayload
    const path = edit.path

    if (payload.search === "") {
      if (Object.prototype.hasOwnProperty.call(result, path)) {
        throw new ApplyError(`${path}: empty SEARCH only creates a new file, but ${path} already exists`)
      }
      result[path] = payload.replace
      continue
    }

    const content = result[path]
    if (content === undefined) {
      throw new ApplyError(`${path}: file not found`)
    }
    const normalizedContent = content.replace(/\r\n/g, "\n")
    const occurrences = countOccurrences(normalizedContent, payload.search)
    if (occurrences === 0) {
      throw new ApplyError(`${path}: SEARCH text not found`)
    }
    if (occurrences > 1) {
      throw new ApplyError(`${path}: SEARCH text is ambiguous — matched ${occurrences} occurrences`)
    }
    const idx = normalizedContent.indexOf(payload.search)
    result[path] =
      normalizedContent.slice(0, idx) + payload.replace + normalizedContent.slice(idx + payload.search.length)
  }
  return result
}

function renderFiles(files: FileMap): string {
  return Object.entries(files)
    .map(([path, content]) => `${path}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n")
}

export const searchReplace: EditFormat = {
  name: "search-replace",
  formatInstructions: FORMAT_INSTRUCTIONS,
  renderFiles,
  parse,
  apply
}
