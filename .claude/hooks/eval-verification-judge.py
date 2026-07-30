#!/usr/bin/env python3
"""Code graders for the verification-judge agent."""

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
    experiment_id = "online-verification-judge"

    # Grader 1: judge_format_compliance
    has_pass1 = 1 if re.search(r"Pass 1|Deterministic", transcript, re.I) else 0
    has_pass2 = 1 if re.search(r"Pass 2|Spec Compliance", transcript, re.I) else 0
    has_pass3 = 1 if re.search(r"Pass 3|Perspective", transcript, re.I) else 0
    has_verdict = 1 if re.search(r"Verdict.*VERIFIED|Verdict.*REJECTED|Verdict.*ESCALATE", transcript, re.I) else 0
    
    sections_found = has_pass1 + has_pass2 + has_pass3 + has_verdict
    format_score = sections_found / 4
    if sections_found == 4:
        format_passed = 1
        passed += 1
    else:
        format_passed = 0
        failed += 1
    
    log_result(db_path, experiment_id, agent_id, "judge_format_compliance",
               format_score, format_passed, f"Found {sections_found}/4 required sections (Pass1/Pass2/Pass3/Verdict)")

    # Grader 2: judge_deterministic_first
    if has_pass1 and has_pass2 and has_pass3:
        pass1_pos = re.search(r"Pass 1|Deterministic Check", transcript, re.I).start()
        pass2_pos = re.search(r"Pass 2|Spec Compliance", transcript, re.I).start()
        pass3_pos = re.search(r"Pass 3|Perspective Review", transcript, re.I).start()
        
        if pass1_pos < pass2_pos < pass3_pos:
            order_passed = 1
            order_score = 1.0
            passed += 1
        else:
            order_passed = 0
            order_score = 0.0
            failed += 1
            comments += "Pass ordering violated. "
        
        log_result(db_path, experiment_id, agent_id, "judge_deterministic_first",
                   order_score, order_passed, f"Pass order check")

    # Model graders
    if passed > 0:
        # Complex extraction for verification-judge
        agent_output = {}
        verdict_match = re.search(r'Verdict[:\s]+(VERIFIED|REJECTED|ESCALATE)', transcript, re.I)
        if verdict_match:
            agent_output['verdict'] = verdict_match.group(1).upper()
        
        for label in ['Blocking', 'Advisory']:
            m = re.search(rf'{label}[:\s]+(.*?)(?=\nAdvisory|\n#|\Z)', transcript, re.I | re.S)
            if m:
                agent_output[label.lower() + '_issues'] = m.group(1).strip()[:500]
        
        perspectives = {}
        for p in ['Logician', 'Architect', 'Security', 'Implementer']:
            m = re.search(rf'{p}[:\s]+(.*?)(?=\n[A-Z]|\n#|\Z)', transcript, re.I | re.S)
            if m:
                perspectives[p.lower()] = m.group(1).strip()[:300]
        if perspectives:
            agent_output['pass3_perspectives'] = perspectives

        input_data = {"artifact": "online session", "spec_requirements": []}
        for grader in ["judge_rejection_quality", "judge_perspective_coverage"]:
            run_model_grader(db_path, experiment_id, agent_id, grader, agent_output, input_data)

    # Summary
    total = passed + failed
    pass_rate = passed / total if total > 0 else 1.0
    output_context(failed, pass_rate, total, comments, "verification-judge")

if __name__ == "__main__":
    main()
