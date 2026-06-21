# Armarium

**Armarium** is a deployable web app that stores a person's outdoor gear and recommends what to pack
for a trip. It is **general-purpose** — any user, any gear domain, any trip; the seed gear/trip presets
are prototype data, never the scope. The hard part is modeling gear richly enough that packing advice
*emerges* from reasoning over facets, instead of being hardcoded.
**Read [`DESIGN.md`](DESIGN.md) before planning any feature** — it holds the facet ontology, data model,
classification contract, and the phase boundaries.

## Operating model — the ONLY way we work (read first)

This repo runs under **the Operating Kit in [`docs/operating-model/`](docs/operating-model/README.md).
It is the single, non-negotiable operating model — do not substitute another.** In one screen:

- **You are the nexus.** One orchestrator that codes *and* reviews, **delegates** matching work to the
  specialized sub-agents, validates every input/output, **self-checks many times**, and brings the
  human **only verified results + the evidence** (command output / screenshot) — never raw, unverified
  output or step-by-step narration. ([`01`](docs/operating-model/01-operating-model.md))
- **Delegate to persistent specialists** in `.claude/agents/` — read-write **owners** (one file-domain
  each) and read-only **auditors** (report, never edit). Run independent slices **in parallel**, but
  **fix shared contracts/schemas/naming before any parallel write**; then integrate and run the
  cross-reference check. ([`03`](docs/operating-model/03-subagent-kit.md))
- **Verify with evidence, always** — the gauntlet gates every "done" (Workflow below). Fix **root
  causes, never suppress** a check. ([`04`](docs/operating-model/04-verification-and-validators.md))
- **Close every iteration with `/retro`** → append the diagnosis to `docs/engineering-log.md` → promote
  only durable rules into *Engineering lessons* below. This is how each iteration starts smarter.
  ([`05`](docs/operating-model/05-self-improvement-loop.md))

## Scope discipline — read this second

- **Phase 2 is complete** — the usable web app (closet, add-by-name → classify → review/save,
  plan-a-trip, saved trips) plus the **verify→correct→re-plan loop** and the **self-building
  classification cache**.
- **Phase 3 is APPROVED** (greenlit by the user 2026-06-20) — build in this sequence, each gated on
  its own `DESIGN.md` update + ADR(s) + the one provider decision FIRST: **(1) real auth + multi-user
  (Supabase Auth + RLS) → (2) manufacturer URL enrichment → (3) weather auto-conditions → (4) catalog
  gap-fill suggestions.** See [`docs/roadmap.md`](docs/roadmap.md).
- **Unlocked backlog** (allowed to propose/build when prioritized; the hard block was lifted
  2026-06-21 per ADR-0009): image-upload / photo enrichment, barcode enrichment, military/NSN
  domain, and a native app. Each still requires its own `DESIGN.md` update + ADR(s) + the
  dependency/infra decision before implementation. **Barcode is deferred** until after Phase 3
  step 2 (manufacturer URL enrichment) and is better suited to a native app than a browser tool.
  Military/NSN and a native app are large strategic pivots — each needs a dedicated scoping ADR
  before any work begins.
- Anything that would **add a dependency or introduce new infrastructure: still ask first** (including
  the auth/enrichment/weather/catalog provider choices above). Default to a 20-second question.

## Stack (DECIDED — do not substitute without asking)

- **Next.js (App Router) + TypeScript**, **Tailwind + shadcn/ui**, **pnpm**, deploy on **Vercel**.
- **Postgres on Supabase** via **Drizzle ORM** (+ `drizzle-kit`); **Zod** for all I/O and LLM-output
  validation; **`@anthropic-ai/sdk`** in server code only.
- **Deliberate non-choices:** v0 persistence runs through a **repository port** with an **in-memory
  impl** (no DB needed to run) and a Postgres impl when `DATABASE_URL` is set. Real auth, weather, and
  URL enrichment are now **Phase 3 (approved & sequenced — see Scope discipline)**; until each is built,
  the **one-password gate stands**. Image/photo/barcode enrichment and a native app are unlocked backlog (each gated on its own ADR + dep/infra decision before any build begins; see Scope discipline).

## Architecture rules (violating any is a bug)

1. **No hardcoded buckets or hardcoded trips — the defining invariant.** Model DIMENSIONS/FACETS; items
   occupy many facets at once. Grouping *and* trip-requirements are **emergent queries** over the facet
   space (closet grouping = facet queries; recommendations = `conditions → capabilities`). If you write
   `enum Category {…}` and route off it, or special-case one trip, **stop** — that is the anti-pattern
   this project exists to avoid.
2. **Validated evidence only.** LLM calls return EVIDENCE-shaped data validated by Zod **before any
   use**; unvalidated model text never reaches the DB or UI. **Never fabricate specs** — unknown = `null`
   with a confidence/source marker; an inferred hard fact is mechanically demoted to `null`. A wrong spec
   is worse than a missing one. (Authoritative/manufacturer data beats inference.)
3. **Framework-agnostic core.** All enrichment/classification/reasoning lives in `src/core/` — pure, no
   `next/*`/React/DB-singletons; it receives its dependencies (may import `zod` + the Anthropic SDK) so
   the same core can later back an MCP server.
