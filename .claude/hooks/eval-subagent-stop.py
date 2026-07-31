#!/usr/bin/env python3
"""Post-session evaluation hook for all agents (Python version)."""

import json
import os
import subprocess
import sys
from pathlib import Path

def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)

    agent_type = input_data.get("agent_type")
    agent_id = input_data.get("agent_id")
    transcript_path = input_data.get("agent_transcript_path")
    cwd = input_data.get("cwd")

    # Only evaluate our custom agents
    valid_agents = ["triage-fix", "research-taste", "dependency-verifier", "coordination-momentum", "verification-judge", "scout", "cartographer"]
    if agent_type not in valid_agents:
        sys.exit(0)

    if not cwd:
        sys.exit(0)

    db_path = os.path.join(cwd, "research-workflows", "workflows.db")
    if not os.path.exists(db_path):
        sys.exit(0)

    if not transcript_path or not os.path.exists(transcript_path):
        sys.exit(0)

    # Dispatch to agent-specific Python script
    hook_dir = Path(__file__).parent
    eval_script = hook_dir / f"eval-{agent_type}.py"

    if eval_script.exists():
        # Read transcript tail (50k bytes) and pipe to script
        try:
            with open(transcript_path, 'rb') as f:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                f.seek(max(0, size - 50000))
                transcript_tail = f.read()
            
            subprocess.run(
                [sys.executable, str(eval_script), db_path, agent_type, agent_id],
                input=transcript_tail,
                check=False
            )
        except Exception as e:
            print(f"Error executing {eval_script}: {e}", file=sys.stderr)
    else:
        # Fallback logging logic (moved from Bash)
        import sqlite3
        from datetime import datetime, timezone
        try:
            conn = sqlite3.connect(db_path)
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            conn.execute(
                "INSERT OR IGNORE INTO eval_results (experiment_id, example_id, grader_id, agent_output, score, passed, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (f"online-{agent_type}", agent_id, f"{agent_type}_session_completed", "", 1.0, 1, f"Session completed at {timestamp}", timestamp)
            )
            conn.commit()
            conn.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()
