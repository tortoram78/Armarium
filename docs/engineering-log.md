# Armarium Engineering Log (self-improving)

Append-only retrospective log. After each iteration, the **`retrospective`** agent (or **`/retro`**)
diffs what changed since the last entry, diagnoses *why*, records the durable lesson here, and promotes
broadly-applicable rules into `CLAUDE.md`'s "Engineering lessons" section. Full detail lives here;
CLAUDE.md holds only the distilled rules.

Entry format per change — **Delta** · **Why** · **Lesson** · **Promoted**.

---

## 2026-06-19 — Phase 0 design + Phase 1 foundation + Phase 2 UI start (analyzed through `32eb66d`)

First retrospective. Covers the project from the empty repo through the in-progress Phase 2 UI, written
as we adopt the Operating Kit. The keystone learnings are promoted to `CLAUDE.md`.

### Phase 0 ran as a 16-agent swarm and converged on a hybrid faceted model
- **Delta:** 9 investigation agents → 3 blind competing architectures → 3 adversarial audits → one
  integrated `DESIGN.md` (capability-first hybrid backbone, facet registry, composable domain groups),
  ADRs 0001–0005, ~6.7k lines of committed artifacts. The user approved the hybrid + all five group stubs.
- **Why:** the load-bearing risk is the data model; competing-then-auditing surfaced the real fork
  (storage) and let synthesis harvest the best of each (A's evidence shapes, B's registry, C's capability
  layer) while every auditor's top fix was folded in.
- **Lesson:** for a load-bearing design decision, parallelize investigation, run *blind* competing
  proposals + adversarial audits, then synthesize — and surface the one genuine fork to the human rather
  than silently picking.