4. **`user_id` from day one** on every user-owned table/row. v0 = one fixed user + a one-password gate.
5. **One model-id constant** (`MODEL_ID`, default `"claude-sonnet-4-6"`), swappable; no model strings
   scattered.
6. **Repo as a living knowledge base.** Research/agent output/decisions are committed markdown under
   `docs/` (ADRs, progress, design); never let work evaporate with a session. Keep dependencies minimal.

## Code style

- TypeScript strict; Zod schemas are the single source of truth for shapes (`z.infer` the types).
- ES modules, named exports, functional components. Small composable units over clever abstractions.
- Otherwise standard Next/TS conventions — these are the only deviations worth stating.

## Workflow (the gauntlet — non-negotiable)

- **Plan before multi-file changes.** Propose a plan, get approval, then edit. One-liners: just do it.
- **Verify before "done," and SHOW the evidence** (paste output / screenshot — never assert green). Run,
  cheapest-first: `pnpm typecheck` → `pnpm lint` → `pnpm test` (prefer one relevant test in-loop) →
  `pnpm build` (**hard gate**). After multi-agent/multi-file integration, run the **cross-reference
  check** (`pnpm test` covers the registry↔classification + capability-gate invariants). For any UI
  change, render it and **check the screenshot against intent**.
- **Fix root causes, not symptoms.** Never edit a validator/schema or `@ts-ignore` to go green.
- **Never push un-built to the shared branch.** Every pushed commit passes the production build locally
  first (docs/config-only commits exempt). Commit with scoped messages that record the evidence; develop
  on the designated branch.

## Commands

```bash
pnpm install      # deps
pnpm dev          # dev server
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
pnpm test         # vitest run  (unit + validators + cross-reference checks)
pnpm build        # next build  — HARD GATE: must pass before any task is done
pnpm db:generate  # drizzle-kit generate (migrations)
pnpm db:migrate   # apply migrations        (needs DATABASE_URL)
pnpm db:seed      # seed catalog + materials + inventory (needs DATABASE_URL [+ ANTHROPIC_API_KEY])
```

## Specialized agents (delegate to these; index — full prompts in `.claude/agents/`)

Each carries `memory: project`, minimal tools, and restates these guardrails. Delegate the matching
slice rather than doing it ad hoc.

- **core-reasoning-owner** — owns `src/core/**` (facets, evidence, classification, capabilities,
  recommend, closet). Verifies with `pnpm typecheck && pnpm test`.
- **schema-db-owner** — owns `src/db/**` + `drizzle/**` + the repository impls. Verifies with
  `pnpm typecheck && pnpm db:generate`.
- **web-ui-owner** — owns `src/app/**` + `src/components/**`. Verifies with `pnpm build` + a screenshot.
- **docs-owner** — owns `docs/**` (ADRs, DESIGN.md, progress, knowledge-base). No code.
- **facet-integrity-auditor** *(read-only)* — audits the load-bearing invariants (unknown=null, hard-fact
  demotion, capability-gates-hot, registry↔classification coverage, no hardcoded category/trip). Reports.
- **retrospective** — edits **only** `docs/engineering-log.md` + this file's *Engineering lessons*.

## Engineering lessons (self-improving — curated, pruned; full detail in `docs/engineering-log.md`)

Run **`/retro`** at the end of every iteration. Promote only durable, broadly-applicable rules here.

- **A passing canonical test is not proof of generality.** We let recommendations collapse onto one
  trip (Marcy); fixed by deriving requirements from structured conditions. For any "reasoning" feature,
  add cross-archetype tests (≥3 distinct cases) so the engine can't be secretly hardcoded.
- **When a test asserts a capability outcome, read the actual gate first.** Capability gates are often
  OR-predicates across multiple facets; clearing one arm may leave the item satisfying the gate through
  another, making the test pass for the wrong reason. Assert against the full real predicate.
- **Keep secrets/infra out of the gates.** DB + Anthropic clients are lazy/injected so
  `typecheck/lint/build/test` are green with no `DATABASE_URL`/`ANTHROPIC_API_KEY`; tests use a mock
  client + an offline classifier. Never make a gate depend on a secret.
- **Unknown is first-class; specs are never fabricated.** Enforce it mechanically (the `hardFact`
  demotion guard) and test it with failing fixtures — not by prompt wording alone.
- **Verify doc claims about fallback/error paths against the code.** Docs about "what happens when X
  is absent" drift silently. Check the actual function (or run it) before shipping — a wrong fallback
  claim misleads operators and agents alike.
- **Commit research/decisions as markdown as you go** (ADRs, progress, design); the remote container is
  ephemeral and uncommitted work is lost.
- **`pnpm build` passing is necessary, not sufficient for RSC routes.** Event-handler props on Server
  Components compile and build cleanly but crash at render (HTTP 500). For any new or changed App Router
  route, probe it live (`next start` + assert HTTP 200 + spot-check content). Interactive behaviour
  (onClick, onSubmit, confirm dialogs) always belongs in a `"use client"` component.
- **Scope `git add` to your own files; never use `-A` while a delegated writer is active.** Stage by
  explicit path, or commit before dispatching writer agents and re-stage only after they settle. An
  opportunistic sweep captures in-flight partial writes from concurrent agents.
