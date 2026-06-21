# 0006 — Phase 2 load-bearing decisions: NL parser, draft lifecycle, Postgres shape

**Status:** Accepted
**Date:** 2026-06-19
**Full implementation:** `src/core/recommend/parse-conditions.ts` · `src/core/ports.ts` ·
`src/server/postgres-repo.ts` · `src/server/services.ts` · `drizzle/0001_*`

---

## A — NL trip description → structured `TripConditions` with offline fallback

### Context
The plan-a-trip surface accepts free-text descriptions ("a 3-day backpack in the Cascades, cold
nights, likely rain"). That text must produce a `TripConditions` envelope — the same structured
contract `deriveRequirements` reasons over — before any recommendation logic runs. Three constraints
apply:

1. The app must run without an API key (build, CI, and offline demo are all key-free by contract).
2. NL input must never bypass the structured contract and reach the engine as raw text.
3. The offline path must be tested across ≥3 distinct archetypes (engineering lesson: a single
   canonical test is not proof of generality).

### Decision
Two implementations behind a single `TripParser` interface, selected at startup by
`getTripParser()` in `src/server/services.ts`:

**Live path (`parseTripConditions`):** injects an Anthropic client, sends the description with
a system prompt that lists all enum literals and instructs the model to omit any field it cannot
determine (no guessing). The model returns a partial JSON object validated by `PartialConditionsSchema`
(Zod, closed enum literals on every field). The validated partial is merged onto `defaultConditions`,
so an unresolved field becomes an explicit default, never a fabricated value. `TripConditionsSchema`
then parses the merged result for final assurance. On any validation failure a typed
`ConditionsParseError` is thrown.

**Offline path (`parseConditionsHeuristic`):** deterministic keyword-to-enum mapping —
precipitation, wind, exposure, sun, exertion, duration from term lists; explicit temperatures
extracted by regex (range and single-value, both Fahrenheit-converted to Celsius). Conservative
by design: unrecognised text falls to mild defaults and the user can override via the structured
form. Returns `defaultConditions({...})` — the same Zod-validated envelope.

The UI exposes both an NL form and a structured conditions form; the structured form is always
available so any user who distrusts the parser can specify conditions precisely. The plan page
shows which mode is active.

### Alternatives considered
- **NL input passed directly to the recommender as a string.** Rejected: the recommender reasons
  over typed conditions; bypassing the contract would let NL quirks silently corrupt requirements.
- **Offline path skipped (require API key for NL).** Rejected: breaks the key-free build/CI/demo
  contract and degrades the no-key experience unnecessarily.
- **One implementation that branches internally on `apiKey`.** Rejected: harder to test the
  offline path in isolation; the interface split makes it explicit which path is active.

### Consequences
- Either path always yields a `TripConditions`; the engine is not aware of the input source.
- `test/parse-conditions.test.ts` asserts sensible envelopes and derived requirements for
  alpine, desert, sustained-rain, casual, and Fahrenheit-conversion cases — the minimum cross-
  archetype coverage the engineering lesson requires.
- Adding a new enum level to `TripConditions` requires updating the offline keyword map (manual,
  not automatic) — acceptable for the current set of ~6 enum dimensions.

---

## B — Review-before-save draft lifecycle

### Context
Classifying an item with an LLM produces facet assignments that may be imprecise, especially in
offline mode or for unusual items. Silently committing a freshly-classified item into the closet
with no opportunity to review or correct means users accumulate items with unknown or wrong facets
that silently corrupt future recommendations. The problem is especially acute for capability-gate
facets (waterproofness, warmth-when-wet, etc.) where a wrong value produces a wrong recommendation.

### Decision
Add-by-name always passes through a **draft → review → confirm/discard** flow:

1. `classifyToDraft` classifies the item and stores it with `draft: true`. Draft items are excluded
   from the closet (`getInventory` filters `!draft`) and from recommendation inputs.
2. The server redirects to `/items/[id]/review`, which shows the full evidence tree (identity,
   universal facets, multi-label, domain groups, materials, treatments, capability preview).
3. The review page presents a `FacetEditor` (client component). The editor covers all universal and
   multi-label facets; corrections receive `source: "user"` and are re-validated by
   `safeParseClassification` before `updateClassification` is called — invalid updates are rejected
   with an inline message. The delete-confirm action on the item detail page requires a separate
   `ConfirmButton` client component (`src/components/ConfirmButton.tsx`) because Server Components
   cannot pass event handlers across the server→client boundary.
4. Confirming calls `setDraft(userId, id, false)`, promoting the item into the closet.
   Discarding calls `deleteItem`, removing the draft.

**Port contract additions** (`src/core/ports.ts`):
- `StoredItem.draft: boolean` — first-class field on every item.
- `AddItemInput.draft?: boolean` — defaults to `false`; the review flow passes `true`.
- `GearRepository.setDraft(userId, id, draft)` — confirms or un-confirms a draft.

### Alternatives considered
- **Auto-confirm after classification (no review).** Rejected: wrong facets enter the closet
  silently; the whole point of evidence shapes is to surface uncertainty for review.
- **Show classification result on the add form before saving.** Rejected: requires a round-trip
  before the item row exists; draft storage is simpler and lets the user return to review later.
- **Separate "draft" table.** Rejected: one items table with a `draft` flag is simpler, keeps all
  queries uniform, and avoids a promotion INSERT + DELETE.

### Consequences
- The closet and recommendation path never see unconfirmed items — `getInventory` enforces
  `!draft` at the service layer.
- Users who add many items quickly may accumulate unreviewed drafts; a future improvement could
  surface pending drafts on the closet page. Not built in Phase 2.
- `updateClassification` in the Postgres repo upserts group rows that are present in the new
  classification but does not delete group rows removed by a reclassification (e.g. removing an
  insulation group from a re-classified item). Harmless in v0 because reads use the `classification`
  jsonb column as source of truth, not the group tables. Needs to be addressed before group-table
  reads are relied upon.

---

## C — Postgres persistence shape: lossless `classification` jsonb as read source of truth

### Context
Phase 1 shipped a Drizzle schema with typed hot columns (waterproofness, wind_resistance, etc.) and
five composable optional domain group tables. Phase 2 adds the `classification` jsonb column
(migration `0001`) to enable the full `ItemClassification` to round-trip losslessly. The question is
how reads should reconstruct a `StoredItem`: from the scattered typed columns, from the jsonb, or
some hybrid.

### Decision
**Writes project; reads reconstruct from jsonb.**

- **Write path:** every insert and update calls `projectIdentity`, `projectUniversal`,
  `projectMultilabel` to populate the typed columns from the classification, and `upsertGroups` to
  write the domain group tables. These projections are denormalized for future indexability and
  query convenience (e.g. `WHERE waterproofness = 'waterproof'`) — they are not the read path.
- **Read path:** `rowToStoredItem` reconstructs the `StoredItem` from the `classification` jsonb
  column plus the row's own scalars (`id`, `userId`, `name`, `inInventory`, `draft`, `rawText`,
  `createdAt`). The typed columns are not consulted. This makes the read path:
  - **Lossless:** the jsonb stores the full `ItemClassification` including confidence, source,
    evidence strings, and any group data, without projection loss.
  - **Simple:** one column to reconstruct from, not 30+ typed columns requiring re-assembly.
  - **Safe against schema evolution:** adding a facet to `ItemClassification` only requires a
    code change, not a new column migration, until/unless that facet is promoted to a hot column
    for query performance.

