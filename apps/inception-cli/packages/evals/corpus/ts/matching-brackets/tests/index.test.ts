import { describe, expect, it } from "vitest"
import { matched } from "../src/index.js"

describe("matching-brackets", () => {
  it("matches balanced brackets of one kind", () =>
    expect(matched("([])")).toBe(true))
  it("matches nested and sequential brackets", () =>
    expect(matched("{[()()]}")).toBe(true))
  it("rejects an unclosed opening bracket", () =>
    expect(matched("(((")).toBe(false))
  it("rejects a closing bracket with no matching opener", () =>
    expect(matched("]")).toBe(false))
  it("rejects mismatched bracket types", () =>
    expect(matched("(]")).toBe(false))
  it("ignores non-bracket characters", () =>
    expect(matched("foo(bar[baz]{qux})")).toBe(true))
  it("treats the empty string as matched", () =>
    expect(matched("")).toBe(true))
  it("rejects brackets closed in the wrong order", () =>
    expect(matched("([)]")).toBe(false))
})
