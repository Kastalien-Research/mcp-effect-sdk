#!/usr/bin/env python3
"""Code graders for the cartographer agent."""

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
    experiment_id = "online-cartographer"

    # Grader 1: cart_boundary_definition
    # Check that boundaries section has in/out/edge
    boundary_parts = 0
    for part in ["in scope", "out of scope", "edge"]:
        if re.search(re.escape(part), transcript, re.I):
            boundary_parts += 1

    if boundary_parts == 0 and re.search(r"boundar", transcript, re.I):
        boundary_parts = 1

    bound_score = boundary_parts / 3
    if boundary_parts >= 2:
        bound_passed = 1
        passed += 1
    else:
        bound_passed = 0
        failed += 1
        comments += f"Boundary definition incomplete ({boundary_parts}/3 parts). "

    log_result(db_path, experiment_id, agent_id, "cart_boundary_definition",
               bound_score, bound_passed, f"Boundary parts: {boundary_parts}/3")

    # Grader 2: cart_interface_identification
    # Check for interface/dependency discussion
    interface_signals = 0
    for signal in ["interface", "depend", "propagat", "coupling", "connect", "touch", "surface"]:
        if re.search(re.escape(signal), transcript, re.I):
            interface_signals += 1

    if interface_signals >= 2:
        iface_passed = 1
        iface_score = 1.0
        passed += 1
    else:
        iface_passed = 0
        iface_score = interface_signals / 2 if interface_signals > 0 else 0.0
        failed += 1
        comments += f"Interface identification weak ({interface_signals} signals). "

    log_result(db_path, experiment_id, agent_id, "cart_interface_identification",
               iface_score, iface_passed, f"Interface signals: {interface_signals}")

    # Grader 3: cart_scout_integration
    # Check if Scout signals are referenced (soft grader — don't fail if Scout wasn't invoked)
    if re.search(r"(scout|signal.*incorporat|signal.*integrat)", transcript, re.I):
        scout_passed = 1
        scout_score = 1.0
    else:
        scout_passed = 1
        scout_score = 0.5
        comments += "No Scout signal integration detected (may not be applicable). "
    passed += 1

    log_result(db_path, experiment_id, agent_id, "cart_scout_integration",
               scout_score, scout_passed, "Scout integration check")

    # Grader 4: cart_output_format
    # Check for key output sections
    sections = 0
    for section in ["Scope Map", "Boundaries", "Interfaces", "Dependencies", "Risk"]:
        if re.search(re.escape(section), transcript, re.I):
            sections += 1

    format_score = sections / 5
    format_passed = 1 if sections >= 3 else 0
    if format_passed:
        passed += 1
    else:
        failed += 1

    log_result(db_path, experiment_id, agent_id, "cart_output_format",
               format_score, format_passed, f"Output sections: {sections}/5")

    # Model graders
    if passed > 0:
        agent_output = extract_sections(transcript, ["Boundaries", "Interfaces", "Dependencies", "Risk"])
        input_data = {"area": "online session", "context": ""}
        for grader in ["cart_scope_clarity", "cart_dependency_completeness"]:
            run_model_grader(db_path, experiment_id, agent_id, grader, agent_output, input_data)

    # Summary
    total = passed + failed
    pass_rate = passed / total if total > 0 else 1.0
    output_context(failed, pass_rate, total, comments, "cartographer")

if __name__ == "__main__":
    main()
