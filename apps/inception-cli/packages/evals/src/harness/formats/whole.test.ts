import { describe, expect, it } from "vitest"
import { ParseError } from "./types.js"
import { whole } from "./whole.js"

function fenced(path: string, content: string, lang = ""): string {
  return `${path}\n\`\`\`${lang}\n${content}\n\`\`\`\n`
}

describe("whole.parse", () => {
  it("parses a single file replace", () => {
    const edits = whole.parse(fenced("src/a.ts", "const a = 1\n", "ts"))
    expect(edits).toEqual([{ path: "src/a.ts", payload: "const a = 1\n" }])
  })

  it("parses two files", () => {
    const response = fenced("src/a.ts", "const a = 1", "ts") + fenced("src/b.ts", "const b = 2", "ts")
    const edits = whole.parse(response)
    expect(edits).toEqual([
      { path: "src/a.ts", payload: "const a = 1" },
      { path: "src/b.ts", payload: "const b = 2" }
    ])
  })

  it("treats an unrecognized path as a new file at apply time", () => {
    const edits = whole.parse(fenced("src/new.ts", "export const x = 1", "ts"))
    const result = whole.apply(edits, {})
    expect(result["src/new.ts"]).toBe("export const x = 1")
  })

  it("throws ParseError when no fenced block is found", () => {
    expect(() => whole.parse("no blocks here, just prose")).toThrow(ParseError)
  })

  it("allows an optional fence language tag", () => {
    const edits = whole.parse(fenced("src/a.ts", "const a = 1"))
    expect(edits).toEqual([{ path: "src/a.ts", payload: "const a = 1" }])
  })
})

describe("whole.apply", () => {
  it("replaces an existing file wholesale", () => {
    const edits = whole.parse(fenced("src/a.ts", "const a = 2", "ts"))
    const result = whole.apply(edits, { "src/a.ts": "const a = 1\n" })
    expect(result["src/a.ts"]).toBe("const a = 2")
  })

  it("leaves files not touched by any edit unchanged", () => {
    const edits = whole.parse(fenced("src/a.ts", "const a = 2", "ts"))
    const result = whole.apply(edits, { "src/a.ts": "const a = 1\n", "src/b.ts": "const b = 1\n" })
    expect(result["src/b.ts"]).toBe("const b = 1\n")
  })
})
