# ADR-0024 — Collections, user tags, and CSV export

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** Closet-database Phase 4 (curation + portability)

---

## Context

After Phases 1–3 shipped (possession model, browse at scale, batch capture), users have closets
with potentially hundreds of items but no way to organize them beyond what the facet system
provides and no way to take their data out of Armarium.

Two distinct needs surfaced:

1. **Personal curation.** A user who assembles a "3-day ski kit" or an "ultralight backpacking
   setup" wants to name that collection, refer to it across trips, and add or remove items
   without changing the items themselves. This is emphatically NOT a hardcoded category —
   two users' "ski kits" contain different items; the collection is a personal, mutable view,
   not a behavioral predicate.

2. **Freeform labeling.** Some users want ad-hoc labels ("lent to Sarah", "needs repair",
   "REI sale") that do not correspond to any facet, status, or condition value. These are
   personal signals, not inputs to classification or recommendations.

3. **Anti-lock-in.** A personal inventory database that cannot export its data creates
   justified user skepticism. CSV export is the top anti-lock-in ask; without it the product
   makes an implicit promise it doesn't keep.

A key constraint: **none of these three features should route capability evaluation or
recommendations through them.** A "ski kit" collection is not a fact about what rain
protection an item has; a tag "lent to Sarah" is not a domain marker. The no-hardcoded-buckets
invariant (ADR-0003) applies — these are curation tools, not behavioral predicates.

---

## Decision

### Collections (kits): M:N join table

A collection is a user-owned named group. Schema:

```
collections
  id            uuid  PK
  user_id       uuid  NOT NULL  (RLS-scoped)
  name          text  NOT NULL
  description   text  nullable
  created_at    timestamptz

collection_items
  collection_id  uuid  FK → collections(id)  ON DELETE CASCADE
  item_id        uuid  FK → items(id)         ON DELETE CASCADE
  PRIMARY KEY (collection_id, item_id)
```

Migration 0009 delivers these tables with full RLS enforcement (user sees only their own
collections; joins through `user_id` on `collections`).

The product surfaces `/collections` (list) and `/collections/[id]` (detail + item list).
An item detail page carries a `CollectionPicker` — add or remove the item from any collection
in one tap. Collections support create, rename, and delete.

**Collections are personal curation, not a routing key.** They do not appear in capability
predicates, recommendation filters, or the trip engine. A collection is not a "category" in
the ADR-0003 sense: it is a named set whose membership is entirely user-defined and has no
semantic meaning to the reasoning layer.

### User tags: `user_tags text[]` on `InventoryMeta`

```
user_tags  text[]  NOT NULL  DEFAULT '{}'
```

GIN-indexed for set-membership queries. Stored as `user_tags` in the `items` table alongside
the other inventory columns introduced in ADR-0021. Free text, no controlled vocabulary, no
validation beyond non-empty strings.

Tags are distinct from:
- `domains` (behavioral scope — which facet-sets apply, governed by ADR-0023)
- classification facets (evidence-graded behavioral properties, governed by ADR-0004)
- `ownership_status` / `condition` (typed lifecycle columns, governed by ADR-0021)

Tags are clickable on item cards and filter the closet via `?tag=` query parameter (reusing
the existing `listItemsPage` filter chain from Phase 2). No new infrastructure required.

### CSV export: streaming GET endpoint

`GET /api/export` streams the user's full closet as RFC-4180 quoted CSV — one row per item —
covering the identity fields, all inventory layer columns (ADR-0021), ownership status,
condition, and key facets (waterproofness, warmth, weight, layering role). The field set is
chosen to be useful without exposing internal implementation details.

No third-party CSV library. Plain text generation with RFC-4180 quoting ensures portability to
Excel, Numbers, and Sheets without requiring the user to install anything.

---

## Alternatives considered

**Collections as a facet or domain marker.** Representing "ski kit" as a facet value (e.g.
`activity_fit = ['skiing']`) conflates the user's personal curation with the item's behavioral
properties. An item is not a ski item because the user put it in a ski-kit collection; an item
is a ski item because its facets (layering role, waterproofness, insulation) make it appropriate
for skiing. Using a collection as a behavioral predicate would reintroduce the hardcoded-category
anti-pattern by another name. Rejected outright.

**User tags as capability inputs.** A tag like "waterproof" could be read by the capability
predicates and used to satisfy `rain_protection`. This conflates user-applied labels with
evidence-graded facet values — a tag has no `confidence`, no `source`, no LLM evidence — and
breaks the unknown-is-first-class contract (ADR-0004). Tags have no effect on capability
evaluation. Rejected.

**Paid export/import dependency (Flatfile, Papa Parse, etc.).** CSV generation is ten lines of
string manipulation. Adding a dependency to do it introduces a vendor relationship, a license,
and a bundle size cost disproportionate to the complexity. Rejected.

**Collections in the classification JSONB bag.** The JSONB bag is evidence-shaped behavioral
data governed by the facet registry (ADR-0021's typed-columns-not-JSONB rule). A collection
membership is user-owned, mutable, has no confidence or source, and must never influence the
evidence resolver. Rejected.

---

## Consequences

### What is better

- Users can organize their closet into named kits without any behavioral coupling to the
  facet/capability system.
- Freeform tags serve personal workflows (loan tracking, repair reminders, purchase sourcing)
  that no structured field can fully anticipate, and they are immediately queryable via the
  closet filter chain.
- CSV export is unconditional — the user always owns their data.

### Invariants preserved

- Collections and tags carry no `confidence`, `source`, or evidence — they never enter the
  evidence resolver (ADR-0012) or influence any capability gate.
- The no-hardcoded-buckets invariant (ADR-0003) is preserved: capability evaluation, grouping
  queries, and trip packing remain purely facet-derived.
- `user_tags` is a typed column, consistent with the inventory-layer rule (ADR-0021): inventory
  and curation metadata live in typed columns, never in the classification JSONB.

### Known limitations / deferred

- **Apparel as a second modeled domain** was originally scoped for Phase 4 but was not built in
  this pass. The `domains text[]` column already supports `'apparel'` entries (storable and
  queryable from Phase 1); the apparel facet ontology, classification prompt, and capability
  predicates require a dedicated `DESIGN.md` section and ADR before implementation. Deferred.
- **Import / round-trip CSV.** Export ships; import (re-ingesting a CSV to populate the closet)
  is a natural follow-on but is not in scope here. The CSV column layout is stable enough to
  be the basis for a future import path.
