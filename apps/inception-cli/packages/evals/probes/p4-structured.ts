import { Ajv, type ErrorObject } from "ajv"
import { loadEnv, mercuryConfig } from "../src/lib/env.js"
import { mercuryFetch } from "../src/lib/mercury.js"
import { writeProbeReport } from "../src/lib/report.js"
import { MERCURY_MODEL } from "../src/lib/constants.js"

const cfg = mercuryConfig({ ...loadEnv("../../../.."), ...process.env })

// SCHEMA is moderately nasty on purpose: nested object, enum, array, optional field.
const SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          action: { type: "string", enum: ["create", "modify", "delete"] },
          hunks: { type: "integer" }
        },
        required: ["path", "action"]
      }
    },
    summary: { type: "string" },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["files", "summary"]
} as const

const PROMPT =
  "Plan edits to rename function `foo` to `bar` across src/a.ts and src/b.ts; respond per the schema."

const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(SCHEMA)

interface ChatResponseBody {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{ function?: { arguments?: string } }>
    }
  }>
}

interface Rec {
  variant: 1 | 2 | 3
  variantLabel: string
  strict: boolean | null
  toolChoiceUsed: string | null
  rep: number
  status: number
  requestBody: unknown
  rawResponseText: string
  extractedText: string | null
  jsonParsed: boolean
  schemaValid: boolean
  ajvErrors: ErrorObject[] | null
}

function validateExtracted(text: string | null): {
  jsonParsed: boolean
  schemaValid: boolean
  ajvErrors: ErrorObject[] | null
} {
  if (text === null) return { jsonParsed: false, schemaValid: false, ajvErrors: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { jsonParsed: false, schemaValid: false, ajvErrors: null }
  }
  const schemaValid = validate(parsed)
  return { jsonParsed: true, schemaValid, ajvErrors: schemaValid ? null : (validate.errors ?? null) }
}

async function runRep(
  variant: 1 | 2 | 3,
  variantLabel: string,
  strict: boolean | null,
  toolChoiceUsed: string | null,
  rep: number,
  requestBody: Record<string, unknown>,
  extractText: (body: ChatResponseBody | null) => string | null
): Promise<Rec> {
  const res = await mercuryFetch(cfg, "/chat/completions", requestBody)
  const rawResponseText = await res.text()
  let parsedBody: ChatResponseBody | null = null
  try {
    parsedBody = JSON.parse(rawResponseText) as ChatResponseBody
  } catch {
    parsedBody = null
  }
  const extractedText = extractText(parsedBody)
  const v = validateExtracted(extractedText)
  const rec: Rec = {
    variant,
    variantLabel,
    strict,
    toolChoiceUsed,
    rep,
    status: res.status,
    requestBody,
    rawResponseText,
    extractedText,
    ...v
  }
  console.log(
    JSON.stringify({
      variant,
      rep,
      status: rec.status,
      jsonParsed: rec.jsonParsed,
      schemaValid: rec.schemaValid
    })
  )
  return rec
}

const records: Rec[] = []

for (const [variant, strict] of [
  [1, false],
  [2, true]
] as const) {
  for (let rep = 0; rep < 3; rep++) {
    records.push(
      await runRep(
        variant,
        "response_format json_schema",
        strict,
        null,
        rep,
        {
          model: MERCURY_MODEL,
          messages: [{ role: "user", content: PROMPT }],
          response_format: {
            type: "json_schema",
            json_schema: { name: "extract", strict, schema: SCHEMA }
          }
        },
        (body) => body?.choices?.[0]?.message?.content ?? null
      )
    )
  }
}

const variant3Tools = [
  {
    type: "function",
    function: {
      name: "extract",
      description: "Record the planned file edits.",
      parameters: SCHEMA
    }
  }
]
const variant3ExtractText = (body: ChatResponseBody | null) =>
  body?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? null

// API rejects the OpenAI-style { type: "function", function: { name } }
// forced-tool-choice object (400: "Input should be 'auto', 'required' or
// 'none'") — observed live 2026-08-02. Captured once as its own record
// (rep -1) before switching to "required" — the closest equivalent when
// only one tool is offered — for the 3 real reps.
records.push(
  await runRep(
    3,
    "forced tool call",
    null,
    "{type:function,function:{name}} (rejected)",
    -1,
    {
      model: MERCURY_MODEL,
      messages: [{ role: "user", content: PROMPT }],
      tools: variant3Tools,
      tool_choice: { type: "function", function: { name: "extract" } }
    },
    variant3ExtractText
  )
)

for (let rep = 0; rep < 3; rep++) {
  records.push(
    await runRep(
      3,
      "forced tool call",
      null,
      "required",
      rep,
      {
        model: MERCURY_MODEL,
        messages: [{ role: "user", content: PROMPT }],
        tools: variant3Tools,
        tool_choice: "required"
      },
      variant3ExtractText
    )
  )
}

console.log(
  "report:",
  writeProbeReport("p4-structured", { model: MERCURY_MODEL, schema: SCHEMA, prompt: PROMPT, records })
)
