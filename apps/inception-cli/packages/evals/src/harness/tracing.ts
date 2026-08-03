import { traceable } from "langsmith/traceable"

export interface TracedOptions {
  /** LangSmith run type, e.g. "chain" (default), "llm", "tool". */
  runType?: string
  /** Reshape the logged outputs (e.g. attach `usage_metadata` for "llm" runs) without altering the real return value. */
  processOutputs?: (outputs: any) => Record<string, unknown>
}

const tracingEnabled = (): boolean => process.env["LANGSMITH_TRACING"] === "true"

/**
 * Wraps `fn` with LangSmith `traceable` when LANGSMITH_TRACING === "true".
 * Otherwise returns `fn` unchanged (identity, no network, no-op) — safe to
 * call unconditionally without LangSmith env configured.
 */
export function traced<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
  options: TracedOptions = {}
): T {
  if (!tracingEnabled()) return fn
  return traceable(fn, {
    name,
    run_type: options.runType ?? "chain",
    ...(options.processOutputs ? { processOutputs: options.processOutputs } : {})
  }) as unknown as T
}
