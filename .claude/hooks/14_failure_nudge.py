#!/usr/bin/env python3
"""Mid-session distill nudge: when the same tool call fails twice within one
session, inject a one-line suggestion to run /distill and capture the lesson.

Keyed by normalized command (Bash) or file path (Edit/Write). At most one nudge
per key per session. State lives in .claude/state/failure_counts.json and resets
when the session changes. Never breaks a session — always exits 0."""
import json, os, pathlib, sys


def norm_key(tool_name, tool_input):
    if not isinstance(tool_input, dict):
        return None
    if tool_name in ("Edit", "Write", "MultiEdit"):
        fp = tool_input.get("file_path")
        return f"file:{fp}" if fp else None
    cmd = tool_input.get("command")
    if not cmd:
        return None
    lines = [l.strip() for l in str(cmd).splitlines()]
    meaningful = [l for l in lines if l and not l.startswith("cd ")]
    first = (meaningful or [l for l in lines if l] or [""])[0]
    return "cmd:" + " ".join(first.split())[:100]


def main():
    data = json.load(sys.stdin)
    key = norm_key(data.get("tool_name"), data.get("tool_input"))
    if not key:
        return

    session = data.get("session_id", "") or ""
    root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
    state_dir = root / ".claude" / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    path = state_dir / "failure_counts.json"

    state = {}
    if path.exists():
        try:
            state = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            state = {}
    if state.get("session_id") != session:
        state = {"session_id": session, "counts": {}, "nudged": []}

    counts = state.setdefault("counts", {})
    nudged = state.setdefault("nudged", [])
    counts[key] = counts.get(key, 0) + 1

    emit = counts[key] >= 2 and key not in nudged
    if emit:
        nudged.append(key)

    try:
        path.write_text(json.dumps(state) + "\n")
    except OSError:
        pass

    if emit:
        label = key.split(":", 1)[1] if ":" in key else key
        ctx = (f"Repeated failure on {label} -- consider running /distill to "
               f"capture the lesson now.")
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUseFailure",
                "additionalContext": ctx,
            }
        }))


try:
    main()
except Exception:
    pass
sys.exit(0)
