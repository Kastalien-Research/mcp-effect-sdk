#!/usr/bin/env python3
"""Shared utilities for agent evaluation hooks."""

import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

def get_timestamp() -> str:
    """Return current UTC timestamp in ISO format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def read_transcript_tail(path: str, max_bytes: int = 50000) -> str:
    """Read the last N bytes of a transcript file."""
    if not path or not os.path.exists(path):
        return ""
    try:
        with open(path, 'rb') as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            return f.read().decode('utf-8', errors='ignore')
    except Exception:
        return ""

def log_result(db_path: str, experiment_id: str, example_id: str, grader_id: str, 
               score: float, passed: int, comment: str, agent_output: str = "",
               judge_input: Optional[str] = None, judge_response: Optional[str] = None,
               cost_usd: Optional[float] = None):
    """Insert evaluation result into eval_results table."""
    if not os.path.exists(db_path):
        return

    try:
        conn = sqlite3.connect(db_path)
        timestamp = get_timestamp()
        
        # Check if columns exist (experimental, based on existing Bash logic)
        columns = [row[1] for row in conn.execute(f"PRAGMA table_info(eval_results)").fetchall()]
        
        query_cols = ["experiment_id", "example_id", "grader_id", "score", "passed", "comment", "created_at"]
        params = [experiment_id, example_id, grader_id, score, passed, comment, timestamp]
        
        if "agent_output" in columns:
            query_cols.append("agent_output")
            params.append(agent_output)
        if "judge_input" in columns:
            query_cols.append("judge_input")
            params.append(judge_input)
        if "judge_response" in columns:
            query_cols.append("judge_response")
            params.append(judge_response)
        if "cost_usd" in columns:
            query_cols.append("cost_usd")
            params.append(cost_usd)

        placeholders = ", ".join(["?"] * len(params))
        query = f"INSERT INTO eval_results ({', '.join(query_cols)}) VALUES ({placeholders})"
        
        conn.execute(query, params)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error logging result to DB: {e}", file=sys.stderr)

def extract_sections(text: str, labels: List[str], max_len: int = 500) -> Dict[str, str]:
    """Extract sections from text based on labels (e.g., 'Root cause:')."""
    output = {}
    for label in labels:
        # Match label followed by colon/whitespace until next label or end
        pattern = rf'{re.escape(label)}[:\s]+(.*?)(?=\n[A-Z]|\n#|\Z)'
        match = re.search(pattern, text, re.I | re.S)
        if match:
            output[label.lower().replace(' ', '_')] = match.group(1).strip()[:max_len]
    return output

def run_model_grader(db_path: str, experiment_id: str, example_id: str, grader_id: str,
                     agent_output: Dict[str, Any], input_data: Dict[str, Any]):
    """Run the model grader script in the background."""
    hook_dir = Path(__file__).parent
    model_grader = hook_dir / "eval-model-grader.py"
    
    if not model_grader.exists():
        return

    cmd = [
        sys.executable, str(model_grader),
        "--db-path", db_path,
        "--experiment-id", experiment_id,
        "--example-id", example_id,
        "--grader-id", grader_id,
        "--agent-output", json.dumps(agent_output),
        "--input", json.dumps(input_data)
    ]
    
    # Run in background
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f"Error starting model grader: {e}", file=sys.stderr)

def output_context(failed: int, pass_rate: float, total: int, comments: str, agent_type: str):
    """Output JSON for SubagentStop hook if FAILURES occurred."""
    if failed > 0:
        ctx = f"Eval: {agent_type} scored {pass_rate:.2f} ({total-failed}/{total} graders passed). {comments}"
        result = {
            "hookSpecificOutput": {
                "hookEventName": "SubagentStop",
                "additionalContext": ctx
            }
        }
        print(json.dumps(result))
