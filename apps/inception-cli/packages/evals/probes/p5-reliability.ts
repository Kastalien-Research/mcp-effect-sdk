import { Ajv } from "ajv"
import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { mercuryFetch } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })

// 3-level nested schema, `required` declared at every level.
const APPLY_EDIT_SCHEMA = {
  type: "object",
  properties: {
    file: {
      type: "object",
      properties: {
        path: { type: "string" },
        language: {
          type: "string",
          enum: ["typescript", "javascript", "python", "go"]
        }
      },
      required: ["path", "language"]
    },
    edit: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["insert", "replace"] },
        anchor: { type: "string" },
        lines: { type: "array", items: { type: "string" } }
      },
      required: ["kind", "anchor", "lines"]
    },
    dryRun: { type: "boolean" }
  },
  required: ["file", "edit"]
} as const

const tools = [
  {
    type: "function",
    function: {
      name: "apply_edit",
      description: "Apply a single edit to a file in the workspace.",
      parameters: APPLY_EDIT_SCHEMA
    }
  }
]

const ajv = new Ajv()
const validate = ajv.compile(APPLY_EDIT_SCHEMA)

// 5 small code snippets, each with a path + language for the `file` field.
const snippets = [
  {
    path: "src/utils/clamp.ts",
    language: "typescript",
    code: "export function clamp(n: number, min: number, max: number) {\n  return Math.min(Math.max(n, min), max)\n}\n"
  },
  {
    path: "src/utils/sum.ts",
    language: "typescript",
    code: "export function sum(nums: number[]) {\n  return nums.reduce((a, b) => a + b, 0)\n}\n"
  },
  {
    path: "lib/format.js",
    language: "javascript",
    code: "function pad(n) {\n  return String(n).padStart(2, '0')\n}\nmodule.exports = { pad }\n"
  },
  {
    path: "src/greet.py",
    language: "python",
    code: "def greet(name):\n    return f'Hello, {name}!'\n"
  },
  {
    path: "src/models/user.go",
    language: "go",
    code: "type User struct {\n\tName string\n\tAge  int\n}\n"
  }
] as const

// 4 instruction templates, applied over the 5 snippets above.
const instructions = [
  "Insert an explanatory comment as the very first line of the file.",
  "Replace the first line with an updated version that adds a TODO note.",
  "Insert a blank line followed by a comment describing the return value, right after the first line.",
  "Replace the first line to rename the primary identifier by appending the digit 2 to it."
] as const

function promptForRep(rep: number): { path: string; language: string; content: string } {
  const snippet = snippets[rep % snippets.length]!
  const instruction = instructions[Math.floor(rep / snippets.length) % instructions.length]!
  const content = `Here is the current contents of ${snippet.path} (${snippet.language}):\n\n${snippet.code}\n${instruction}\n\nUse the apply_edit tool to perform this change.`
  return { path: snippet.path, language: snippet.language, content }
}

interface Record_ {
  rep: number
  httpStatus: number
  argsRaw: string | null
  jsonParsed: boolean
  schemaValid: boolean
  ajvErrors: unknown
  usage: unknown
}

// One-time live capture of the OpenAI-style named-function tool_choice object
// form, which Mercury rejects. Captured once, outside the 20-record sample,
// as raw evidence for why the sample below uses tool_choice: "required".
const rejectedProbeRes = await mercuryFetch(cfg, "/chat/completions", {
  model: MERCURY_MODEL,
  max_tokens: 500,
  messages: [{ role: "user", content: promptForRep(0).content }],
  tools,
  tool_choice: { type: "function", function: { name: "apply_edit" } }
})
const rejectedToolChoiceProbe = {
  attemptedToolChoice: { type: "function", function: { name: "apply_edit" } },
  httpStatus: rejectedProbeRes.status,
  body: await rejectedProbeRes.text()
}

const records: Record_[] = []
let jsonParsedCount = 0
let schemaValidCount = 0

for (let rep = 0; rep < 20; rep++) {
  const { content } = promptForRep(rep)
  const res = await mercuryFetch(cfg, "/chat/completions", {
    model: MERCURY_MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content }],
    tools,
    // Mercury's tool_choice accepts only the literal strings "auto" | "required" | "none"
    // (verified live: the OpenAI-style named-function object form 400s). With a single
    // tool defined, "required" forces the call to apply_edit.
    tool_choice: "required"
  })
  const httpStatus = res.status
  let argsRaw: string | null = null
  let usage: unknown = null
  if (res.ok) {
    const body = await res.json()
    usage = body.usage ?? null
    argsRaw = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? null
  } else {
    await res.text()
  }

  let jsonParsed = false
  let parsedArgs: unknown
  if (argsRaw !== null) {
    try {
      parsedArgs = JSON.parse(argsRaw)
      jsonParsed = true
    } catch {
      jsonParsed = false
    }
  }

  let schemaValid = false
  let ajvErrors: unknown = null
  if (jsonParsed) {
    schemaValid = validate(parsedArgs)
    ajvErrors = validate.errors ?? null
  }

  if (jsonParsed) jsonParsedCount++
  if (schemaValid) schemaValidCount++

  const rec: Record_ = { rep, httpStatus, argsRaw, jsonParsed, schemaValid, ajvErrors, usage }
  records.push(rec)
  console.log(JSON.stringify(rec))
}

console.log(
  "report:",
  writeProbeReport("p5-reliability", {
    model: MERCURY_MODEL,
    toolChoiceUsed: "required",
    rejectedToolChoiceProbe,
    records,
    counts: { jsonParsed: jsonParsedCount, schemaValid: schemaValidCount }
  })
)
