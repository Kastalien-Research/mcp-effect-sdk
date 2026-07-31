// Anthropic client construction for the agent evals.
//
// This is the only place in the repository that reaches an external paid API, so
// it is deliberately narrow:
//   - credentials come from `.env` via Node's own loader (no dotenv dependency),
//   - the key is never returned, logged, or written into an artifact,
//   - `verify` never imports this module; only the opt-in eval generators do.
import Anthropic from "@anthropic-ai/sdk"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// Every scenario runs on both models. Haiku is the salience floor: an
// affordance that only the strongest model can find is not a salient
// affordance, it is a puzzle. GR-AGENT-001 is about discoverability, so a
// weaker model failing to select the right tool is the finding, not noise.
export const EVAL_MODELS = ["claude-opus-5", "claude-haiku-4-5"]

/**
 * Per-model request parameters.
 *
 * Adaptive thinking and `output_config.effort` are rejected outright by Haiku
 * 4.5 — it predates both — so the parameters cannot be shared. Haiku therefore
 * runs plain, which is the honest shape for a salience floor anyway: the
 * question it answers is whether a fast, cheap, non-reasoning model can still
 * find the right affordance from the surface alone.
 */
export function modelParameters(model) {
  if (model.startsWith("claude-opus-5") || model.startsWith("claude-sonnet-5")) {
    return { thinking: { type: "adaptive" }, output_config: { effort: "high" } }
  }
  return {}
}

/**
 * Load ANTHROPIC_API_KEY from the environment or `.env`.
 *
 * Node 22+ ships `process.loadEnvFile`, so this needs no dependency. Returns
 * whether a key is present; it never returns the key itself.
 */
export function loadCredentials({ root = repositoryRoot } = {}) {
  if (process.env.ANTHROPIC_API_KEY) return true
  const envPath = path.join(root, ".env")
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath)
  }
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export function createClient() {
  if (!loadCredentials()) {
    throw new Error(
      [
        "ANTHROPIC_API_KEY is not set and no .env provides it.",
        "The agent evals call the Claude API; `pnpm run verify` does not and never needs this key."
      ].join(" ")
    )
  }
  return new Anthropic()
}

/**
 * Redact anything secret-shaped before it reaches a transcript.
 *
 * Transcripts are committed under docs/agent-evidence/, so this runs over every
 * string that lands in one. Modelled on the redacting writer in
 * run-conformance-authorization.mjs.
 */
export function redact(value) {
  const key = process.env.ANTHROPIC_API_KEY
  let text = typeof value === "string" ? value : JSON.stringify(value)
  if (typeof text !== "string") return text
  if (key) text = text.split(key).join("[REDACTED]")
  return text.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
}

/**
 * Cache the system prompt and tool list, which are byte-identical across every
 * trial of a scenario. Caching is a prefix match, so the stable content has to
 * come first and the per-trial task text after — see shared/prompt-caching.md.
 */
export function cacheableSystem(text) {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }]
}

export function usageTotals(messages) {
  return messages.reduce(
    (totals, usage) => ({
      inputTokens: totals.inputTokens + (usage?.input_tokens ?? 0),
      outputTokens: totals.outputTokens + (usage?.output_tokens ?? 0),
      cacheReadTokens: totals.cacheReadTokens + (usage?.cache_read_input_tokens ?? 0),
      cacheCreationTokens: totals.cacheCreationTokens + (usage?.cache_creation_input_tokens ?? 0)
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  )
}

export function parseEvalArguments(argv = process.argv.slice(2)) {
  const options = { trials: 3, models: EVAL_MODELS, maxIterations: 12 }
  for (const argument of argv) {
    const [flag, rawValue] = argument.split("=")
    if (flag === "--trials") options.trials = Number(rawValue)
    else if (flag === "--models") options.models = rawValue.split(",")
    else if (flag === "--max-iterations") options.maxIterations = Number(rawValue)
    else if (flag === "--help" || flag === "-h") options.help = true
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) {
    throw new Error("--trials must be a positive integer")
  }
  return options
}
