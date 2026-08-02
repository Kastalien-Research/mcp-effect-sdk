import { describe, expect, it } from "vitest"
import { decode, encode } from "../src/index.js"

describe("run-length-encoding", () => {
  it("encodes runs of repeated characters", () =>
    expect(encode("aabbbcccc")).toBe("2a3b4c"))
  it("leaves single characters unprefixed", () =>
    expect(encode("abcd")).toBe("abcd"))
  it("encodes a mix of single and repeated characters", () =>
    expect(encode("aabbbccddd")).toBe("2a3b2c3d"))
  it("encodes an empty string as empty", () => expect(encode("")).toBe(""))
  it("encodes runs spanning whitespace", () =>
    expect(encode("  hsqq qww  ")).toBe("2 hs2q q2w2 "))
  it("decodes back to the original", () =>
    expect(decode("2a3b4c")).toBe("aabbbcccc"))
  it("decodes single characters unprefixed", () =>
    expect(decode("abcd")).toBe("abcd"))
  it("round-trips through encode and decode", () => {
    const original = "zzz ap"
    expect(decode(encode(original))).toBe(original)
  })
})
