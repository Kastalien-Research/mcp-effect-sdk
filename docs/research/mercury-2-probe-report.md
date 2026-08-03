# Mercury 2 Probe Report (M0 exit artifact)

Date: 2026-08-02 · Model: `mercury-2` (observed, P0) · Fixtures:
`apps/inception-cli/packages/evals/fixtures/probes/` (commits
`23394f2`…`a987f71`) · Plan:
`docs/superpowers/plans/2026-08-02-inception-cli-m0-m1.md` Task 8.

Probes recorded raw measurements only; all interpretation lives in this document
(no-self-graded-verification: each probe was implemented and review-gated by
different agents than the ones who captured or interpret it).

## P0 — model inventory

Methodology: one `GET /models`, body captured verbatim; the chat-model id was
copied from the response into `src/lib/constants.ts` (observed, never guessed).

| measurement        | value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| HTTP status        | 200                                                                     |
| models listed      | `mercury-2` (exactly one)                                               |
| pricing in listing | $0.25/M in, $0.75/M out, $0.025/M cached in — matches `PRICING` exactly |

**Design consequence:** `MERCURY_MODEL = "mercury-2"` is stable and pinned; the
pricing constants are provider-confirmed, not documentation folklore.

## P1 — latency profile (4 efforts × 3 shapes × 3 reps, streamed)

Methodology: 36 sequential `streamChat` calls, `max_tokens: 300`; shapes = short
(~60 tok), long (~30k tok), tools (short + 8 tool schemas, auto).

| cell (effort/shape)                                   | TTFB med ms           | TTFT med ms               | total med ms              |
| ----------------------------------------------------- | --------------------- | ------------------------- | ------------------------- |
| instant/short · low/short · medium/short · high/short | 128 · 97 · 130 · 94   | 407 · 335 · 336 · 510     | 421 · 361 · 418 · 560     |
| instant/long · low/long · medium/long · high/long     | 150 · 263 · 151 · 132 | 1335 · 1837 · 1687 · 1490 | 1336 · 2355 · 1689 · 1547 |
| instant/tools · low/tools · medium/tools · high/tools | 84 · 85 · 103 · 95    | 298 · 282 · 433 · 658     | 298 · 282 · 433 · 872     |

Worst TTFT across all 36 samples: **2351 ms** (long prompt). Two high-effort
samples (`high/short/rep2`, `high/tools/rep0`) finished `length` with
`ttftMs: null` (no content delta before truncation) — excluded from medians,
retained raw.

**Design consequence:** the published 1.7s-vs-12.7s contradiction resolves
decisively to the fast side — no cell came within 5× of 12.7s. No loop-shape
change needed; TTFT is dominated by prompt length, not `reasoning_effort`.
**Caveat:** `usage` was null on all 36 samples — Mercury's SSE stream emits no
usage frame unless `stream_options: { include_usage: true }` is set. Provider-
side cache behavior therefore could not be measured in P1 (spec delta below).

## P2 — stream termination (5 short streamed runs)

Methodology: 5 short completions, `max_tokens: 60`; last 6 raw frames,
`sawDoneSentinel`, `finishReason`, usage-arrival recorded per run.

| measurement       | value                  |
| ----------------- | ---------------------- |
| `[DONE]` sentinel | 5/5 runs               |
| finishReason      | 3× `length`, 2× `stop` |
| usage arrived     | 0/5 (see P1 caveat)    |

