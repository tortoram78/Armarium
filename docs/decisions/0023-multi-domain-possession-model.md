# ADR-0023 — Multi-domain possession model: three-ring architecture + pluggable facet-sets

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** Closet-database Phase 1 (possession-model inversion)

---

## Context

`CLAUDE.md` states the product's scope plainly: *"Armarium is a deployable web app that stores
a person's outdoor gear and recommends what to pack for a trip. It is general-purpose — any
user, any gear domain, any trip; the seed gear/trip presets are prototype data, never the scope."*

Despite this intent, the current implementation is gear-locked in practice:

- The LLM classification prompt is tuned to outdoor-gear facets.
- The capability predicates (rain protection, wicking base, packable insulation, etc.) are
  gear-specific by construction.
- There is no way to record a camera body, a board game, a musical instrument, or any
  possession that does not map to the gear facet ontology.
- The `layering_role`, `waterproofness`, `breathability`, and related columns are presented as
  universal properties of items when they are actually properties of gear.

A personal inventory database that cannot hold a camera is not a general-purpose inventory
database. As Armarium expands its scope, the current model must be refactored to distinguish
between universal possession facts (true of any item in any domain) and gear-specific behavioral
facets (true only of items where gear reasoning applies).

This refactoring must not introduce a `domain` routing discriminator — doing so would replicate
the `category` anti-pattern that the no-hardcoded-buckets invariant (CLAUDE.md rule #1,
ADR-0003) was specifically designed to prevent.

---

## Decision

### The three-ring possession model

Every item in Armarium has exactly three concentric rings of data:

**Ring 1 — Universal possession core (every item, any domain)**

Present on every row regardless of what the item is. Contains:

- **Identity:** `name`, `brand`, `model`, `image_path` (ADR-0018).
- **Inventory layer:** `ownership_status`, `quantity`, `condition`, `acquired_at`,
  `price_paid_cents`, `acquired_from`, `storage_location`, `size`, `color`, `user_notes`
  (ADR-0021). These are universal facts about a possessed object.

**Ring 2 — Domain markers (pluggable, non-routing)**

```
domains  text[]  NOT NULL  DEFAULT '{}'
```

A GIN-indexed array of domain identifiers. Current defined value: `'gear'`.

`domains` records which behavioral facet-sets *apply* to the item. It is **not** a routing
discriminator. It does not determine which UI route loads, which table is queried, or which
branch of an `if/else` runs. "Domain" is never read as a switch case. It governs only which
reasoning pipelines are invoked and which facet groups are expected to be populated. This
directly preserves the no-hardcoded-buckets invariant: the existing principle "show me my
shells" is the query `waterproofness ≥ wp_breathable OR wind_resistance = windproof`, not a
table lookup — and it remains so. An item can have `domains = ['gear', 'apparel']` without
any routing or schema branching.

**Ring 3 — Behavioral facet ring (domain-specific, optional)**

The existing gear facets — the universal hot soft facets in §3.1 of DESIGN.md, the multi-label
arrays in §3.2, and the composable group tables (`item_insulation`, `item_shell`, `item_carry`,
`item_footwear`, `item_sleep`) — are the **gear domain's behavioral facet-set**. They are
dormant (all values null / arrays empty) when `'gear' ∉ domains`. For items where
`'gear' ∈ domains`, they function exactly as they do today.

No columns are removed or renamed. The gear facets remain present on every row; they simply
carry all-unknown values for non-gear items, which is already the starting state for any
unclassified item.

### Domain scope in v1

**Gear** is the one fully-modeled domain in Phase 1. Its ontology — the facet registry, the
capability predicates, the classification prompt, and the enrichment pipeline — exists and is
used unchanged.

**Apparel, electronics, and collectibles** are registered extension points. An item can carry
`domains = ['apparel']` (or `['electronics']`, `['collectibles']`) immediately — it will be
stored with all gear facets null (all-unknown) and with the inventory layer populated. These
domain labels are storable and queryable from day one even though their own ontologies have not
been built yet. The user can record a jacket as an apparel item, and it will appear correctly
in their closet with all behavioral facets unknown. Domain-specific classifiers, facets,
and capability predicates for these domains are fast-follows, each requiring their own
`DESIGN.md` section + ADR(s) before implementation.

### Reconciliation with the no-hardcoded-buckets invariant

