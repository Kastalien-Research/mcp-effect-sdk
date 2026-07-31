---
name: close-out
description:
  Drive work to completion. Audits scope, generates cut lists, produces
  completion checklists, and identifies hard calls that need human input.
argument-hint: [none]
user-invocable: true
allowed-tools:
  Bash(bd *), Bash(git status*), Bash(git log*), Bash(git diff*), Bash(cat *),
  Read
---

Drive the current work to completion. Audit scope, identify cuts, and produce a
completion checklist.

### 1. Gather State

Read current phase and canary:
!`cat .claude/state/system_phase.json 2>/dev/null || echo '{"phase": "unknown"}'`
!`cat .claude/state/canary_signals.json 2>/dev/null || echo '{"pressure": 0}'`

Read beads state: !`bd stats 2>/dev/null || echo "No beads stats"`
!`bd list --status=open 2>/dev/null || echo "No open issues"`
!`bd list --status=in_progress 2>/dev/null || echo "No in-progress issues"`

Read git state: !`git status --short 2>/dev/null || echo "Clean"`
!`git log --oneline -5 2>/dev/null || echo "No recent commits"`

### 2. Scope Audit

Compare planned work against actual state:

- **Planned**: What was the original scope? (Check beads issues, recent commits,
  session context)
- **Completed**: What's actually done? (Closed issues, committed code)
- **Outstanding**: What's still open? (Open/in-progress issues, uncommitted
  changes)

### 3. Generate Cut List

For each outstanding item, make a hard call:

- **CUT**: Remove from scope. Not essential for this session. Give a reason.
- **DEFER**: Create a beads issue for later. Important but not now. Specify
  when.
- **KEEP**: Must be done before session ends. Explain why it's essential.

The default should be CUT or DEFER. Only KEEP items that are truly blocking.

### 4. Completion Checklist

Produce a concrete checklist of what must happen before "done":

- Code changes committed and pushed
- Beads issues updated (close completed, create deferred)
- No uncommitted changes in git
- Phase state reflects reality
- Any hard calls surfaced to the user

### 5. Output

```
## Close-Out Assessment

### Scope Audit
**Planned:** [original scope — what we set out to do]
**Completed:** [what's done — closed issues, committed code]
**Outstanding:** [what's still open]

### Cut List
| Item | Decision | Reason |
|---|---|---|
| [item] | CUT/DEFER/KEEP | [reason] |

### Completion Checklist
- [ ] [concrete step]
- [ ] [concrete step]
- [ ] [concrete step]

### Hard Calls Needed
[Decisions that require human input — present as structured options, not open questions]

### Session Summary
[2-3 sentences: what was accomplished, what was deferred, what the user should know]
```

### 6. Execute

After presenting the assessment, help execute the completion checklist:

- Close completed beads issues (`bd close <id1> <id2> ...`)
- Create deferred issues (`bd create --title="..." --type=task`)
- Commit and push code changes
- Update phase state if appropriate
