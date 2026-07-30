---
name: helm
description:
  Evaluate current system state and recommend phase transitions. Reads phase
  state, canary signals, beads issues, and git activity to make steering
  decisions.
argument-hint: [none]
user-invocable: true
allowed-tools: Bash(bd *), Bash(git log*), Bash(git status*), Bash(cat *), Read
---

Evaluate the current system state and recommend whether to stay in the current
phase or transition.

### 1. Gather State

Read current phase:
!`cat .claude/state/system_phase.json 2>/dev/null || echo '{"phase": "exploration"}'`

Read canary signals:
!`cat .claude/state/canary_signals.json 2>/dev/null || echo '{"pressure": 0}'`

Read beads state: !`bd stats 2>/dev/null || echo "No beads stats"`

!`bd list --status=in_progress 2>/dev/null || echo "No in-progress issues"`

!`bd blocked 2>/dev/null || echo "No blocked issues"`

Read recent git activity:
!`git log --oneline -5 2>/dev/null || echo "No recent commits"`

### 2. Evaluate Phase Transition

Based on the gathered state, evaluate against these transition criteria:

**exploration → convergence:**

- Scout signals are becoming repetitive (same themes recurring)
- Cartographer scope map is stabilizing (boundaries aren't shifting)
- Key unknowns have been addressed
- Canary pressure > 0.3

**convergence → execution:**

- Scope is locked (boundaries agreed, edge cases resolved)
- Names are agreed (key concepts have stable names)
- No major unknowns remain
- Dependencies are mapped and unblocked

**execution → completion:**

- Most execution issues are closed or near-close
- Canary pressure is rising (> 0.5)
- Remaining work is polish, not substance
- Git log shows implementation commits, not exploration

### 3. Output

```
## Helm Assessment

### Current Phase: [phase]
**Entered:** [when]
**Reason:** [why we're in this phase]

### System State
- Canary pressure: [X%]
- In-progress issues: [N]
- Blocked issues: [N]
- Recent activity: [summary]

### Phase Transition Evaluation
[Which transition criteria are met/unmet]

### Recommendation
**[STAY | TRANSITION to X]**
Rationale: [why]

### Active Topology
Primary: [which agents/skills should be most active]
Secondary: [available but not primary]
Dormant: [should not be invoked unless explicitly needed]
```

### 4. Update Phase (if transitioning)

If recommending a transition AND the user approves, update the phase state file:

```bash
cat > .claude/state/system_phase.json << 'EOF'
{
  "phase": "[new_phase]",
  "transitioned_at": "[ISO timestamp]",
  "reason": "[rationale]",
  "canary_pressure": [current_pressure],
  "active_topology": ["[primary agents]"]
}
EOF
```

Do NOT update the phase file without user confirmation. Present the
recommendation and wait.
