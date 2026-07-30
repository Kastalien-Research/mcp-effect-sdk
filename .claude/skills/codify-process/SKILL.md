---
name: codify-process
description:
  Codify a repeatable agentic development workflow as an Effect dev process
  under dev-processes/, traced to LangSmith and scored by deterministic graders.
  Use when a multi-step workflow discovered during a task or handoff is worth
  reusing, tuning, and evaluating over time.
---

# Codify Process

When a developer task involves multi-step reasoning, synthesis, inspection, or
generation that is likely to recur, **codify it as data** under `dev-processes/`
rather than leaving it in prompt history.

Read `dev-processes/README.md` first — it holds the layout, the commands, and
the reasoning behind the harness.

## What qualifies

A good candidate is **repeatable and gradeable**. If you cannot say how you
would tell a good output from a bad one, you are not ready to codify it yet;
write the grading criterion first, then the process.

Bad candidates: one-off investigations, anything needing broad filesystem or
network access (the harness is prompt-in/text-out today), anything whose output
nobody will check.

## Procedure

1. **Name it.** Hyphenated, stable — this becomes the trace key, the dataset
   name, and the experiment prefix. Renaming later orphans your history.

2. **Write `dev-processes/processes/<name>/process.ts`:**

```ts
import { defineProcess } from "../../harness/process.js"

export default defineProcess<string>({
  name: "<name>",
  description: "One line, shown by --list.",
  promptVersion: "1",
  system: "Standing instructions. Be explicit about output format.",
  prompt: (input) => `…${input}…`
})
```

3. **Register it** — add one line to `dev-processes/processes/registry.ts`. The
   registry is explicit so a typo is a compile error, not a runtime miss.

4. **Write graders before tuning.** Add deterministic checks to
   `dev-processes/evals/graders.ts` and unit-test them in `graders.test.ts`. Per
   `.claude/rules/no-self-graded-verification.md`, the model that produced the
   output must not be what decides it is correct. Prefer a mechanical check over
   an LLM judge whenever the criterion can be expressed as one.

5. **Add dataset cases** to `dev-processes/evals/datasets.ts` — in git, small
   and adversarial. The point is catching a prompt regression, not demonstrating
   the happy path.

6. **Verify:**

```bash
npm run typecheck:dev-processes
npm run effect:strict:dev-processes
npm run test:dev-processes
npm run process -- <name> "sample input"
npm run eval -- <name>            # costs tokens; do it deliberately
```

7. **Confirm the transcript** landed under
   `dev-processes/processes/<name>/transcripts/`, and that the run appears in
   the LangSmith project.

## Tuning over time

**Bump `promptVersion` on every prompt change.** The experiment prefix embeds
it, so a score delta is attributable to a specific revision. Without that, you
have two numbers and no idea what moved between them.

## Rules that bite

- **Never render a raw error.** Use `redactUnknown` from `harness/redact.ts`. An
  Effect HTTP failure cause carries request headers, which carry the API key.
- **Do not import anything from `src/`.** `dev-processes/` is a separate
  TypeScript project on purpose; app code and dev tooling stay disjoint.
- **Use `.js` import specifiers**, not `.ts` — `moduleResolution: Node16`.
