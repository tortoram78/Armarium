# ADR-0026 — Apparel domain ontology: second modeled domain

**Status:** Accepted
**Date:** 2026-06-26
**Phase:** Closet-database (extension of ADR-0023 three-ring possession model)

---

## Context

ADR-0023 established the three-ring possession model and declared apparel an extension point:
`domains = ['apparel']` is storable and queryable from day one, but the domain's own facet
ontology, classifier configuration, and capability predicates were explicitly deferred pending a
dedicated design section and ADR. DESIGN.md §20 named "apparel as a second fully-modeled domain"
as the immediate designed-next item after Phase 5. This ADR is that design, now shipped.

Armarium's defining invariant (CLAUDE.md rule #1, ADR-0003) is that grouping and recommendations
are **emergent queries over the facet space** — there are no hardcoded category buckets or routing
discriminators. Any apparel ontology must be held to the same standard: "business attire" and
"machine-washable tops" must fall out of facet queries, not from a `garment_type` enum that the
code switches on.

The gear domain is the template. The pattern is: one new facet group in the registry, all soft,
no new group tables if no apparel facet gates a capability, classifier prompt broadened, offline
corpus posture unchanged.

---

## Decision

### Facet group `apparel` in the registry

A new `apparel` group is added to the facet registry (`src/core/facets/registry.ts`). All six
apparel-specific facets are **soft, non-capability-gating, tier `jsonb`**. They live in the
always-persisted `items.classification` JSONB bag with **no migration and no new group table**.

This contrasts deliberately with the gear domain's group tables (`item_insulation`, `item_shell`,
`item_carry`, `item_footwear`, `item_sleep`), which exist because those facets gate capability
predicates (`rain_protection`, `wicking_base`, `packable_insulation`, etc.) and must be hot-path
Postgres columns. Apparel has no equivalent capability gates in this phase — the facets enable
browsing, outfit reasoning, and curation queries, not safety-critical packing recommendations.
The invariant "a capability gate may never live in JSONB" (ADR-0003, §3.5) is preserved: there
are simply no apparel capability gates yet.

| Facet | Kind | Levels / members | Fact | Notes |
|-------|------|-----------------|:----:|-------|
| `garment_role` | multilabel | `top / bottom / dress / outerwear / underlayer / footwear / headwear / accessory / full_body` | soft | The structural facet. Analogous to `layering_role` for gear. Enables outfit assembly queries (a top + a bottom, or a dress alone). Open-ended: a hoodie is `[top, outerwear]`. |
| `formality` | ordinal | `loungewear < casual < smart_casual < business_casual < business < formal` | soft | Enables "work wardrobe" and "evening" queries as range predicates, never a routing key. |
| `fit` | nominal | `slim / tailored / regular / relaxed / oversized` | soft | |
| `pattern` | nominal | `solid / striped / plaid / checked / floral / graphic / colorblock / other` | soft | |
| `care` | multilabel | `machine_wash / hand_wash / dry_clean / line_dry / tumble_dry / iron` | soft | "Machine-washable tops" = `garment_role ∋ top AND care ∋ machine_wash`. |
| `occasion` | multilabel | `work / everyday / athletic / evening / formal_event / lounge / travel / outdoor` | soft | |

### Reuse of universal fabric facets

Clothing is fabric. Apparel items reuse the universal behavioral facets already modeled on every
`items` row — `warmth`, `breathability`, `moisture_management`, `conditions_fit`, and the full
`item_insulation` sub-model — without duplication. An insulated down jacket classified as apparel
carries `garment_role: [outerwear]` from the apparel group AND `fill_type: down` from
`item_insulation`, exactly as it would if it were gear only. The materials model is similarly
shared: fabric composition and construction type belong to the `materials` library regardless
of domain.

### Cross-domain items: `domains = ['gear', 'apparel']`

An item can occupy both domains simultaneously. A merino base layer is
`domains: ['gear', 'apparel']` with `layering_role: [next_to_skin, base]` (gear) and
`garment_role: [top, underlayer]` (apparel). A rain shell is the same. The UI renders each
domain's facet section when that domain is present in `domains`; the domain-gated display pattern
from Phase 1 (`isGearClassified`) generalizes per-domain.

`modeledDomainsOf(item)` — the helper that inspects which domains an item shows populated facet
signal in — drives this rendering. `domains` is set from actual facet signal after classification,
never fabricated up front.

