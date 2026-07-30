# Maintenance Policy

Effective date: 2026-06-23

The released
[MCP SDK Tier policy](https://modelcontextprotocol.io/community/sdk-tiers) and
the official
[SDK Tier audit](https://github.com/modelcontextprotocol/conformance/tree/main/.claude/skills/mcp-sdk-tier-audit)
are the authority for this repository's Tier maintenance score. The vendored
historical SEP is not an active readiness authority.

## Service levels and clocks

- Triage is measured from issue creation to the first GitHub label event. Tier 1
  requires at least 90% of issues in the rolling audit window to receive that
  first label within two business days.
- Critical resolution is measured from application of the first exact `P0` label
  to the first later issue-close event. Every P0 must close within seven
  calendar days; a prefix, suffix, issue-form title, or other priority label
  does not start that clock.
- Lower-priority work has no resolution SLA.

Business days are Monday through Friday in America/Chicago, excluding United
States federal holidays. Stored timestamps are exact ISO 8601 instants.

## Manual classification

Issue forms intentionally apply no labels. A maintainer reviews the report and
then manually applies labels from the exact Tier taxonomy in
[`.github/labels.json`](.github/labels.json). The first label must reflect a
real triage action; an automatic placeholder would manufacture a response time.

A suspected critical incident follows
[the P0 escalation path](docs/maintenance/p0-escalation.md). Sensitive reports
go through GitHub Security Advisories and are not copied into public issue
evidence.

Maintainers must not relabel, close, recreate, or exclude an issue to improve a
score. The public GitHub timeline is the source event record.

## Separate history and scorecard

Two checked-in artifacts serve different purposes:

- [`docs/maintenance/sla-all-history.json`](docs/maintenance/sla-all-history.json)
  is the append-only all-history ledger. It records issue creation facts and
  stable GitHub timeline event IDs. Refreshing may append newly observed issues
  and events, but it fails if a previously recorded fact changes or disappears.
- [`docs/maintenance/sla-ledger.json`](docs/maintenance/sla-ledger.json) is the
  rolling official scorecard. It is derived from the all-history facts, uses a
  90-day triage window and the official 90% Tier 1 threshold, and includes all
  exact P0 applications since the policy effective date.

`pnpm run check:tier-operations` validates both JSON Schema 2020-12 documents
and independently re-derives the scorecard. Historical misses therefore remain
visible after they age out of the rolling window, without rewriting past events.
Every derived row maps to `GR-TIER-002`.

Refresh public evidence from GitHub with:

```sh
pnpm run generate:tier-maintenance -- --days 90 --write-ledger
```

The command requires authenticated `gh` access, reads each issue timeline,
writes the two ledgers, and emits
`.local/readiness-evidence/tier-maintenance.json`. Its exit status reflects the
rolling official score: a non-passing current score produces exit 1 even though
the evidence files are still written.

The scheduled/manual trusted Tier workflow copies the committed history into
`.local/tier-audit/`, refreshes it with `--write-ledger`, and uploads both the
expanded all-history ledger and its derived rolling scorecard as immutable
run-scoped artifacts. It does not rewrite the checkout. Maintainers use the
command above when a reviewed refresh should update the committed evidence.

The current ledger preserves eight late first-label events and one on-time
event. Its 90-day triage score is therefore 1/9 (11.1%), below the 90% Tier 1
threshold. No P0 event is recorded. This is a real, explicit Tier blocker, not a
reason to erase the historical misses; the rolling score will change only as new
events enter and old events naturally leave the window.

`pnpm run check:tier-relegation` separately surfaces issues approaching the
released policy's two-month unaddressed-issue rule from the same scorecard.

## Stable taxonomy

The exact twelve labels are synchronized by the trusted labels workflow:

- type: `bug`, `enhancement`, `question`;
- status: `needs confirmation`, `needs repro`, `ready for work`,
  `good first issue`, `help wanted`; and
- priority: `P0`, `P1`, `P2`, `P3`.

The sync operation deletes labels outside this canonical set. Historical
timeline entries retain the label names that were actually applied at the time.

An empty rolling window passes the arithmetic threshold but is not formal Tier
designation evidence by itself. Stable release, conformance, documentation,
policy, and Working Group requirements remain independent.
