#!/usr/bin/env python3
"""Code graders for the triage-fix agent."""

import sys
import re
from eval_utils import log_result, extract_sections, run_model_grader, output_context

def main():
    if len(sys.argv) < 4:
        sys.exit(1)

    db_path = sys.argv[1]
    agent_type = sys.argv[2]
    agent_id = sys.argv[3]
    transcript = sys.stdin.read()

    passed = 0
    failed = 0
    comments = ""
    experiment_id = "online-triage-fix"

    # Grader 1: triage_format_compliance
    required = ["Root cause", "Classification", "Fix applied", "Before evidence", "After evidence", "Regression check"]
    found = 0
    for section in required:
        if re.search(re.escape(section), transcript, re.I):
            found += 1
    
    format_score = found / len(required)
    if found == len(required):
        format_passed = 1
        passed += 1
    else:
        format_passed = 0
        failed += 1
        comments += f"Missing sections: {len(required) - found} of {len(required)}. "

    log_result(db_path, experiment_id, agent_id, "triage_format_compliance",
               format_score, format_passed, f"Found {found}/{len(required)} required sections")

    # Grader 2: triage_scope_compliance
    file_edits = len(re.findall(r'"tool_name".*"Edit|Write"', transcript, re.I))
    if file_edits > 10:
        scope_passed = 0
        scope_score = 0.5
        failed += 1
        comments += f"High file edit count ({file_edits}), possible scope creep. "
    else:
        scope_passed = 1
        scope_score = 1.0
        passed += 1
    
    log_result(db_path, experiment_id, agent_id, "triage_scope_compliance",
               scope_score, scope_passed, f"{file_edits} file edits detected")

    # Grader 3: triage_escalation_check
    if re.search(r"external dependency|external dep", transcript, re.I):
        if re.search(r"escalat", transcript, re.I):
            esc_passed = 1
            esc_score = 1.0
            passed += 1
        else:
            esc_passed = 0
            esc_score = 0.0
            failed += 1
            comments += "External dependency mentioned but no escalation detected. "
        
        log_result(db_path, experiment_id, agent_id, "triage_escalation_judgment",
                   esc_score, esc_passed, "External dependency scenario")

    # Model graders
    if passed > 0:
        agent_output = extract_sections(transcript, ["Root cause", "Classification", "Fix applied"])
        input_data = {"failure_description": "online session"}
        for grader in ["triage_root_cause_quality", "triage_escalation_judgment_llm"]:
            run_model_grader(db_path, experiment_id, agent_id, grader, agent_output, input_data)

    # Summary
    total = passed + failed
    pass_rate = passed / total if total > 0 else 1.0
    output_context(failed, pass_rate, total, comments, "triage-fix")

if __name__ == "__main__":
    main()
