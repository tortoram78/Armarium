# ADR-0021 — Inventory layer + ownership-status lifecycle replacing the inInventory boolean

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** Closet-database Phase 1 (possession-model inversion)

---

## Context

The current schema expresses ownership as a single boolean column `inInventory` on `items`.
This encoding has three concrete gaps that block the intended product:

1. **No lifecycle.** A user who loans a piece of gear to a friend, retires a worn-out item,
   or sells it has no way to record that state. The boolean collapses "I have this" and
   "I might want this" into one bit and has no room for loaned / retired / sold transitions.

2. **No acquisition or condition metadata.** A useful personal inventory database needs to
   record *when* something was bought, *what was paid for it* (distinct from the manufacturer's
   MSRP already in `priceCents`), *where it was acquired*, its current *condition*, and
   *where it is stored*. None of these are personal-preference fields — they are facts about
   a specific possessed object that are invisible to the current schema.

3. **Inventory metadata in the wrong bucket.** Putting per-possession facts (price paid,
   acquisition date, condition, location) into the behavioral-classification JSONB column
   would conflate canonical product specifications with personal-ownership state — the same
   anti-pattern Discogs avoids by separating canonical album data from per-copy overlay data.
   Inventory data is user-owned, mutable, and personal; classification facets are derived from
   the product, validated through the evidence contract (ADR-0004), and shared with the cache
   (ADR-0007). They must be stored in different structures.

This ADR records the decision to replace `inInventory` with a typed `ownership_status` enum
and to add a full inventory layer as typed columns on `items`, addressed as part of the
closet-database inversion described in ADR-0022 and ADR-0023.

---

## Decision

### Ownership status lifecycle

Replace `inInventory boolean` with:

```
ownership_status  text  NOT NULL  DEFAULT 'owned'
```

Valid values (closed set, enforced at the Zod boundary):

| Value | Meaning |
|-------|---------|
| `owned` | In the user's possession right now |
| `wishlist` | Desired but not yet owned |
| `loaned` | Currently in someone else's possession |
| `retired` | Kept but no longer in service (worn out, archived) |
| `sold` | Disposed of; kept for reference / price history |

**Migration:** backfill — `inInventory = true` → `'owned'`; `inInventory = false` → `'wishlist'`.
`inInventory` is **retained as a deprecated mirror column in Phase 1** (maintained by a
trigger or application-layer sync to avoid breaking any in-flight callers) and removed in a
subsequent cleanup migration. No data is lost.

Recommendations and trip-packing queries filter to `ownership_status = 'owned'` OR items
explicitly included by the user. Items with status `'loaned'`, `'retired'`, or `'sold'` are
excluded from capability evaluation by default and surfaced as a separate closet view.

### Inventory layer — typed columns on `items`

The following columns are added in one additive migration. All are nullable (absent = not
recorded, not zero):

| Column | Type | Notes |
|--------|------|-------|
| `quantity` | `integer DEFAULT 1` | Number of identical items owned; 1 for most gear |
| `condition` | `text` nullable | `'new' \| 'good' \| 'worn' \| 'end_of_life'` |
| `acquired_at` | `date` nullable | Date of purchase/acquisition |
| `price_paid_cents` | `integer` nullable | What the user paid — **distinct from `priceCents`** (MSRP) |
| `acquired_from` | `text` nullable | Retailer or source (free text; "REI", "eBay", "gift") |
| `storage_location` | `text` nullable | Where the item lives ("hall closet", "gear room shelf 2") |
| `size` | `text` nullable | User-recorded size label (free text) |
| `color` | `text` nullable | User-recorded color (free text) |
| `user_notes` | `text` nullable | Freeform personal notes |
| `domains` | `text[] DEFAULT '{}'` | GIN-indexed; see ADR-0023 |

**`price_paid_cents` is strictly the amount the user paid for their specific unit.**
It is a personal ownership fact, not a product specification. The existing `priceCents` column
records the manufacturer's suggested retail price extracted during enrichment
(ADR-0011 / ADR-0020) and carries a `priceSource` provenance column — that contract is
unchanged. Conflating the two numbers is an anti-pattern (a user buys a jacket on clearance
for $89; the MSRP is $249; both facts are useful and are not the same fact).

### The typed-columns-not-JSONB rule

Inventory metadata is **never stored in `items.facets` (the classification JSONB bag)**.

The JSONB bag's contract is: behavioral facet data that passed through the LLM classification
pipeline and the evidence validator, governed by the facet registry, potentially shared with
the classification cache. Inventory data does not meet any of those criteria — it is personal,
mutable, never classified by the LLM, and never shared between users. Mixing the two would
break the provenance model (ADR-0004), invalidate the cache contract (ADR-0007), and make the
evidence resolver (ADR-0012) unable to distinguish a manufacturer-stated weight from a user's
note about where they store an item.

Collections and user-defined tags are **deferred to Phase 4** and will be join tables when
they arrive, not additions to the JSONB bag.

### `classification` stays NOT NULL

Record-only items and non-gear items carry the existing `unknownBehavioralClassification(name)`
envelope — all facets unknown, confidence `'unknown'`, source `'unknown'`. Making `classification`
nullable is explicitly deferred as a future schema cleanup; it is not part of this ADR. This
preserves the downstream contract: all code paths that read classification data can assume the
field is present (though all values may be unknown).

---

## Alternatives considered

**Keep two booleans (`inInventory` + `onWishlist`).** A second boolean does not solve the
lifecycle problem — `loaned`, `retired`, and `sold` states still have no representation and
would require a third, fourth, fifth boolean. Boolean proliferation is the anti-pattern a
status enum is designed to replace. Rejected.

**Per-item pricing parity with Sortly / AnyList (inline market-value tracking, depreciation
schedules, insurance-appraisal fields).** Introduces financial data that is out of scope for a
gear-management and packing tool, requires ongoing per-item market data to be useful, and
raises privacy/export concerns. `price_paid_cents` covers the inventory-record use case (cost
basis, value of collection at a glance) without modelling depreciation or market value. More
complex pricing features are a Phase 4+ discussion. Rejected for v1.

**Storing inventory metadata in the classification JSONB.** The JSONB bag is governed by the
facet registry and the evidence contract (ADR-0004). Inventory data is user-owned and mutable;
it is not a behavioral facet, has no confidence level, no LLM source, and must never influence
the evidence resolver. Mixing inventory state into classification data is the exact
canonical-specs-vs-personal-overlay anti-pattern this section of the design rejects. Rejected.

---

## Consequences

### What is better

- The ownership lifecycle is now fully representable: a loaned item stays visible in the
  closet, trip planning excludes it by default, and the user can track when it comes back.
- Acquisition facts (date, price paid, retailer) are typed, indexed, and queryable — enabling
  future views like "total spent," "items acquired this year," or "items from REI."
- Condition supports a natural "time to replace" workflow: the user marks an item `'end_of_life'`
  and it surfaces as a gap candidate in trip planning.
- The MSRP / price-paid distinction is explicit in the schema, preventing the confusion that
  arises when a single `price` column mixes product-spec and personal-purchase data.

### Invariants preserved

- `classification` stays NOT NULL (all-unknown envelope, not nullable), preserving every
  downstream reader's contract.
- The classification JSONB bag remains strictly for evidence-shaped behavioral facet data.
- `unknown-is-first-class` is unaffected: inventory fields are nullable by design; absent =
  not recorded, never fabricated.
- No hardcoded category or domain routing is introduced (see ADR-0023 for `domains`).