Migration `drizzle/0001_clammy_gertrude_yorkes.sql` adds:
```sql
ALTER TABLE "items" ADD COLUMN "classification" jsonb NOT NULL;
ALTER TABLE "items" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;
```

Every query is `WHERE user_id = $userId` (architecture rule #4). The lazy singleton pattern
(`getDb()` throws only on first query, never at module load) keeps build and test key-free.

### Alternatives considered
- **Reconstruct `StoredItem` from the scattered typed columns** (no jsonb source of truth).
  Rejected: projection loss is real — confidence, source, evidence strings, and domain-group
  details do not all have typed columns; re-assembly would either truncate data or require
  30+ columns per read with complex join/re-assembly logic. Fragile: every new facet needs a
  new column migration before it can round-trip.
- **jsonb only, no typed columns.** Rejected: loses indexability. Facet-based queries (e.g.
  "all waterproof items") become expensive jsonb-path scans. The hybrid (typed columns + jsonb)
  is the design chosen in ADR-0003; this ADR simply clarifies which side is authoritative for reads.
- **Drizzle relations / JOIN group tables on every read.** Rejected: adds query complexity and
  coupling to the group table layout. The group tables exist for write-side denormalization and
  potential future indexed queries, not as the read path.

### Consequences
- Any code that reads items gets the full lossless classification without joins.
- The typed columns and group tables may drift from the jsonb if `updateClassification` is called
  (which upserts groups but does not delete removed groups — see Part B latent note). This is
  intentional in v0; the jsonb is the authority.
- Future: if a facet query (e.g. "show me all items with sustained-rain waterproofness") is needed,
  the typed column is already present for indexing — no re-migration required.
- Future: if group-table reads are added (e.g. for domain-specific queries), the upsert-without-
  delete gap in `updateClassification` must be fixed first.
