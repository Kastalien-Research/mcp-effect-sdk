# M1a: LangSmith Tracing + First Live Two-Arm Campaign

Date: 2026-08-02 · Model: `mercury-2` · Package:
`apps/inception-cli/packages/evals` · Command:
`pnpm tsx src/harness/campaign.ts --run m1a --formats whole,search-replace --budget 2`
· Corpus: 5 exercises (`clock`, `flatten-array`, `luhn`, `matching-brackets`,
`run-length-encoding`) · Plan:
`docs/superpowers/plans/2026-08-02-inception-cli-m0-m1.md` Task 14.

Numbers below are raw first-contact output — not iterated to look better, per
the task's binding budget/discipline constraint.

## Tracing (`src/harness/tracing.ts`)

`traced<T extends (...a: any[]) => any>(name, fn, options?)` wraps `fn` with
LangSmith's `traceable` when `LANGSMITH_TRACING === "true"`; otherwise it
returns `fn` unchanged (verified by unit test with no network and the env var
unset — `src/harness/tracing.test.ts`, 4 tests, all green, no LangSmith calls
made).

Wired into the campaign (`src/harness/campaign.ts`) as a three-level trace tree:

- `campaign` (`run_type: "chain"`) — the whole `runCampaign` invocation, root.
- `case:<exercise>:<format>` (`run_type: "chain"`) — one per `runCase`, only
  invoked on a live run (a cache hit from `loadOrRun` never re-traces).
- `mercury-chat` (`run_type: "llm"`) — one per chat call. A `processOutputs`
  hook reshapes the logged outputs to attach
  `usage_metadata: { input_tokens, output_tokens, total_tokens }` without
  altering the real return value `runner.ts` consumes.

`LANGSMITH_TRACING`/`LANGSMITH_API_KEY`/`LANGSMITH_ENDPOINT`/`LANGSMITH_PROJECT`
are read from the repo-root `.env` and copied into `process.env` in `main()`
(`seedLangsmithEnv()`) — this has to happen before `runCampaign()` is called,
because `traced()` decides identity-vs-traceable synchronously at wrap time,
before any campaign/case body runs.

Also added: `--only <exercise>` filter on the campaign CLI, used for the Step 2
smoke case below.

## Step 2 — one traced live case (settles probe P7)

Command: `--run m1a-smoke --formats whole --only luhn --budget 2` (1 case, 1
Mercury call — passed on attempt 1).

**What was verified, and how:** I cannot open a browser from this session, so I
did not visually confirm the LangSmith UI. Instead I queried the LangSmith
project programmatically with the `langsmith` SDK's `Client.listRuns()`
(`projectName: "inception-cli"`, `start_time` filter over the last 20 minutes)
immediately after the run. It returned exactly the 3 runs the trace tree should
produce, with parent/child linkage and token counts present:

| run name          | run_type | prompt_tokens | completion_tokens | total_tokens | outputs carry `usage_metadata` |
| ----------------- | -------- | ------------: | ----------------: | -----------: | :----------------------------- |
| `mercury-chat`    | `llm`    |           262 |               188 |          450 | yes                            |
| `case:luhn:whole` | `chain`  |           262 |               188 |          450 | no (aggregated from child)     |
| `campaign`        | `chain`  |           262 |               188 |          450 | no (aggregated from child)     |

This confirms the run was recorded server-side with token counts attached to the
`llm` run and rolled up to its ancestors — the mechanism the UI's token count
column reads from. I did **not** independently confirm the dashboard rendering
(chart, cost column, latency graph) since that requires a browser.

## Step 3 — full live campaign (raw first-contact numbers)

5 exercises × 2 formats × attempt budget 2 = 10 cases, 11 Mercury calls (9 cases
passed on attempt 1; 1 case — `clock`/`search-replace` — consumed both attempts
on parse/apply failures without ever reaching a test run).

```
format          cases  pass@1  pass@2  parse_err  apply_err  well_formed  mean_cost_usd  mean_ms
whole           5      1.00    1.00    0.00       0.00       1.00         0.0002         878
search-replace  5      0.80    0.80    0.20       0.20       0.80         0.0003         1090
```

Per-case detail (`runs/m1a/*.json`):

| exercise            | format         | tests_outcomes | parse_error | apply_error | cost_usd | prompt_tok | completion_tok |
| ------------------- | -------------- | -------------- | ----------- | ----------- | -------- | ---------: | -------------: |
| clock               | search-replace | `[]`           | true        | true        | 0.000549 |        792 |            468 |
| clock               | whole          | `[true]`       | false       | false       | 0.000214 |        341 |            172 |
| flatten-array       | search-replace | `[true]`       | false       | false       | 0.000164 |        290 |            122 |
| flatten-array       | whole          | `[true]`       | false       | false       | 0.000132 |        262 |             89 |
| luhn                | search-replace | `[true]`       | false       | false       | 0.000235 |        292 |            216 |
| luhn                | whole          | `[true]`       | false       | false       | 0.000209 |        266 |            190 |
| matching-brackets   | search-replace | `[true]`       | false       | false       | 0.000193 |        298 |            158 |
| matching-brackets   | whole          | `[true]`       | false       | false       | 0.000167 |        263 |            135 |
| run-length-encoding | search-replace | `[true]`       | false       | false       | 0.000320 |        340 |            314 |
| run-length-encoding | whole          | `[true]`       | false       | false       | 0.000267 |        315 |            251 |

**First real per-arm rates:**

- `whole`: `parse_error_rate = 0.00`, `apply_error_rate = 0.00`.
- `search-replace`: `parse_error_rate = 0.20`, `apply_error_rate = 0.20` (both
  attributable to the single `clock` case, which failed to parse-or-apply on
  both attempts and never reached a test run — `tests_outcomes` is correctly
  empty, not padded with `false`).

**Cost:** full campaign total = $0.002450 (11 Mercury calls). Smoke case
(Step 2) = $0.000207 (1 call). Combined session total for this task ≈
**$0.002657** across 12 live Mercury calls, well inside the ≤20+1 budget.

**LangSmith project:** `inception-cli` (`LANGSMITH_PROJECT` from `.env`). Every
case and chat call in this campaign was traced by the same mechanism verified in
Step 2; I did not re-run the SDK verification per case (that would be redundant
with the Step 2 proof of the wiring) — the same `campaign` → `case:*` →
`mercury-chat` tree is emitted for all 10 cases and the run/case-id fields
(`clock--search-replace--mercury-2--r2`, etc.) match `runs/m1a/*.json`.

## What this settles for M1

- P7 (LangSmith tracing renders runs with token counts): settled by Step 2,
  programmatic verification only (no browser UI check performed).
- First real `parse_error_rate`/`apply_error_rate` split between `whole` and
  `search-replace`, on a 5-exercise corpus: `search-replace` is measurably less
  reliable at the parse/apply layer at this scale (1/5 cases), `whole` had zero
  parse/apply failures. Sample size is small (n=5 per arm) — this is a
  first-contact signal, not a claim of statistical significance.
