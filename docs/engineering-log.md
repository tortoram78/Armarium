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

---

## 2026-06-20 — Verify→correct→re-plan loop, self-building classification cache, Phase 3 greenlight (analyzed through `c77884b`)

Covers commits `5f18bac` (core: correction engine + re-plan spine), `7ab1fbe` (web: verify loop UI +
end-to-end proof), `2c77699` (feat: self-building classification cache), `a80937f` (db: durable Postgres
cache + docs), and `c77884b` (docs: Phase 3 scope greenlight). Baseline: `edac40f`.

### Verify→correct→re-plan loop closes the feedback cycle
- **Delta:** `src/core/corrections.ts` — `applyUserCorrections()` builds `source:"user"` envelopes so a
  corrected hard fact (fill_power, temp_rating, upf, seam_sealing, capacity) is AUTHORITATIVE and
  survives the `hardFact` demotion guard, actually moving capability outcomes. `replanTrip()` re-runs a
  saved trip against the current closet and persists the new result. UI: FacetEditor is now
  registry-driven (EDITABLE_UNIVERSAL/GROUPS/MULTILABEL), trip detail shows "Re-plan with current
  closet," and each uncertain/blocked item deep-links to `/items/[id]?edit=1`. Service-level integration
  test (`test/verify-loop.integration.test.ts`) pins the payoff: correction propagates through re-plan,
  result is persisted.
- **Why:** Phase 2 could surface gaps ("verify") but offered no path to resolve them — the loop was open.
  Connecting corrections → capability re-evaluation → saved-result update closes it end to end.
- **Lesson:** an open feedback loop (gap surfaced, no fix path) has zero payoff. Design the full cycle —
  detect → correct → re-evaluate → persist — before shipping the detection UI.
- **Promoted:** no (architectural principle; the specific pattern is already encoded in the design;
  the general "close the loop" rule is too abstract without a crisper formulation than what's already
  in the workflow rule about evidence and root causes).

### MISS → NOTICED: capability/outcome test initially asserted the wrong lever
- **Delta:** the integration test for the verify loop originally cleared `upf` alone to "disprove"
  sun_protection, but the gate is `upf>=30 OR function_purpose⊇"sun_protection"` — so the test passed
  with the item still in picks (the second lever was still set). The test was then written to clear
  BOTH levers (`universal.upf: "unknown"` AND `multilabel.function_purpose: []`), which correctly
  removes the item. The initial version would have asserted the right outcome for the wrong reason.
- **Why:** the gate predicate was assumed from memory rather than read from `src/core/capabilities.ts`.
  An OR-predicate with two arms only fails when ALL arms fail; clearing one arm while leaving the other
  is not a real correction.
- **Lesson:** **when a test asserts a capability outcome, read the actual gate before asserting.**
  Capability gates are often OR-predicates across multiple facets; clearing one facet may leave the item
  still satisfying the gate through another arm. Assert against the full real predicate.
- **Promoted:** yes (new; broadly applicable to any capabilities test, now or in Phase 3).

### Self-building classification cache — corrections feed the KB
- **Delta:** `src/core/cache.ts` defines `normalizeCacheKey` (accent-fold, lowercase, punctuation→space)
  and the `CachedClassification` shape. A `ClassificationCacheRepository` port backs two impls:
  in-memory (seeded from the corpus, so known items hit instantly) and Postgres (`classification_cache`
  table, ADR-0007). `classifyToDraft` consults the cache before calling the LLM; `confirmDraft` and
  `updateItemClassification` upsert `source:"user"` entries so every correction improves the next add.
  Three new tests pin: cache hit before classifier, cache-before-LLM ordering, correction-feeds-KB.
- **Why:** repeat adds were re-deriving the same classification at LLM cost, and user corrections were
  ephemeral — the next add of the same item regressed to the original inferred facets. A name-keyed KB
  makes every correction durable and shared.
- **Lesson:** for any derived-data system where user corrections exist, route corrections back into the
  source so future derivations inherit them — don't let a cache diverge from user intent.
- **Promoted:** no (the single-source-of-truth principle is implicit in Architecture rule #2; the
  specific cache-feedback pattern is too narrow to stand as a top-level rule).

### Docs fixed: `deploy.md` claimed offline classifier returns a "minimal default" — it throws
- **Delta:** `deploy.md` stated "any unknown item receives a minimal default classification." The
  Postgres-cache commit (`a80937f`) corrected it to "any unknown item causes `classifyOffline` to throw
  an error directing the user to set `ANTHROPIC_API_KEY`. No default or fabricated classification is
  returned." The code's actual behavior (the throw) was already present; the doc was wrong from the
  prior iteration.
- **Why:** the doc was written before the offline behavior was pinned precisely, and the cache commit
  author noticed the discrepancy when writing the note "the offline classifier throws on novel items"
  in the commit message.
- **Lesson:** **verify doc claims about fallback/error paths against the code before shipping.** Docs
  about "what happens when X is absent" drift silently — a quick read of the relevant function
  (or a single test run) is the check.
- **Promoted:** yes (new; broadly applicable whenever documenting fallback or absence behavior; the
  existing "commit research as markdown" rule says to write docs, but doesn't say to verify them against
  the code).

### Phase 3 greenlit and sequenced in CLAUDE.md + roadmap.md
- **Delta:** `CLAUDE.md` Scope discipline section updated from "Phase 2 only" to "Phase 2 complete,
  Phase 3 approved — (1) Supabase Auth + RLS → (2) URL enrichment → (3) weather auto-conditions →
  (4) catalog gap-fill suggestions." `docs/roadmap.md` added with sequenced phases and explicit
  provider decisions gated at the start of each step.
- **Why:** the user greenlit Phase 3 after reviewing the complete Phase 2 including the verify loop and
  KB. Committing the sequence to the repo prevents phase-boundary drift and makes the next-action
  unambiguous for any agent reading CLAUDE.md.
- **Lesson:** commit scope decisions immediately as they happen (existing rule; confirmed effective here).
- **Promoted:** no (confirms existing "commit research/decisions as markdown" lesson).
