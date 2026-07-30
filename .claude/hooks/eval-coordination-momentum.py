#!/usr/bin/env python3
"""Code graders for the coordination-momentum agent."""

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
    experiment_id = "online-coordination-momentum"

    # Grader 1: coord_sections_present
    required = ["Active", "Blocked", "Available", "Conflict", "Spiral", "Recommend"]
    found = 0
    for section in required:
        if re.search(re.escape(section), transcript, re.I):
            found += 1
    
    format_score = found / len(required)
    format_passed = 1 if found >= 5 else 0
    if format_passed:
        passed += 1
    else:
        failed += 1

    log_result(db_path, experiment_id, agent_id, "coord_sections_present", 
               format_score, format_passed, f"Found {found}/{len(required)} required sections")

    # Grader 2: coord_no_reprioritization
    if re.search(r"change.*priorit|reprioritiz|raise.*priority|lower.*priority", transcript, re.I):
        repri_passed = 0
        repri_score = 0.0
        failed += 1
        comments += "Possible re-prioritization detected in recommendations. "
    else:
        repri_passed = 1
        repri_score = 1.0
        passed += 1
    
    log_result(db_path, experiment_id, agent_id, "coord_no_reprioritization",
               repri_score, repri_passed, "Re-prioritization check")

    # Model graders
    if passed > 0:
        agent_output = extract_sections(transcript, ["Recommend", "Active", "Blocked", "Available"])
        input_data = {"bd_list_output": "online session", "bd_blocked_output": "", "bd_stats_output": "", "git_log": ""}
        run_model_grader(db_path, experiment_id, agent_id, "coord_recommendation_relevance", agent_output, input_data)

    # Summary
    total = passed + failed
    pass_rate = passed / total if total > 0 else 1.0
    output_context(failed, pass_rate, total, comments, "coordination-momentum")

if __name__ == "__main__":
    main()
