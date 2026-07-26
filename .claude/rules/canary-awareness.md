## Canary Awareness

The Canary is an ambient monitoring system that tracks session pressure through edit velocity, scope breadth, turn count, and elapsed time. Signals are written to `.claude/state/canary_signals.json` by the `10_canary_monitor.py` hook.

### Reading Canary Signals

At key decision points — before expanding scope, before new explorations, before adding features — check the canary:

```bash
cat .claude/state/canary_signals.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Pressure: {d[\"pressure\"]:.0%} | Edits: {d[\"edit_count\"]} | Files: {len(d[\"files_touched\"])} | Turns: {d[\"turn_count\"]}')" 2>/dev/null || echo "No canary signals"
```

### Pressure Thresholds

- **< 0.3**: Green. Normal operations, explore freely.
- **0.3 - 0.5**: Yellow. Proceeding normally but be mindful of scope.
- **0.5 - 0.7**: Orange. Avoid opening new explorations. Favor convergence.
- **> 0.7**: Red. Strongly consider phase transition toward completion. Use `/helm` to evaluate.

### Response Protocol

When canary pressure is elevated:

1. **Never ignore a canary warning.** Acknowledge it and explain why you're proceeding.
2. **Bias toward convergence.** Prefer finishing over starting.
3. **Check scope drift.** Are you still working on what you set out to do?
4. **Consider cutting.** Use `/close-out` to identify what can be deferred.

The Canary doesn't make decisions — it provides pressure signals. The Helmsman (`/helm`) interprets them in context.
