#!/usr/bin/env python3
"""Append-only evidence log for tool events. Feeds the session-start failure
digest (13) and post-hoc audit.

Hygiene: never stores full file bodies — for Edit/Write it records path + byte
count + content hash instead. Rotates when the log grows past ~2 MB, keeping one
generation as tool-events.jsonl.1. Must never break a session: all work runs
under a top-level guard and the hook always exits 0."""
import hashlib, json, os, pathlib, sys, time

MAX_BYTES = 2 * 1024 * 1024
ERR_MAX = 300


def sanitize_input(tool_name, tool_input):
    """Drop full file bodies from Edit/Write; keep path + size + hash."""
    if not isinstance(tool_input, dict):
        return tool_input
    if tool_name in ("Edit", "Write", "MultiEdit"):
        out = {"file_path": tool_input.get("file_path")}
        payload = tool_input.get("content")
        if payload is None:
            payload = tool_input.get("new_string")
        if isinstance(payload, str):
            b = payload.encode("utf-8", "replace")
            out["content_bytes"] = len(b)
            out["content_sha256"] = hashlib.sha256(b).hexdigest()
        return out
    return tool_input


def extract_error(data):
    """Pull a one-liner error out of whatever field the harness provides on a
    failure event. The exact field is undocumented, so probe candidates."""
    for key in ("tool_error", "error", "tool_response", "tool_output", "stderr"):
        v = data.get(key)
        if v is None:
            continue
        if isinstance(v, dict):
            for sub in ("stderr", "error", "message", "stdout", "content"):
                s = v.get(sub)
                if isinstance(s, str) and s.strip():
                    return s.strip()[:ERR_MAX]
            continue
        if isinstance(v, str) and v.strip():
            return v.strip()[:ERR_MAX]
    return None


def main():
    data = json.load(sys.stdin)

    root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
    evidence = root / ".claude" / "evidence"
    evidence.mkdir(parents=True, exist_ok=True)
    log = evidence / "tool-events.jsonl"

    # Rotate before appending so the fresh event lands in a new file and the
    # previous generation (with the last session's failures) survives as .1.
    try:
        if log.exists() and log.stat().st_size >= MAX_BYTES:
            log.replace(log.with_name(log.name + ".1"))
    except OSError:
        pass

    tool_name = data.get("tool_name")
    event = {
        "ts": int(time.time()),
        "hook_event_name": data.get("hook_event_name"),
        "tool_name": tool_name,
        "tool_input": sanitize_input(tool_name, data.get("tool_input")),
        "session_id": data.get("session_id"),
    }
    if "failure" in str(data.get("hook_event_name") or "").lower():
        err = extract_error(data)
        if err:
            event["error"] = err

    with log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


try:
    main()
except Exception:
    pass
sys.exit(0)
