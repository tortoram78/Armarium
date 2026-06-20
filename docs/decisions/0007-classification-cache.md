# 0007 — Classification cache: self-building knowledge base

**Status:** Accepted
**Date:** 2026-06-20
**Full implementation:** `src/core/cache.ts` · `src/core/ports.ts` (ClassificationCacheRepository) ·
`src/server/memory-cache.ts` · `src/server/postgres-cache.ts` · `src/db/schema.ts` (classificationCache) ·
`src/server/app-service.ts` (classifyToDraft, confirmDraft, updateItemClassification)

---

## Context

Every time a user adds an item by name, the live classification path makes a real LLM call. Two
problems follow from that:

1. **Redundant cost and latency.** Adding the same (or identically-named) item twice calls the
   model twice and may produce slightly different facet assignments — model drift introduces
   non-determinism into the data.
2. **User corrections disappear.** If a user reviews the draft classification, corrects a facet
   (e.g. sets a hard `fill_power` or fixes `waterproofness`), confirms the item, and later
   re-adds the same item (after deletion or on another device), the correction is gone. The
   model will produce the same imprecise initial classification again.

The goal is a **classification knowledge base** — a persistent store of validated classifications
keyed by item identity — so that repeat adds are instant (no LLM call) and user corrections
accumulate durably. Review-before-save remains the safety valve regardless of whether a result
came from the cache or from a live LLM call.

---

## Decision

### Cache structure

The KB is a table of `(key, name, classification, source, modelId, createdAt, updatedAt)` rows.
The `key` is a normalized string derived from the item name. `classification` is the full
`ItemClassification` jsonb, identical to the shape stored in `items.classification` — it rounds
trips losslessly and is Zod-validated at every write. `source` encodes provenance:

- `"seed"` — pre-populated from the prototype corpus; present in the in-memory impl at startup.
- `"llm"` — written by `classifyToDraft` on a cache miss, using `MODEL_ID` at classification
  time. `modelId` records the exact model string for drift tracking.
- `"user"` — written by `confirmDraft` (confirmation endorses the full reviewed classification)
  and by `updateItemClassification` (an explicit facet correction). User entries are authoritative:
  no higher-precedence source exists.

On a cache HIT the stored classification is reused directly; the LLM is not called. On a MISS
the live (or offline) classifier runs and writes the result back as `source:"llm"`. In both cases
the review-before-save draft lifecycle still applies — the cache speeds up the classification
step, it does not bypass review.

### Key design: name only (v0)

`normalizeCacheKey(name)` in `src/core/cache.ts` lowercases, accent-folds, collapses
punctuation to spaces, and trims. The result keys on the item **name alone**.

This is a deliberate v0 scope decision. Name-only keying means a correction to "Patagonia
Nano-Air Hoody" improves every future add of that string, without needing the user to fill in
brand or model fields first. It is the minimum viable KB that produces real reuse immediately.

The known limitation is that two genuinely different products with the same name (or two different
models from the same brand) would share a cache entry. In practice this is rare for specific gear
names; the review step catches any mismatch. Keying on `normalizeCacheKey(brand + " " + model)`
once those fields are filled in is the natural next refinement (documented below under Caveats).

### Corrections feed the KB

The KB improves with use through two write paths:

1. **Confirm draft** (`confirmDraft`): when the user reviews and confirms a draft item, the
   full confirmed classification is upserted as `source:"user"`. The user's act of confirming
   is an endorsement — even if no individual facet was changed, they saw it and accepted it.
2. **Update classification** (`updateItemClassification`): when the user explicitly corrects a
   facet via the hard-fact editor or the facet editor, the corrected classification is upserted
   as `source:"user"`. Because the user is an authoritative source, a corrected hard fact
   (fill_power, temp_rating, seam_sealing, capacity_liters, UPF) carries `source:"user"` through
   the `HardFact` wrapper and survives the mechanical demotion guard — meaning it actually moves
   a capability outcome, not just the display.

These two paths are why the KB is "self-building": every confirm and every correction makes the
next add of the same-named item better.

