#!/usr/bin/env python3
"""Save a memory capsule before compaction for re-injection after."""
import json, os, pathlib, subprocess, shutil, sys, time

_ = json.load(sys.stdin)
root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
state = root / ".claude" / "state"
state.mkdir(parents=True, exist_ok=True)

def sh(cmd: list[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    out = (p.stdout or "") + (p.stderr or "")
    return out.strip()

lines = []
lines.append(f"# Compaction snapshot ({time.strftime('%Y-%m-%d %H:%M:%S')})")
lines.append("")
lines.append("## Git status")
lines.append("```")
lines.append(sh(["git", "status", "--porcelain=v1"]))
lines.append("```")
lines.append("")
lines.append("## Recent commits")
lines.append("```")
lines.append(sh(["git", "log", "--oneline", "-10"]))
lines.append("```")

if shutil.which("bd"):
    lines.append("")
    lines.append("## Beads: in-progress work")
    lines.append("```")
    lines.append(sh(["bd", "list", "--status=in_progress"]))
    lines.append("```")
    lines.append("")
    lines.append("## Beads: ready work")
    lines.append("```")
    lines.append(sh(["bd", "ready"]))
    lines.append("```")

(state / "compaction_snapshot.md").write_text("\n".join(lines))
sys.exit(0)
