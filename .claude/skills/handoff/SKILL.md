---
name: handoff
description:
  End-of-session handoff ritual - reflect on surprises, ratchet the environment,
  write HANDOFF.md, reset the canary. Use this whenever the user says "handoff",
  "wrap up", "let's switch chats", "close out the session", "new session", or
  "pick this up later"; whenever canary pressure is HIGH/RED (>70%) and work is
  at a natural boundary; or whenever /helm recommends transitioning toward
  completion. Also use it proactively before context compaction erases
  session-specific insight.
---

# Handoff

A session's most valuable outputs are often not in git: the surprises, the
near-misses, the "oh THAT's how this fails" moments. This ritual extracts them
while they're fresh, converts them into durable environment changes, and leaves
a clean runway for the next session. Run the steps IN THIS ORDER — reflection
degrades fastest, so it goes first; the canary reset goes last because the
outgoing session owns its numbers until the handoff is complete.

## Step 1 — Reflect: the two surprises

Before summarizing anything, answer these two questions honestly. Surprise means
_expectation violation_, not magnitude — a small thing that shouldn't have
happened beats a big thing that was merely difficult.

- **Most surprising POSITIVE**: what worked meaningfully better than you
  expected, or succeeded for a reason you didn't plan? (A pattern that composed
  cleanly, a check that caught something real, an approach that generalized.)
- **Most surprising NEGATIVE**: what failed or nearly failed in a way your model
  of the system said shouldn't happen? (A silent replay, a hardcoded assumption
  surfacing, a hook blocking a legitimate action.)

"Nothing surprised me" is not an acceptable answer — lower the surprise bar
until one of each qualifies. If several compete, pick the one with the largest
gap between expectation and outcome, not the largest consequence.

## Step 2 — Ratchet the environment

Make ONE concrete change for each surprise, so the session permanently tightens
the system:

- **Positive → more likely by default**: codify it — a rule file, a skill, a
  bundled script, a schema shape, a compose-prior — so the next session gets it
  without luck or memory. Ask: "what made this possible, and is that thing
  written down or wired in?"
- **Negative → less likely, or structurally impossible**: prefer structure over
  prose, in this order: make the illegal state unrepresentable (schema/type) >
  deterministic guard (hook, script assertion, test) > config change > rule/doc
  note > memory entry. "Impossible" beats "documented" — a sentence in a doc is
  the weakest ratchet.

Constraints: smallest effective change; verify external specifics against
reality before writing them (per verify-before-writing); never break the live
demo path; commit per the post-edit workflow. If the right change is too large
for the session's remaining budget, create a task for it and record the DESIGN
of the change in HANDOFF.md — but still make some smaller ratchet now.

**The brake — prune one per add.** If a ratchet ADDS an always-on rule to
`.claude/rules/`, pay for it: demote one existing rule in the same commit (move
it to `docs/philosophy/`, give it `paths:` frontmatter so it lazy-loads, or
delete it if superseded). The rule set is a context budget, not an archive —
history lives in git. Path-scoped rules (with `paths:`) and docs are free; only
always-on prose costs.

## Step 3 — Write HANDOFF.md

Write (overwrite) `HANDOFF.md` at the project root — it is git-tracked, so
history preserves prior handoffs. Use exactly this structure:

```markdown
# Handoff — <date> (<session focus in a few words>)

## Where things stand

<2-4 sentences: what this session was about and how it ended>

## Shipped

- <change> (<repo>, commit <hash>)

## In flight / parked

- <work started but not finished, with exact file paths and what remains>

## Next steps

- <ordered; reference task IDs from the task list where they exist>

## Gotchas for the next session

- <environment facts that cost time to discover: hook behaviors, API quirks,
  path/cwd traps, quota limits>

## Reflection

- Surprising positive: <what + why it was surprising>
- Surprising negative: <what + why it was surprising>
- Ratchet applied: <the two environment changes made in Step 2, with
  paths/commits>
- Process codified / skipped reason: <path under dev-processes/, or an explicit
  justification why no workflow this session qualified>
```

Anchor every claim in something checkable (commit hash, file path, task ID) —
the next session should be able to verify rather than trust.

## Step 4 — Codify one agentic process

Review the session for a repeatable agentic workflow, reasoning sequence, or
verification pattern.

- **If one exists**: use the `codify-process` skill to add it under
  `dev-processes/processes/<name>/`, with deterministic graders in
  `dev-processes/evals/graders.ts` and at least one dataset case. Smoke-run it
  (`npm run process -- <name>`) and record the path in HANDOFF.md.
- **Escape hatch**: if genuinely nothing qualified, write an explicit
  justification under `Reflection -> Process codified / skipped reason`. "None"
  or a blank is not acceptable — say what you considered and why it failed the
  bar (not repeatable / no gradeable output / needs tools the harness lacks).

The bar is _repeatable and gradeable_. If you cannot state how you would tell a
good output from a bad one, do not codify it yet — that is a signal the workflow
is not understood well enough to tune, and a process nobody can score is
decoration.

## Step 5 — Session calibration (memory)

Per `docs/philosophy/continual-calibration.md`: note which memories/patterns
actually helped this session and which misled; update or add auto-memory files
accordingly (durable facts only — HANDOFF.md owns the session-specific state).
Lesson routing is owned by the global `distill` skill (one lesson → one layer);
do not maintain a parallel capture ritual here.

## Step 6 — Reset the canary

Last step. Archive the outgoing session's signals into `previous_session` and
zero the counters — the same shape `10_canary_monitor.py` writes on session
change, so the hook picks up cleanly either way:

```bash
python3 - <<'EOF'
import json, time, pathlib
p = pathlib.Path(".claude/state/canary_signals.json")
s = json.loads(p.read_text()) if p.exists() else {}
if s.get("session_start"):
    s["previous_session"] = {
        "session_id": s.get("session_id", ""),
        "edit_count": s.get("edit_count", 0),
        "file_count": len(s.get("files_touched", [])),
        "turn_count": s.get("turn_count", 0),
        "final_pressure": s.get("pressure", 0.0),
        "started": s.get("session_start"),
        "ended": time.time(),
    }
s.update(session_start=time.time(), edit_count=0, files_touched=[], turn_count=0,
         pressure=0.0, warnings=[], components={}, last_updated=time.time())
p.write_text(json.dumps(s, indent=2))
print("canary reset; previous session archived:", s.get("previous_session", {}).get("session_id", "n/a"))
EOF
```

## Step 7 — Hand over

Tell the user: HANDOFF.md is written, the canary is reset, and the next session
should start by reading `HANDOFF.md` (CLAUDE.md points there). Then stop — do
not start new work after a handoff.
