# ADR-0014 — Evidence store + claims-based LLM (Phase 3 of the evidence-architecture migration)

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 3 (evidence-architecture) — concrete implementation of ADR-0012 Elements 2 + 4

---

## Context

ADR-0012 established the target architecture for evidence-first classification and defined a
six-phase migration sequence. Phases 1 and 2 are complete:

- **Phase 1 — Resolver keystone** (`src/core/resolve/`): `resolveFacet`, `SOURCE_PRECEDENCE`,
  and `resolveBehavioralFacets` are built and in production. The precedence order
  (`user > manufacturer > derived_from_material > inferred > unknown`) is now an explicit,
  tested policy — no longer implicit code in `merge.ts`.
- **Phase 2 — Cache split** (ADR-0013): `classification_cache` has been replaced by
  `llm_draft_cache` (global, low-authority) + `user_overrides` (per-user, RLS-scoped). The
  cross-tenant correction leakage documented in ADR-0007 is resolved.

This ADR records the **concrete implementation contracts** for Phase 3: the `item_evidence` table
(ADR-0012 Element 2) and the claims-based LLM output (ADR-0012 Element 4).

### The problem this phase solves

Today the LLM emits a final `ItemClassification` — the resolved shape that is immediately
persisted to the `items` hot columns and `classification` JSONB. This has two structural limits:

1. **No provenance audit trail per fact.** Once a classification is written, it is impossible to
   answer "did the LLM assert this value, or did the manufacturer page state it, or did the user
   correct it?" The `*_src` columns on `items` carry the WINNING source but not the competing
   claims that were considered and lost. There is nothing to inspect, re-resolve, or export.

2. **Re-running the LLM is the only path to updating a single facet.** When a new URL enrichment
   arrives, or when the user corrects one facet in the review UI, the current code re-runs the
   full classification pipeline for that item. There is no mechanism to append a new claim for one
   facet and re-resolve only that facet without touching the others.

The resolver (Phase 1) is the correct engine for adjudicating competing claims. But today the
resolver only sees two claims at once (LLM + derived). Phase 3 gives it the full claim set — from
every source, persisted per `(item_id, facet_key)` — so resolution becomes a durable, queryable,
re-runnable operation.

### What already exists and must be preserved

| Piece | Location | Status |
|---|---|---|
| `Claim<V>` type, `SOURCE_PRECEDENCE`, `resolveFacet` | `src/core/resolve/resolve-facet.ts` | Solid — Phase 1 |
| `resolveBehavioralFacets` | `src/core/resolve/behavioral.ts` | Solid — Phase 1 |
| `Evidence<T>`, `HardFact<T>`, `hardFact` demotion preprocessor | `src/core/evidence.ts` | Solid — ADR-0004 |
| `SOURCE` enum: `manufacturer \| user \| inferred \| derived_from_material \| unknown` | `src/core/evidence.ts` | Solid |
| `ItemClassification` Zod schema and `parseClassification` | `src/core/classification.ts` | Solid — shape UNCHANGED |
| `pending_facets` table (novel LLM extractions parked, never silently dropped) | `src/db/schema.ts` | Solid — ADR-0004 |
| Per-facet `*_src` / `*_conf` hot columns on `items` + group tables | `src/db/schema.ts` | Solid — ADR-0003 |
| Lossless `classification` JSONB column on `items` | `src/db/schema.ts` | Solid — ADR-0006 |
| `llm_draft_cache` + `user_overrides` tables | `src/db/schema.ts` | Solid — ADR-0013 |
| Capability / recommendation layer separation | `src/core/capabilities/`, `src/core/recommend/` | Solid — ADR-0005 |

---

## Decision

### 1. The `item_evidence` table

A new Postgres table `item_evidence` holds every claim ever made about a facet of an item. Multiple
rows with the same `(item_id, facet_key)` are explicitly allowed — that is the point. The item's
existing hot columns and `classification` JSONB remain the RESOLVED snapshot; `item_evidence` is
the provenance backing store.

