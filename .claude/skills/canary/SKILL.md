---
name: canary
description:
  Check system health and pressure signals. Shows current pressure score,
  component breakdown, and recommendations.
argument-hint: [none]
user-invocable: true
allowed-tools: Bash(cat *), Read
---

Read the current canary signals and system phase, then produce a health report.

!`cat .claude/state/canary_signals.json 2>/dev/null || echo '{"pressure": 0, "edit_count": 0, "files_touched": [], "turn_count": 0, "warnings": []}'`

!`cat .claude/state/system_phase.json 2>/dev/null || echo '{"phase": "exploration"}'`

## Output Format

```
## Canary Health Report

### Pressure: [X%] [GREEN|YELLOW|ORANGE|RED]

### Components
- Edit velocity: [X%] ([N] edits)
- Scope breadth: [X%] ([N] files)
- Turn count: [X%] ([N] turns)
- Elapsed time: [X%]

### Current Phase: [phase]

### Warnings
[List any active warnings]

### Recommendation
[Based on pressure level and phase:
- GREEN: Continue current work
- YELLOW: Monitor scope, avoid new explorations
- ORANGE: Consider converging. Use /helm to evaluate phase transition.
- RED: Transition to completion. Use /close-out to identify cuts.]
```
