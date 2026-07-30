#!/usr/bin/env python3
"""Code graders for the dependency-verifier agent."""

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
    experiment_id = "online-dependency-verifier"

    # Grader 1: verifier_format_compliance
    required = ["Assumption", "Criticality", "Source", "Test", "Result", "Confidence", "Evidence", "Impact"]
    found = 0
    for section in required:
        if re.search(rf"{re.escape(section)}:", transcript, re.I):
            found += 1
    
    format_score = found / len(required)
    format_passed = 1 if found >= 6 else 0
    if format_passed:
        passed += 1
    else:
        failed += 1

    log_result(db_path, experiment_id, agent_id, "verifier_format_compliance",
               format_score, format_passed, f"Found {found}/{len(required)} template sections")

    # Grader 2: verifier_sources_cited
    urls = re.findall(r'https?://[^\s]+', transcript)
    url_count = len(urls)
    if url_count > 0:
        sources_passed = 1
        sources_score = 1.0
        passed += 1
    else:
        sources_passed = 0
        sources_score = 0.0
        failed += 1
        comments += "No source URLs found in verification output. "
    
    log_result(db_path, experiment_id, agent_id, "verifier_sources_cited",
               sources_score, sources_passed, f"{url_count} URLs found")

    # Grader 3: verifier_escalation_fields
    if re.search(r"Result.*FAILED", transcript, re.I) and re.search(r"Criticality.*HIGH", transcript, re.I):
        has_options = len(re.findall(r"option|alternative|workaround", transcript, re.I))
        if has_options >= 2:
            esc_passed = 1
            esc_score = 1.0
            passed += 1
        else:
            esc_passed = 0
            esc_score = 0.0
            failed += 1
            comments += "HIGH criticality FAILED result without 2+ options for escalation. "
        
        log_result(db_path, experiment_id, agent_id, "verifier_escalation_fields",
                   esc_score, esc_passed, "Escalation check for HIGH/FAILED")

    # Model graders
    if passed > 0:
        agent_output = extract_sections(transcript, ["Result", "Confidence", "Evidence", "test_method"])
        input_data = {"claim": "online session"}
        for grader in ["verifier_evidence_quality", "verifier_test_rigor"]:
            run_model_grader(db_path, experiment_id, agent_id, grader, agent_output, input_data)

    # Summary
    total = passed + failed
    pass_rate = passed / total if total > 0 else 1.0
    output_context(failed, pass_rate, total, comments, "dependency-verifier")

if __name__ == "__main__":
    main()
