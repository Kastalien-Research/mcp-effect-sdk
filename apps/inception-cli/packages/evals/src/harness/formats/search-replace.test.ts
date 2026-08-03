import { describe, expect, it } from "vitest"
import { ApplyError, ParseError } from "./types.js"
import { searchReplace } from "./search-replace.js"

function block(path: string, search: string, replace: string): string {
  return `${path}\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n`
}

describe("searchReplace.parse + apply", () => {
  it("applies a single happy-path block", () => {
    const edits = searchReplace.parse(block("src/a.ts", "const a = 1", "const a = 2"))
    const result = searchReplace.apply(edits, { "src/a.ts": "const a = 1\n" })
    expect(result["src/a.ts"]).toBe("const a = 2\n")
  })

  it("applies multiple blocks in order, later blocks seeing earlier output", () => {
    const response =
      block("src/a.ts", "const a = 1", "const a = 2") + block("src/a.ts", "const a = 2", "const a = 3")
    const edits = searchReplace.parse(response)
    const result = searchReplace.apply(edits, { "src/a.ts": "const a = 1\n" })
    expect(result["src/a.ts"]).toBe("const a = 3\n")
  })

  it("creates a new file via empty SEARCH", () => {
    const edits = searchReplace.parse(block("src/new.ts", "", "export const x = 1"))
    const result = searchReplace.apply(edits, {})
    expect(result["src/new.ts"]).toBe("export const x = 1")
  })

  it("throws ApplyError when empty SEARCH targets a file that already exists", () => {
    const edits = searchReplace.parse(block("src/a.ts", "", "export const x = 1"))
    expect(() => searchReplace.apply(edits, { "src/a.ts": "const a = 1\n" })).toThrow(ApplyError)
  })

  it("throws ParseError on a block missing the ======= divider", () => {
    const malformed = "src/a.ts\n<<<<<<< SEARCH\nold\n>>>>>>> REPLACE\n"
    expect(() => searchReplace.parse(malformed)).toThrow(ParseError)
  })

  it("throws ParseError on a block missing the path line", () => {
    const malformed = "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\n"
    expect(() => searchReplace.parse(malformed)).toThrow(ParseError)
  })

  it("throws ParseError on an unterminated block", () => {
    const malformed = "src/a.ts\n<<<<<<< SEARCH\nold\n=======\nnew\n"
    expect(() => searchReplace.parse(malformed)).toThrow(ParseError)
  })

  it("normalizes CRLF input to \\n before matching", () => {
    const crlfBlock = block("src/a.ts", "const a = 1", "const a = 2").replace(/\n/g, "\r\n")
    const edits = searchReplace.parse(crlfBlock)
    const result = searchReplace.apply(edits, { "src/a.ts": "const a = 1\r\n" })
    expect(result["src/a.ts"]).toBe("const a = 2\n")
  })

  it("fails apply, not parse, when SEARCH text is absent", () => {
    const edits = searchReplace.parse(block("src/a.ts", "NOT PRESENT", "x"))
    expect(() => searchReplace.apply(edits, { "src/a.ts": "const a = 1\n" })).toThrow(ApplyError)
  })

  it("rejects ambiguous SEARCH with occurrence count", () => {
    const edits = searchReplace.parse(block("src/a.ts", "dup()", "one()"))
    expect(() => searchReplace.apply(edits, { "src/a.ts": "dup()\ndup()\n" })).toThrow(/2 occurrences/)
  })

  it("apply error message contains the path when SEARCH is not found", () => {
    const edits = searchReplace.parse(block("src/missing-match.ts", "NOT PRESENT", "x"))
    expect(() => searchReplace.apply(edits, { "src/missing-match.ts": "const a = 1\n" })).toThrow(
      /src\/missing-match\.ts/
    )
  })
})
