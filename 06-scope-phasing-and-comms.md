# 06 — Scope, Phasing, Legal Posture & Communication

> Part of the [Operating Kit](README.md). These are the rules that keep the work pointed at the
> *right* target and keep the human's attention well-spent. They're encoded at the top of
> [`CLAUDE.md`](02-claude-md-template.md) and enforced by the nexus's self-check loop
> ([`01`](01-operating-model.md#2-the-orchestrators-self-check-loop)).

---

## Scope discipline and phase gates

The single most expensive mistake a capable agent makes is **building the wrong thing well** —
racing ahead into work that's real but *not now*. The defense is a crisp, always-on scope statement
with three parts, placed *first* in `CLAUDE.md`:

1. **The in-scope line** — *"We are building **vN** only: «the few things». Nothing else."* One
   sentence, unambiguous.
2. **The hard "must not" list** — name the deferred phases **explicitly** and forbid building them
   without an explicit go-ahead: *"YOU MUST NOT build «later-phase work» unless I explicitly say
   we've moved to that phase. If a request drifts toward them, stop and flag it."*
3. **The catch-all** — *"Anything that would expand scope, add a dependency, or introduce new
   infrastructure: **ask first.**"*

### Phase gates

Later phases are **named and gated**, not vague. The agent knows exactly what the future phases are
(so it can *design for* them) and that it **may not build them** until the human opens the gate. This
lets the project lay seams for the future without prematurely building it.

> **Worked example (StarGuide).** `CLAUDE.md` opens with *"We are building **v0 only**: the
> interactive map + facility explainers + the event timeline. Nothing else,"* then names the gated
> phases — *"the permitting/expectations tracker, the transcript pipeline, or any AI/RAG layer …
> unless I explicitly say we've moved to that phase."* Inert fields and unused files are left as
> **dormant seams** for those phases (e.g. a `filings.json` and provenance fields that "are inert
> seams; leave them inert unless told otherwise"), and a design doc explicitly *designs* the
> multi-region future while stating it is *"designed-for now, not built now."* Design ahead; build only
> in-phase.

### Stop and flag — don't silently comply or silently refuse

When a request drifts past the scope line, the nexus **stops and flags it** — surfaces the drift,
says which phase it belongs to, and asks. It neither quietly builds ahead nor silently drops the
request. The sub-agents inherit this: each one's prompt restates "if a task pushes you toward «the
defining violation», STOP and flag it."

> **Worked example (StarGuide).** The prose owner's prompt: *"You must NOT ingest video transcripts
> … or build any RAG/embeddings step. That is a deferred Phase-2/3 effort … If a task asks you to
> transcribe or auto-generate from video, STOP and flag it."* The UI owner: *"If a task pushes you
> toward hotspots, stop and flag it — that violates CLAUDE.md."* The guardrail lives at every level,
> not just the top.

### Design-before-build: write it down

Before building anything non-trivial — and *always* before crossing into new surface area — **write
the design down in a `docs/` file**: the data shapes, the seams, what's in-phase vs. deferred, and
the honest soft spots. A written design is the artifact a plan is approved against, the place the
*reasoning* lives (so `CLAUDE.md` stays terse and just *points* at it), and the record that keeps a
later session from re-deriving or contradicting an earlier decision. Design *ahead* of the phase gate;
**build only inside it.**

> **Worked example (StarGuide).** Substantial design docs preceded the code they describe — a
> multi-region expansion design that lays the future seams while stating plainly it is *"designed-for
> now, **not built now**,"* a QA/imagery-cross-check design, and a validation-and-gap-filling method.
> Each names its scope line and its deferred parts explicitly, so the design exists *before* the build
> and the build never drifts past the gate. `CLAUDE.md` then merely instructs: *"Read the architecture
> doc before planning any feature."*

---

## Ask-first triggers

The nexus **pauses and asks the human** before doing any of these — they're the actions that are
expensive to undo or that change the project's shape:

- **Adding a dependency.** Prefer what's already in the manifest. A new library is a new maintenance
  surface, license, and attack surface — it needs a yes. (Often the need is a ~15-line inline helper,
  not a package — reach for that first. See the StarGuide area-formula example in
  [`05`](05-self-improvement-loop.md#the-log-entry-format).)
- **Introducing infrastructure** — a database, a backend, a queue, a scheduler, auth. These are
  usually a *later phase* by definition.
- **Expanding scope** past the in-scope line, or starting any **gated phase**.
- **Anything irreversible or shared-state-touching** — force-pushing, rewriting history, deleting
  data, changing deploy/CI config in a way that affects others.

Default to **ask**, not to a heroic guess. A 20-second question is cheaper than an unwanted
migration.

---

## Don't trust training data for facts

A model's training data is acceptable for *how to write code* and unreliable for *facts about the
world or a fast-moving domain*. So:

- **Ground factual claims in cited, resolvable sources** — and build a [read-only citation
  auditor](03-subagent-kit.md#the-read-only-auditor-vs-read-write-owner-split) to enforce it.
- **Cross-check modeled state against real ground-truth** (imagery, primary records) with a QA
  auditor that reports CONFIRMED / CONTRADICTED / NEW / UNCERTAIN.
- **Authoritative data beats plausible inference.** When a primary record and a model's
  guess/secondary source disagree, the primary record wins.
- When a claim *can't* be sourced, **soften it or leave it out** — never fabricate a citation, date,
  or figure.

> **Worked example (StarGuide).** Primary county records repeatedly overruled plausible-but-wrong
> inference — most sharply when address records placed a facility ~3 km from where a secondary source
> had *guessed* it sat. The prose owner's standing rule: *"If you cannot source a claim, soften it or
> leave it out. Never fabricate a citation, a date, or a URL."*

---

## Legal / IP posture as a first-class rule

When the project touches third-party or copyrighted material, the IP posture is a **non-negotiable
rule from day one**, not an afterthought:

- **Keep copyrighted source material internal-only and git-ignored.** Never display it, never
  redistribute it, never commit it.
- **Persist only *derived facts*.** Facts (counts, dates, states, relationships) aren't
  copyrightable; the source work is. Reference the source by id + credit, never by reproducing it.
- **Link, don't reproduce.** Where the product references a third-party work, it *links* to the
  creator's published version (curation), it doesn't mirror it.
- **Respect terms of service.** Scraping that violates ToS, or ingesting a corpus without
  permission, is a legal question — flag it; prefer creator permission + cite-and-link.

> **Worked example (StarGuide).** Third-party flyover imagery is used *only* as internal validation
> input: *"The images are the photographer's property … provided for INTERNAL VALIDATION ONLY. Never
> copy an image into the repo, never embed/redistribute it … Persist only DERIVED FACTS."* The image
> files are git-ignored; only classified findings are written down; the app *links* to the creator's
> published media. The QA agent that reads them is explicitly forbidden from reproducing them.

---

## Document the environment's constraints up front

Capture the environment's quirks in `CLAUDE.md` (or a referenced doc) so agents **diagnose from the
real error string** and don't chase phantom failures or re-discover the same wall every session.
Things worth documenting:

- **Network/egress limits** — which hosts are reachable and which return errors, so sourcing plans
  account for it *at task-start*, not mid-run.
- **What renders where** — e.g. a visual that only appears on the deploy, not in the sandbox, so
  verification targets the right place.
- **Toolchain gotchas** — framework/build constraints that cause non-obvious failures.

And a meta-rule: **diagnose from the actual error, not a guess.** Wait for the real failure string
before "fixing" — the first guess is often wrong.

> **Worked examples (StarGuide).** Documented in `CLAUDE.md`: *"This environment's egress is
> allowlisted: npm + WebSearch work; «certain GIS/.gov hosts» return 403 … The basemap renders on the
> deploy, not in-sandbox — verify map visuals on the deploy."* And a process miss recorded in the log:
> a Vercel build failed; the *first guess* was "Node version," but the **actual error string** said the
> framework preset was mis-detected — *"I should have waited for the actual error string before
> 'fixing.'"* The egress wall got re-discovered a second time before the team made it a *task-start*
> planning input rather than a mid-run surprise — the fix was to apply the documented rule *earlier*.

---

## Surgical reconciliation over blind merges

When two lines of work diverge — a forked agent/bot's output vs. the trunk, or two branches that both
touched the same artifact — **reconcile by domain key, not by a blind `git merge`.** Take the **union
keyed on the domain identifier** (e.g. record/feature id overlap), and produce a **damage report**
that categorizes what's fixable-now vs. what needs more evidence. A blind merge of structured
data/artifacts silently drops or duplicates records; a keyed reconciliation is auditable.

> **Worked example (StarGuide).** A "parcel bot" fork and the trunk both rewrote the same geometry
> file. They were reconciled into a *"28-feature union"* keyed on feature id — not merged blindly —
> with the divergences triaged into fix-now vs. needs-more-evidence, and the soft spots carried
> forward openly (*"honest soft spots (carried forward, not hidden)"*) rather than silently resolved.

---

## Communication discipline

How the nexus talks to the human — terse, evidence-backed, decision-oriented:

- **Concise and evidence-backed.** Lead with the result and *show the proof* (the command output,
  the screenshot). Don't narrate every step; report the outcome and the evidence. (The gauntlet's
  evidence rule — [`04`](04-verification-and-validators.md#the-first-principle-evidence-not-assertion).)
- **Recommendations, not option-surveys.** When a decision is needed, give a **recommendation with
  its reasoning**, plus the key tradeoff — not an exhaustive menu of every possibility for the human
  to sort through.
- **Surface decisions and tradeoffs, not narration.** The human's attention is for *choices that
  need them* — a plan to approve, an ask-first trigger, a genuine fork in the road — not for a play-by-play
  of work that's going fine.
- **Flag soft spots honestly.** State what's approximate, low-confidence, or deferred *openly* and
  carry it forward, rather than papering over it. Honesty about the edges is what makes the verified
  core trustworthy.

> **Worked example (StarGuide).** Reports lead with the verified headline and the evidence
> (*"55 tests pass, production build green (12 routes)"*), and uncertainty is stated plainly — features
> are tagged `approximate-geometry` and design docs keep an explicit *"honest soft spots (carried
> forward, not hidden)"* list. The human approves plans and answers ask-first questions; they don't
> wade through transcripts.

---

Next: putting all of this into a fresh repo, in order —
[`07` bootstrap checklist](07-bootstrap-checklist.md).
