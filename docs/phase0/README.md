# Phase 0 — Design / Discovery

**Goal:** determine the best faceted data model + material model + classification approach *before*
any schema is migrated or feature code is written. Output is **design docs only**. Phase 0 ends at a
**coherence gate** (one integrated `DESIGN.md`, no silent contradictions) and then **STOPs for
approval** — no migrations, no feature code.

## Method: a parallel swarm, serialized at integration
Parallelize investigation; serialize integration. Independent facets → parallel agents. Each agent
writes a structured markdown artifact here; the lead integrates and **surfaces any load-bearing
divergence to the user** rather than silently picking.

## Swarm roster & status

### Wave 1 — Investigation (parallel) → [`investigation/`](investigation/)
| Agent | Artifact | Status |
|-------|----------|--------|
| Domain: base layers | `investigation/domain-base-layers.md` | ✅ |
| Domain: mid/insulation | `investigation/domain-mid-insulation.md` | ✅ |
| Domain: shells/wind | `investigation/domain-shells-wind.md` | ✅ |
| Domain: sleeping bags | `investigation/domain-sleeping-bags.md` | ✅ |
| Domain: packs | `investigation/domain-packs.md` | ✅ |
| Domain: footwear | `investigation/domain-footwear.md` | ✅ |
| Domain: accessories | `investigation/domain-accessories.md` | ✅ |
| Decision-driver | `investigation/decision-drivers.md` | ✅ |
| Material-behavior | `investigation/material-behavior.md` | ✅ |

**Wave 1 complete.** Convergent signals → see [`progress/PROGRESS.md`](../progress/PROGRESS.md)
and the synthesis. Headlines: universal-core + domain-extension architecture (not a flat facet set);
a shared insulation-behavior sub-model (garments + bags); a normalized material library referenced by
structured construction roles; multi-label facets (`function_purpose`, `body_zone_covered`,
`layering_role`); waterproof ≠ water-resistant with unknown = `null`; ratings stored with their
standard + confidence; and a derived **capability layer** as the unit recommendations reason over.

### Wave 2 — Competing architectures (parallel, blind) → [`architectures/`](architectures/)
Three independent proposals, each a COMPLETE faceted data model + how grouping emerges as queries.
**Complete.** All three converge on the safety behaviors (DWR ≠ rain protection; Marcy → exactly the
3 expected gaps); they diverge on the load-bearing **storage architecture**, which synthesis resolves.
| Proposal | Thesis | Status |
|----------|--------|--------|
| A — `architecture-a-typed-relational.md` | Typed columns + per-domain extension tables; capabilities as `src/core` functions | ✅ |
| B — `architecture-b-facet-graph.md` | EAV facet rows against a `facet_definitions` ontology; capabilities as SQL views; no migrations to add facets | ✅ |
| C — `architecture-c-capability-hybrid.md` | Hybrid: typed hot facets + Zod-validated JSONB cold bag; first-class capabilities w/ `blocked_unknown` | ✅ |

### Wave 3 — Adversarial audits (parallel) → [`audits/`](audits/)
One auditor per proposal. Stress-test against multi-purpose items (Terre Planing, buff, R1 Air),
missing-data behavior, and a Marcy-style gap query.
| Audit | Verdict | Headline |
|-------|---------|----------|
| A — `audit-a-typed-relational.md` | SOUND-WITH-FIXES | Single-domain union fights multi-domain gear → `itemDomains[]`; close the `z.string()` enums; harvest `Evidence<T>`/`HardFact<T>` |
| B — `audit-b-facet-graph.md` | SOUND-WITH-FIXES | Type-safety is aspirational → codegen + CI lint of facet keys; don't silently discard novel facets → `pending_facets`; "no migration" overstated |
| C — `audit-c-capability-hybrid.md` | ⏳ running | — |

### Synthesis (serial, lead)
Reconcile into ONE recommended design → `../../DESIGN.md` + proposed Drizzle schema + classification
rubric. Surface divergences to the user. *(pending Waves 1–3)*
