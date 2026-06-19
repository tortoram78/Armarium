# CLAUDE.md — Armarium

> Working memory for any agent (human or AI) touching this repo. Read this before writing code.

## What this is

**Armarium** is a deployable web app that stores a person's outdoor gear and recommends what to
pack for a trip. The hard part is **not** the CRUD or the UI — it is modeling gear richly enough
that packing recommendations *emerge* from reasoning over the model, instead of being hardcoded.

It is a **general-purpose** product: it must work for **any user, any gear domain, and any trip** —
not one person's closet or one canonical hike. The specific seed gear/items and trip presets in this
repo are **prototype data and test fixtures**, never the scope. Recommendation logic is derived from
structured trip conditions (see ADR-0005), never hardcoded per trip.

Built **bottom-up** in three layers. The foundation is the priority; the recommendation layer sits
on top last.

- **Layer 0 — Data foundation.** A faceted, multi-dimensional model of gear + materials.
- **Layer 1 — Analysis layer (THE CORE, most of the value).** An LLM-driven classification pipeline
  that places any garment onto the dimensions/facets. Runs at ingest, validated to a schema, stored.
- **Layer 2 — Recommendation layer.** Trip planning + kit recommendation + gap analysis, expressed
  as queries/reasoning **over** Layers 0–1.

## Guiding principle (load-bearing — do not violate)

**Do NOT hardcode category buckets.** Model **DIMENSIONS / FACETS** (function/purpose,
conditions-fit, material behavior, layering role, active-vs-static, technical-vs-lifestyle,
packability, etc.). Items occupy **many facets at once**. Grouping and recommendations are
**emergent queries / reasoning over the facet space**, not fixed enums. The classification that maps
a garment onto facets is done by **LLM analysis at ingest**, validated to a schema, then stored.

If you find yourself writing `enum Category { BaseLayer, MidLayer, ... }` and routing logic off it,
stop — that is the anti-pattern this project exists to avoid.

## Repository as a living knowledge base (load-bearing)

This repo is **its own knowledge source**, not just code. Armarium is developed with heavy
multi-agent research and design swarms; that work produces a lot of valuable reasoning. Research,
agent outputs, design rationale, and progress are **durable artifacts committed to the repo**, never
left to evaporate with a session. A future contributor (human or AI) should be able to reconstruct
**what** we built and **why** by reading the repo alone.

- **Capture, don't discard.** Every investigation, swarm output, search finding, or design decision
  becomes a committed markdown doc under `docs/`. When an agent produces a structured artifact, it
  lands in the repo and is committed and pushed (the remote container is ephemeral — uncommitted work
  is lost).
