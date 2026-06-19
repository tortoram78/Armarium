# Progress Log

Reverse-chronological. Each entry is a meaningful checkpoint. This is the narrative spine of the
project; skim it to catch up fast.

## 2026-06-19 (synthesis) — Phase 0 coherence gate: DESIGN.md + STOP for approval

- **Audit C → SOUND-WITH-FIXES.** Strength: the `item_capabilities` 3-state status
  (`satisfies|fails|blocked_unknown`). Critical fix: cache can go silently stale when a *capability
  predicate* changes → add `capability_version` (checked with `facet_hash`); make capability gates
  hot-only; `item_kind` must not be authoritative.
- **All three audits in → coherence gate passed.** Wrote the single integrated artifact
  [`DESIGN.md`](../../DESIGN.md) + the [classification rubric/prompt](../phase0/classification-rubric.md)
  + [ADR-0003](../decisions/0003-facet-ontology-and-data-model.md) (storage architecture) and
  [ADR-0004](../decisions/0004-llm-classification-contract.md) (classification contract).
- **Recommended design:** capability-first **hybrid** backbone (Architecture C) — typed hot facets +
  composable optional domain groups (`item_insulation/sleep/shell/carry/footwear`) + Zod-validated JSONB
  tail — **governed by a facet registry** (Architecture B's best idea) that generates the Zod validators
  and a CI facet-key lint, **wearing** A's null-first `Evidence<T>`/`HardFact<T>` shapes. Capabilities
  are first-class 3-state predicates; unknown safety inputs ⇒ `blocked_unknown` ("verify"), never a
  silent pass. No authoritative category. Every auditor's top fix folded in (DESIGN.md §10).
- **Verified by design walkthrough:** Marcy query against the 3 owned items → Terre Planing usable as a
  caveated approach layer, and **exactly the 3 intended gaps** (waterproof/windproof shell, packable
  wearable insulation, adequate wicking base). Terre Planing can never count as rain protection
  (`waterproofness=dwr`); Kelty "30" stored with `standard=null, confidence=low` (never upgraded).
- **STOP — awaiting approval.** One load-bearing fork surfaced to the user: storage architecture
  (approve hybrid vs prefer pure-A / pure-B). No migrations or feature code until approved.
- Phase 0 has no code yet, so its gate is the **coherence gate** (one integrated DESIGN.md, no silent
  contradictions) — `pnpm typecheck/lint/build/test` become live in Phase 1.

## 2026-06-19 (later) — Phase 0 Waves 2–3: competing architectures + adversarial audits

- **Wave 2 — three blind competing architectures** written to `docs/phase0/architectures/` (Opus):
  - **A — typed relational:** universal typed columns + per-domain extension tables; capabilities as
    pure `src/core` functions computed at query time.
  - **B — facet-graph / EAV:** every fact is a row in `item_facets` validated against a
    `facet_definitions` ontology; "domains" are emergent queries; adding a facet = INSERT, no migration.
  - **C — capability-first hybrid:** ~14 load-bearing facets as typed columns + a Zod-validated JSONB
    "cold bag"; first-class capabilities with a 3-state `satisfies | fails | blocked_unknown`.
  - **Convergence (strong signal):** all three make DWR/water-resistant *structurally* unable to count
    as rain protection, and all three surface exactly the 3 canonical Marcy gaps. They diverge on the
    **storage architecture** (the load-bearing decision synthesis must resolve).
- **Wave 3 — adversarial audits** (`docs/phase0/audits/`, one per proposal):
  - **A → SOUND-WITH-FIXES:** single-domain discriminated union loses safety columns on multi-domain
    gear (insulated waterproof boot) → make `itemDomains` an array; close `z.string()` multi-label
    enums; keep ordered-enum levels in `src/core`, not Postgres declaration order. **Harvest:**
    null-first `Evidence<T>`/`HardFact<T>` wrappers (cleanest unknown-handling seen).
  - **B → SOUND-WITH-FIXES:** type-safety is aspirational (JSONB is `unknown` to TS) → needs
    registry-driven codegen + a CI lint asserting every facet-key literal exists in the ontology;
    don't *silently discard* novel LLM-extracted facets → a `pending_facets` review queue; the
    "no migration" claim is really "no column-schema migration" (enum-level changes still need data
    migration). **Harvest:** the `isUnknown` 3-state row + the hard-fact-source guard (can't be
    bypassed by prompt wording).
  - **C → audit running.**
- **Emerging synthesis direction (to be finalized after audit C):** a **hybrid backbone (C)** —
  capability-first, typed hot facets + governed JSONB long tail — that **harvests** A's null-first
  evidence shapes and B's facet-registry/ontology governance (the registry de-risks C's typed/JSONB
  promotion boundary: promotion changes only physical storage, never a facet's definition).
- **Next:** audit C → synthesize `DESIGN.md` + proposed Drizzle schema + classification rubric →
  surface the storage-architecture decision to the user → **STOP for approval.**

## 2026-06-19 — Phase 0 kickoff: knowledge base + design swarm

- Wrote [`CLAUDE.md`](../../CLAUDE.md): stack, three-layer architecture, guiding principle (facets,
  not categories), load-bearing rules, orchestration rules, out-of-scope, commands, verify-before-done.
- Established the repo as a **living knowledge base** (`docs/` structure, ADRs, this log) per explicit
  direction: capture all research/agent output as committed markdown, never discard it.
- Recorded [ADR-0001](../decisions/0001-faceted-data-model.md) (faceted data model) and
  [ADR-0002](../decisions/0002-repository-as-knowledge-base.md) (repository as knowledge base).
- Launched **Wave 1** of the Phase 0 discovery swarm: **9 parallel investigation agents**
  - 7 domain agents: base layers · mid/insulation · shells/wind · sleeping bags · packs · footwear · accessories
  - 1 decision-driver agent (reasons backward from real planning queries to find load-bearing facets)
  - 1 material-behavior agent (composition → behavior; the item↔material relationship model)
  - Each writes a structured artifact to [`docs/phase0/investigation/`](../phase0/investigation/).
- **Next:** Wave 2 (3 blind competing-architecture proposals) → Wave 3 (3 adversarial audits) →
  synthesis into `DESIGN.md` + proposed Drizzle schema + classification rubric → **STOP for approval.**

### Emerging cross-cutting signals (from Wave 1 — to reconcile at synthesis)
- A shared **insulation-behavior** sub-model (fill type / power / treatment → wet performance,
  warmth-for-weight, packability) should be reused by *both* insulated garments and sleeping bags.
- **Moisture management / warmth-when-wet** is safety-critical and spans every textile domain
  ("cotton kills" → the hemp/cotton henley collapses when wet).
- **waterproof ≠ water-resistant/DWR** must be distinct facet values; unknown waterproofness = `null`
  (never assumed waterproof). The Terre Planing is the canonical danger case.
- Several facets want to be **multi-label** (layering role, function/purpose, body-zone-covered) — the
  buff and the R1 Air break single-value categories.
- Ambiguous **ratings** (sleeping-bag "30", garment warmth) must store the number *and* the
  standard/confidence separately; never upgrade a marketing number to a certified rating.