#### Schema (Drizzle column names → Postgres column names)

| Drizzle field | Postgres column | Type | Notes |
|---|---|---|---|
| `id` | `id` | `uuid` PK, `defaultRandom()` | Stable row identity for updates / GDPR deletion |
| `itemId` | `item_id` | `uuid` NOT NULL, FK → `items.id ON DELETE CASCADE` | Cascade ensures no orphan evidence on item delete |
| `facetKey` | `facet_key` | `text` NOT NULL | Dot-namespaced: `"universal.warmth"`, `"identity.brand"`, `"multilabel.layering_role"`, `"groups.insulation.fill_power"`, `"materials[0].fiber_components"` |
| `value` | `value` | `jsonb` NOT NULL | Scalar for ordinals (`"high"`); array for multilabel (`["base","mid_layer"]`); number for numerics; boolean for booleans |
| `confidence` | `confidence` | `text` NOT NULL | `"low" \| "medium" \| "high" \| "unknown"` (mirrors `ClaimConfidence`) |
| `source` | `source` | `text` NOT NULL | `SOURCE` enum values: `"inferred" \| "manufacturer" \| "derived_from_material" \| "user" \| "unknown"` |
| `sourceUrl` | `source_url` | `text` NULL | The manufacturer page URL when `source = "manufacturer"`, else NULL |
| `extractorVersion` | `extractor_version` | `text` NULL | `"llm-claims-v1"`, `"manufacturer-url-v1"`, `"material-derive-v1"`, etc. Tracks which extractor version produced this claim |
| `evidence` | `evidence` | `text` NOT NULL | The evidence / rationale string (same semantics as the `evidence` field on `Evidence<T>`) |
| `observedAt` | `observed_at` | `timestamptz` NOT NULL, default `now()` | When the claim was first observed (e.g. when the LLM ran, when the URL was fetched) |
| `createdAt` | `created_at` | `timestamptz` NOT NULL, default `now()` | Row insertion time |

**Index:** `(item_id, facet_key)` — the primary access pattern is "all claims for this item's
facet"; this index makes that lookup and the per-item delete-all efficient.

#### RLS (the subtype-table pattern from `drizzle/0003`)

`item_evidence` carries no `user_id` column directly — it is a subtype table of `items`, which
does carry `user_id`. RLS enforces ownership via the parent:

```sql
CREATE POLICY "owner reads own item_evidence"
  ON item_evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM items
      WHERE items.id = item_evidence.item_id
        AND items.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "owner writes own item_evidence"
  ON item_evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM items
      WHERE items.id = item_evidence.item_id
        AND items.user_id = (SELECT auth.uid())
    )
  );
```

Delete and Update policies follow the same `EXISTS` pattern. The service-role connection (used by
server-side Drizzle) bypasses RLS; app-layer code always filters by `userId` on the parent `items`
join, consistent with the dual-layer enforcement model (ADR-0008).

`item_evidence` is not globally readable. A user cannot access another user's evidence rows
through either the PostgREST surface or the Drizzle app-layer path.

#### The `facet_key` namespace

`facet_key` uses dot notation to mirror the `ItemClassification` object path:

- `"identity.brand"`, `"identity.weight_grams"`, `"identity.price_cents"`
- `"universal.warmth"`, `"universal.waterproofness"`, `"universal.breathability"`, …
- `"multilabel.layering_role"`, `"multilabel.activity_fit"`, …
- `"groups.insulation.fill_power"`, `"groups.insulation.fill_type"`, …
- `"groups.shell.seam_sealing"`, `"groups.sleep.temp_rating_value"`, …
- `"materials"` (for material composition claims, `value` = JSON array)

Novel keys surfaced by the LLM that do not match the registry (currently parked in
`pending_facets`) are written to `item_evidence` with the novel key as `facet_key` AND also
remain in `pending_facets` for the human review queue — see section 5 below.

