#!/usr/bin/env python3
"""Canary monitor — PostToolUse hook that tracks edit velocity, scope breadth,
and computes a pressure score. Writes signals to canary_signals.json.

Session detection: uses CLAUDE_SESSION_ID env var (set by Claude Code) to detect
new conversations. When the session ID changes, counters reset. Falls back to a
2-hour staleness timeout if the env var isn't available."""
import json, os, pathlib, sys, time

data = json.load(sys.stdin)
tool_name = data.get("tool_name", "")

root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
state_dir = root / ".claude" / "state"
state_dir.mkdir(parents=True, exist_ok=True)
signals_path = state_dir / "canary_signals.json"

# Load existing signals or initialize
if signals_path.exists():
    try:
        signals = json.loads(signals_path.read_text())
    except (json.JSONDecodeError, OSError):
        signals = {}
else:
    signals = {}

# --- Session boundary detection ---
# Primary: session_id from hook input JSON changes between conversations
# Fallback: if last_updated is >2 hours stale, treat as new session
current_session = data.get("session_id", "")
stored_session = signals.get("session_id", "")
last_updated = signals.get("last_updated", 0)
stale = (time.time() - last_updated) > 7200 if last_updated else True

needs_reset = (
    "session_start" not in signals
    or (current_session and current_session != stored_session)
    or stale
)

if needs_reset:
    # Preserve previous session as history (one level deep)
    if signals.get("session_start"):
        signals["previous_session"] = {
            "session_id": stored_session,
            "edit_count": signals.get("edit_count", 0),
            "file_count": len(signals.get("files_touched", [])),
            "turn_count": signals.get("turn_count", 0),
            "final_pressure": signals.get("pressure", 0.0),
            "started": signals.get("session_start"),
            "ended": last_updated,
        }
    signals["session_start"] = time.time()
    signals["session_id"] = current_session
    signals["edit_count"] = 0
    signals["files_touched"] = []
    signals["turn_count"] = 0
    signals["pressure"] = 0.0
    signals["warnings"] = []
    signals["components"] = {}

# Track edits
if tool_name in ("Edit", "Write"):
    signals["edit_count"] = signals.get("edit_count", 0) + 1
    # Track file from tool input if available
    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    if file_path:
        touched = signals.get("files_touched", [])
        if file_path not in touched:
            touched.append(file_path)
            signals["files_touched"] = touched

# Track turns (every tool call counts)
signals["turn_count"] = signals.get("turn_count", 0) + 1

# Compute pressure score (0.0 - 1.0)
elapsed = time.time() - signals.get("session_start", time.time())
edit_count = signals.get("edit_count", 0)
file_count = len(signals.get("files_touched", []))
turn_count = signals.get("turn_count", 0)

# Pressure components (each 0.0 - 1.0, weighted average)
# Thresholds calibrated for real work sessions:
#   - 100 edits (was 30): a productive session can easily hit 30 edits
#   - 40 files (was 15): multi-file refactors touch many files
#   - 200 turns (was 50): 50 is just getting started
#   - 90 minutes (was 45): complex tasks need more than 45 min
edit_pressure = min(edit_count / 100.0, 1.0)
scope_pressure = min(file_count / 40.0, 1.0)
turn_pressure = min(turn_count / 200.0, 1.0)
time_pressure = min(elapsed / 5400.0, 1.0) if elapsed > 0 else 0.0

pressure = (edit_pressure * 0.3 + scope_pressure * 0.3 +
            turn_pressure * 0.2 + time_pressure * 0.2)

signals["pressure"] = round(pressure, 3)
signals["last_updated"] = time.time()
signals["components"] = {
    "edit_velocity": round(edit_pressure, 3),
    "scope_breadth": round(scope_pressure, 3),
    "turn_count": round(turn_pressure, 3),
    "elapsed_time": round(time_pressure, 3)
}

# Add warning if pressure threshold crossed (deduplicated per level)
warnings = signals.get("warnings", [])
if pressure > 0.7 and not any(w.get("level") == "high" for w in warnings):
    warnings.append({
        "level": "high",
        "message": f"Canary: pressure at {pressure:.0%} — consider converging or closing",
        "at_turn": turn_count,
        "timestamp": time.time()
    })
elif pressure > 0.5 and not any(w.get("level") == "medium" for w in warnings):
    warnings.append({
        "level": "medium",
        "message": f"Canary: pressure at {pressure:.0%} — monitor scope breadth",
        "at_turn": turn_count,
        "timestamp": time.time()
    })
signals["warnings"] = warnings

# Write signals
signals_path.write_text(json.dumps(signals, indent=2) + "\n")

# If pressure > 0.7, inject warning into context
if pressure > 0.7:
    ctx = (f"Canary warning: System pressure at {pressure:.0%}. "
           f"Edits: {edit_count}, Files: {file_count}, Turns: {turn_count}. "
           f"Consider converging or closing current scope.")
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": ctx
        }
    }))

sys.exit(0)
