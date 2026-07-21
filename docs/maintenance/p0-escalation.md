# P0 escalation path

Use this path for a defect that causes widespread unavailability, data exposure or corruption, a practical authentication/authorization bypass, or a release-blocking protocol defect with no safe workaround.

1. If the report contains sensitive security information, stop and open a private [GitHub Security Advisory](https://github.com/Kastalien-Research/mcp-effect-sdk/security/advisories/new). Do not use a public issue.
2. Otherwise, open the repository's `critical-incident.yml` issue form. It applies `priority:P0`, `triage:unreviewed`, and `type:bug` and requests impact, scope, reproduction, and mitigation details.
3. The first maintainer responder confirms or downgrades severity with a written reason, assigns an owner, and records the response timestamp. Do not remove `triage:unreviewed` before that classification exists.
4. For confirmed P0 incidents, the owner posts status at least once per business day and drives a tested correction to completion within seven calendar days of the initial report.
5. After resolution, record the exact issue/advisory identity, opened/deadline/response/resolution timestamps, collection command or method, command exit/status, outcome, and `GR-TIER-002` mapping in `docs/maintenance/sla-ledger.json`.

The ledger is evidence, not a control surface: changing an issue label or closing an issue only to manufacture an SLA result is prohibited. A missed deadline remains recorded as missed.
