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
