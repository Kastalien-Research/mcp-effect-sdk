# Maintenance Policy

Effective date: 2026-06-23

## Service levels

- Every new public issue receives maintainer triage within two business days.
  Triage means a maintainer records a type, priority, disposition, and next
  owner or explicitly requests the information needed to do so.
- Confirmed `priority:P0` defects and security vulnerabilities are resolved
  within seven calendar days of the initial report. Closing without a
  correction, or recording only a workaround, does not satisfy resolution
  evidence.
- Lower-priority work is scheduled according to impact and maintainer capacity;
  no resolution SLA is claimed for it.

Business days are Monday through Friday in America/Chicago, excluding United
States federal holidays. Deadlines and observed actions are stored as explicit
ISO 8601 timestamps.

## Classification

New issue forms add `triage:unreviewed` and a type label. A maintainer removes
`triage:unreviewed` only after recording priority and disposition. Suspected
critical incidents use the `priority:P0` path in
[docs/maintenance/p0-escalation.md](docs/maintenance/p0-escalation.md).
Sensitive security reports use GitHub Security Advisories and are never copied
verbatim into public issues or evidence.

Maintainers do not close or reclassify existing issues merely to make the ledger
look complete. Any excluded event needs a reason in its evidence entry.

## Evidence collection

The checked-in evidence path is
[docs/maintenance/sla-ledger.json](docs/maintenance/sla-ledger.json), validated
by `pnpm run check:tier-operations` against its JSON Schema. Each entry maps to
`GR-TIER-002` and records the issue/event identity, timestamps, deadline,
observed response, exact collection command or method, command exit/status, and
outcome.

`pnpm run generate:tier-maintenance` automates the public-issue path: it reads
every issue via `gh`, computes each deadline in America/Chicago against the
federal-holiday calendar, classifies the outcome as `met`, `missed`, or
`pending`, and writes `.local/readiness-evidence/tier-maintenance.json` for
`GR-TIER-002`. Add `--write-ledger` to project the entries into the checked-in
ledger.

Three properties keep that automation honest:

- It never invents entries. Issues opened before the effective date are excluded
  because the policy is not retroactive.
- It writes no readiness artifact when nothing has settled. `GR-TIER-002` then
  stays `unknown` — no evidence yet — rather than `fail`, which would claim the
  SLA was measured and missed.
- It re-reads the two commitments out of the vendored
  `sources/vendor/sep-1730/1730-sdks-tiering-system.md` and fails if the
  upstream text no longer says what the thresholds encode, and refuses to
  compute a deadline in a year whose holidays are not enumerated.

The generator also records two figures the per-incident ledger does not: the
"github stats on issues" response-time measure SEP-1730 validates a tier
application against, and the horizon for its two-month relegation rule.
`pnpm run check:tier-relegation` reads that horizon offline on every `verify`,
so the deadline cannot arrive unannounced.

As of 2026-07-26 the record is: eight issues in scope, none addressed, median
first-response time 32.8 days, and the earliest relegation date 2026-08-23.
`GR-TIER-002` therefore fails. That is the accurate reading, and it improves the
moment those issues are triaged — a label, an assignee, or a comment is enough
to clear an issue from the relegation horizon.

For a public issue, collect the source event with this parameterized command and
record the fully substituted command in the entry:

```sh
gh issue view <number> --repo Kastalien-Research/mcp-effect-sdk --json number,url,createdAt,updatedAt,closedAt,labels,author,comments
```

For a private advisory, the collection method is a maintainer review of the
GitHub Security Advisory audit trail; publish only a redacted advisory
identifier, timestamps, status, and outcome.

## Effective date and scope

The effective date is **2026-06-23**, the day the repository's first public
issue was filed. It therefore covers the repository's complete public issue
history: every issue ever opened here is measured.

It was previously 2026-07-17. That date sat _after_ every existing issue, so the
ledger excluded the only data there was and reported "no evidence" while eight
issues sat untriaged. SEP-1730 does not measure a per-incident ledger — it
validates against "github stats on issues", and relegates an SDK whose issues go
unaddressed for two months. Measuring a window that began after the backlog
meant the local gate read more favourably than the criterion it claims to
encode.

Moving the date does not claim the policy existed earlier. It sets the
measurement window to the full history so the evidence is not selective. The
immediate effect is that the record gets worse: the eight issues opened on
2026-06-23 are now in scope and recorded as missed.

The security policy in [SECURITY.md](SECURITY.md) is a separate commitment
covering vulnerability reports, and keeps its own effective date of 2026-07-17.

An empty ledger means the policy is active but does not establish Tier
compliance.