### Implementations

**In-memory** (`src/server/memory-cache.ts`): a `Map<string, CachedClassification>` seeded
lazily from `SEED_CORPUS` on first access (entries get `source:"seed"`). Used when no
`DATABASE_URL` is set. Data is ephemeral (lost on restart), but build, test, and dev need no
external service.

**Postgres** (`src/server/postgres-cache.ts`): Drizzle ORM over the `classification_cache` table
(see `src/db/schema.ts`). `putCached` upserts via `onConflictDoUpdate`; `createdAt` is preserved
on collision (only `updatedAt`, `classification`, `source`, and `modelId` are overwritten). The
client is the same lazy singleton used by the main repo — importing the module has zero
connection side effects; no `DATABASE_URL` is needed at build or test time.

`getCacheRepository()` in `src/server/services.ts` currently returns `memoryCache` in both
branches (the Postgres branch wiring is noted as the next schema-db-owner task once the migration
for `classification_cache` lands). This is the expected in-progress state; the interface and both
implementations exist.

### Review as safety valve

The cache never bypasses the review-before-save step. `classifyToDraft` stores every result —
cache hit or LLM result — as a draft (`draft: true`, excluded from the closet). The user must
explicitly confirm. This means a stale or imprecise cache entry is caught at review time, not
silently absorbed into the closet.

---

## Alternatives considered

**Name + raw text as the key.** Rejected. The raw text varies per-add (a user might type
slightly different descriptions). This would dramatically reduce cache reuse — essentially making
every add a miss — while adding complexity. Name is the stable identity signal for v0.

**Embedding-based similarity matching.** Rejected for Phase 2. A vector similarity lookup
would handle name variations ("Nano Air" vs "Nano-Air Hoody") but introduces a vector DB or
embedding API dependency, which is out of scope. The normalized key handles common punctuation
and casing variation without any external service.

**Skip the cache; always classify.** Rejected. Non-determinism across calls for the same item
means facet values drift between sessions; correction value evaporates on re-add; cost and
latency are unnecessary for items already seen. The KB directly solves these.

**One combined cache+items table.** Rejected. The KB is intentionally reference data (not
user-owned) so that a user correction to a named item improves the cache for all users (in a
multi-user future). Sharing the `items` table would couple the KB to the per-user row lifecycle;
the standalone `classification_cache` table mirrors the existing global `materials` and
`treatments` tables in that regard.

---

## Known caveats (v0)

- **Name-only keying:** two distinct products with the same name share a cache entry. Mitigated
  by the review step. Future refinement: key on `normalizeCacheKey(brand + " " + model)` once
  those fields are reliably populated.
- **Offline classifier rejects novel items:** `classifyOffline` throws for any name not in the
  prototype corpus. The live miss→classify path therefore requires `ANTHROPIC_API_KEY`. The in-
  memory cache is pre-seeded with corpus items so all prototype names are instant hits offline;
  only genuinely new items need the key.
- **Model-version drift:** `modelId` is recorded on every LLM-derived cache entry. A future
  cache-invalidation pass could evict or re-classify entries written by an older model. No
  automatic invalidation is built yet.
- **Postgres branch not yet wired in `getCacheRepository()`:** `services.ts` returns `memoryCache`
  in both branches pending the migration for `classification_cache`. The table definition and the
  Postgres impl are already complete; wiring is the remaining step.

---

## Consequences

- Repeat adds of a known item are instant (no LLM call) and deterministic (same classification
  every time unless the user has corrected it).
- User corrections accumulate durably and propagate to future adds — the app gets more accurate
  with use.
- `model_id` on each entry creates an audit trail for future drift analysis and targeted
  re-classification.
- The `source` field encodes a clear provenance hierarchy: `"user"` beats `"llm"` beats `"seed"`;
  no automatic override goes the other direction.
- The Postgres impl is already written (`postgres-cache.ts`); the remaining work is wiring
  `getCacheRepository()` to select it when `DATABASE_URL` is set, which is tracked in the
  near-term roadmap.