The no-hardcoded-buckets invariant (ADR-0003, CLAUDE.md rule #1) states: do not route
recommendations, groupings, or capabilities off a single authoritative `category` enum.

The `domains text[]` column is compatible with this invariant for three reasons:

1. It is a **set, not a discriminator.** An item can belong to multiple domains simultaneously
   (`['gear', 'apparel']`). There is no exclusive OR that forces a single truth.
2. It governs **which reasoning runs**, not which rows are returned or which UI is shown.
   A query for "items with rain protection" still runs the capability predicate over facets,
   not a `WHERE 'gear' = domains` lookup. The domain array does not replace or shortcut
   facet-based queries.
3. It is **open-ended.** New domain values can be added without changing existing code paths,
   unlike an `enum` that forces a migration and a branch for each new value.

The invariant is about not routing off a category. `domains` marks which facet-sets apply
so the reasoning pipelines know what to attempt — it is metadata about the item's scope, not
a routing key for recommendations.

### `unknownBehavioralClassification(name)` as the universal floor

The existing function `unknownBehavioralClassification(name)` produces a well-formed
`ItemClassification` with every gear facet set to unknown. It is the starting state for every
item regardless of domain. This is the correct behavior for non-gear items too: a camera in
the closet has `waterproofness: null, confidence: 'unknown'` — which is honest and correct,
not wrong. The camera never satisfies `rain_protection`, which is also correct.

---

## Alternatives considered

**Gear-first with a non-gear fallback only.** Keep the gear model unchanged; add a single
`is_gear: boolean` flag; non-gear items skip classification entirely and are stored as
name-only records. Simpler in Phase 1 but forecloses the multi-domain extension path: a second
domain (apparel) would require `is_gear` + `is_apparel`, and the boolean proliferation
problem identified in ADR-0021 recurs. There is also no extensibility — adding a third domain
means another boolean. Rejected in favor of `domains text[]` which handles n domains cleanly.

**Fully model four domain ontologies in v1 (gear + apparel + electronics + collectibles).**
Defining complete facet ontologies for four domains in the first iteration requires four
separate classification prompts, four sets of capability predicates, four enrichment pipelines,
and four `DESIGN.md` sections — multiplying the Phase 1 scope by approximately four times.
The value of having a camera classified with electronics facets does not justify that cost
relative to recording it as an all-unknown possession (which is immediately useful as an
inventory record). Domain ontologies are fast-follows; forcing them all into Phase 1 delays
the foundation work that every domain depends on. Rejected.

**`domain` as a single-value enum (one required domain per item).** A mandatory single domain
discriminator is the anti-pattern ADR-0003 was written to prevent. An insulated waterproof
jacket is gear AND apparel; forcing a choice between them loses information and re-introduces
category-based routing. Rejected outright.

---

## Consequences

### What is better

- Any possession can be recorded immediately, regardless of domain. The inventory is truly
  general-purpose from day one.
- Domain-specific reasoning (gear capability predicates) is opt-in: items without `'gear'`
  in `domains` are never fed through the gear classification pipeline.
- New domain ontologies (apparel, electronics, collectibles, military/NSN) slot in as additive
  extensions to the facet registry and reasoning pipelines, without touching any existing code.
- The no-hardcoded-buckets invariant is preserved: `domains` is a facet-set marker, not a
  routing key.

### Gear domain: unchanged

The gear facet ontology (DESIGN.md §3), the capability predicates (DESIGN.md §5), the evidence
contract (ADR-0004), the enrichment pipeline (ADR-0011 / ADR-0019 / ADR-0020), and the
recommendation engine (ADR-0005, ADR-0010) are all **reused unchanged**. This ADR is purely
additive: it wraps the existing gear model inside the first ring of a three-ring structure and
creates the extension points for other domains to follow.

### Known limitations / deferred

- **Domain-aware enrichment.** The web-search enrichment tier (ADR-0020) is today
  allowlisted to gear/outdoor brands. A camera recording from a user whose closet is
  `domains = ['electronics']` will fall through to the all-unknown floor because there are
  no electronics brands on the allowlist and no electronics classifier. Domain-specific
  enrichment is a fast-follow for each domain ontology.
- **Domain-specific capability predicates.** Apparel capabilities (size-range fit, care
  compatibility, seasonal suitability) and electronics capabilities (battery life,
  compatibility, connectivity) are deferred. Each requires its own `DESIGN.md` section and
  ADR before implementation.
- **Domain UI filtering.** Filtering the closet by domain (show only gear; show only
  electronics) is a browse-at-scale feature deferred to Phase 2 of the closet-database
  roadmap (see `docs/roadmap.md`).
