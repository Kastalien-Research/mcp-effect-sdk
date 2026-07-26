---
paths:
  - "deploy/**"
---

# Shadow-Mode Blind Spots

Whatever a dry-run/shadow phase SUPPRESSES is exactly what it fails to test.
Treat every suppressed side effect as an UNTESTED code path, and live-fire each
one against a scratch target before declaring cutover readiness.

## What went wrong (2026-07-19)

The GCE shadow phase ran with `DISPATCH_DRY_RUN=1`, which suppressed Airtable
writes, emails, and git push. All six smoke checks were green for two days. The
first live intake after cutover then hit, in sequence:

- airtable-mcp had **no egress** (`internal: true` network) — every
  api.airtable.com PATCH died. Invisible in shadow because shadow never
  attempted a write (fixed: compose `edge` network, 42213df).
- McpExecutor treated HTTP-200 + `isError: true` tool results as SUCCESS, so the
  dead write ALSO reported green and the chain marched on (fixed: tool errors
  throw, 42213df).
- The exception path's own escalation emails echoed back as inbound
  `message.received` events (labels `["sent"]`) and formed a self-sustaining
  escalate→email→event→fail→escalate loop — the failure handler had never
  processed a single real event during shadow either (fixed: adapter drops
  self-sent mail, 7d8c5c8).

Three independent defects, one common cause: the suppression that made shadow
"safe" made precisely those paths untested.

## The rule

Before any cutover out of a dry-run/shadow phase, enumerate every side effect
the dry-run flag suppresses (grep for the flag; each `if (isDryRun())` branch is
one) and exercise the REAL path for each against a scratch target:

- Airtable writes → a scratch record in the live table (then delete it)
- email → the operator's own address
- git push → `--dry-run` push of HEAD to a throwaway ref (this one shipped:
  smoke-test `--push-check`)
- inbound reply handling → send one real message through the channel

A cutover checklist that only proves ingress + health has proven half the
system. The suppressed half is the half that talks to the outside world — the
half that matters.