---

### 2. The claims-based LLM output contract

Today: the LLM emits an `ItemClassification` (the resolved shape). After Phase 3: the LLM emits
`LlmClaimsOutput` — an array of claims plus a list of things it could not determine.

#### `LlmClaimsSchema` (new Zod schema in `src/core/classification.ts` or a sibling file)

```typescript
// One claim from the LLM for one facet.
const LlmClaimSchema = z.object({
  facetKey:   z.string().min(1),             // dot-namespaced key (see §1 facet_key namespace)
  value:      z.unknown(),                    // validated further by the per-facet schema after resolution
  confidence: z.enum(["low", "medium", "high", "unknown"]),
  source:     z.literal("inferred"),          // LLM claims are always source:"inferred"
  evidence:   z.string().min(1),             // the LLM's stated rationale; never empty
});

export const LlmClaimsSchema = z.object({
  name:               z.string().min(1),     // the normalized item name (unchanged from current)
  claims:             z.array(LlmClaimSchema),
  unresolvedQuestions: z.array(z.string()), // things the LLM could not determine ("fill power not stated")
});

export type LlmClaim = z.infer<typeof LlmClaimSchema>;
export type LlmClaimsOutput = z.infer<typeof LlmClaimsSchema>;
```

`source` is locked to `"inferred"` in the LLM claim schema. The LLM cannot assert
`"manufacturer"` or `"user"` source — those values are only reachable through their respective
extractors (the URL enrichment pipeline and the user correction path).

#### The hard-fact demotion guard at the claim boundary

The `hardFact` Zod preprocessor (`src/core/evidence.ts`) currently runs when the LLM's full
`ItemClassification` blob is validated. In Phase 3, it runs **at the claim boundary** — when each
`LlmClaim` is coerced into the evidence store:

- An LLM claim with `facetKey = "identity.brand"` and a non-null `value` carries `source:
  "inferred"`. Brand is a hard fact; `source:"inferred"` is not authoritative. The demotion guard
  writes this claim to `item_evidence` with `value: null`, `confidence: "unknown"`, and an
  evidence string recording the demotion reason.
- The same claim with `source: "manufacturer"` (arriving via the URL enrichment extractor, not the
  LLM) passes the guard — `"manufacturer"` is authoritative for hard facts.

This preserves the ADR-0004 invariant mechanically: **an inferred hard fact has nowhere to live at
any system boundary, whether the old LLM output validation or the new claim ingestion.** The guard
is not prompt-dependent in either architecture.

#### `unresolvedQuestions`

`unresolvedQuestions` is a first-class output field. The LLM populates it when it cannot extract
a value for a facet from the available text — examples: `"fill power not stated on the product
name"`, `"temp rating unit unclear (F or C?)"`. These are surfaced in the review UI as targeted
prompts for the user to fill in or dismiss. They do not represent claims (they have no facet value)
and are not written to `item_evidence`. They are attached to the draft item's review payload.

`unresolvedQuestions` reduces silent unknowns without inviting fabrication: the LLM is asked to
surface what it does not know, rather than guessing a confident-sounding value.

---

### 3. The resolve flow (how claims become the resolved view)

After Phase 3, the classification pipeline runs as follows:

