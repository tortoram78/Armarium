# 02 — The `CLAUDE.md` Template

> Part of the [Operating Kit](README.md). This is the project's **constitution** — the file the
> nexus loads into every session. Keep it tight: it is *always-on context*, so every line costs
> tokens on every turn. Detail lives in design docs and the [engineering log](05-self-improvement-loop.md);
> `CLAUDE.md` holds only the few rules worth loading every time.

Copy the skeleton below into a new repo's `CLAUDE.md` and fill the `«fill-in»` placeholders.
Annotations explain *why* each section exists and what good content looks like; delete the
annotations (the `<!-- … -->` lines) once filled.

---

## The skeleton (copy this)

```markdown
# «Project Name»

«One-paragraph statement of what this is, who it's for, and the single job it does.
End by pointing at the vision/architecture docs and instructing: "Read the architecture
doc before planning any feature" — it holds the data shapes and phase boundaries.»

## Scope discipline — read this first
<!-- The first thing the agent reads. A crisp "we are building vN only" line, then the
     hard "must not build" list, then the catch-all ask-first rule. See kit file 06. -->
- We are building **«vN» only**: «the 2–4 things in scope». Nothing else.
- **YOU MUST NOT build later-phase work** — «name the deferred phases explicitly» — unless I
  explicitly say we've moved to that phase. If a request drifts toward them, stop and flag it.
- Anything that would expand scope, add a dependency, or introduce new infrastructure: **ask first.**

## Stack
<!-- The boring facts an agent needs to not guess wrong. Be specific about versions and the
     deliberate *non*-choices (what you chose NOT to use, and why) — those prevent re-litigation. -->
- «Language / framework / runtime / deploy target».
- «Key libraries and the deliberate non-choices, e.g. 'imperative X on purpose — do NOT add wrapper Y'».
- **Data for «vN» is «flat files / this store» only:** «list the files or stores».
- **IMPORTANT: do NOT add «the thing you must not add — a database / backend / auth».** «Why; when it comes later.»

## Architecture rules
<!-- The 3–6 invariants that, if violated, make the result "wrong" even when it compiles.
     State the ONE rule that defines the project first. -->
- «The defining invariant — the one rule that, broken, betrays the whole design.»
- Keep dependencies minimal — prefer what's already in «the manifest». Ask before adding a new one.
- Keep the system simple. Favor obvious code over clever abstractions; small units over large ones.

## Code style
<!-- ONLY the deviations from the ecosystem default worth stating. Don't restate the obvious. -->
- «e.g. strict types; ES modules; functional components; named exports».
- Otherwise follow standard «ecosystem» conventions — these are the only deviations worth stating.

## Workflow
<!-- The verify-with-evidence contract and the plan gate. This is non-negotiable. See kit file 04. -->
- **Plan before multi-file changes.** Explore in plan mode and propose a plan; wait for my
  approval before editing. For a one-line or obvious change, just make it.
- **Verify before calling anything done.** Run «typecheck», «lint», «build», «tests», «validators».
  For UI changes, take a screenshot (or describe the rendered result) and check it against intent.
  **Show the evidence** — the command output or screenshot — never just assert it passed.
- Fix **root causes, not symptoms.** Never suppress an error to make a check go green.
- Prefer running a single relevant test over the whole suite.
- Commit with clear, scoped messages. Use the «gh» CLI for PRs.

## Commands
<!-- The exact named scripts. The agent should never have to guess the verb. Keep in sync with
     the manifest. Mark which one is the hard gate ("must pass before any task is done"). -->
- `«run dev»` — local dev server
- `«run build»` — production build; must pass before any task is done
- `«run lint»` — lint
- `«run typecheck»` — type check
- `«test»` — tests
- `«validate:*»` — domain validators (see kit file 04)

## Specialized agents
<!-- Point at .claude/agents/*.md and summarize each in one line: its ONE slice, that it carries
     project memory, and that it inherits every rule above. See kit file 03. -->
Persistent expert subagents live in `.claude/agents/*.md`. Each carries **project memory**
(`memory: project`) so it accumulates context across sessions, and each is scoped to one slice —
delegate the matching work to them rather than doing it ad hoc. They inherit every rule above.

- **«owner-agent»** — owns «its files». Enforces «its contract». Verifies with «its checks».
- **«auditor-agent»** — read-only «citation/QA» auditor. Reports findings; never edits.
- «…one line per agent…»

`.claude/settings.json` defines a `SessionStart` hook («install + a fast check») so cloud/web
sessions arrive ready. CI lives in `.github/workflows/ci.yml`.

## Engineering lessons (self-improving)
<!-- The curated, PRUNED list of durable rules. Promoted from the engineering log by the retro.
     Keep it tight — prune superseded rules; detail lives in the log. See kit file 05. -->
At the end of every iteration, run a **retrospective** — `/retro`, or delegate to the
**`retrospective`** agent: diff the iteration, diagnose *why* each change was needed, append the
full analysis to `docs/engineering-log.md`, and promote only durable, broadly-applicable rules into
the curated list below. Keep this list tight (prune superseded rules) — detail lives in the log.

- «Durable rule 1 — root cause + what to do differently.»
- «Durable rule 2 …»
```

---

## Section-by-section notes

### Scope discipline goes *first, on purpose*
It is the section most likely to prevent the most expensive mistakes (building the wrong thing,
silently adding infra). Putting it at the top means it's the first thing in the agent's context.
The three-part shape — *in-scope line → hard "must not" list → catch-all ask-first* — is covered in
detail in [`06`](06-scope-phasing-and-comms.md#scope-discipline-and-phase-gates).

### State the deliberate *non*-choices
The most useful Stack/Architecture lines are often the negatives: "we use the imperative API on
purpose — do **not** add the wrapper library," "do **not** add a database." These stop an agent from
"helpfully" reaching for a familiar dependency and re-litigating a settled decision.

> **Worked example (StarGuide).** The architecture rules name the defining invariant in one line —
> *"The GeoJSON **is** the interactive layer. Render real features and attach handlers to them. Do
> not build a separate hotspot/coordinate system over an image."* — and the stack hard-bans a
> database: *"do NOT add a database, ORM, backend, or auth. No Supabase, no Postgres, nothing."*
> Both are negatives, and both prevent a whole class of plausible-but-wrong work.

### Commands must be exact and name the hard gate
The agent should never guess whether it's `npm test` or `npm run test:ci`. List the real script
names and mark the one that is the non-negotiable gate ("must pass before any task is done").

### The "Specialized agents" section is an index, not a spec
One line per agent: its single slice, that it carries project memory, that it's an owner or an
auditor. The full behavior lives in each agent's own file ([`03`](03-subagent-kit.md)). The index
exists so the nexus knows *who to delegate to*.

### The "Engineering lessons" list is curated and pruned
This is the **output** of the self-improvement loop ([`05`](05-self-improvement-loop.md)), not a
dumping ground. Only durable, broadly-applicable rules get promoted here; superseded rules get
pruned; the blow-by-blow stays in the log. If this list grows past ~10–12 bullets, it's probably
holding detail that belongs in the log.

> **Worked example (StarGuide).** Promoted rules read like
> *"Every pushed commit must pass `npm run build` locally first … a shared branch with CI/deploys is
> not a scratchpad"* and *"After parallel-agent integration, run a cross-reference check … neither
> agent's domain validator catches the other side; this belongs in CI."* Each names a root cause and
> tells a future session exactly what to do differently. That's the bar for promotion.

---

## A note on `CLAUDE.md` vs design docs

`CLAUDE.md` is **always-on, terse, and rule-shaped.** Anything that is *reasoning*, *a design*, or
*a one-time investigation* belongs in a `docs/` file that the agent reads on demand — and
`CLAUDE.md` should *point* at those docs ("read the architecture doc before planning a feature")
rather than inlining them. This keeps the always-on context small while keeping the depth available.
See [`06` on writing designs down before building](06-scope-phasing-and-comms.md#design-before-build-write-it-down).
