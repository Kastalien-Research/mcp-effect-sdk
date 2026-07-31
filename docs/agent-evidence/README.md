# Agent evidence

Machine-readable results of running this SDK's own affordance surface against
real language models. These artifacts satisfy `GR-AGENT-001`, `GR-AGENT-002`,
and `GR-AGENT-003` — the three readiness rows that ask whether an agent can
actually discover and use what the SDK exposes.

| Artifact                        | Requirement  | Claim                                                                                          |
| ------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `salience-audit.json`           | GR-AGENT-001 | Tool, resource, and prompt affordances are discoverable and salient without prompt-side hints. |
| `golden-transcripts.json`       | GR-AGENT-002 | Representative tasks complete through MCP affordances, with full transcripts.                  |
| `affordance-observability.json` | GR-AGENT-003 | The offered, selected, ignored, retried, and failed paths are all observable.                  |

`agent-eval.schema.json` is the contract. `pnpm run check:agent-evidence`
enforces it on every `verify`, offline and without an API key.

## Regenerating

```bash
pnpm run eval:agent                       # 6 scenarios x 2 models x 3 trials
pnpm run eval:agent --trials=1            # cheaper smoke run
pnpm run eval:agent --models=claude-opus-5
```

Requires `ANTHROPIC_API_KEY` (read from `.env`). **Regenerate whenever the
affordance surface changes** — the artifact records the SDK commit it was
measured against.

`verify` never runs this and never needs the key: the artifacts are committed,
and the gate validates the committed files.

## How it works

The fixtures already existed. `examples/agent-facing-proof-servers.ts` defines
six servers modelling the situations these requirements name — discovery,
ambiguity, recovery, resource-before-action, prompt-versus-tool, and
observability — and each publishes a brief resource declaring its own success
criteria. It even defines
`TraceEventKind = "offered" | "selected" | "ignored" | "retried" | "failed"`,
exactly GR-AGENT-003's vocabulary. Nothing drove them until
`pnpm run eval:agent`.

Each trial hosts one proof server in-process and drives it over the
**dispatcher** — real JSON-RPC, not internals — so the model sees precisely what
any MCP client would see. Tools become Anthropic tool definitions whose `run`
proxies back to `tools/call`; resources and prompts are exposed the way a real
client surfaces them. A failure is therefore a real SDK defect rather than a
harness artifact.

Three properties keep the evidence honest:

- **The model is the subject, never the judge.** Scoring compares the run
  against criteria the fixture declared in advance (`goodAffordance`,
  `expectedRetry`, `requiredToolArgument`, …). No model is asked whether a
  transcript looked convincing.
- **Answer keys are withheld.** Those same criteria would tell the model which
  affordance is correct, so `withholdAnswerKeys` strips them from anything the
  model reads while the scorer sees the original. Otherwise every scenario would
  measure reading comprehension instead of salience.
- **The system prompt names nothing.** It does not mention a tool, hint at the
  task, or suggest an approach — otherwise the eval would measure the prompt.

## The bar

A flat percentage across models measures model capability; the requirement is
about the _surface_. So the bar is structured:

1. The primary model (`claude-opus-5`) passes every scenario on every trial. A
   failure there means an affordance is genuinely not discoverable.
2. Every scenario is solvable by every model at least once. A scenario no floor
   model ever completes is a surface problem, not a model problem.
3. Every model/scenario pair below 100% is recorded in `summary.gaps` with its
   failure reasons. Nothing is rounded up to "pass", and `check:agent-evidence`
   fails if an observed gap is missing from the artifact.

Two models run because a salience claim resting on one strong model is not a
salience claim. `claude-haiku-4-5` is the floor: an affordance only a frontier
model can find is not salient. Three trials per scenario per model, because
models are non-deterministic and a pass _rate_ is the honest unit.

## What these evals have already found

- **A real SDK defect.** Any tool registered without `parameters` advertised an
  input schema containing a top-level `anyOf`, which several LLM providers
  reject — rejecting the _entire request_, so one argument-less tool made a
  whole server unusable to those clients. Fixed in `src/McpServer.ts`;
  regression test in `test/schema/wp5c-json-schema.test.mjs`. This took
  GR-AGENT-003 from 50% to 100%.
- **A fixture whose task presumes an affordance it does not offer.** The
  ambiguity brief says to archive an invoice "after confirming it is paid", but
  nothing on the surface can confirm payment. `claude-opus-5` correctly declined
  to assert it and asked the caller. The eval supplies that confirmation as task
  framing rather than changing the fixture; see the comment in
  `scripts/lib/agent-eval-scenarios.mjs`.
- **A standing salience gap.** `claude-haiku-4-5` frequently reads the
  deployment policy resource and then stops without calling the tool it was
  meant to inform. Recorded in `summary.gaps` rather than suppressed.
