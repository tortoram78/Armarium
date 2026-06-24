# ADR-0012 — Evidence-first classification: classification as an auditable argument

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** North-star architecture (direction accepted; individual phases get follow-up ADRs as built)

---

## Context

Armarium's defining premise is that packing advice *emerges* from reasoning over facets — not
from hardcoded buckets or trip templates. That premise places high demands on the quality and
auditability of the underlying classifications. As Phase 2 and Phase 3 have been built, a coherent
architectural direction has emerged that this ADR makes explicit:

**Classification is not a one-time answer. It is an auditable argument: a set of claims from
identified sources, resolved into a facet value by explicit precedence rules.**

This reframing matters for a faceted system because:

- Facets are *reasoned over* downstream (capabilities, recommendations). A wrong facet value
  produces wrong advice. A missing provenance trail makes it impossible to explain, verify, or
  correct the advice later.
- The system already has multiple potential sources for the same facet: the LLM inferring from a
  product name; the manufacturer stating a spec on their product page; the user correcting in the
  review UI; physics-based derivation from material composition. These sources disagree. The current
  architecture resolves those disagreements implicitly and in scattered code; the target makes the
  resolution deterministic, documented, and testable.
- The self-building cache (ADR-0007) introduced a cross-tenant design trade-off: a `source:"user"`
  correction to "Patagonia Nano-Air Hoody" by one user currently helps and potentially poisons
  classifications for every other user. This is a real, not hypothetical, concern — one user's
  item named "Nano-Air" may be a different model year with different fill power. The cache structure
  must be split to contain this risk as the system moves to real multi-user (Phase 3 step 1,
  ADR-0008).
- URL enrichment (ADR-0011) introduces `source:"manufacturer"` as a high-quality signal. The
  material behavior derivation engine — composing the `derived_from_material` source first wired
  by ADR-0011 §14.6 — is the designed-for next step. These are the first two sources beyond `llm`
  and `user`; as sources accumulate, an implicit merger (`enrich/merge.ts`) will not scale.

### What already exists (the foundation)

The target architecture does not start from zero. Several foundational pieces are already built
and must be *preserved and extended*, not replaced:

| Already built | Where | Status |
|---|---|---|
| `Evidence<T>` / `HardFact<T>` shapes with `{value, confidence, source, evidence}` | `src/core/` | Solid; the ADR-0004 contract |
| Mechanical hard-fact demotion guard | `src/core/` | Solid; enforced at Zod validation |
| `Source` union with precedence concepts | `src/core/` | Solid; ADR-0011 §D established `manufacturer > inferred`; the full canonical order incl. `derived_from_material` (which outranks `inferred`) is defined in Element 3 below |
| Manufacturer overlay / partial merge | `src/core/enrich/merge.ts` | Phase 3 step 2; IMPLICIT precedence |
| Per-facet `*_src` / `*_conf` columns on `items` | `src/db/schema.ts` | Solid; hot columns for capability-gated facets |
| Lossless `classification` JSONB column | `src/db/schema.ts` | Solid; source of truth on reads |
| `pending_facets` queue for novel LLM extractions | `src/db/schema.ts` | Solid; never silently drops unknown keys |
| Capability ↔ classification ↔ recommendation layer separation | `src/core/capabilities/`, `src/core/recommend/` | Solid; the ADR-0003/0005 contract; a strength to preserve |
| Three-state capability results (`satisfies | fails | blocked_unknown`) | `src/core/capabilities/` | Solid |
| Classification cache with `source` provenance | `src/core/cache.ts`, `classification_cache` table | Solid; but cross-tenant mixing is the known trade-off noted in ADR-0007 |

---

## Decision

### Target architecture (8 elements)

The 8 elements below state the TARGET for each architectural concern, paired with an explicit
current-state grounding. Future agents and contributors should read these groundings before
claiming a piece is missing or complete.

---

#### Element 1: Canonical vs user items

**Target:** a global `canonical_products` table (brand / product-line / model / variant / SKU,
promoted only from reliable evidence, no user_id) plus identity matching that links a user's item
to a canonical product via `user_items.canonical_product_id` (nullable — unknown is first-class).
Canonical products form the foundation for photo/barcode enrichment (unlocked backlog, each gated
on its own ADR) and for a future catalog gap-fill service (Phase 3 step 4 per `docs/roadmap.md`).