### Reconciliation with the no-hardcoded-buckets invariant

`garment_role`, `occasion`, and `formality` are **dimensions queried emergently**, never routing
discriminators. Examples:

| Query intent | Facet predicate | No routing key involved |
|---|---|---|
| "Business attire" | `formality ≥ business_casual` | ✓ |
| "Machine-washable tops" | `garment_role ∋ top AND care ∋ machine_wash` | ✓ |
| "Summer dresses" | `garment_role ∋ dress AND conditions_fit ∋ warm` | ✓ |
| "Outfit: top + bottom" | `garment_role ∋ top` paired with `garment_role ∋ bottom` | ✓ |

No code path reads `garment_role` as a switch/if that routes to a different recommendation branch.

### Classification

The classifier prompt is broadened from "a piece of outdoor gear" to "a wearable or piece of
outdoor gear." For items that show apparel signal, the classifier emits the six apparel facets
alongside the universal facets. `domains: ['apparel']` (or `['gear', 'apparel']`) is set by
the enrichment pipeline based on that signal.

The offline corpus used by `offlineClassify` stays gear-focused (no change). Live apparel
classification is verified on Vercel after deploy — the same posture as all other LLM features:
pure/hermetic for the Zod validation and the demotion guard; live for the model call itself.

---

## Alternatives considered

**`garment_type` as a single-value enum routing recommendations.** A `garment_type: 'dress' |
'shirt' | 'jacket' | …` column that drives conditional recommendation logic would replicate
the category anti-pattern ADR-0003 was written to prevent. A dress cannot route to a single
"dress" branch when it also has warmth, breathability, and occasion facets that determine its
actual utility. Rejected outright.

**A separate `item_apparel` group table (now).** A 1:1 group table is appropriate only when a
facet gates a capability predicate — the invariant requires hot-path storage for such facets.
No apparel facet in this phase gates a capability. Adding a group table without a capability gate
is premature infrastructure that adds migration overhead and schema surface area for no query
benefit. JSONB is the correct tier. Rejected until an apparel capability gate is designed.

**Modeling apparel as gear with stretched semantics.** Assigning a blazer to `layering_role:
[static_insulation]` or `activity_fit: [everyday]` would pollute the gear facet space with
semantically incorrect values and corrupt the capability predicates that depend on those facets
for packing recommendations. Gear facets describe outdoor behavioral properties. Apparel facets
describe social/structural garment properties. The domains are complementary, not synonymous.
Rejected.

---

## Consequences

### What is better

- A real wardrobe application falls out of the same engine that already runs gear packing. The
  user can record a blazer, a sundress, or an athleisure set with meaningful facet coverage
  alongside their outdoor gear — no parallel codebase, no separate product table.
- Outfit and occasion reasoning (`garment_role`, `formality`, `occasion`) is now expressible as
  facet queries. The combination logic in the capability layer (ADR-0010) is designed-for
  extension to outfit assembly once apparel capability predicates are defined.
- Zero migration. All six apparel facets land in the existing `items.classification` JSONB bag.
  No schema change, no backfill, no downtime.
- The domain-gated UI from Phase 1 generalizes per-domain without new routing. Adding a third
  domain (electronics, collectibles) follows the identical pattern.

### Known limitations / deferred

- **Apparel capability predicates** (size-range fit, care compatibility, seasonal suitability,
  occasion match) are not defined in this phase. They require their own DESIGN.md section and
  ADR before implementation. Until then, apparel items never satisfy or fail a capability gate —
  they are inventory-visible and query-accessible but are excluded from trip packing picks (same
  as the all-unknown floor for unclassified gear items).
- **Apparel-specific enrichment.** The web-search enrichment allowlist (ADR-0020) and the
  manufacturer URL enrichment pipeline (ADR-0011) are today tuned to outdoor/gear brands. Apparel
  brand coverage is a fast-follow requiring additions to the allowlist and, where relevant, an
  updated parser for fashion retailer product pages.
- **Apparel-to-gear bridge.** For items in `domains: ['gear', 'apparel']`, the classifier must
  emit both domain's facets coherently. Prompt engineering for this dual-signal case is verified
  on deploy; conflicts (e.g., an item the model assigns high `formality` but also `layering_role:
  [weather_shell]`) are resolved by the existing provenance-precedence rules — no new conflict
  logic is introduced.
