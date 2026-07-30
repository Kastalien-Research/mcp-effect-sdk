---
name: scout
description:
  Dispatch the Scout agent to explore a topic, technology, or problem space.
  Returns structured signals from unmapped territory.
argument-hint: [topic or question to explore]
user-invocable: true
---

Dispatch the Scout agent to explore: $ARGUMENTS

Use the Task tool with `subagent_type: "scout"` (the custom
`.claude/agents/scout.md` agent) to investigate this topic. Pass the full
arguments as context.

After the Scout returns, present the Scout Report to the user with:

1. The structured signals found
2. Cross-domain connections
3. Recommended areas for the Cartographer to map

If the Scout report suggests immediate mapping would be valuable, suggest `/map`
as a follow-up.
