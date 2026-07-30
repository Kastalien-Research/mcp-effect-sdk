# P0 escalation path

Use this path for a core functionality failure that prevents basic MCP
operations or for a high-severity security issue meeting the released MCP SDK
Tier policy's P0 criteria.

1. If the report contains sensitive security information, stop and open a
   private
   [GitHub Security Advisory](https://github.com/Kastalien-Research/mcp-effect-sdk/security/advisories/new).
   Do not put credentials, exploit details, or private advisory data in a public
   issue.
2. Otherwise, use the `critical-incident.yml` issue form. The form applies no
   labels.
3. A maintainer manually confirms severity and applies the exact `P0` label
   together with appropriate type and status labels. The timestamp of that exact
   label application starts the Tier resolution clock of seven calendar days.
4. Assign an owner, record a tested mitigation, and drive the correction to
   completion. The first GitHub close event after the P0 label is the measured
   endpoint.
5. Refresh the public timeline evidence with
   `pnpm run generate:tier-maintenance -- --days 90 --write-ledger`.

The append-only all-history ledger preserves the label and close event IDs. A
miss remains a miss even after it leaves the rolling scorecard; labels and issue
state must never be altered merely to manufacture an SLA result.
