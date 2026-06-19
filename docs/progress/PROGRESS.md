# Progress Log

Reverse-chronological. Each entry is a meaningful checkpoint. This is the narrative spine of the
project; skim it to catch up fast.

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
