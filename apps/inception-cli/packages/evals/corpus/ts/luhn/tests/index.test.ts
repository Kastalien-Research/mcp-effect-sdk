import { describe, expect, it } from "vitest"
import { valid } from "../src/index.js"

describe("luhn", () => {
  it("valid canonical number", () =>
    expect(valid("4539 3195 0343 6467")).toBe(true))
  it("invalid when checksum off by one", () =>
    expect(valid("8273 1232 7352 0569")).toBe(false))
  it("single digit invalid", () => expect(valid("1")).toBe(false))
  it("letters invalid", () => expect(valid("055a 444 285")).toBe(false))
  it("zero string of length 2 is valid", () => expect(valid("00")).toBe(true))
  it("punctuation invalid", () => expect(valid("055-444-285")).toBe(false))
})