- **Promoted:** no (process captured in the Operating Kit's parallel-dispatch + design-before-build).

### The defining invariant: facets, not categories — and not hardcoded trips
- **Delta:** items are bundles of facet values; closet grouping is a query (`src/core/closet.ts`),
  recommendations derive from `conditions → capabilities` (`recommend/derive.ts`). No `Category` enum.
- **Why:** real gear is multi-purpose (the buff, the R1 Air); a category model forces one false truth and
  hardcodes the advice we want to derive.
- **Lesson:** model dimensions; let grouping/recommendation emerge as queries.
- **Promoted:** **yes** (Architecture rule #1).

### MISS → FIX: the recommender collapsed onto one trip (Marcy)
- **Delta:** the first recommender hardcoded a "Mount Marcy" required-capability set; the canonical test
  passed but no other trip worked. Fixed by `TripConditions` + `deriveRequirements()` + cross-archetype
  tests (desert/rain/casual/alpine each derive different requirements). (ADR-0005.)
- **Why:** optimizing for the one verification case made the engine pass while being secretly
  non-general — the same anti-pattern as category buckets, one layer up. The user caught it ("too small
  scoped").
- **Lesson:** **a passing canonical test is not proof of generality.** For any reasoning feature, add
  ≥3 distinct-archetype tests so the engine can't be hardcoded to the demo.
- **Promoted:** **yes** (Engineering lessons).

### The four gates stay green with no DB and no API key
- **Delta:** DB client + Anthropic client are lazy/injected; tests use a mock Anthropic client and an
  offline classifier; in-memory repository seeded from the corpus. `typecheck/lint/build/test` all green
  in a sandbox with neither secret.
- **Why:** a verification gate that needs a secret can't run in CI/sandbox and silently rots.
- **Lesson:** never make a gate depend on a secret; inject clients, provide offline/mocked paths.
- **Promoted:** **yes** (Engineering lessons).

### Unknown is first-class; specs are never fabricated — enforced mechanically
- **Delta:** `Evidence<T>`/`HardFact<T>` with a `hardFact` preprocess that demotes any inferred hard
  fact to `null+unknown`; failing-fixture tests assert it; the Kelty "30" is stored with
  `temp_rating_standard` uncertain (never upgraded to EN/ISO).
- **Why:** a wrong spec produces unsafe recommendations; prompt wording alone can't guarantee honesty.
- **Lesson:** enforce the unknown/no-fabrication rule in code (a guard) and protect it with failing
  fixtures, not by trusting the model.
- **Promoted:** **yes** (Architecture rule #2 + Engineering lessons).

### Knowledge captured as committed markdown throughout
- **Delta:** every swarm artifact, ADR, and progress note is committed under `docs/`; pushed each step.
- **Why:** the remote container is ephemeral — uncommitted reasoning evaporates and gets re-derived.
- **Lesson:** commit research/decisions as you go; the repo is the knowledge base.
- **Promoted:** **yes** (Architecture rule #6 + Engineering lessons).

### Phase 2 UI started, then paused to adopt the Operating Kit
- **Delta:** design-system primitives, one-password gate, app-service, server actions, closet + add
  pages (builds green); paused at the user's request to install the Operating Kit as the operating model.
- **Why:** the user introduced a portable operating model and wants it to govern all further work.
- **Lesson:** when the regime changes, retrofit the constitution (CLAUDE.md), the agents, the gauntlet,
  and this log *before* resuming feature work.
- **Promoted:** no (this entry is the record; the adoption commit will be analyzed by the next retro).

---

## 2026-06-19 — Phase 2 full web app: Postgres repo, NL parser, draft lifecycle, and RSC boundary fix (analyzed through `edac40f`)

Covers commits `0b723e3` (Phase 2 core: web app + Postgres repo + NL parser + draft lifecycle),
`137cfc6` (fix: item-detail 500 — onSubmit across the server/client boundary), and
`edac40f` (docs: PROGRESS + ADR-0006 + deploy.md). Baseline: `32eb66d` (previous retro entry).

### Phase 2 shipped: full web app, Postgres repo, NL trip parser, and review/save draft lifecycle
- **Delta:** complete Phase 2 web app across closet, add-by-name → classify → review/save, plan-a-trip
  (NL + structured conditions → picks + capability gaps + "verify"), and saved trips. Postgres repository
  impl (lossless `classification` jsonb as read source-of-truth + projected hot columns). NL parser with
  offline heuristic fallback (ADR-0006). All four gauntlet gates green; live HTTP 200s and LLM-confirmed
  classification verified. ADR-0006 and deploy.md committed.
- **Why:** the Phase 0/1 foundation (facet model, capabilities engine, in-memory repo) was complete and
  approved; Phase 2 is the first deliverable the user can actually run and deploy.
- **Lesson:** ship end-to-end verticals on a proven foundation rather than layering depth incrementally —
  the in-memory repo let the web app, classification, and Postgres impl develop and gate independently.
- **Promoted:** no (confirms existing architecture and workflow; no new rule warranted).

### MISS → FIX: Server Component passed `onSubmit` to `<form>` — HTTP 500 at render despite clean build
- **Delta:** `/items/[id]` passed `onSubmit={() => confirm("Delete this item?")}` directly on a `<form>`
  inside a Server Component. `pnpm build` passed; `pnpm typecheck` passed. The route returned HTTP 500 at
  render. Fixed by extracting a small `"use client"` `ConfirmButton` that keeps the handler on the client
  side of the boundary. Verified live: GET returns 200, renders correctly, zero boundary errors.
- **Why:** Next.js App Router's RSC boundary constraint — event handler props cannot cross
  server→client — is a runtime invariant, not a compile-time one. TypeScript and the Next.js compiler
  accept the code; the violation only manifests as a render-time crash. `pnpm build` is a build-artifact
  gate, not a runtime-correctness gate.
- **Lesson:** **`pnpm build` passing is necessary, not sufficient.** For any new or changed RSC route,
  probe it live (`next start` + assert HTTP 200 + spot-check rendered content). The specific trap:
  event-handler props (`onClick`, `onSubmit`, etc.) silently compile in Server Components but crash at
  render — any interactive behaviour needs a `"use client"` component wrapper.
- **Promoted:** **yes** — sharpens the existing Workflow gauntlet to make live-probe a named requirement
  for RSC route changes, not just a visual screenshot check.

### Partial file swept into an unrelated fix commit via `git add -A`
- **Delta:** `137cfc6` (the boundary fix) inadvertently included a partial draft of `PROGRESS.md` because
  `git add -A` was run while the docs-owner agent was still writing. The docs commit `edac40f` then
  completed and overwrote it cleanly, so no data was lost — but the fix commit's diff is polluted with
  90 lines of unrelated progress notes.
- **Why:** `git add -A` is a sweep that captures the entire working tree at that instant, including files
  owned by a concurrently-running writer agent. The fix author and the docs agent were both active on the
  same working tree.
- **Lesson:** **scope `git add` to your own files; never use `-A` while a delegated writer agent is
  active.** Stage by explicit path (e.g., `git add src/app/... src/components/...`), or commit before
  dispatching writers and only re-stage after they settle.
- **Promoted:** **yes** — new rule; broadly applicable whenever parallel agents share a working tree.

### In-memory repository is per-process — stateful flow verification needs a shared store
- **Delta:** verifying stateful multi-step flows (classify → review → save → trip result) required
  driving the real UI or connecting to Postgres, because a helper script that seeds the in-memory repo
  can't see a separate `next start` server's store.
- **Why:** the in-memory impl is a correct single-process singleton. The constraint is fundamental to
  the architecture, not a bug.
- **Lesson:** for stateful end-to-end flows, either drive via the real UI (form submits) or use Postgres.
  Scripted seeding only works against the test harness (same process).
- **Promoted:** no (narrow verification-tooling note; doesn't generalise beyond this architecture's
  in-memory/Postgres split).
