#!/usr/bin/env python3
"""Auto-inject Beads issue context when issue IDs appear in the user prompt."""
import json, re, subprocess, sys, shutil

data = json.load(sys.stdin)
prompt = (data.get("prompt") or "").strip()

# Match beads issue IDs like agentic-dev-team-3qh
ids = re.findall(r"\b[a-z][\w-]+-[a-z0-9]{2,6}\b", prompt, flags=re.IGNORECASE)
# Filter to likely beads IDs (contain at least one hyphen and end with short alphanum)
ids = [i for i in ids if re.match(r"^[a-z][\w-]+-[a-z0-9]{2,6}$", i, re.IGNORECASE)]

if not ids:
    sys.exit(0)

if not shutil.which("bd"):
    sys.exit(0)

def sh(cmd: list[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    out = (p.stdout or "") + (p.stderr or "")
    return out.strip()

chunks = ["### Beads context (auto-injected)"]
for issue_id in ids[:3]:
    chunks.append(f"\n#### {issue_id}\n")
    result = sh(["bd", "show", issue_id])
    if result:
        chunks.append(result)

print("\n".join(chunks))
sys.exit(0)
