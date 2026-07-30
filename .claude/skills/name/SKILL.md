---
name: name
description:
  Generate and evaluate candidate names for a concept, pattern, or unnamed
  thing. Assesses cognitive load, precision, resonance, and load-bearing
  quality.
argument-hint: [concept or thing to name]
user-invocable: true
---

Name this concept: $ARGUMENTS

## Process

### 1. Understand the Thing

Before naming, understand what needs naming:

- What is the essence of this thing? (Not what it does, but what it _is_)
- What distinguishes it from related things?
- What mental model should the name evoke?
- Who will use this name, and in what context?

### 2. Generate Candidates

Produce 3-5 candidate names. For each:

- State the name
- Explain the metaphor or etymology
- Note what it evokes (the mental model it creates)

Draw from multiple sources: metaphor, etymology, analogy, compression, existing
domain vocabulary.

### 3. Evaluate Each Candidate

Score each name against four criteria:

**Cognitive Load** — Is it easy to remember, spell, pronounce, and use in
conversation? Short names with clear pronunciation win.

**Precision** — Does it distinguish this thing from related things? A good name
makes the wrong usage feel wrong.

**Load-Bearing** — If you deleted this name, would communication break down?
Would people reinvent it? Load-bearing names are essential; decorative names are
overhead.

**Resonance** — Does it evoke the right mental model? Does it connect to
existing intuitions? A resonant name teaches you something about the thing just
by hearing it.

### 4. Check for Retirements

Does this new name replace any existing names? Naming creates ontology — check
what this name implies about the existing naming structure:

- Does it subsume an existing term?
- Does it split an existing term into two?
- Does it rename something that was poorly named?

### 5. Output

```
## Naming: [Concept]

### Candidates
1. **[name]** — [metaphor/etymology]. Evokes: [mental model].
2. **[name]** — [metaphor/etymology]. Evokes: [mental model].
3. **[name]** — [metaphor/etymology]. Evokes: [mental model].

### Evaluation
| Name | Cognitive Load | Precision | Load-Bearing | Resonance |
|---|---|---|---|---|
| [name] | [low/med/high] | [low/med/high] | [yes/no] | [low/med/high] |

### Recommendation
**[name]** (confidence: high/medium/low)
Rationale: [why this name wins]

### Load-Bearing?
[Yes/No] — [Would communication break without this name?]

### Retirements
[Existing names this replaces, if any, and why]

### Ontology Note
[How this name relates to the existing naming structure]
```
