---
name: map
description:
  Dispatch the Cartographer agent to map scope, interfaces, dependencies, and
  boundaries of a problem area or codebase region.
argument-hint: [area or domain to map]
user-invocable: true
---

Dispatch the Cartographer agent to map: $ARGUMENTS

Use the Task tool with `subagent_type: "cartographer"` (the custom
`.claude/agents/cartographer.md` agent) to produce a scope map. Pass the full
arguments as context.

If Scout signals are available from a recent `/scout` invocation, include them
in the prompt so the Cartographer can integrate them.

After the Cartographer returns, present the Scope Map to the user with:

1. Boundaries (in/out/edge)
2. Interfaces and dependency graph
3. Risk zones
4. Recommended actions and decisions needed