```
LLM call
  → LlmClaimsOutput (Zod-validated by LlmClaimsSchema)
  → hard-fact demotion guard on each claim with a hard-fact facetKey
  → write claims to item_evidence (source:"inferred", extractor_version:"llm-claims-v1")

manufacturer URL enrichment (when present)
  → ExtractedProduct → toManufacturerEvidence (unchanged)
  → write claims to item_evidence (source:"manufacturer", extractor_version:"manufacturer-url-v1")

material behavior derivation (when composition is available)
  → deriveFromComposition → DerivedFacets (unchanged)
  → write claims to item_evidence (source:"derived_from_material", extractor_version:"material-derive-v1")

user correction (when the user edits a facet in the review UI)
  → write a single claim to item_evidence (source:"user")

─── for each unique facet_key across all claims for this item ──────────────────────────────────
  resolveFacet(allClaimsForThisFacetKey)   ←  src/core/resolve/resolve-facet.ts (UNCHANGED)
  → winning Claim<V>
  → assemble ItemClassification (UNCHANGED shape)
─────────────────────────────────────────────────────────────────────────────────────────────────

persist:
  → item_evidence rows (all claims, including losing ones)
  → items hot columns updated to the resolved values (capability gates preserved)
  → items.classification JSONB updated to the resolved ItemClassification
```

Key properties of this flow:

- **`resolveFacet` is reused unchanged.** It already accepts `Claim<V>[]` and applies the
  precedence policy. Phase 3 widens the claim set it receives (from 2 claims to N claims from the
  evidence store) but does not change the function.
- **`ItemClassification` remains the contract that capability gates and the recommendation layer
  read.** It changes from being the LLM's output to being the resolver's output. The downstream
  shape is identical.
- **The hot columns remain the resolved snapshot.** Capability predicates in `src/core/capabilities/`
  read the hot columns (the `registry-gates-hot` invariant from ADR-0003). The resolver writes the
  winning value to those same columns. No capability-gated facet is routed through JSONB.
- **Re-resolution without re-LLM.** When a new claim arrives — a later URL enrichment, a user
  correction — the pipeline appends to `item_evidence` and re-runs the resolver for the affected
  facets only, then updates the resolved columns. The LLM is not called again.

#### Assembling `ItemClassification` from resolved claims

After `resolveFacet` has been called for each facet key, the results are assembled into an
`ItemClassification`. This requires a **claim-to-classification assembler** — a new pure function
in `src/core/resolve/` (or `src/core/classification.ts`) that maps a `Map<facetKey, Claim<V>>` to
the `ItemClassification` Zod-validated shape. The assembled shape passes through
`parseClassification` (the existing Zod validator) to guarantee schema conformance before any
persistence. This is the site where multi-label `value` arrays are validated against the closed
enum registries.

---

### 4. What stays UNCHANGED (the ripple boundary)

This section is explicit so concurrent builders know what they do not need to touch.

| Concern | Status |
|---|---|
| `ItemClassification` Zod schema and TypeScript type | UNCHANGED — changes from LLM output to resolver output but the shape is identical |
| `parseClassification` / `safeParseClassification` | UNCHANGED — called on the resolver's assembled output |
| `Evidence<T>`, `HardFact<T>`, `CONFIDENCE`, `SOURCE`, `UNKNOWN_SOFT`, `UNKNOWN_HARD` | UNCHANGED |
| `Claim<V>`, `resolveFacet`, `SOURCE_PRECEDENCE` | UNCHANGED |
| `resolveBehavioralFacets` | UNCHANGED — will be called as before (one of the resolver invocations in the flow) |
| Capability predicates in `src/core/capabilities/` | UNCHANGED — still read the resolved hot columns |
| Recommendation layer in `src/core/recommend/` | UNCHANGED |
| `llm_draft_cache` + `user_overrides` tables (ADR-0013) | UNCHANGED — the cache stores resolved `ItemClassification`s; when a cache hit drives a classification, the resolved values are also recorded as claims in `item_evidence` (see §5 offline items) |
| `pending_facets` table | UNCHANGED semantics — see §5 |
| The offline classifier / seed corpus | UNCHANGED — they produce `ItemClassification`s directly; their facets are treated as `source:"inferred"` claims and recorded in `item_evidence` on save (see §5) |

