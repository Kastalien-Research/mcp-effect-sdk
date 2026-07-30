# Tier maintenance evidence

- [`sla-all-history.json`](sla-all-history.json) is the append-only issue and
  GitHub timeline fact ledger. Its schema is
  [`sla-all-history.schema.json`](sla-all-history.schema.json).
- [`sla-ledger.json`](sla-ledger.json) is the derived rolling Tier scorecard.
  Its schema is [`sla-ledger.schema.json`](sla-ledger.schema.json).
- [`p0-escalation.md`](p0-escalation.md) documents manual exact-`P0`
  classification and the seven-day clock.

The canonical policy is [`MAINTENANCE.md`](../../MAINTENANCE.md). Refresh live
facts with:

```bash
pnpm run generate:tier-maintenance -- --days 90 --write-ledger
```

The generator refuses to rewrite or delete a previously recorded GitHub fact.
The checker re-derives the rolling scorecard from the all-history ledger.
Scheduled/manual trusted audits perform the same refresh under
`.local/tier-audit/` and upload both ledgers without modifying the checkout.
