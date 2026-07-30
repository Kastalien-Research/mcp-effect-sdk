#!/usr/bin/env python3
"""Set a dirty flag when Claude edits code. Used by the stop quality gate."""
import json, os, pathlib, sys

_ = json.load(sys.stdin)

root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
state_dir = root / ".claude" / "state"
state_dir.mkdir(parents=True, exist_ok=True)
(state_dir / "dirty.flag").write_text("dirty\n")
sys.exit(0)
