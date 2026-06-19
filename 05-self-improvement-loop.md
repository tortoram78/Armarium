# 05 — The Self-Improvement Loop

> Part of the [Operating Kit](README.md). **This is the mechanism that makes each iteration smoother
> than the last.** Without it, the same mistakes recur every session; with it, every mistake becomes a
> written rule that prevents its own recurrence.

---

## The loop

At the **end of every iteration**, run a retrospective:

```
   diff the iteration            ──▶  what actually changed since the last retro?
        │
        ▼
   diagnose WHY each change       ──▶  root cause — what was wrong or learned, not just "added X"
        │
        ▼
   append the analysis            ──▶  docs/engineering-log.md   (append-only, full detail)
        │
        ▼
   promote durable rules          ──▶  CLAUDE.md "Engineering lessons"   (tight, curated, pruned)
        │
        ▼
   next iteration starts smarter  ──▶  the rule is now always-on context
```

Two artifacts, two different jobs:

- **`docs/engineering-log.md`** — *append-only*, holds the **full** blow-by-blow: every meaningful
  change, its root cause, the durable takeaway, and whether it was promoted. This is the searchable
  history. It never gets pruned.
- **`CLAUDE.md` "Engineering lessons"** — the **few** durable, broadly-applicable rules, promoted
  from the log. This is always-on context, so it is kept **tight and pruned** ([`02`](02-claude-md-template.md#the-engineering-lessons-list-is-curated-and-pruned)).

The log is the memory; `CLAUDE.md` is the reflex.

---

## Run it as a command or a dedicated agent

Make the retro **one word to fire** and **the same steps every time** — a `/retro` slash command
that prefers to delegate to a dedicated `retrospective` agent. The agent edits **only** the log and
`CLAUDE.md` — never app code or data — so the learning loop can't itself introduce a regression.

### The procedure (what `/retro` / the agent does)

1. **Find the baseline.** Read the newest log entry and use its *"analyzed through `<sha>`"* marker
   as the starting point. (If there's none yet, use the last ~3 commits.)
2. **Inspect the delta.** `git log --oneline <baseline>..HEAD` and `git diff --stat <baseline>..HEAD`;
   read the actual diffs of the substantive changes and any agent reports from the conversation.
3. **Analyze each meaningful change** as **Delta · Why · Lesson · Promote?** (defined below).
4. **Append** a dated entry to the log in the existing format, ending with the HEAD sha analyzed
   through — so the next run knows where to resume.
5. **Promote** only durable, broadly-applicable rules into `CLAUDE.md`. Dedupe against what's there,
   tighten wording, and **prune rules newer learning has superseded.** Don't bloat it.
6. Keep all other `CLAUDE.md` sections intact; verify the Markdown; commit both files with a
   `chore(retro): …` message summarizing the lessons.

> Bias toward **fewer, sharper** lessons over many shallow ones. A good lesson names the root cause
> and tells a future session exactly what to do differently.

---

## The log-entry format

Each meaningful change is one entry with four fields:

- **Delta** — *what* changed (the concrete diff: files, behavior, numbers).
- **Why** — the **root cause**: what was wrong or learned, *not* "added X." This is the field that
  makes the log valuable — it's the diagnosis, not the changelog.
- **Lesson** — the durable, generalizable takeaway: what to do differently next time.
- **Promoted** — yes/no, to `CLAUDE.md`? (And if no, *why not* — usually "already covered" or "too
  specific.")

### Template — copy for a new iteration

```markdown
## «YYYY-MM-DD» — «iteration title» (analyzed through `«HEAD-sha»`)

### «short title of change 1»
- **Delta:** «what concretely changed — files, behavior, measured numbers».
- **Why:** «the root cause — what was actually wrong or learned».
- **Lesson:** «the durable takeaway — what a future session should do differently».
- **Promoted:** «yes (to CLAUDE.md) | no (reason: already covered / too specific)».

### «short title of change 2»
- **Delta:** …
- **Why:** …
- **Lesson:** …
- **Promoted:** …
```

### The log header (set this up once)

```markdown
# «Project» Engineering Log (self-improving)

Append-only retrospective log. After each iteration, the **`retrospective`** agent (or **`/retro`**)
diffs what changed since the last entry, diagnoses *why*, records the durable lesson here, and
promotes broadly-applicable rules into `CLAUDE.md`'s "Engineering lessons" section. Full detail lives
here; CLAUDE.md holds only the distilled rules.

Entry format per change — **Delta** · **Why** · **Lesson** · **Promoted**.
```

> **Worked examples (StarGuide log).** A few real entries, abbreviated, to show the bar:
>
> - *Delta:* pushed a mid-integration WIP snapshot; CI + deploy went red; PR closed. *Why:* a
>   Stop-hook prompted "commit" while agents were still writing; optimized for the hook over a
>   buildable state. *Lesson:* never push a commit that hasn't passed the build; a shared branch
>   isn't a scratchpad. *Promoted:* **yes.**
> - *Delta:* wrote a multi-layer geometry validator (bbox, containment, size guards, vertex limit)
>   *before* authoring geometry, with nine regression tests. *Why:* the old validator checked
>   structure/winding but never *placement* — "a centroid in the Gulf passed CI clean." *Lesson:*
>   write the validator before the artifact; check *where* and *how big*, not just *shape*; protect it
>   with a failing-fixture test. *Promoted:* **yes (condensed).**
> - *Delta:* inlined a ~15-line area formula instead of adding a library. *Why:* both call sites
>   needed the same small formula; a new dependency needs approval. *Lesson:* reach for the small
>   inline computation before a new dep. *Promoted:* **no — too specific; the "ask before adding a
>   dep" rule already covers it.**
>
> Note the third: most entries are *not* promoted. The log captures everything; `CLAUDE.md` gets only
> the few that generalize.

---

## Rule-promotion criteria

Promote a lesson to `CLAUDE.md` **only if all of these hold**:

1. **Durable** — it will still be true many iterations from now (not a one-off fix).
2. **Broadly applicable** — it applies beyond the single spot it came from.
3. **Actionable** — it names the root cause *and* tells a future session what to do differently
   (not just "be careful").
4. **Not already covered** — an existing rule doesn't already imply it. If it's a sharper restatement
   of an existing rule, *edit the existing rule* rather than adding a second.

**Do not promote** when the lesson is: too specific to one file; a confirmation that an existing rule
worked (record that in the log — it's evidence the rule is load-bearing — but don't duplicate the
rule); or a restatement of something already in `CLAUDE.md`.

### Pruning is part of promotion

Each retro also **prunes**: when newer learning supersedes an old rule, the old rule is removed (its
history stays in the log). The lessons list is a *living, tight* set — if it only grows, it stops
being always-on context worth its tokens. Aim to keep it around a screen.

> **Worked example (StarGuide).** When the geometry lesson was learned twice — first "approximate
> rectangles read as wrong," later "write the validator *first*" — the retro **updated the existing
> rule** to include validator-first sequencing rather than adding a second, near-duplicate bullet.
> That's pruning-by-merging in action.

---

## Why this is the keystone

Scope discipline, the gauntlet, and the sub-agents each prevent *categories* of problem. The
retrospective loop is what lets the system **discover new categories and close them permanently.**
It's the difference between a process that's merely good and one that gets **monotonically better** —
every snag becomes a rule, every rule prevents a class of future snags, and the human notices the
sessions getting smoother. That compounding is the whole point of the kit.

Next: the human-facing rules that keep the work pointed at the right target —
[`06` scope, phasing & communication](06-scope-phasing-and-comms.md).