**Current state:** `items` is user-owned with inline `brand` and `model` text columns, an
`in_inventory` flag, and `user_id` on every row (architecture rule #4). There is no global product
table. The `classification_cache` table is global (no `user_id`) but is keyed on normalized item
name, not on a product identity — it is a knowledge base for classifications, not a product catalog.

**Gap:** net-new; no existing table represents a canonical product identity.

---

#### Element 2: Evidence store

**Target:** a first-class `item_evidence` table holding multiple competing claims per facet per
item. Each row: `(item_id, facet_key, source_type, source_url, extractor_version, observed_at,
value, confidence, explanation)`. The item's facet columns become a RESOLVED VIEW over this table,
computed by the resolver (Element 3). This makes the provenance of every fact inspectable,
exportable, and auditable — and makes it possible to re-resolve when a new claim arrives or when
the resolver policy changes.

**Current state:** claims are stored INLINE. Each hot soft facet has `x`, `x_confidence`,
`x_source` columns on `items`; the lossless `classification` JSONB carries the full evidence
envelope. `pending_facets` parks novel LLM-extracted keys that are not in the registry —
an important piece of the target (never silently discard) that must be preserved. There is no
table that holds multiple competing claims for the same `(item_id, facet_key)` pair.

**Gap:** the evidence table and the "resolved view" concept are net-new. The current inline columns
become the resolved state; the evidence table is the new backing store.

---

#### Element 3: Resolver layer

**Target:** a single deterministic `resolve(claims[])` function in `src/core/resolve/` that
accepts all claims for a given `(item_id, facet_key)` and returns the winning resolved value with
its provenance. Precedence, from highest to lowest:

```
user > manufacturer > derived_from_material > inferred/llm > unknown
```

Conflict policy: authoritative sources win by precedence regardless of confidence. A high-confidence
`inferred` claim does not beat a low-confidence `manufacturer` claim. A `derived_from_material`
claim (physics-derived from authoritative composition) outranks pure LLM inference but defers to
manufacturer or user statements. A low-confidence `derived_from_material` claim defers to a
higher-confidence `inferred` claim from the LLM when no authoritative source is available.

**Current state:** precedence is IMPLICIT and distributed. The manufacturer overlay in
`src/core/enrich/merge.ts` implements the `manufacturer > inferred` rule inline. The hard-fact
demotion guard in the Zod validator enforces the `user/manufacturer`-only precondition for hard
facts. ADR-0011 §D documents the hierarchy in prose. There is no single `resolve()` function;
there are instead several ad hoc merge points.

**Phase status:** this is Phase 1 of the migration sequence (in progress). A `src/core/resolve/`
module is the first deliverable; it absorbs the logic currently scattered in `merge.ts` and the
validator, and it is where the `derived_from_material` wiring from ADR-0011 §14.6 will land.

---

#### Element 4: LLM = extractor, not authority

**Target:** the LLM emits CLAIMS (an array of `{facet_key, value, confidence, source, evidence,
unresolvedQuestions}` objects) rather than a final `ItemClassification` shape. These claims are
validated by Zod, stored in the evidence table (Element 2), and fed to the resolver (Element 3).
The LLM is one extractor among several — not the authority that decides the final value.

`unresolvedQuestions` is a first-class output field: the LLM surfaces what it could not determine
from the available text (`"fill power not stated on the product name"`). These surface in the
review UI for the user to fill in or dismiss. This reduces silent unknowns without inviting
fabrication.

**Current state:** the LLM emits a full `ItemClassification` (the final shape, Zod-validated).
The Zod contract and the hard-fact demotion guard (ADR-0004) prevent fabrication, but the LLM
is still positioned as the direct author of the resolved facet values. The evidence shape
(`{value, confidence, source, evidence}` per facet) is already claim-like in structure; the
migration is about routing those claims through an explicit store and resolver rather than
treating the validated output as final.

**Gap:** requires a new LLM prompt that outputs a claims array, a claims Zod schema, and wiring
through the resolver. The existing `ItemClassification` Zod schema remains the *resolver output*
contract; it changes from being the LLM output contract to being the resolved-state contract.

---

#### Element 5: Cache split

**Target:** three distinct stores replacing the current single `classification_cache`:

1. **`llm_draft_cache`** — global (no `user_id`); stores LLM-emitted claims as low-authority
   drafts; keyed on normalized item name. A hit here provides a starting point for the resolver but
   does not bypass review. This replaces the current `source:"llm"` and `source:"seed"` rows.
2. **`user_overrides`** — per-user (`user_id` required); stores `source:"user"` corrections for
   a specific item as scoped to that user. A user's correction to "Nano-Air Hoody" affects only
   their items. This replaces the current `source:"user"` rows in the shared cache.
3. **`canonical_facts`** — global; stores facts promoted from manufacturer evidence or curation
   (linked to `canonical_products` from Element 1); authoritative but not user-personalizable.

The split directly fixes the cross-tenant security concern: a user's private correction no longer
propagates to other users' items. The `llm_draft_cache` remains global (a low-authority draft
shared across tenants is desirable — it saves LLM calls and the review step catches any
mismatch), but user corrections are now scoped.

