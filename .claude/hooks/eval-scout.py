#!/usr/bin/env python3
"""Code graders for the scout agent."""

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
    experiment_id = "online-scout"

    # Grader 1: scout_signal_structure
    # Check that signals have required fields (domain, claim, confidence, source)
    signal_fields = 0
    for field in ["domain", "claim", "confidence", "source"]:
        if re.search(re.escape(field), transcript, re.I):
            signal_fields += 1

    signal_score = signal_fields / 4
    if signal_fields >= 3:
        signal_passed = 1
        passed += 1
    else:
        signal_passed = 0
        failed += 1
        comments += f"Signal structure incomplete ({signal_fields}/4 fields found). "

    log_result(db_path, experiment_id, agent_id, "scout_signal_structure",
               signal_score, signal_passed, f"Signal fields: {signal_fields}/4")

    # Grader 2: scout_cross_domain
    # Check that cross-domain connections are reported
    cross_pattern = r"(cross.domain|cross.pollination|analogy|analogies|adjacent|resonance|other field|different domain)"
    if re.search(cross_pattern, transcript, re.I):
        cross_passed = 1
        cross_score = 1.0
        passed += 1
    else:
        cross_passed = 0
        cross_score = 0.0
        failed += 1
        comments += "No cross-domain connections found. "

    log_result(db_path, experiment_id, agent_id, "scout_cross_domain",
               cross_score, cross_passed, "Cross-domain check")

    # Grader 3: scout_phase_compliance
    # Check that the scout read the current phase
    phase_pattern = r"(system_phase|phase.*exploration|phase.*convergence|phase.*execution|phase.*completion)"
    if re.search(phase_pattern, transcript, re.I):
        phase_passed = 1
        phase_score = 1.0
        passed += 1
    else:
        phase_passed = 0
        phase_score = 0.0
        failed += 1
        comments += "No evidence of phase awareness. "

    log_result(db_path, experiment_id, agent_id, "scout_phase_compliance",
               phase_score, phase_passed, "Phase awareness check")

    # Grader 4: scout_output_format
    # Check for key output sections
    sections = 0
    for section in ["Scout Report", "Signals", "Recommended", "Hunch"]:
        if re.search(re.escape(section), transcript, re.I):
            sections += 1

    format_score = sections / 4
    format_passed = 1 if sections >= 3 else 0
    if format_passed:
        passed += 1
    else:
        failed += 1

    log_result(db_path, experiment_id, agent_id, "scout_output_format",
               format_score, format_passed, f"Output sections: {sections}/4")

    # Model graders
    if passed > 0:
        agent_output = extract_sections(transcript, ["Signals", "Cross-Domain", "Recommended", "Hunch"])
        input_data = {"topic": "online session", "context": ""}
        for grader in ["scout_signal_quality", "scout_coverage_breadth"]:
            run_model_grader(db_path, experiment_id, agent_id, grader, agent_output, input_data)

    # Summary
    total = passed + failed
    pass_rate = passed / total if total > 0 else 1.0
    output_context(failed, pass_rate, total, comments, "scout")

if __name__ == "__main__":
    main()