- **Map of the knowledge base:** see `docs/README.md`.
  - `docs/decisions/` — Architecture Decision Records (ADRs): one file per load-bearing decision.
  - `docs/phase0/` — design/discovery swarm artifacts (`investigation/`, `architectures/`, `audits/`).
  - `docs/progress/` — dated progress reports / session logs (the project's narrative history).
  - `docs/knowledge-base/` — curated, durable domain knowledge distilled from the above.
  - `DESIGN.md` (root) — the integrated Phase 0 design.
- **Curate, don't dump.** Supersede artifacts (mark + link forward), don't silently delete; keep
  indexes and ADRs current so the trail stays coherent.

## Stack (DECIDED — do not substitute without asking)

- **Next.js (App Router) + TypeScript**
- **Tailwind + shadcn/ui**
- **Postgres on Supabase** via **Drizzle ORM** (+ `drizzle-kit`)
- **Zod** for all I/O and **LLM-output validation**
- **`@anthropic-ai/sdk`** — server code only, never shipped to the client
- **pnpm**
- Deploy on **Vercel**

## Load-bearing rules (violating any of these is a bug)

1. **Validated evidence only.** LLM calls return **EVIDENCE-shaped structured data** validated against
   a Zod schema **before any use**. Unvalidated model text **never** reaches the DB or the UI.
2. **Never fabricate specs.** Unknown fields are `null` **with a confidence/source marker**, never
   guessed. A wrong spec is worse than a missing one.
3. **Framework-agnostic core.** All enrichment / classification / reasoning logic lives in `src/core/`
   — **pure, no Next.js imports** — so the same core can later back an MCP server. The web API is just
   one caller. (Tip: `src/core/` may import `zod` and the Anthropic SDK, but **must not** import
   `next/*`, `react`, server actions, or DB-connection singletons; it receives its dependencies.)
4. **`user_id` from day one.** Every user-owned table has `user_id`. v0 = a single fixed user + a
   one-password gate. **Do not build real auth; do not block it either.**
5. **One model-id constant.** The Anthropic model id lives in **one config constant**
   (default `"claude-sonnet-4-6"`), swappable. No model strings scattered through the code.
6. **Persist knowledge to the repo.** Capture research/agent output/decisions as committed markdown;
   don't let it evaporate with the session (see *Repository as a living knowledge base*).

## Multi-agent orchestration rules

- **Parallelize investigation; serialize integration.** Spawn parallel subagents for any work with
  independent, separable facets. Each subagent returns a **structured markdown artifact** (write it to
  a file under `docs/phase0/` or the relevant dir); a **lead agent integrates**.
- **Be exhaustive in discovery.** Run as many parallel investigation agents as the problem has
  independent facets. Convergence is enforced by a **synthesis + coherence gate**, not by limiting
  agent count.
- **Gates, not vibes.** No phase ends except at a **coherence gate** (one integrated artifact, no
  silent contradictions) followed by the **verification gate** (below). If independent agents diverge
  on something load-bearing, **surface the decision to the user** rather than silently picking.

## Phasing

- **Phase 0 — Design / Discovery (current).** Determine the best faceted data model + material model +
  classification approach via a swarm. Deliverables: `DESIGN.md`, a **proposed** Drizzle schema (in the
  doc, not migrated), and the classification rubric/prompt. **STOP for approval. No migrations or
  feature code.**
- **Phase 1 — Foundation + analysis pipeline.** Approved schema + migrations + seed script; the
  analysis/classification pipeline in `src/core/`; seed the canonical catalog + materials and classify
  through the real pipeline.
- **Phase 2 — Recommendation / trip layer.** Closet UI (emergent facet grouping), Plan UI (NL + structured
  conditions → reasoning → picks + gaps), saved trips.

## Out of scope for v0 (STOP and ask if a task seems to need one)

Barcode/photo/URL enrichment; weather API; real multi-user auth/sharing; military/NSN domain; native
app; image upload pipeline; catalog suggestions to fill gaps.

## Commands

> The project is not scaffolded yet (Phase 0 is design-only). These are the intended commands; they
> become live in Phase 1.

```bash
pnpm install           # install deps
pnpm dev               # run Next.js dev server
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint / next lint
pnpm build             # next build
pnpm test              # unit tests (vitest)
pnpm db:generate       # drizzle-kit generate (migrations)
pnpm db:migrate        # apply migrations
pnpm db:seed           # seed canonical catalog + materials + inventory
```

## Verify-before-done workflow (every phase that produces code)

A task is **not done** until all of these are green **and the output is pasted into the reply**:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Never declare something done without pasted green verification output. Phase 0 produces design docs,
not code, so its gate is the **coherence gate** (one integrated `DESIGN.md`, no silent contradictions)
— there is nothing to typecheck/build yet.

**Phase 2 end-to-end check:** seed; add a new item by name and confirm analysis fills facets with
unknowns `null`; plan *"Mount Marcy, mid-June, alpine summit, cold and windy, long day hike"* and
confirm it recommends from the 3 owned items **and** flags the missing waterproof shell + packable
insulation as gaps.

## Conventions

- TypeScript strict. Zod schemas are the single source of truth for shapes; derive TS types with
  `z.infer`.
- Core stays pure; side effects (DB, network, Anthropic calls) are injected or live at the edge.
- Prefer small, composable facet queries over monolithic recommendation functions.