The only code changes required are:
- A new LLM prompt that emits `LlmClaimsSchema` format instead of `ItemClassificationSchema`.
- `LlmClaimsSchema` (new Zod schema).
- A claim-to-classification assembler (new pure function).
- `item_evidence` table + migration + RLS.
- Wiring in `src/server/app-service.ts` (the `classifyToDraft` and `enrichFromUrlToDraft` paths)
  to write claims to `item_evidence` and call the full resolver before persisting.
- A single-facet re-resolve path (for user corrections without re-calling the LLM).

---

### 5. `pending_facets` integration and offline items

#### Novel facet keys

When the LLM emits a claim with a `facetKey` not in the registry, Phase 3 handles it as follows:

1. The claim is written to `item_evidence` with the novel `facetKey`, so it is never lost.
2. The claim is ALSO written to `pending_facets` (unchanged semantics), so the human review queue
   receives it.

This preserves the ADR-0004 guarantee: novel extractions are never silently discarded. The
`pending_facets` row and the `item_evidence` row are siblings, not duplicates — the evidence row
is the persistent claim record; the `pending_facets` row is the work-queue entry for review.

A novel-key claim cannot be resolved against the registry (there is no registered schema for it),
so the resolver skips it and the resolved `ItemClassification` does not include it. The claim
persists in `item_evidence` for future use when/if the registry is extended.

#### Offline items (cache hits, seed corpus, draft cache)

Items that are classified by the offline classifier, the seed corpus, or a cache hit produce an
`ItemClassification` directly (not via `LlmClaimsSchema`). When such an item is saved (confirmed
through the review step), its resolved facets are recorded as `source:"inferred"` claims in
`item_evidence` with `extractor_version` set to `"offline-classifier-v1"` or `"seed-v1"` as
appropriate.

This gives even offline-classified items an evidence trail. It is a degraded trail (no per-facet
rationale, confidence sourced from the stored classification), but it is auditable and re-resolvable
if a higher-authority claim arrives later (e.g. a subsequent URL enrichment on the same item).

No backfill of existing items' `item_evidence` rows is required for v1. Existing items keep their
resolved `classification` JSONB as the authoritative snapshot. `item_evidence` begins populating
for any item that is reclassified or re-saved after Phase 3 is deployed.

---

### 6. Migration

A new Drizzle migration creates the `item_evidence` table and its RLS policies. No data backfill
is required.

Existing items are not affected at deploy time: their resolved `classification` JSONB and hot
columns remain the authoritative snapshot. `item_evidence` populates incrementally as items are
reclassified or newly added after Phase 3.

Recording existing items' resolved facets retrospectively as `source:"inferred"` claims in
`item_evidence` (a "historical backfill") is an OPTIONAL future step, explicitly not part of v1.
It would enable full provenance queries across the entire closet without requiring re-classification,
but it is not required for the Phase 3 correctness guarantees.

---

## Alternatives rejected

### Keep the LLM emitting a final `ItemClassification` shape (no claims layer)

The current design. Retained for Phase 1 and Phase 2; rejected as the permanent architecture for
the reasons documented in ADR-0012 Alternatives. The load-bearing reason for rejecting it at Phase
3 specifically: without the claims store, re-resolution after a new URL enrichment or user
correction requires re-running the full LLM classification. With the claims store, a new claim
appends to `item_evidence` and the resolver re-runs only the affected facets — a pure in-process
operation with no LLM call.

### Resolve in-memory at classification time only; do not persist claims

A transient variant: assemble all claims in memory at classification time, run the resolver, write
only the resolved output. The evidence trail would exist momentarily but never be persisted.

Rejected because:

- Auditability disappears: once the resolved snapshot is written, there is no way to answer "which
  source won this facet and what did the losing sources say?"
- Re-resolution without re-LLM is impossible: there is no persistent claim to add a new source to
  and re-resolve.
- The GDPR export story weakens: per-fact provenance is not available for data-subject requests.

### Full event-sourcing (append-only event log; no resolved columns)

Replace the resolved hot columns with a purely derived view over the event log. Every fact read
would require replaying the event log through the resolver.

