import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

export type FileMap = Record<string, string>

export interface Exercise {
  name: string
  instructions: string
  files: FileMap
  testFiles: FileMap
}

const here = dirname(fileURLToPath(import.meta.url))
const defaultCorpusRoot = join(here, "..", "..", "corpus", "ts")

const walk = (dir: string, base: string, out: FileMap): FileMap => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, base, out)
    } else {
      const rel = relative(base, full).split(sep).join("/")
      out[rel] = readFileSync(full, "utf8")
    }
  }
  return out
}

export const listExercises = async (
  root: string = defaultCorpusRoot
): Promise<Exercise[]> => {
  const names = readdirSync(root).sort()
  return names.map((name) => {
    const exerciseDir = join(root, name)
    const instructions = readFileSync(
      join(exerciseDir, "instructions.md"),
      "utf8"
    )
    const files = walk(join(exerciseDir, "src"), exerciseDir, {})
    const testFiles = walk(join(exerciseDir, "tests"), exerciseDir, {})
    return { name, instructions, files, testFiles }
  })
}