**Current state:** ONE `classification_cache` table (global, no `user_id`). The `source` field
encodes provenance (`llm`, `user`, `seed`) but all entries share the same physical table and the
same key space. ADR-0007 documented the cross-tenant trade-off as a known limitation. It is a
real security and data-quality concern now that Phase 3 step 1 has delivered real multi-user.

**Gap:** schema change (new tables replacing `classification_cache`), wiring in `src/core/cache.ts`
and `src/server/`, RLS policies on `user_overrides`.

---

#### Element 6: Targeted review — impact-ranked unknowns

**Target:** the review UI surfaces ONLY the unknowns that affect recommendation outcomes,
ranked by the severity of their impact (e.g. `seam_sealing` on a rain shell is high-impact;
`pocket_count` on the same item is irrelevant). The ranking is derived from the capability
predicates: a facet that gates a `blocked_unknown` outcome on a required capability is shown
first. Facets that no active capability reads are omitted from the "verify" list entirely.

**Current state:** the review surface shows all extracted facets; `blocked_unknown` capabilities
surface as "verify" items on the trip result page. The link from a blocked capability to
`/items/[id]?edit=1` already implements a coarse version of targeted review. What is missing is
the ranking: all unknowns are treated equally, and some displayed unknowns have no effect on
any recommendation the user has made or is likely to make.

**Gap:** derive the impact rank from live capability evaluation (the capability evaluator already
exists; routing its `blocked_unknown` outputs back to the review sort order is the remaining step).

---

#### Element 7: Versioned snapshots + reclassification flow

**Target:** items carry three version fields: `schemaVersion` (current facet ontology version),
`resolverVersion` (current resolver policy version), and `classifierVersion` (model version at
last classification). When any of these changes, the system can identify items that need
re-review (`WHERE schema_version < current OR classifier_version != current_model`). A
reclassification UI shows "N items were classified with an older ontology — would you like to
re-review them?"

**Current state:** the `classification_cache` table records `modelId` on each LLM-derived entry
(for drift tracking per ADR-0007). The `items` table has no version fields. Trip result snapshots
(`trips.result_snapshot`) record the recommendation output at a point in time but carry no
classifier or schema version. There is no reclassification flow.

**Gap:** version columns on `items`, an incremented-on-change `SCHEMA_VERSION` and
`RESOLVER_VERSION` constant in `src/core/`, and a reclassification query + UI surface.

---

#### Element 8: Layer separation — capability ≠ classification ≠ recommendation

**Target:** these three concerns remain cleanly separated modules with no shared mutable state.
Classification produces resolved facets. Capabilities are pure predicates over resolved facets.
Recommendation maps a trip envelope to capability requirements and evaluates them against the
user's closet.

**Current state:** this is ALREADY the design — `src/core/capabilities/`, `src/core/recommend/`,
and `src/core/classify/` (or equivalent) are distinct modules, and the ADR-0003/ADR-0005 contracts
enforce the separation. This is a strength to preserve, not an area of work.

**No action required here;** record it explicitly so future contributors know the separation is
intentional and load-bearing.

---

### Migration sequence

