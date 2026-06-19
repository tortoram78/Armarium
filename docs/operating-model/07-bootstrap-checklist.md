# 07 — Bootstrap Checklist

> Part of the [Operating Kit](README.md). A concrete, ordered procedure to stand the whole operating
> model up in a fresh repo. Work top to bottom; each step links to the kit file with the detail.

This checklist assumes you've copied this `operating-model/` directory into the new repo's `docs/`.
Adapt every `«placeholder»` and every command to your stack — the kit is stack-agnostic; only the
*shape* is fixed.

---

## Phase 0 — Decide the shape (before writing any agent)

- [ ] **Write the vision/architecture doc(s).** What the project is, who it's for, the data shapes,
      and the **phase boundaries** (what's in vN vs. gated for later). This is the doc `CLAUDE.md`
      will tell agents to *"read before planning a feature."* See
      [`06` design-before-build](06-scope-phasing-and-comms.md#scope-discipline-and-phase-gates).
- [ ] **Name the scope line and the gated phases.** One sentence of in-scope; an explicit list of
      deferred phases. ([`06`](06-scope-phasing-and-comms.md#scope-discipline-and-phase-gates))
- [ ] **Identify your real file domains.** The disjoint slices owners will hold (data / UI / prose /
      config…). These become your owner agents. ([`03` slicing roles](03-subagent-kit.md#how-to-slice-roles))
- [ ] **List the deliberate non-choices.** What you're choosing *not* to use (no database, no wrapper
      lib X), and why. ([`02`](02-claude-md-template.md#state-the-deliberate-non-choices))
- [ ] **Note the environment's constraints.** Egress limits, what renders only on deploy, toolchain
      gotchas. ([`06`](06-scope-phasing-and-comms.md#document-the-environments-constraints-up-front))
- [ ] **Settle the IP/legal posture** if any third-party material is involved. ([`06`](06-scope-phasing-and-comms.md#legal--ip-posture-as-a-first-class-rule))

---

## Phase 1 — Write `CLAUDE.md` (the constitution)

- [ ] Copy the skeleton from [`02`](02-claude-md-template.md#the-skeleton-copy-this) into `CLAUDE.md`.
- [ ] Fill: **Scope discipline** (first!), **Stack**, **Architecture rules** (defining invariant
      first), **Code style**, **Workflow**, **Commands**, **Specialized agents** (stub for now),
      **Engineering lessons** (start empty — the retro fills it).
- [ ] Delete the `<!-- … -->` annotations once filled.
- [ ] Keep it tight — it's always-on context.
      ([`02`](02-claude-md-template.md#a-note-on-claudemd-vs-design-docs))

---

## Phase 2 — Set up verification (the gauntlet) *before* writing features

> Validators and the gauntlet come **before** the artifacts they guard — that's the whole point.
> ([`04`](04-verification-and-validators.md#validators-as-gates--written-before-the-artifact-they-guard))

- [ ] Wire the named scripts in your manifest: `«typecheck»`, `«lint»`, `«build»`, `«test»`, and a
      `«validate:*»` for each artifact that needs more than types/tests.
- [ ] **Write the domain validator(s) first.** Check placement/magnitude/relationships, not just
      shape; include a hard outer limit.
      ([`04`](04-verification-and-validators.md#validators-as-gates--written-before-the-artifact-they-guard))
- [ ] **Add failing-fixture regression tests** that feed each validator known-bad input and assert it
      rejects them. ([`04`](04-verification-and-validators.md#protect-the-validator-with-a-failing-fixture-regression-test))
- [ ] **Write the cross-reference check** for every cross-domain relationship your project has, and
      put it in `validate:*` / CI. ([`04`](04-verification-and-validators.md#the-cross-reference-check-after-integration))
- [ ] **Add CI** mirroring the gauntlet in fail-fast order, with the `concurrency` cancel block.
      ([`04`](04-verification-and-validators.md#ci-mirrors-the-gauntlet))
- [ ] **Add the `SessionStart` hook** in `.claude/settings.json` so cloud/web sessions arrive ready —
      install deps and run one fast check:

      ```json
      {
        "hooks": {
          "SessionStart": [
            { "matcher": "*", "hooks": [
              { "type": "command", "command": "«install && a fast check, e.g. typecheck»" }
            ]}
          ]
        }
      }
      ```

---

## Phase 3 — Define the first agents

> Don't build the whole roster at once. Start with the owners for your real file domains plus the
> retrospective agent; add auditors as claims worth checking accumulate.
> ([`03`](03-subagent-kit.md#how-to-slice-roles))

- [ ] **One read-write owner per file domain**, from [Template A](03-subagent-kit.md#template-a--a-read-write-owner).
      Each: `memory: project`, minimal `tools:`, restates the global guardrails, names its verify
      step (and an MCP screenshot server if it owns UI).
- [ ] **The `retrospective` agent** (edits only the log + `CLAUDE.md`), from
      [`05`](05-self-improvement-loop.md#run-it-as-a-command-or-a-dedicated-agent). Set this up early —
      it's the keystone.
- [ ] **Read-only auditors as needed** (citation auditor, ground-truth QA), from
      [Template B](03-subagent-kit.md#template-b--a-read-only-auditor). **No `Edit`/`Write`**; report-first;
      cheap model where the work is mechanical.
- [ ] Update `CLAUDE.md`'s **Specialized agents** index — one line each (slice + owner/auditor).
- [ ] Add **slash commands** for recurring multi-agent flows (at least `/retro`); keep the command
      the *procedure*, the agent the *expertise*.
      ([`03`](03-subagent-kit.md#slash-commands--skills-wrap-multi-step-agent-flows))

---

## Phase 4 — Create the engineering log

- [ ] Create `docs/engineering-log.md` with the header from
      [`05`](05-self-improvement-loop.md#the-log-header-set-this-up-once). Leave the body empty — the
      first retro writes the first entry.

---

## Phase 5 — Run the loop on the first real iteration

- [ ] **Pick a slice of in-scope work.** Confirm it's in the current phase (scope-check).
- [ ] **Plan if it's multi-file**; propose and get approval. One-liner → just do it.
      ([`01`](01-operating-model.md#2-the-orchestrators-self-check-loop))
- [ ] **Delegate to the owner(s)** — in **parallel** if the slices are independent **and** the shared
      contracts (schema, naming, the cross-domain key) are fixed *first*.
      ([`01`](01-operating-model.md#parallel-dispatch))
- [ ] **Integrate**, then run the **cross-reference check**.
      ([`04`](04-verification-and-validators.md#the-cross-reference-check-after-integration))
- [ ] **Run the full gauntlet; show the evidence.** Screenshot for UI; auditor for factual claims.
      Fix root causes only. ([`04`](04-verification-and-validators.md#the-gauntlet))
- [ ] **Surface to the human:** verified result + evidence + any decision needed — concisely.
      ([`06`](06-scope-phasing-and-comms.md#communication-discipline))
- [ ] **Commit** only when asked, with a scoped message that records the evidence; **never push to a
      shared branch un-built.** ([`04`](04-verification-and-validators.md#the-gauntlet))

---

## Phase 6 — Close the iteration with a retro

- [ ] **Run `/retro`** (or the `retrospective` agent).
      ([`05`](05-self-improvement-loop.md#the-procedure-what-retro--the-agent-does))
- [ ] It diffs since baseline, diagnoses **why** each change was needed, **appends** a dated entry to
      the log, and **promotes** only durable rules into `CLAUDE.md` (deduping and **pruning**).
- [ ] Skim the promoted rules: each names a root cause and a do-differently. Prune anything shallow.
      ([`05`](05-self-improvement-loop.md#rule-promotion-criteria))
- [ ] The log entry ends with the HEAD sha analyzed-through, so the next retro resumes there.

→ Then loop back to **Phase 5** for the next iteration. Each pass starts with a smarter `CLAUDE.md`.

---

## The "is it set up?" checklist

A fresh repo has the operating model when **all** of these exist:

- [ ] `CLAUDE.md` — scope-first, with the verify-with-evidence workflow and an (initially empty)
      lessons list.
- [ ] `docs/` — vision/architecture doc with phase boundaries; this `operating-model/` kit; an
      `engineering-log.md` with its header.
- [ ] **Named scripts** for typecheck / lint / build / test / validate.
- [ ] **Domain validator(s)** + **failing-fixture regression tests** + a **cross-reference check** —
      all written *before* the artifacts they guard.
- [ ] `.github/workflows/ci.yml` — mirrors the gauntlet, fail-fast order, concurrency-cancel.
- [ ] `.claude/settings.json` — `SessionStart` hook (install + a fast check).
- [ ] `.claude/agents/*.md` — an owner per file domain, the `retrospective` agent, auditors as
      needed; all `memory: project`, minimal tools, guardrails restated.
- [ ] `.claude/commands/*.md` — at least `/retro`, plus commands for any recurring multi-agent flow.

When every box is checked, the nexus has: a constitution to load, specialists to delegate to, a
gauntlet to gate "done," and a loop to get smarter every iteration — which is the entire kit. Return
to [`README`](README.md) for the map of how the pieces fit.
