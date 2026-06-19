# 0003 — Facet ontology + data model (storage architecture)

**Status:** Proposed (awaiting approval — Phase 0 gate)
**Date:** 2026-06-19
**Supersedes/extends:** [ADR-0001](0001-faceted-data-model.md) (the faceted principle this realizes)
**Full design:** [`DESIGN.md`](../../DESIGN.md)

## Context
ADR-0001 mandates facets, not categories. *How* to physically store a faceted, multi-dimensional,
confidence-bearing model in Postgres/Drizzle is the single most load-bearing engineering decision in
the project. The Phase 0 swarm produced three blind competing architectures, all judged
SOUND-WITH-FIXES by adversarial audit:
- **A — typed relational:** typed columns + per-domain extension tables; capabilities as `src/core`
  functions. Max type-safety; migration-per-facet; single-domain discriminator fights multi-domain gear.
- **B — facet-graph / EAV:** every fact is a row validated against a `facet_definitions` ontology;
  domains emergent; no migration to add a facet. Max extensibility; loses compile-time type-safety;
  ontology-governance burden.
- **C — capability-first hybrid:** load-bearing facets as typed columns + a Zod-validated JSONB tail;
  first-class capabilities with a 3-state `satisfies|fails|blocked_unknown`. Recommendation-shaped;
  typed/JSONB promotion boundary + cache staleness are the risks.

All three agreed on every *behavioral* requirement (DWR ≠ rain protection; unknown blocks positive
claims; the Marcy query surfaces exactly three gaps). They diverged only on storage.

## Decision
Adopt **C (capability-first hybrid) as the backbone**, hardened by harvesting the best of A and B:
- **Hybrid storage:** ~18 load-bearing facets as **typed columns** on `items`; cohesive domain
  clusters as **optional, composable 1:1 group tables** (`item_insulation`, `item_sleep`, `item_shell`,
  `item_carry`, `item_footwear`) — a multi-domain item simply has several groups (this fixes A's
  single-discriminator flaw); the long tail in a **Zod-validated JSONB bag**.
- **A facet registry in `src/core`** is the single source of truth for every facet (key, value-space,
  canonical ordering, tier, hard/soft, capability-gate). It generates the Zod validators and backs a CI
  lint that asserts every facet-key literal exists. This neutralizes C's promotion-boundary risk
  (promotion changes `tier` only) and B's "type-safety is aspirational" hole.
- **Capabilities are first-class** predicates over facets with a 3-state result; every
  capability-gating facet must be stored hot (never JSONB). v0 computes capabilities on read (small-N,
  always correct); optional materialization is deferred and, when added, keyed on `facet_hash` **and**
  `capability_version`.
- **No authoritative `item_kind`/category** is read by recommendations; applicable groups are derived
  from facets (`layering_role`/`function_purpose`).
- Evidence shapes `Evidence<T>`/`HardFact<T>` (A) + 3-state unknown + hard-fact-source guard +
  `pending_facets` queue (B).

## Alternatives considered
Pure A, pure B, pure unhardened C — see [`DESIGN.md` §10](../../DESIGN.md) for the full comparison
table and the per-architecture rejection reasons, and `docs/phase0/audits/` for the audits.

## Consequences
- One clean query path for hot facets/capabilities; JSONB keeps us from migrating for rare facets.
- The registry adds a small codegen/CI investment but removes the brittleness all three pure designs had.
- Adding a *new load-bearing* facet still costs a column migration (acceptable; load-bearing facets are
  the most stable part of the ontology per the decision-driver analysis).
- The one open fork (approve hybrid vs prefer pure-A/pure-B) is surfaced to the user before Phase 1.
