# ADR-0025 — Self-building product catalog: surface `llm_draft_cache` as add-time autocomplete

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** Closet-database Phase 5 (self-building catalog)

---

## Context

The global `llm_draft_cache` table (ADR-0007, ADR-0013) is a self-building knowledge base:
every item that passes through the LLM classification pipeline writes a validated, normalized
entry keyed on product name. It accumulates across all users (global cache layer) and improves
with every confirmation and correction (`source:'user'` upserts). This KB has been running
since Phase 2 and by Phase 5 holds a non-trivial corpus of classified products.

Until Phase 5, this corpus was invisible to the user at add time. The typical add flow —
type a name → fast record → enrich in background — always started from an all-unknown baseline
even when the exact product was already in the cache. The cache was consulted server-side to
skip the LLM call, but the user never saw it.

Two gaps this creates:

1. **Wasted specs.** An item like "Arc'teryx Beta AR Jacket" may already exist in the cache
   with manufacturer-derived facets from a previous enrichment. Silently applying those facets
   in the background is correct; allowing the user to pick from the known-good entry at add
   time is better — they get specs immediately rather than after a background round-trip.

2. **No discovery path.** A user who doesn't know the exact name of what they own can benefit
   from seeing "Arc'teryx Beta AR Jacket" appear in autocomplete when they type "Arc'teryx
   jacket", confirming the model, and adding it with inherited specs in one tap.

The Phase 0 research finding (captured in the roadmap's Phase 5 node) noted that no licensable
third-party gear catalog exists — the classification cache IS the catalog, and it builds itself.

**Constraint: no cross-tenant data poisoning.** The global `llm_draft_cache` holds validated
LLM output; it does not hold per-user overrides. Per-user corrections live in `user_overrides`
(ADR-0013). The `searchCatalog` surface must read only from the global draft store, never from
another user's override table.

---

## Decision

### `searchCatalog(query, limit)` — new cache method

A new `searchCatalog(query: string, limit: number): Promise<CatalogHit[]>` method on the
cache port executes a normalized-name prefix/fuzzy search over `llm_draft_cache` entries.
It returns only entries from the global draft store — never from `user_overrides` — so results
reflect what the LLM + enrichment pipeline produced for previous items, never another user's
manual edit.

`CatalogHit` carries: `name`, `brand` (if known), `model` (if known), and the cached
classification snapshot. The snapshot is used to seed the new item's classification at insert
time, skipping both the LLM call and the background enrichment round-trip.

### `addFromCatalog(hit, userId)` — one-tap add with inherited specs

A user who selects a `CatalogHit` from autocomplete triggers `addFromCatalog`. This creates
the `items` row with:

- `classification` set from the cached snapshot (not all-unknown), demoting any hard facts
  that lack manufacturer source to `null` per the hard-fact demotion guard (ADR-0004).
- `domains` populated per the cache entry's domain markers.
- `ownership_status = 'owned'`, `DEFAULT_INVENTORY` for all other inventory fields.

The item lands directly in the closet, classified. It is immediately correctable via the
standard facet editor (ADR-0012 evidence resolver, `source:'user'` correction path).

### Record-only path is unaffected

`addFromCatalog` is strictly additive. When no catalog hit is selected (user types a name not
in the cache, or skips autocomplete), the existing `recordOwnership → background enrichment`
path (ADR-0022) runs unchanged.

### Dedupe awareness

`searchCatalog` also underpins the dedupe banner introduced in Phase 3 (`findDuplicate` in
`src/core/dedupe.ts`). When the user types a name that matches a closet item they already own,
the banner shows "you may already have this — view / add anyway / +1 quantity". This reuses the
same normalized-name matching without additional infrastructure.

---

## Alternatives considered

**A separate curated `canonical_products` table (DESIGN.md §15 element 1), built now.**
A canonical product table would hold one authoritative row per product, keyed on GTIN or
a stable slug, as the source for autocomplete and spec inheritance. This is the right long-term
model — and it is designed-for in DESIGN.md §15 — but it requires:
- A GTIN/barcode pipeline to populate stable keys (deferred per CLAUDE.md scope discipline;
  barcode enrichment is unlocked backlog, not built until after Phase 3 URL enrichment).
- A curation or promotion strategy to prevent low-confidence LLM output from becoming
  "canonical" across all users.
- A migration to split what is today a single `llm_draft_cache` table into a draft store and
  a canonical store, with a promotion gate.

Doing this now adds schema complexity without sufficient GTIN data to justify it. The
`llm_draft_cache` is already globally keyed on normalized name — good enough for autocomplete
and spec inheritance at the current corpus size. Surfacing it is the right Phase 5 move; a
canonical products table is the right Phase 6+ upgrade. Deferred.

**A third-party gear catalog license.**
No licensable general-purpose outdoor gear catalog with facet-level specs exists for this
use case (finding confirmed in Phase 0 research). Gear database products either require a
custom data partnership, cover only retail listings (not specs), or are consumer-facing apps,
not data APIs. The self-building cache is not a compromise — it is purpose-built for Armarium's
facet ontology in a way no external catalog could be. Rejected.

**Expose user overrides in search results.**
User override entries (`user_overrides` table, ADR-0013) may have higher confidence than
the corresponding draft cache entry if the user corrected it. However, overrides are per-user
and may reflect personal context (e.g. "I know this jacket has 900fp fill" — a claim the user
verified for their specific unit). Serving another user's override as a catalog suggestion
would be a cross-tenant leak of personal data. `searchCatalog` reads only the global draft
layer. Rejected.

---

## Consequences

### What is better

- The self-building KB that has been accumulating since Phase 2 now has a user-facing payoff:
  add-time autocomplete and one-tap spec inheritance.
- Items added via `addFromCatalog` skip the background enrichment round-trip entirely —
  they arrive classified.
- The cache grows faster: every add from catalog creates another user/confirmation signal
  that upserts a `source:'user'` entry, improving the global KB.
- No new infrastructure, no new dependency. `searchCatalog` is a query over an existing table.

### Invariants preserved

- The hard-fact demotion guard (ADR-0004) runs on inherited specs at insert time —
  specs from the cache are not silently promoted to hard facts unless they carry
  manufacturer or user source.
- Cross-tenant isolation: `searchCatalog` never reads `user_overrides`. The global draft
  layer contains only LLM + enrichment output, not personal corrections.
- The no-fabricate-specs rule: a `CatalogHit` inherits the cache's confidence and source
  markers intact; low-confidence values remain low-confidence in the new item.
- The record-only / degrade-not-throw path (ADR-0022) is unchanged for all non-catalog adds.

### Designed-next: not built this pass

Two Phase 5 deliverables from the roadmap were intentionally deferred:

1. **Photo / vision capture.** The evidence resolver already has `source:'vision_inferred'`
   as a designed extension point (ADR-0018). Vision capture requires a runtime vision API
   (Anthropic Vision or equivalent), which cannot satisfy the hermetic gate (`pnpm test`
   with no env) without a dedicated mock path. Background-removal for clean item photos
   would add a dependency (ask-first rule). A dedicated ADR + provider decision must precede
   any implementation. Deferred until that ADR is written and approved.

2. **Apparel as a second modeled domain.** Items can already be stored with
   `domains = ['apparel']` (storable from Phase 1, ADR-0023). A full apparel ontology —
   facet registry entries for size range, care instructions, seasonal suitability; a
   classification prompt; capability predicates — is a scope equivalent to the original
   gear ontology. It needs its own dedicated `DESIGN.md` section and ADR, not a rushed
   bundle. Deferred until that design pass is complete.