Rejected because:

- The `registry-gates-hot` invariant (ADR-0003) requires capability-gated facets to be hot columns
  for query performance. Capability evaluation is a tight loop over the closet; it cannot afford to
  re-derive every facet at read time.
- The hybrid model (claims store + resolved snapshot) delivers the same auditability as full
  event-sourcing while preserving the read-path performance that capability gates require.
- The existing schema (`items` hot columns + `classification` JSONB) is the resolved snapshot; it
  would need to be replaced entirely in a big-bang migration. The phased approach (add
  `item_evidence` alongside existing columns) is lower-risk and keeps the system running throughout.

### Separate `item_evidence` per domain group (one table per group)

One table for universal facet claims, one for insulation claims, one for shell claims, etc.

Rejected because:

- The `resolveFacet` function is generic over `V` and facet-key-agnostic. It does not need to know
  which table holds a claim; it only needs the `Claim<V>` array.
- A single `item_evidence` table with a `facet_key` column (dot-namespaced) achieves the same
  queryability as separate tables. The single index on `(item_id, facet_key)` covers the primary
  access pattern.
- Separate tables would require schema changes every time a new domain group is added.

---

## Consequences

### Auditable provenance per fact

Every facet value on every item will have a queryable, human-readable provenance trail in
`item_evidence`. "The LLM said `warmth:high` / the material derivation said `warmth:medium` with
low confidence and deferred / the manufacturer did not assert warmth" is a query, not a debugging
session.

### Re-resolution without re-LLM

When new evidence arrives (a URL enrichment, a user correction, a future barcode claim), the
system appends to `item_evidence` and re-runs `resolveFacet` for the affected facets. No LLM call
is needed. This is the principal operational benefit and the reason Phase 3 is sequenced before
Phase 4 (canonical products) and Phase 5 (versioned snapshots).

### `unresolvedQuestions` reduce silent unknowns

The LLM's inability to determine a value is now a first-class signal in the review UI, not a
silent `null`. A user who adds a down jacket is told "fill power not stated" rather than seeing a
blank field they may not notice. This should reduce the rate of `blocked_unknown` capability
outcomes that the user is surprised by at trip-planning time.

### The demotion guard moves to the claim boundary

The ADR-0004 hard-fact demotion guard (`hardFact` preprocessor) remains mechanical and
prompt-independent. It moves from the LLM output validation site to the claim ingestion site.
The protection is identical in strength; the location moves inward. Until Phase 3 is deployed,
the guard continues to run at the existing Zod validation site (no regression).

### No downstream changes to capabilities or recommendations

`ItemClassification` is still the contract that capability gates and the recommendation engine
read. The shape is unchanged. The only change is that `ItemClassification` is now the resolver's
output rather than the LLM's output. Callers in `src/core/capabilities/` and `src/core/recommend/`
require no changes.

### Migration is incremental and reversible at each step

`item_evidence` is additive. Existing items' resolved snapshots are unaffected at deploy. The
system degrades gracefully: if claim ingestion fails for one item, the resolved columns already
hold the previous correct values and capability gates continue to work. Phase 3 can be deployed
behind a feature flag (write-to-evidence enabled/disabled per environment) during the rollout
window.

### Relationship to ADR-0012 migration sequence

```
Phase 1 — Resolver keystone     (complete)
Phase 2 — Cache split           (complete — ADR-0013)
Phase 3 — Evidence store + claims LLM  (this ADR)  ← implemented here
Phase 4 — Canonical products    (future; prerequisite for canonical_facts)
Phase 5 — Versioned snapshots   (future)
Phase 6 — Impact-ranked review  (future; no schema change)
```

`canonical_facts` (the third cache tier from ADR-0012 Element 5) is not built in this phase. It
is deferred to Phase 4 and requires the `canonical_products` table (ADR-0012 Element 1) to exist
first.
