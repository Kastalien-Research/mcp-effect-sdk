#!/usr/bin/env python3
"""Block writes to sensitive files: .env, .git/, lockfiles, .beads/, etc."""
import json, os, sys, pathlib, re

def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(2)

data = json.load(sys.stdin)
tool_input = data.get("tool_input") or {}
file_path = (tool_input.get("file_path") or "").strip()
if not file_path:
    sys.exit(0)

project = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())).resolve()
p = pathlib.Path(file_path)

target = (project / p).resolve() if not p.is_absolute() else p.resolve()

# Allow writes to the user's ~/.claude/ directory (agent memory, settings)
home_claude = pathlib.Path.home() / ".claude"
if home_claude.resolve() == target.resolve() or home_claude.resolve() in target.resolve().parents:
    sys.exit(0)

if project != target and project not in target.parents:
    die(f"Blocked: write outside project root: {file_path}")

rel = target.relative_to(project).as_posix()

protected = [
    r"^\.git(/|$)",
    r"^\.env(\.|$)",
    r"^\.envrc$",
    r"^\.ssh(/|$)",
    r"^\.aws(/|$)",
    r"^.*\.(pem|key|p12)$",
    r"^node_modules(/|$)",
    r"^\.venv(/|$)",
    r"^dist(/|$)",
    r"^build(/|$)",
    r"^\.beads(/|$)",
    r"^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock)$",
]

for pat in protected:
    if re.search(pat, rel):
        die(
            f"Blocked: {rel} is protected (pattern: {pat}). "
            f"Use the approved workflow/tooling instead of direct edits."
        )

sys.exit(0)
