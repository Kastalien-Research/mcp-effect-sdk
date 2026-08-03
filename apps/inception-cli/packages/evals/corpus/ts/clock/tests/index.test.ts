import { describe, expect, it } from "vitest"
import { Clock } from "../src/index.js"

describe("clock", () => {
  it("formats a basic time with zero-padding", () =>
    expect(new Clock(8, 3).toString()).toBe("08:03"))
  it("defaults minutes to zero", () =>
    expect(new Clock(10).toString()).toBe("10:00"))
  it("wraps an hour past midnight", () =>
    expect(new Clock(25, 0).toString()).toBe("01:00"))
  it("wraps a negative hour with a positive minute", () =>
    expect(new Clock(-1, 15).toString()).toBe("23:15"))
  it("wraps a negative minute", () =>
    expect(new Clock(0, -2).toString()).toBe("23:58"))
  it("adds minutes without wrapping", () =>
    expect(new Clock(10, 0).add(90).toString()).toBe("11:30"))
  it("adds minutes across midnight", () =>
    expect(new Clock(23, 59).add(2).toString()).toBe("00:01"))
  it("adds a negative number of minutes", () =>
    expect(new Clock(0, 0).add(-1).toString()).toBe("23:59"))
  it("add returns a new Clock, not a mutation", () => {
    const c = new Clock(10, 0)
    const c2 = c.add(60)
    expect(c.toString()).toBe("10:00")
    expect(c2.toString()).toBe("11:00")
  })
})
