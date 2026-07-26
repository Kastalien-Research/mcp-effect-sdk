---
paths:
  - "src/ledger/**"
  - "src/cli/**"
  - "data/correction-taxonomy.json"
---

# Ledger Replay Discipline

The taxonomy loop only works because every run stays REPLAYABLE: a taxonomy edit is
safe since `npm run ingest` re-derives any run's correction rows idempotently on
(record_id, webset_id), and `npm run verify-ingest` re-checks them against the source
annotations. Replayability dies quietly when a run's inputs are lost — and after a
taxonomy change, an un-replayed run FAILS verify-ingest (expected rows are derived
with the current taxonomy; stored rows carry the old one).

## The rule

When ingesting a run, persist its inputs under canonical names in `data/` and never
delete them:

- `data/return-<recordId>.json` — the workflow return value, verbatim
- `data/role-<recordId>.txt` — `{{role_url}}` + `"\n"` + `{{candidate_notes}}`
- timestamps live in the ledger row (`started_at`/`finished_at`) — re-pass them on
  replay, because the upsert overwrites all non-identity columns

After ANY edit to `data/correction-taxonomy.json`: replay every run, then
verify-ingest each, then `npm run mirror-runs`. `npm run distill` lists the runs and
confirms the 'other' bucket state.

## Recovery, not a plan

A run whose role-text is missing can be reconstructed from its Airtable record —
`Role URL + "\n" + Candidate Notes` reproduces the stored fingerprint (proven for
run 1 on 2026-07-17: sha256 matched exactly). Verify the hash BEFORE replaying;
a mismatched reconstruction would silently rewrite `role_fingerprint`.
