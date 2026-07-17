# Maintenance Policy

Effective date: 2026-07-17

## Service levels

- Every new public issue receives maintainer triage within two business days. Triage means a maintainer records a type, priority, disposition, and next owner or explicitly requests the information needed to do so.
- Confirmed `priority:P0` defects and security vulnerabilities are resolved within seven calendar days of the initial report. Closing without a correction, or recording only a workaround, does not satisfy resolution evidence.
- Lower-priority work is scheduled according to impact and maintainer capacity; no resolution SLA is claimed for it.

Business days are Monday through Friday in America/Chicago, excluding United States federal holidays. Deadlines and observed actions are stored as explicit ISO 8601 timestamps.

## Classification

New issue forms add `triage:unreviewed` and a type label. A maintainer removes `triage:unreviewed` only after recording priority and disposition. Suspected critical incidents use the `priority:P0` path in [docs/maintenance/p0-escalation.md](docs/maintenance/p0-escalation.md). Sensitive security reports use GitHub Security Advisories and are never copied verbatim into public issues or evidence.

Maintainers do not close or reclassify existing issues merely to make the ledger look complete. Any excluded event needs a reason in its evidence entry.

## Evidence collection

The checked-in evidence path is [docs/maintenance/sla-ledger.json](docs/maintenance/sla-ledger.json), validated by `pnpm run check:tier-operations` against its JSON Schema. Each entry maps to `GR-TIER-002` and records the issue/event identity, timestamps, deadline, observed response, exact collection command or method, command exit/status, and outcome.

For a public issue, collect the source event with this parameterized command and record the fully substituted command in the entry:

```sh
gh issue view <number> --repo Kastalien-Research/mcp-effect-sdk --json number,url,createdAt,updatedAt,closedAt,labels,author,comments
```

For a private advisory, the collection method is a maintainer review of the GitHub Security Advisory audit trail; publish only a redacted advisory identifier, timestamps, status, and outcome.

No period before the effective date is measured or claimed. An empty ledger means the policy is active but does not establish Tier compliance.
