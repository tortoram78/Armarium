# 01 — The Operating Model (the "nexus")

> Part of the [Operating Kit](README.md). See also: [`03` sub-agent kit](03-subagent-kit.md),
> [`04` verification](04-verification-and-validators.md), [`06` scope & comms](06-scope-phasing-and-comms.md).

This is the core mental model. Everything else in the kit is an elaboration of it.

---

## 1. One orchestrator: the nexus

There is **one** orchestrating agent — call it the *nexus*. The human talks to the nexus and
(almost) only the nexus. The nexus is simultaneously:

- **A coder** — it makes changes directly when the change is small/obvious.
- **A reviewer** — it reviews its own and its sub-agents' output before anything is called done.
- **A validator** — it runs every input and every output through checks (schemas, validators,
  the build, source-checks).
- **A self-checker** — it verifies *many times* before surfacing a result, and it surfaces only
  **verified results + the evidence**, never raw, unverified output.
- **A delegator** — it hands matching work to specialized sub-agents rather than doing everything
  itself (see [`03`](03-subagent-kit.md)).

> **The human's framing that defines the role:** *"act as a nexus of coding and review and
> validate and self-check many times before coming before me."* The cost of a wrong-but-confident
> result reaching the human is high; the cost of one more self-check is low. The nexus always pays
> the second cost.

### What the nexus brings to the human

Only three things ever reach the human:

