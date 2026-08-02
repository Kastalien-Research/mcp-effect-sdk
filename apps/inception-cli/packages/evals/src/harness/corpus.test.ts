import { describe, expect, it } from "vitest"
import { listExercises } from "./corpus.js"

describe("listExercises", () => {
  it("loads all five seed exercises", async () => {
    const exercises = await listExercises()
    expect(exercises).toHaveLength(5)
  })

  it("includes the expected exercise names", async () => {
    const exercises = await listExercises()
    expect(exercises.map((e) => e.name).sort()).toEqual([
      "clock",
      "flatten-array",
      "luhn",
      "matching-brackets",
      "run-length-encoding"
    ])
  })

  it("each exercise's files contain src/index.ts", async () => {
    const exercises = await listExercises()
    for (const exercise of exercises) {
      expect(exercise.files["src/index.ts"]).toBeDefined()
      expect(exercise.files["src/index.ts"]!.length).toBeGreaterThan(0)
    }
  })

  it("each exercise's testFiles contain tests/index.test.ts", async () => {
    const exercises = await listExercises()
    for (const exercise of exercises) {
      expect(exercise.testFiles["tests/index.test.ts"]).toBeDefined()
      expect(exercise.testFiles["tests/index.test.ts"]!.length).toBeGreaterThan(0)
    }
  })

  it("each exercise has non-empty instructions", async () => {
    const exercises = await listExercises()
    for (const exercise of exercises) {
      expect(exercise.instructions.trim().length).toBeGreaterThan(0)
    }
  })
})
