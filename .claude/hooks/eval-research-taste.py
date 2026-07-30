#!/usr/bin/env python3
"""Code graders for the research-taste agent."""

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
    experiment_id = "online-research-taste"

    # Grader 1: taste_verdict_valid
    if re.search(r"Verdict.*(proceed|simplify|defer|kill)", transcript, re.I):
        verdict_passed = 1
        verdict_score = 1.0
        passed += 1
    else:
        verdict_passed = 0
        verdict_score = 0.0
        failed += 1
        comments += "No valid verdict found (expected proceed/simplify/defer/kill). "
    
    log_result(db_path, experiment_id, agent_id, "taste_verdict_valid",
               verdict_score, verdict_passed, "Verdict enum check")

    # Grader 2: taste_format_compliance
    required = ["Verdict", "rationale", "Compression"]
    found = 0
    for section in required:
        if re.search(re.escape(section), transcript, re.I):
            found += 1
    
    format_score = found / len(required)
    format_passed = 1 if found == len(required) else 0
    if format_passed:
        passed += 1
    else:
        failed += 1

    log_result(db_path, experiment_id, agent_id, "taste_format_compliance",
               format_score, format_passed, f"Found {found}/{len(required)} required sections")

    # Grader 3: taste_compression_quality
    comp_match = re.search(r"Compression:\s*(.*)", transcript, re.I)
    if comp_match:
        compression = comp_match.group(1).strip()
        comp_length = len(compression)
        if 10 < comp_length <= 200:
            comp_passed = 1
            comp_score = 1.0
            passed += 1
        else:
            comp_passed = 0
            comp_score = 0.5
            failed += 1
            comments += f"Compression length {comp_length} chars (target: 10-200). "
        
        log_result(db_path, experiment_id, agent_id, "taste_compression_quality",
                   comp_score, comp_passed, f"Compression length: {comp_length} chars")

    # Model graders
    if passed > 0:
        agent_output = extract_sections(transcript, ["Verdict", "rationale", "Compression", "landscape"])
        input_data = {"proposal": "online session", "context": ""}
        for grader in ["taste_reasoning_quality", "taste_landscape_completeness"]:
            run_model_grader(db_path, experiment_id, agent_id, grader, agent_output, input_data)

    # Summary
    total = passed + failed
    pass_rate = passed / total if total > 0 else 1.0
    output_context(failed, pass_rate, total, comments, "research-taste")

if __name__ == "__main__":
    main()
