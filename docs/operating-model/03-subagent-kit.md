# 03 — The Sub-Agent Kit

> Part of the [Operating Kit](README.md). The nexus ([`01`](01-operating-model.md)) delegates to
> these. This file is how you design them: role-slicing, the auditor/owner split, tool-scoping,
> project memory, and two reusable templates.

Sub-agents live as Markdown files in `.claude/agents/*.md`, each with YAML frontmatter (`name`,
`description`, `tools`, `model`, `memory`, optionally `mcpServers`) followed by the agent's system
prompt. The nexus dispatches to one by name; the agent runs with only the tools you grant it and
returns a report.

---

## The core idea: persistent, role-sliced experts

Three properties make these agents work:

1. **One slice each.** An agent owns exactly *one* domain — the data files, *or* the UI, *or* the
   prose, *or* citation auditing. Not two. A narrow agent has a sharp, unambiguous mandate and
   can't sprawl.
2. **Project memory.** `memory: project` in the frontmatter means the agent **accumulates context
   across sessions**. The data curator remembers last session's schema decisions; the map owner
   remembers why the loader wrapper exists. Quality compounds instead of resetting each session.
3. **Inherit the global rules.** Every agent's prompt restates the load-bearing guardrails from
   `CLAUDE.md` (the current phase/scope, no new deps, verify-with-evidence) so they hold *inside*
   the delegated work, not just at the top level.

> **Worked example (StarGuide).** Six agents, one slice each, all `memory: project`: a data curator
> (flat data files), a map-feature owner (the interactive UI), an explainer-writer (prose), a
> citation auditor, an imagery QA, and a retrospective agent. None overlaps another's files. Each
> prompt re-states "v0 only, no new deps, show the evidence." This is the whole roster — note that
> it covers *make* (owners) and *check* (auditors) and *learn* (retrospective).

---

## How to slice roles

Slice by **domain of responsibility that has its own contract and its own way to verify**. Good
slices are mutually exclusive in the files they touch, so parallel work never collides
([`01`](01-operating-model.md#parallel-dispatch)). Typical slices, abstracted:

| Slice | Owns | Verifies with |
|-------|------|---------------|
| **Data/content owner** | the structured data / fixtures / flat files | schema validators, the data linter |
| **UI/feature owner** | the user-facing components for one surface | typecheck + lint + **a screenshot** |
| **Prose/docs owner** | the human-readable content | the content schema; every claim cited |
| **Citation/source auditor** *(read-only)* | nothing — audits everyone's claims | source-resolves checks; reports findings |
| **Ground-truth/QA auditor** *(read-only)* | nothing — audits modeled state vs reality | classified findings (confirmed/contradicted/new) |
| **Retrospective/learning** | only the log + the lessons list | diffs the iteration; promotes rules |

You won't need all of these on every project. Start with the **owners for your real file domains**
plus a **retrospective** agent, and add auditors as the project accumulates claims worth checking.
(Bootstrap order is in [`07`](07-bootstrap-checklist.md).)

---

## The read-only auditor vs read-write owner split

This split is the most important design decision in the kit after the nexus itself.

- **Owners** have `Edit`/`Write` (and usually `Bash`) for **their slice only**. They make changes
  and verify them.
- **Auditors** have **no `Edit`/`Write` to the thing they audit**. They `Read`/`Grep`/`Glob` (and
  maybe `WebFetch` to check a link, or `Bash` for read-only checks), and they **emit a report**.
  The relevant *owner* then acts on the report.

Why separate them:

- An auditor that can't edit can't "fix" the thing it's judging — so its judgment stays
  independent and its report stays trustworthy.
- It keeps **accountability** with the owner of the domain (the curator fixes the data; the auditor
  only flags it).
- It mirrors real engineering: the reviewer and the author are different roles for a reason.

Auditors are **report-first**: findings are grouped by severity (e.g. *blocking* / *should-fix* /
*nit*) and name the exact file + record + fix-owner, so the owner can act without re-investigating.

> **Worked example (StarGuide).** The citation auditor is `tools: Read, Grep, Glob, WebFetch, Bash`
> — *no Edit/Write* — and its prompt ends: *"Output a tight report … with file + id + fix owner
> (data-curator vs explainer-writer). No edits."* The imagery QA likewise *"REPORTS; the data-curator
> edits."* Both find problems neither schema nor build could catch (an uncited claim; a modeled state
> that contradicts a photo), hand them to an owner, and the owner closes the loop.

---

## Tool-scoping: grant the minimum

The `tools:` line is a capability boundary. Grant only what the slice needs:

- **Owner of code/data:** `Read, Edit, Write, Bash, Grep, Glob`.
- **Owner of prose/docs (no code execution):** `Read, Edit, Write, Grep, Glob` — *deliberately no
  `Bash`*, so it can't run the build or wander into code. (It says "this needs a code change" and
  hands off, instead of doing it.)