Each phase is a shippable increment with its own follow-up ADR. The phases are sequenced so that
each one improves the system without breaking the invariants established by the prior phase.

```
Phase 1 — Resolver keystone [in progress]
  └─ src/core/resolve/ with explicit resolve(claims[]) and the documented precedence table
  └─ Absorbs: merge.ts implicit manufacturer overlay, derived_from_material wiring (ADR-0011 §14.6)
  └─ Output: the existing ItemClassification contract becomes the resolver *output* shape
  └─ No schema change; no UI change; no breaking change to callers

Phase 2 — Cache split [immediate follow-up to Phase 1]
  └─ Replace classification_cache with: llm_draft_cache (global) + user_overrides (user_id-scoped)
  └─ canonical_facts deferred until Element 1 (canonical products) is built
  └─ Fixes the cross-tenant correction leakage documented in ADR-0007
  └─ Requires: schema migration, RLS on user_overrides, wiring update in src/core/cache.ts

Phase 3 — Evidence store + claims-based LLM [the heart of the migration]
  └─ New item_evidence table holding multiple competing claims per (item_id, facet_key)
  └─ LLM prompt updated: output claims array + unresolvedQuestions (new Zod schema)
  └─ Resolver wired to read from item_evidence and write resolved values to items columns
  └─ pending_facets preserved and integrated (novel keys → item_evidence as unresolved claims)
  └─ Requires: schema migration, new prompt, new Zod claims schema, resolver wiring

Phase 4 — Canonical products + identity matching
  └─ canonical_products table (global, brand/line/model/variant/SKU)
  └─ user_items.canonical_product_id (nullable FK)
  └─ canonical_facts cache tier (global, linked to canonical_products)
  └─ Enables: photo/barcode enrichment (unlocked backlog), catalog gap-fill (Phase 3 step 4)
  └─ Requires: schema migration, identity-matching logic, canonical_facts wiring

Phase 5 — Versioned snapshots + reclassification
  └─ schema_version, resolver_version, classifier_version on items
  └─ SCHEMA_VERSION / RESOLVER_VERSION constants incremented on ontology / policy changes
  └─ Reclassification query: items WHERE schema_version < current OR classifier_version != MODEL_ID
  └─ UI surface: "N items need re-review" with batch re-classify option
  └─ Requires: schema migration, version constant management, UI

Phase 6 — Impact-ranked targeted review
  └─ Review UI surfaces only recommendation-impacting unknowns, ranked by blocked capability severity
  └─ Derived from live capability evaluation output (module already exists)
  └─ No schema change; pure UI and routing logic
```

---

## Relationship to prior ADRs

This ADR **extends** the decisions recorded in ADR-0003 through ADR-0011. It does not supersede
any of them. Specifically:

- **ADR-0003** (capability-first hybrid storage) — the resolver and evidence table are built on
  top of the existing hybrid schema. Hot columns, composable group tables, and the JSONB tail are
  unchanged. The registry-gates-hot invariant (capability-gated facets must be hot columns or
  group fields) is preserved: the resolver writes resolved values to those same hot columns.
- **ADR-0004** (LLM classification contract) — the evidence-shape contract (`Evidence<T>`,
  `HardFact<T>`, the demotion guard) is preserved and promoted. In the target architecture the
  demotion guard runs on claims entering the evidence store (Phase 3) rather than on the LLM
  output blob; the mechanical protection is the same.
- **ADR-0007** (classification cache) — the cache split (Element 5 / Migration Phase 2) directly
  addresses the cross-tenant trade-off documented in ADR-0007 as a known limitation. ADR-0007
  is not superseded but its Consequences section should be read with this ADR's Element 5 as the
  resolution path. The ADR-0007 `source` provenance hierarchy is preserved in the split stores.
- **ADR-0011** (manufacturer URL enrichment) — the resolver (Migration Phase 1) absorbs the
  implicit merger in `src/core/enrich/merge.ts`. The `source:"manufacturer"` precedence rule
  documented in ADR-0011 §D becomes the explicit resolver policy. ADR-0011 is not superseded.

---

## Alternatives rejected

### Keep the LLM returning a final `ItemClassification` shape (no claims layer)