1. **Verified results** — the change is done *and the gauntlet passed* ([`04`](04-verification-and-validators.md)).
2. **The evidence** — the command output, the screenshot, the validator report. (See
   [communication discipline](06-scope-phasing-and-comms.md#communication-discipline).)
3. **Decisions that need a human** — a plan to approve, a scope/dependency/infra question
   (see [ask-first triggers](06-scope-phasing-and-comms.md#ask-first-triggers)), or a genuine
   tradeoff. As a *recommendation*, not an exhaustive option-survey.

What does **not** reach the human: raw sub-agent transcripts, half-finished work, "I think this
passed," or narration of every step.

---

## 2. The orchestrator's self-check loop

For any non-trivial unit of work, the nexus runs this loop internally before surfacing anything:

```
        ┌────────────────────────────────────────────────────┐
        │ 1. SCOPE-CHECK   Is this in the current phase?      │
        │                  Does it add a dep / infra / scope? │──▶ if yes: STOP, ask the human
        ├────────────────────────────────────────────────────┤
        │ 2. PLAN          Multi-file? Propose a plan, get    │──▶ wait for approval
        │                  approval. One-liner? Just do it.   │
        ├────────────────────────────────────────────────────┤
        │ 3. DELEGATE      Does a specialist own this slice?  │──▶ dispatch (parallel if independent)
        │                  If so, hand it off with contracts. │
        ├────────────────────────────────────────────────────┤
        │ 4. INTEGRATE     Merge sub-agent output. Reconcile  │
        │                  cross-domain links by hand.        │
        ├────────────────────────────────────────────────────┤
        │ 5. VERIFY        Run the gauntlet. Cross-reference  │──▶ if red: fix ROOT CAUSE, loop to 5
        │                  check. Screenshot for UI.          │     (never suppress to go green)
        ├────────────────────────────────────────────────────┤
        │ 6. SELF-REVIEW   Read the diff as a reviewer would. │──▶ if doubts: loop to 4/5
        │                  Does the evidence match intent?    │
        ├────────────────────────────────────────────────────┤
        │ 7. SURFACE       Report verified result + evidence. │
        └────────────────────────────────────────────────────┘
```

Steps 5 and 6 are where the "many times" lives — the nexus does not exit the loop on the first
green; it re-reads its own diff with a reviewer's eye, and any doubt sends it back. The gauntlet
itself is defined in [`04`](04-verification-and-validators.md); scope-check and the plan gate in
[`06`](06-scope-phasing-and-comms.md).

---

## 3. Delegate aggressively to specialists

The nexus does **not** do all the work itself. Work that matches a specialist's slice is handed to
that specialist. This keeps each domain's context, conventions, and guardrails concentrated in an
agent that has accumulated them across sessions (see [`03`](03-subagent-kit.md) for the full
sub-agent pattern). The nexus retains: orchestration, integration, cross-domain reconciliation,
the gauntlet, and the conversation with the human.

### Two kinds of specialist

- **Read-write owners** edit exactly one slice (the data files, the UI components, the prose).
- **Read-only auditors** inspect and **report findings**, but never edit (the citation auditor,
  the imagery QA). Their output is a report the relevant *owner* then acts on.

This split is load-bearing: an auditor that can't edit can't "help" by quietly changing the thing
it's auditing, so its report stays honest and the owner stays accountable. Details and templates in
[`03`](03-subagent-kit.md#the-read-only-auditor-vs-read-write-owner-split).

### Parallel dispatch

Independent slices are dispatched **at once**, not serially. When the work decomposes into
disjoint file domains, multiple owners run in parallel and the nexus integrates their output.

> **Worked example (StarGuide).** Three read-write owners — a data curator (flat data files), a
> map-feature owner (the interactive UI), and an explainer-writer (prose) — worked in parallel
> across `data/`, `components/map/`, and `content/explainers/`. Because their **file domains were
> disjoint and their shared contracts (schema, id-naming, the slug convention) were fixed before
> anyone started**, the output integrated with the typechecker clean, the linter at exit 0, and the
> whole test suite passing. One pass touched 23 files and ~5,300 insertions without a write
> conflict. The precondition — *fix schemas/contracts/naming before any agent writes* — is what
> makes parallel dispatch safe.

### The catch: parallel work needs a cross-reference check

Each specialist's own validator only checks *its* domain. The seam *between* domains — e.g. a prose
file that is supposed to be linked from a data record, and vice versa — is checked by **neither**.
So after integrating parallel output, the nexus runs an explicit **cross-domain cross-reference
check**, and that check belongs in CI, not in manual inspection. This is important enough that it
has its own section in [`04`](04-verification-and-validators.md#the-cross-reference-check-after-integration).

> **Worked example (StarGuide).** After the parallel pass, several prose explainers existed on disk
> but were not linked from their corresponding map features (the `explainerSlug` was set on only one
> feature at baseline). Nine links had to be added during integration. The data validator didn't
> catch it (the data was schema-valid); the prose had no validator at all. Only a cross-domain check
> — *every explainer slug on disk has a matching feature, and every feature with a slug resolves to a
> real file* — surfaces this class of bug.

---

## 4. The nexus never trusts its own memory for facts

A coding agent's training data is fine for *how to write code* and stale/unreliable for
*facts about the world* (or about a fast-moving codebase or domain). So the nexus **grounds factual
claims in cited sources and real ground-truth**, and it builds *auditors* whose whole job is to
catch ungrounded claims:

- A **read-only citation auditor** that verifies every factual claim is backed by a resolvable
  source.
- An **imagery / ground-truth QA** that cross-checks the modeled state against real evidence
  (photos, primary records) and reports CONFIRMED / CONTRADICTED / NEW / UNCERTAIN.

> **Worked example (StarGuide).** A secondary source *guessed* that a facility ("Rio West") sat next
> to the build site. Cross-referencing authoritative county address records placed it ~3 km away by a
> river — *correcting the guess*. Repeatedly, primary records beat plausible-but-wrong inference. The
> lesson generalizes: **authoritative data beats inference; verify trained/inferred facts against the
> primary record.** See [`06`](06-scope-phasing-and-comms.md#dont-trust-training-data-for-facts).

---

## 5. Why this produces a smooth experience

The smoothness is not luck; it is the compounding of a few choices:

- The human is never handed unverified output, so trust never has to be re-litigated.
- Specialists keep context, so quality rises per-domain over time instead of resetting each session.
- The gauntlet makes "done" mean *done*, so rework is rare and never reaches `main` red.
- The retrospective loop ([`05`](05-self-improvement-loop.md)) turns every mistake into a written
  rule, so the *same* mistake doesn't recur — **each iteration starts further ahead than the last.**

The rest of the kit operationalizes each of these:
[`02`](02-claude-md-template.md) (the constitution),
[`03`](03-subagent-kit.md) (the specialists),
[`04`](04-verification-and-validators.md) (the gauntlet),
[`05`](05-self-improvement-loop.md) (the learning loop),
[`06`](06-scope-phasing-and-comms.md) (scope, phases, comms),
[`07`](07-bootstrap-checklist.md) (how to stand it all up).
