# The Operating Kit

A portable, **project-agnostic** capture of *how* a project gets built well with Claude Code —
the working methodology between a human and an orchestrating ("nexus") agent. Drop this
`operating-model/` directory into any new repo, follow the [bootstrap checklist](07-bootstrap-checklist.md),
and you reproduce the same workflow.

> This kit was extracted from a project (StarGuide, a Next.js mapping app) where the loop
> ran smoothly. Everything here is abstracted to general patterns; StarGuide appears only as a
> **clearly-marked worked example**. A reader on a totally different kind of project — a CLI, a
> data pipeline, a game — should be able to apply all of it.

---

## The philosophy in one screen

1. **One orchestrator, the "nexus."** A single agent that both *codes and reviews*, delegates
   aggressively to specialized sub-agents, validates every input and output, self-checks
   repeatedly, and **only comes to the human with verified results plus evidence** — never raw,
   unverified output.

2. **Persistent, role-sliced expert sub-agents.** Each sub-agent owns exactly one slice of the
   work (data / UI / prose / citations / QA / retrospective), carries **project memory** so it
   accumulates context across sessions, and inherits all the global rules. Some are **read-write
   owners** (they edit their domain); some are **read-only auditors** (they report findings and
   never edit). Independent slices run **in parallel**.

3. **Verify with evidence, always.** Never assert "it passed." Show the command output or the
   screenshot. A standing gauntlet — typecheck → lint → build → tests → domain validators →
   cross-reference checks → (for UI) a screenshot checked against intent — gates every "done."
   Fix **root causes, not symptoms**; never suppress an error to make a check go green.

4. **Validators as gates, written *before* the artifact they guard,** and protected by
   failing-fixture regression tests so they can't be silently weakened.

5. **A self-improving loop.** End every iteration with a retrospective: diff it, diagnose *why*
   each change was needed, append the analysis to an engineering log, and **promote only durable,
   broadly-applicable rules** into a tight curated "lessons" list. This is the mechanism that makes
   each iteration smoother than the last.

6. **Scope discipline and phase gates.** A crisp "we are building vN only" statement; explicit
   later phases that must not be built without a go-ahead; and "anything that expands scope, adds a
   dependency, or introduces new infrastructure: **ask first.**" The agent *stops and flags* drift
   instead of quietly building ahead.

7. **Don't trust training data for facts.** Ground factual claims in cited sources and real
   ground-truth (imagery, primary records), not the model's memory.

---

## Index of files

| File | Purpose (one line) |
|------|--------------------|
| [`01-operating-model.md`](01-operating-model.md) | The nexus + sub-agent model: roles, delegation, parallel dispatch, the orchestrator's self-check loop. |
| [`02-claude-md-template.md`](02-claude-md-template.md) | An annotated, fill-in-the-blanks `CLAUDE.md` skeleton a new project copies and adapts. |
| [`03-subagent-kit.md`](03-subagent-kit.md) | The persistent-memory sub-agent pattern: role-slicing, read-only-auditor vs read-write-owner, tool-scoping, reusable agent templates. |
| [`04-verification-and-validators.md`](04-verification-and-validators.md) | The gauntlet, validators-as-gates, failing-fixture protection, the cross-reference-after-integration check, and CI wiring. |
| [`05-self-improvement-loop.md`](05-self-improvement-loop.md) | The retro → engineering-log → lesson-promotion mechanism, with a log-entry template and rule-promotion criteria. |
| [`06-scope-phasing-and-comms.md`](06-scope-phasing-and-comms.md) | Scope discipline, phase gates, ask-first triggers, IP/legal posture, environment-constraint documentation, communication norms. |
| [`07-bootstrap-checklist.md`](07-bootstrap-checklist.md) | A concrete, ordered checklist to stand the whole system up in a fresh repo, ending with the first retro. |

**Suggested reading order.** First time: read this README, then [`01`](01-operating-model.md) for the
mental model, then [`07`](07-bootstrap-checklist.md) to set it up — pulling in [`02`](02-claude-md-template.md)–[`06`](06-scope-phasing-and-comms.md)
as the checklist references them. Returning: jump straight to the file for the practice you need.

---

## How the pieces fit together

```
            ┌──────────────────────────────────────────────────────────┐
            │  HUMAN  — sets intent, scope, phase gates; approves plans │
            │          receives only verified results + evidence       │
            └───────────────────────────┬──────────────────────────────┘
                                        │ verified results + evidence
                          ┌─────────────▼─────────────┐
                          │   NEXUS (orchestrator)     │   self-checks many times
                          │   codes · reviews · gates  │   before surfacing anything
                          └───┬───────────┬────────┬───┘
            delegates (parallel) │        │        │ runs the gauntlet on every "done"
            ┌────────────────────┘        │        └───────────────────────┐
            ▼                             ▼                                 ▼
  read-write OWNERS              read-only AUDITORS               VERIFICATION GAUNTLET
  (edit their one slice)         (report, never edit)             typecheck · lint · build
  e.g. data / UI / prose         e.g. citations / QA              tests · validators ·
            │                             │                       cross-ref · screenshot
            └─────────────┬───────────────┘                                 │
                          ▼                                                  ▼
              CROSS-REFERENCE CHECK   ◀── catches what each domain         CI mirrors
              (cross-domain integrity)    validator misses individually    the gauntlet
                          │
                          ▼
                  RETROSPECTIVE (every iteration)
                  diff → diagnose why → engineering-log → promote durable rules → CLAUDE.md
                          │
                          └──▶ next iteration starts smoother
```

Each box maps to a file: the nexus + owners + auditors live in [`01`](01-operating-model.md) and
[`03`](03-subagent-kit.md); the gauntlet, validators, and cross-reference check in
[`04`](04-verification-and-validators.md); the retrospective in [`05`](05-self-improvement-loop.md);
the human-facing rules (scope, phases, comms) in [`06`](06-scope-phasing-and-comms.md); and
[`02`](02-claude-md-template.md) is the `CLAUDE.md` that encodes all of it for a fresh project.
