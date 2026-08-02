import { describe, expect, it } from "vitest"
import { flatten } from "../src/index.js"

describe("flatten-array", () => {
  it("leaves an already-flat array unchanged", () =>
    expect(flatten([1, 2, 3])).toEqual([1, 2, 3]))
  it("flattens one level of nesting", () =>
    expect(flatten([1, [2, 3], 4])).toEqual([1, 2, 3, 4]))
  it("flattens arbitrarily deep nesting", () =>
    expect(flatten([1, [2, [3, [4, [5]]]]])).toEqual([1, 2, 3, 4, 5]))
  it("drops null values", () =>
    expect(flatten([1, null, 2, [null, 3]])).toEqual([1, 2, 3]))
  it("drops undefined values", () =>
    expect(flatten([1, undefined, [2, undefined]])).toEqual([1, 2]))
  it("drops empty nested arrays entirely", () =>
    expect(flatten([1, [], [2, []]])).toEqual([1, 2]))
  it("returns an empty array for an empty input", () =>
    expect(flatten([])).toEqual([]))
  it("preserves falsy-but-defined values", () =>
    expect(flatten([0, false, "", [null, 1]])).toEqual([0, false, "", 1]))
})
