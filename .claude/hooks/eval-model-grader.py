#!/usr/bin/env python3
"""Model-based grader for agent evaluation.

Calls Claude Haiku as a judge to evaluate agent output quality.
Called by agent-specific eval scripts after code graders pass.

Usage:
    echo "$TRANSCRIPT" | python3 eval-model-grader.py \
        --db-path /path/to/workflows.db \
        --experiment-id "online-triage-fix" \
        --example-id "session-abc123" \
        --grader-id "triage_root_cause_quality" \
        --agent-output '{"root_cause": "...", "fix": "..."}' \
        --input '{"failure_description": "..."}'

The script:
1. Reads the judge prompt from eval_graders table
2. Fills in template variables from --agent-output and --input
3. Calls Haiku via the Anthropic API
4. Parses the response and logs to eval_results
5. Prints score to stdout for the calling script

API key resolution order:
1. ANTHROPIC_API_KEY environment variable
2. ~/.config/anthropic/api_key file
3. .env file in project root (ANTHROPIC_API_KEY=...)
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.request
import urllib.error
from pathlib import Path


def resolve_api_key() -> str | None:
    """Find API key from env var or standard file locations."""
    # 1. Environment variable
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key.strip()

    # 2. ~/.config/anthropic/api_key
    config_path = Path.home() / ".config" / "anthropic" / "api_key"
    if config_path.exists():
        key = config_path.read_text().strip()
        if key:
            return key

    # 3. .env in project root (walk up from script location)
    script_dir = Path(__file__).resolve().parent
    for parent in [script_dir, script_dir.parent, script_dir.parent.parent]:
        env_file = parent / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")

    return None


def get_grader_config(db_path: str, grader_id: str) -> dict:
    """Read grader config from eval_graders table."""
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT judge_model, judge_prompt, cost_estimate_usd FROM eval_graders WHERE id = ?",
        (grader_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise ValueError(f"Grader '{grader_id}' not found in eval_graders")
    return {
        "judge_model": row[0],
        "judge_prompt": row[1],
        "cost_estimate_usd": row[2] or 0.001,
    }


def fill_template(template: str, agent_output: dict, input_data: dict, reference_output: dict = None) -> str:
    """Replace {{variable.path}} placeholders in the judge prompt template."""
    def replacer(match):
        path = match.group(1)
        parts = path.split(".")
        if parts[0] == "agent_output":
            obj = agent_output
        elif parts[0] == "input":
            obj = input_data
        elif parts[0] == "reference_output":
            obj = reference_output or {}
        else:
            return match.group(0)

        for part in parts[1:]:
            if isinstance(obj, dict):
                obj = obj.get(part, f"<missing: {path}>")
            else:
                return f"<missing: {path}>"
        if isinstance(obj, (dict, list)):
            return json.dumps(obj)
        return str(obj)

    return re.sub(r'\{\{([^}]+)\}\}', replacer, template)


def call_haiku(prompt: str, model: str, api_key: str) -> dict:
    """Call Claude Haiku via the Anthropic API."""
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    body = json.dumps({
        "model": model,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            text = result["content"][0]["text"]
            # Extract JSON from response (may have surrounding text)
            json_match = re.search(r'\{[^{}]*\}', text)
            if json_match:
                return json.loads(json_match.group())
            return {"score": 0.5, "reasoning": text}
    except (urllib.error.URLError, json.JSONDecodeError, KeyError) as e:
        return {"score": None, "reasoning": f"API call failed: {e}", "error": True}


def log_result(db_path: str, experiment_id: str, example_id: str, grader_id: str,
               agent_output_str: str, score: float, passed: int, comment: str,
               judge_input: str, judge_response: str, cost_usd: float):
    """Insert grader result into eval_results table."""
    conn = sqlite3.connect(db_path)
    conn.execute(
        """INSERT INTO eval_results
           (experiment_id, example_id, grader_id, agent_output, score, passed, comment,
            judge_input, judge_response, cost_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (experiment_id, example_id, grader_id, agent_output_str,
         score, passed, comment, judge_input, judge_response, cost_usd)
    )
    conn.commit()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Model-based eval grader")
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--experiment-id", required=True)
    parser.add_argument("--example-id", required=True)
    parser.add_argument("--grader-id", required=True)
    parser.add_argument("--agent-output", required=True, help="JSON string of agent output")
    parser.add_argument("--input", required=True, dest="input_data", help="JSON string of input/scenario")
    parser.add_argument("--reference-output", default="{}", help="JSON string of expected output")
    parser.add_argument("--dry-run", action="store_true", help="Print prompt without calling API")
    args = parser.parse_args()

    api_key = resolve_api_key()
    if not api_key and not args.dry_run:
        print("0.0", file=sys.stdout)
        print("No API key found (checked env, ~/.config/anthropic/api_key, .env)", file=sys.stderr)
        return

    agent_output = json.loads(args.agent_output)
    input_data = json.loads(args.input_data)
    reference_output = json.loads(args.reference_output)

    config = get_grader_config(args.db_path, args.grader_id)
    if not config["judge_prompt"]:
        print("0.0", file=sys.stdout)
        print(f"No judge prompt for grader {args.grader_id}", file=sys.stderr)
        return

    prompt = fill_template(config["judge_prompt"], agent_output, input_data, reference_output)

    if args.dry_run:
        print(f"--- Judge Prompt for {args.grader_id} ---")
        print(prompt)
        print("--- End ---")
        return

    judge_response = call_haiku(prompt, config["judge_model"], api_key)

    score = judge_response.get("score")
    if score is None:
        score = 0.0
        passed = 0
        comment = f"Model grader error: {judge_response.get('reasoning', 'unknown')}"
    else:
        score = float(score)
        passed = 1 if score >= 0.5 else 0
        comment = judge_response.get("reasoning", "")

    log_result(
        db_path=args.db_path,
        experiment_id=args.experiment_id,
        example_id=args.example_id,
        grader_id=args.grader_id,
        agent_output_str=args.agent_output,
        score=score,
        passed=passed,
        comment=comment,
        judge_input=prompt,
        judge_response=json.dumps(judge_response),
        cost_usd=config["cost_estimate_usd"],
    )

    print(f"{score}", file=sys.stdout)


if __name__ == "__main__":
    main()
