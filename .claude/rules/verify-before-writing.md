## Verify Before Writing

When writing technical specifics — package names, CLI flags, API signatures, configuration formats, endpoint URLs — **verify against reality before writing them into code or config.**

Claude frequently hallucinates plausible-sounding but nonexistent:
- Package names (`@langchain/langsmith-mcp-server` — never existed)
- CLI flags and arguments
- API endpoints and parameters
- Configuration file schemas
- Import paths and module names

### The Rule

Before writing any of these into a file, verify at least one of:
1. **Run it** — `which`, `--help`, `--version`, `npm info`, `pip show`
2. **Read the source** — GitHub README, official docs, actual package registry
3. **Test it** — a quick invocation that proves it works

"I'm pretty sure it's X" is not verification. If you can't verify, say so and help the user find the answer — don't guess.

### Why This Matters

A hallucinated package name that gets written to config creates a failure that:
- Is silent until someone tries to use it
- Looks like an environment issue, not a data issue
- Takes multiple round trips to diagnose because the error points away from the root cause

### Applies To

All agents. All file writes involving external dependencies, tools, or APIs.