- **Read-only auditor:** `Read, Grep, Glob` plus `WebFetch` (to resolve links) and/or `Bash`
  (read-only checks). **No `Edit`/`Write`.**
- **Specialized capability via MCP:** add an `mcpServers:` block when a slice needs a tool the base
  set lacks — e.g. a browser-automation server for the UI owner to drive the app and screenshot it.

Choose `model:` per slice too: a heavier model for vision/judgment-heavy work, a lighter/cheaper one
for mechanical auditing. (StarGuide used a cheap model for the citation auditor, a vision-capable one
for the imagery QA.)

> **Worked example (StarGuide).** The prose owner is `tools: Read, Edit, Write, Grep, Glob` with the
> explicit note *"You have no Bash/Write-to-code access by design."* The UI owner adds a Playwright
> MCP server in frontmatter so it can open the page, drive the controls, and **take a screenshot** —
> which is how it satisfies the verify-with-evidence rule for a visual change.

---

## Template A — a read-write **owner**

```markdown
---
name: «slice»-owner
description: >-
  Owns «the files this slice covers». Use for any add/edit to «those paths».
  Enforces «the contract». Invoke whenever «the trigger».
tools: Read, Edit, Write, Bash, Grep, Glob
model: «sonnet | a heavier model for judgment-heavy work»
memory: project
# mcpServers:            # add only if this slice needs a special capability
#   playwright:
#     command: npx
#     args: ["-y", "@playwright/mcp@latest"]
---

You own «slice» for «Project». You own «exact paths» and nothing else.

## The contract you enforce
- «The authoritative schema/spec file» is authoritative — read it before editing so you match
  field names/enums/shapes exactly. Never invent fields.
- «The hard rules a validator checks» (e.g. every record sourced; correct winding; ISO dates).
- «Conventions: id-naming, cross-link shapes, the slug ↔ record mapping».

## How you verify (every time, show the output)
Run and **paste the results — never assert green**:
```
«validate command(s)»
«typecheck»
[for UI: start the dev server, drive it via the MCP, TAKE A SCREENSHOT, show it]
```
If a check fails, fix the **root cause** in your domain. Never edit the validator/schema to make
your output pass — those are out of your lane.

## Scope guardrails (from CLAUDE.md — non-negotiable)
- «current phase» only. Do NOT build «the deferred phases». If a task drifts there, STOP and flag it.
- Do not add dependencies. Stay in your lane: «your paths». Don't touch «other slices' files» —
  coordinate with «those owners» instead.

When done, list exactly what you changed and the evidence backing it, so the nexus can review.
```

## Template B — a read-only **auditor**

```markdown
---
name: «domain»-checker
description: >-
  Read-only «citation/QA» auditor. Use to verify «what it checks».
  Reports findings; never edits.
tools: Read, Grep, Glob, WebFetch, Bash     # NO Edit/Write — read-only by design
model: «a cheap model is often enough for mechanical auditing»
memory: project
---

You are «Project»'s «domain» auditor. You are **read-only**: you find and report problems, you
never fix them. Hand findings to «the owning agent» to act on.

## What you check
1. «Check 1 — what good looks like, and which validator it mirrors.»
2. «Check 2 …»
   Be systematic — check all records, not a sample (say what you sampled if the set is huge).

## How you work
- Use Grep/Glob/Read to enumerate every record. Use WebFetch/Bash only for **read-only**
  verification (resolve a link; run a validator). Do not mutate anything.
- Be specific: cite the file, the record id, the exact problem. Group by severity:
  **blocking** (fails CI) · **should-fix** (real but non-blocking) · **nit** (optional/polish).

## Scope
«current phase» only. You audit the existing artifacts; you do NOT build «deferred work». If asked
to go build/fetch a corpus rather than verify what exists, flag it as out of scope.

Output a tight report: a pass/fail headline, then grouped findings with **file + id + fix owner**.
No edits.
```

---

## Slash commands / skills wrap multi-step agent flows

A recurring multi-agent procedure deserves a **slash command** (a Markdown file in
`.claude/commands/`, invoked as `/name`) so the human can fire it with one word and the nexus runs
the steps the same way every time. A command typically: locates inputs → delegates to the right
agent(s) → summarizes the report → offers the follow-up. Keep the command file the *procedure* and
the agent file the *expertise*.

> **Worked example (StarGuide).** `/retro` runs the retrospective procedure (find baseline → diff →
> diagnose → append to the log → promote rules), preferring to delegate to the `retrospective` agent.
> `/review-imagery` is the "switch" that fires the imagery-QA agent over freshly-dropped reference
> images and then summarizes the classified findings for approval. One word; the same disciplined
> flow each time.

See [`05`](05-self-improvement-loop.md) for the retrospective command/agent in full, and
[`07`](07-bootstrap-checklist.md) for which agents to define first.