**Design consequence:** Effect's `[DONE]`-keyed finish path works unmodified.
**Anomaly (unexplained, raw):** 3/5 ~10-token replies finished `length` under
`max_tokens: 60` — token budgets appear to be consumed by something beyond
visible output (consistent with P5's `reasoning_tokens` observation). Do not
size `max_tokens` tightly; treat `length` as a common, non-exceptional finish.

## P3 — tool-call fragment shapes (2 scenarios × 3 reps, streamed)

Methodology: forced single call and two-file `auto` prompt; full
`toolCallFrames` recorded verbatim (the M2 provider client's reference fixture).

| measurement                                | value                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| object `tool_choice` `{type:"function",…}` | **HTTP 400** — "Input should be 'auto', 'required' or 'none'" (captured verbatim) |
| fragments per run                          | exactly 1 complete frame, all 6 runs                                              |
| parallel tool calls under `auto`           | never observed (always exactly 1 call)                                            |

**Design consequence (load-bearing for M2):** Mercury cannot force a _named_
function — only `auto | required | none`. Forcing a specific tool requires
offering exactly one tool with `required`, or prompt-level steering. Arguments
arrive as one complete fragment: the M2 client needs no incremental
tool-call-delta assembly, and the agent loop should assume single-call turns.

## P4 — schema-constrained output (3 variants × 3 reps, non-streamed)

Methodology: `response_format json_schema` strict:false / strict:true / forced
tool call, one moderately nasty nested schema; ajv `allErrors` validation over
recorded raw text.

| measurement                       | value                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| HTTP 200, jsonParsed, schemaValid | 9/9 across all variants                                     |
| `strict: true`                    | accepted; no rejection, no observable behavioral difference |
| object tool_choice 400            | persisted as `rep: -1` record                               |

**Design consequence:** structured output is viable through the codec-
transformer seam as specced (`strictJsonSchema: false` stands — strict mode is
accepted but does nothing observable). **Gap:** this prompt/schema pair never
provoked an invalid response, so M1 still lacks a negative-case fixture;
repair-path code must not be validated against P4 alone.

## P5 — forced-tool-call reliability (20 sequential non-streamed calls)

Methodology: `tool_choice: "required"` with a single `apply_edit` tool, 3-level
nested schema (`required` at every level), deterministic 5-snippet × 4-
instruction prompt grid; ajv over each returned `arguments` string.

| measurement                    | value                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| jsonParsed / schemaValid       | **18/20 · 18/20** (prior uncommitted run: 19/20)                                              |
| failure mode                   | both misses returned **no tool call at all** (HTTP 200, `argsRaw: null`) — not malformed args |
| misses' `reasoning_tokens`     | 482 and 494 — the two highest of the run                                                      |
| ajv errors when a call arrived | zero, ever; 3-level `required` never tripped                                                  |
| `completion_tokens`            | **0 in all 20 records** despite nonzero `reasoning_tokens`/`total_tokens`                     |

**Design consequence (ledger):** the exact-match bet's assumption (`08dca5e2…`:
anchors reproduce reliably enough that apply-failures don't dominate the rollout
budget) **survives first contact but is not yet measured**: when a call arrives,
argument structure is perfect (18/18), and the observed failure mode — an absent
call — is a cheap dead rollout under best-of-N (assumption `bf30f438…`'s
economics), not an anchor failure. Anchor fidelity against real file content is
only measurable as M1's `apply_error_rate`. Outcome recorded as **unclear**
(consistent-with, pending M1); **no `challenge_assumption` warranted**.
**Cost-accounting consequence:** `completion_tokens: 0` on tool-call responses
means `PRICING`-based cost math undercounts tool-call output; M1 should use
`total_tokens − prompt_tokens` or treat tool-call output cost as a known gap.
**Caveat:** rep 0's `usage.cached_input_tokens` (249/259) is likely contaminated
by the pre-loop rejected-tool_choice probe reusing rep 0's prompt; do not cite
rep 0's cache counters as steady-state (future reruns: distinct dummy prompt for
the rejection probe).

## P6 — FIM/Edit endpoint existence

Methodology: three candidate endpoints hit once each with mercury-2; P0 fixture
re-scanned locally for edit/coder model ids.

| candidate                        | status  | body gist                                                                                    |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `POST /completions` (suffix FIM) | 404     | `{"detail":"Not Found"}`                                                                     |
| `POST /fim/completions`          | **400** | "Model must be one of: **mercury-coder, mercury-coder-small, mercury-edit, mercury-edit-2**" |
| `POST /edits`                    | 404     | `{"detail":"Not Found"}`                                                                     |
| `/models` re-scan                | —       | only `mercury-2`; zero edit/coder ids listed                                                 |

**Design consequence:** mercury-2 itself has no FIM/edit surface, but the
endpoint exists and gates on four sibling model ids that `/models` does not
advertise. The fifth edit-format arm is **possible but unproven** — it needs a
follow-up probe (`/fim/completions` with `model: "mercury-coder"`) before any
arm is built. Deferred past the M0 gate.

## Ledger actions taken

- `record_outcome` on decision `897ad11b…`
  (`inception-cli-v1-edit-policy- exact-match-only`): data =
  `p5_json_parsed: 18/20`, `p5_schema_valid: 18/20`, fixtures path;
  `expectationAssessment: unclear` — the decision's expected outcome is defined
  over M1's `apply_error_rate`, which M0 cannot measure; P5's proxy evidence is
  consistent with the bet and surfaced no contradiction.
- No `challenge_assumption` on `08dca5e2…`: the observed failure mode (absent
  tool call) is not anchor misreproduction, and argument fidelity was 18/18.

## Spec deltas applied (same commit)

1. **§3.4 fifth arm**: probe-dependent branch resolved — no FIM on mercury-2;
   `/fim/completions` exists gated to unlisted sibling models; fifth arm
   deferred pending a mercury-coder follow-up probe.
2. **§5 Token accounting**: streaming usage requires
   `stream_options.include_usage`; tool-call responses report
   `completion_tokens: 0` — both constraints now recorded where the spec relies
   on observed usage.
3. **§5 Tool-calling constraints (new bullet)**: no named-function `tool_choice`
   (only `auto|required|none`); one complete argument fragment per call; no
   parallel calls observed; ~5–10% absent-call rate under `required` at elevated
   reasoning load.

## P6b — FIM follow-up (post-gate, user-sanctioned)

Methodology: one `POST /fim/completions` per sanctioned model (`mercury-coder`,
`mercury-edit-2`), same body as P6; raw status + body.

| model          | status | result                                                                         |
| -------------- | ------ | ------------------------------------------------------------------------------ |
| mercury-coder  | 200    | real FIM completion at `choices[0].text`; usage sane (`completion_tokens: 17`) |
| mercury-edit-2 | 200    | identical completion text                                                      |

**Design consequence:** the fifth edit-format arm is now **unblocked** — both
sibling models serve FIM with correct usage accounting (unlike chat tool-call
responses). Arm design/eval remains M1-Phase-B scope.