The current design. It works and is simple. Rejected as the permanent architecture because:

- The LLM can infer a plausible-looking value even for hard facts it cannot know. The demotion
  guard catches this mechanically, but the guard's scope is limited to facts where `source` is
  not a stated source — the LLM can still fabricate a confident `inferred` value for a soft
  facet and have it persist unquestioned. A claims model where the resolver ranks sources makes
  the fabrication problem structural, not guard-dependent.
- There is no way to represent "the manufacturer said X and the LLM said Y; the manufacturer
  wins" as a queryable fact. The merger in `merge.ts` resolves this silently and the resolution
  disappears. Auditing a facet value means reading code, not data.
- As source count grows (`manufacturer`, `derived_from_material`, `barcode`, future enrichment
  sources), each new source requires a new merge code path. A resolver function that takes a
  `claims[]` array is O(1) code growth for O(N) new sources.

### Big-bang rewrite: replace the current schema all at once

Replace `items` columns, the cache, and the LLM contract simultaneously. Rejected because:

- The current system is in production (Phase 3 users); any non-atomic migration risks data loss
  or broken classifications mid-flight.
- The phased sequence (Phases 1–6 above) delivers value at each step. The resolver (Phase 1)
  improves correctness immediately with no schema change. The cache split (Phase 2) fixes the
  cross-tenant security concern before it affects real users. The evidence store (Phase 3) is the
  most complex change and benefits from the resolver and split being stable before landing.
- Each phase can be gated and verified independently; a big-bang cannot.

### Separate combinability oracle (deciding which items can be compared across sources)

A separate service or module that decides whether two claims for the same facet from different
sources can be compared. Rejected: the resolver's precedence table already encodes this decision
for the current source set. Adding a combinability oracle introduces indirection without benefit
for a bounded, well-understood set of source types. If the source set grows to include types with
genuinely incomparable semantics (e.g. user subjective ratings vs. lab measurements), this
alternative can be re-evaluated.

---

## Consequences

### What improves immediately (Phase 1 — resolver keystone)

- Provenance precedence is no longer implicit code in `merge.ts` and the demotion guard; it is a
  documented, testable function with an explicit policy table.
- `derived_from_material` facts (the material behavior derivation engine, ADR-0011 §14.6) have a
  defined place in the precedence hierarchy and a concrete module to land in.

### What improves in Phase 2 (cache split)

- A user's correction to a named item no longer silently affects other users' classifications.
  The cross-tenant security concern documented in ADR-0007 is resolved.
- Per-user cache entries can be inspected, exported, and deleted per GDPR/data-subject rights
  without touching the global LLM draft cache.

### What improves in Phase 3 (evidence store + claims LLM)

- Every facet value on every item has a queryable provenance trail.
- Multiple competing claims for the same facet coexist and can be inspected ("the LLM said
  `fill_power: 700`; the manufacturer page says `fill_power: 650`; manufacturer wins").
- Re-running the resolver when new evidence arrives (a new URL enrichment, a model update)
  produces an updated resolved value without re-running the full classification pipeline.
- `unresolvedQuestions` from the LLM surface as targeted prompts in the review UI, reducing
  silent unknowns without inviting fabrication.

### Invariants that must be preserved throughout

- **Unknown is first-class.** Every migration phase must preserve the `null + unknown` state for
  both `Evidence<T>` and `HardFact<T>`. No phase may introduce a "default to inferred" path.
- **Capability gates must be hot.** The resolver writes resolved values to the same hot columns
  the capability predicates read. No phase may route a capability-gated facet through JSONB.
- **The demotion guard is mechanical, not prompt-dependent.** In the target (Phase 3), the guard
  runs on claims entering the evidence store. Until Phase 3 lands, it continues to run on the
  Zod-validated LLM output exactly as today.
- **The gauntlet remains hermetic.** Each migration phase must keep `pnpm typecheck && pnpm test`
  green with no env vars set. The resolver, claims schema, and evidence table must be testable
  with a mock LLM client and offline fixtures.
- **Layer separation is non-negotiable.** Classification → capabilities → recommendation is a
  directed dependency, not a loop. No phase may introduce a call from capabilities back into the
  classifier, or from the recommendation layer into the evidence store directly.
