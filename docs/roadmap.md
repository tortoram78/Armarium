# Armarium Roadmap

**Scope anchor:** Phase 2 is complete. On **2026-06-20 the user greenlit Phase 3** — real auth +
multi-user, manufacturer (URL) enrichment, weather auto-conditions, and catalog gap-fill — to be
built in the sequence in the "Approved — Phase 3" section below. Each still needs its own `DESIGN.md`
update + ADR(s) + the one provider decision noted before its build begins. On **2026-06-21 the user
unlocked the previously blocked items** (image-upload / photo / barcode enrichment, military/NSN
domain, native app) — they are now an **unlocked backlog**, each still gated on its own ADR +
dependency/infra decision before any implementation. See `CLAUDE.md` and ADR-0009 for details.

---

## Active track — Packing engine rebuild (decided 2026-06-26; see ADR-0027)

The recommendation engine is being rebuilt from a **capability auditor** (9 thermal/clothing
capabilities → satisfied/verify/gap) into a **packing planner** (trip → one quantified, gear-first
checklist covering the 10 Essentials + big 3 + consumables, with owned/verify/gap + quantities per
line). Architecture: a deterministic, hermetic **`Need`-model skeleton** (Layer A, reuses the
faceted matcher for "what you own") plus an **additive, Zod-validated LLM breadth/narration layer**
(Layer B, proposes needs only — never asserts ownership). Owner decisions locked: comprehensive
gear-first list · deterministic floor first / LLM later · trip-type chip + free text input. Folds in
the approved Open-Meteo weather (step 3) and catalog gap-fill (step 4). Build gated on the Phase 0
`DESIGN.md` update. Phases 0–4 in ADR-0027. **Next:** Phase 0 DESIGN section → Phase 1 (the
deterministic checklist).

---

## Done this phase

**Verify → correct → re-plan loop** (`src/core/corrections.ts`, `src/server/app-service.ts`):
A user can inspect any saved trip result, navigate to an item that is blocking a capability
("verify"), correct its facets via the hard-fact editor (corrections carry `source:"user"` and
survive the demotion guard), and hit Re-plan — the same trip re-runs against the corrected
closet and the new result is persisted. Proof: `test/verify-loop.integration.test.ts`.

**Self-building classification cache** (`src/core/cache.ts`, `src/server/memory-cache.ts`,
`src/server/postgres-cache.ts`): a normalized-name-keyed knowledge base stores validated
classifications so repeat adds skip the LLM. Cache hits are served before the classifier is
called. Confirmations and corrections upsert `source:"user"` entries — the KB improves with use.
Review-before-save remains the safety valve. Proof: `test/cache.test.ts`. See ADR-0007.

---

## Near-term, in Phase 2 scope

These items fall within the current Phase 2 boundary as described in `CLAUDE.md` and `DESIGN.md`.
No scope unlock is needed — but each needs an approved plan before multi-file changes begin.

**Wire Postgres cache in `getCacheRepository()`**
`services.ts` currently returns `memoryCache` in both branches; `postgresCache` exists but is
not selected when `DATABASE_URL` is set. One-line wiring change + migration for the
`classification_cache` table. Needed so corrections survive across restarts in production.

**Classification eval harness (golden-set regression)**
A fixed set of item names with expected facet assignments run against the live classifier each
time `MODEL_ID` is bumped or the prompt changes. Catches model drift before it reaches users.
Pairs with the `model_id` column on cache entries (already recorded) for targeted re-classification.
Runs offline against the corpus for CI; live run against Anthropic is opt-in.

**Trip CRUD (edit / rename / clone / delete)**
Saved trips are currently read-only. Users need to rename a trip (the plan name drives the
result header), clone a trip with different conditions, and delete trips they no longer need.
Each is a thin repo method + server action + UI control; no new data shapes required.

**Layering-system reasoning (combine items)** — DONE (commit `bf116b4`; ADR-0010)
`src/core/recommend/combine.ts` evaluates derived requirements against sets of owned items in
distinct structural layering slots when no single item satisfies. Two strategies: `additive_warmth`
(slot warmth ranks sum toward a thermal target) and `shell_over_warmth` (conjunctive: protective
slot over warmth-base slot). Unknown facets demote the system to `blocked_unknown`. The
`CapabilityOutcome` output contract is extended with `satisfiedBySystem: ItemSystem[]` (additive
— existing consumers unaffected). **Open follow-up: wire `satisfiedBySystem` in the trip-result
UI** (`src/app/trips/[id]/page.tsx`) so users can see which items form a system. See ADR-0010.

**Weight / volume budgets**
`planTrip` could accept a budget envelope (pack weight ceiling, volume ceiling) and rank or
filter picks accordingly. Depends on reliable `weight_grams` and `capacity_liters` values, which
are already modeled as hard facts (`source` required). The recommendation engine would emit a
budget-vs-actual breakdown alongside gaps.

**Fix: `updateClassification` stale group-row cleanup**
When an item is re-classified away from a domain group (e.g. loses its insulation group), the
current Postgres `updateClassification` upserts new group rows but does not delete the removed
ones. Harmless today because reads use the jsonb column as source of truth, but must be fixed
before any code path reads from the group tables directly. See ADR-0006 Part B latent note.

**Fix: item page renders raw `facetError=1` query param**
When a facet update fails server-side the item detail page receives `?facetError=1` in the URL
and should render a user-friendly inline message. Currently the raw query parameter is visible
but not turned into a helpful UI state. Low effort; high polish impact.

**Observability: error tracking + LLM cost/latency**
The app has no structured error capture or LLM usage accounting. Adding Sentry (or equivalent)
for runtime errors and logging `input_tokens`/`output_tokens` from each Anthropic response
(already in the SDK response) into a lightweight log table would let operators track cost,
latency, and failure modes without any new external dependency.

**Rate-limiting the classify and parse routes**
The `/items/new` and `/plan` server actions call the Anthropic API. Without rate limiting, a
single user can exhaust the API budget. A simple in-memory token bucket or Vercel's built-in
rate-limit middleware is sufficient for the single-user v0 gate.

**Pagination**
`listItems` and `listTrips` return all rows for the user today. A large closet (100+ items) will
make the closet page slow. Standard cursor pagination on `created_at` with a configurable
page size is the minimal fix; the port interface already passes `userId` cleanly so the change
is contained to the repo impls and the service layer.

**E2E tests (Playwright)**
The gauntlet currently stops at `pnpm build`. Playwright tests that drive the real browser
against `next start` (or Vercel preview) would catch RSC event-handler bugs (which compile
cleanly but crash at render), confirm redirect chains (add → review → confirm → closet), and
validate that the verify→re-plan loop completes end-to-end without a 500. Medium effort,
high confidence gain.

**Pending-draft surface on the closet page**
Users who add many items quickly accumulate unreviewed drafts that are invisible from the closet
view. A small "N items awaiting review" banner with a link to the drafts list would surface the
review queue. No new data shapes; drafts are already filtered by `!draft` in `getInventory`.

---

## Approved — Phase 3 (greenlit 2026-06-20; build in sequence)

The user has unlocked the items below. Build them in the numbered order (they have dependencies).
Each still requires, before its own implementation: a `DESIGN.md` update covering the new data
shapes and seams, ADR(s) for load-bearing decisions, and the single infra/provider decision noted.

### 1. Real auth + multi-user + Supabase RLS — *foundation*
Replace the one-password gate with proper authentication, per-user row isolation enforced by
Postgres RLS, and a session model that ties `user_id` to an authenticated identity. The `user_id`
column is already on every user-owned table (rule #4), so the schema is ready; the auth middleware
and application logic are not. Prerequisite for any sharing/social features.
**Decision:** auth provider — recommend **Supabase Auth** (already on Supabase; pairs with RLS).

### 2. Manufacturer (URL) enrichment — *feeds the cache/KB*
Enrich a classification from an authoritative manufacturer spec page given a product URL, producing
`source:"manufacturer"` facts (the highest-confidence inputs) that flow into the classification KB.
Photo and barcode channels are unlocked backlog but deferred. Barcode is explicitly sequenced
after this step (URL enrichment is the prioritized "easier item input" path); barcode is also
better suited to a native app than a browser tool (see ADR-0009).
**Decision:** start with paste-a-URL + server-side fetch (no scraping infra beyond fetch + parse).

### 3. Weather auto-conditions — *removes manual entry*
Auto-populate `TripConditions` from a forecast given destination + dates (the user still adjusts).
Needs a clear fallback when the API is unavailable or the location is ambiguous.
**Decision:** provider — **Open-Meteo** (free, no key) recommended.

### 4. Catalog gap-fill suggestions — *gaps → guidance*
When the recommender surfaces a capability gap, suggest specific items that would fill it. Requires
a catalog source + matching logic between capability requirements and catalog items, framed as
guidance (Armarium is a personal gear manager, not a shopping engine). Benefits from the KB built in
steps 1–2 as its item source.
**Decision:** catalog source — reuse the classification KB vs a curated seed.

---

## Shipped — Closet-database: turning the closet into a first-class inventory (all five phases complete 2026-06-25)

The product inversion approved on 2026-06-25 (ADR-0021 / ADR-0022 / ADR-0023; DESIGN.md §19):
ownership becomes the root entity; classification/enrichment is an optional async follow-up;
the closet becomes a general-purpose, any-domain personal inventory database. All five phases
are additive over the existing capability-first hybrid — the facet core, evidence contract,
capability predicates, enrichment pipeline, and trip engine are reused unchanged.

### Closet P1 — Foundation — **SHIPPED** *(commit "Phase 1")*

**Goal:** any possession can be recorded instantly; the full inventory layer is live; the
closet is a real, browsable database rather than a classification side-effect.

Delivered:
- Additive schema migration: `ownership_status`, `quantity`, `condition`, `acquired_at`,
  `price_paid_cents`, `acquired_from`, `storage_location`, `size`, `color`, `user_notes`,
  `domains` columns on `items`; backfill `inInventory → ownership_status`.
- `recordOwnership(name)` path: instant persist via all-unknown classification + DEFAULT_INVENTORY.
  Capture latency under 1 second.
- Degrade-not-throw: corpus miss / LLM error → all-unknown, never throw.
- Domain gating: `isGearClassified(it)` = `domains.includes('gear') OR hasAnyKnownFacet(it)`.
  A non-gear possession renders identity + inventory + "Add details" only; gear-specific sections
  are hidden. `groupCloset` gains a trailing "Unclassified — add details" bucket so record-only
  items remain visible in grouped views.

**Gating docs:** DESIGN.md §19 + ADR-0021 + ADR-0022 + ADR-0023.

---

### Closet P2 — Browse at scale — **SHIPPED** *(commit "Phase 2")*

**Goal:** a closet with 50–500 items is navigable, searchable, and actionable without scrolling
through a flat list.

Delivered:
- Filters (status, condition) + sort (newest / name).
- Keyset pagination: `listItemsPage` (formerly dead code) is now the live path; load-more
  appends the next page in place.
- Grid / dense-list toggle.
- Inline actions (⋯ menu): change status, change quantity, rename, delete.
- Bulk select: set status / delete across multiple items.
- `renameItem` updates both `items.name` and `classification.name` in sync.

---

### Closet P3 — Capture at scale — **SHIPPED** *(commit "Phase 3")*

**Goal:** adding a large existing collection is not a one-item-at-a-time exercise.

Delivered:
- **Batch paste-a-list** (`POST /items/batch`): `recordOwnershipBatch` creates all items
  instantly; a client-orchestrated view then enriches each via `enrichItemAction`
  (concurrency cap 3, rate-limit backoff), streaming per-item status. No server job queue;
  no new infrastructure — the browser drives follow-up calls.
- **`enrichItem`** re-runs the classify pipeline on an existing item in place; promotes to
  `domains:['gear']` only when the classifier finds real gear signal.
- **Dedupe**: `src/core/dedupe.ts` `findDuplicate` powers a quiet quick-add banner (view /
  add anyway / +1 quantity). Typeahead over owned items; in-place "Classify now" on detail.

---

### Closet P4 — Curation and portability — **SHIPPED** *(commit "Phase 4")*

**Goal:** users can organize their closet their way and take their data with them.

Delivered:
- **Collections (kits):** `collections` + `collection_items` tables (RLS, migration 0009);
  `/collections` + `/collections/[id]`; `CollectionPicker` on item detail; add / remove /
  rename / delete. Collections are personal curation — explicitly NOT a hardcoded category
  and NOT a capability input. See ADR-0024.
- **User tags:** `user_tags text[]` (GIN-indexed) on inventory meta; tag editor on item
  detail; clickable tag chips; `?tag=` closet filter. See ADR-0024.
- **CSV export:** `GET /api/export` streams the full closet (RFC-4180 quoted). No new
  dependency; plain text generation. See ADR-0024.

**Deferred from this pass (both require their own DESIGN.md section + ADR before build):**
- Apparel as a second modeled domain — the `domains = ['apparel']` extension point is live
  from P1, but the full facet ontology, classification prompt, and capability predicates
  for apparel need a dedicated design pass.

---

### Closet P5 — Self-building catalog — **SHIPPED** *(commit "Phase 5")*

**Goal:** the catalog builds itself; adding items requires minimal user effort.

Delivered:
- **`searchCatalog(query, limit)`** queries the global `llm_draft_cache` (the self-building KB,
  ADR-0007 / ADR-0013) for add-time autocomplete. Reads global drafts only — never per-user
  overrides — so there is no cross-tenant leak. See ADR-0025.
- **`addFromCatalog(hit, userId)`** one-taps a known product into the closet with inherited
  specs (hard-fact demotion guard applies at insert time). Items arrive classified rather than
  all-unknown, skipping the background enrichment round-trip.
- This is the user-facing payoff of the self-building cache that has been running since Phase 2.

**Designed-next: not built this pass (each requires ADR + provider decision before build):**
- **Photo / vision capture.** The evidence resolver already designates `source:'vision_inferred'`
  as an extension point (ADR-0018). Vision capture requires a runtime vision API that cannot
  satisfy the hermetic gate without a dedicated mock path, and background-removal would add a
  dependency (ask-first rule). Write the ADR + provider decision first.
- **GTIN-keyed `canonical_products` table** (DESIGN.md §15 element 1). The right long-term
  canonical store requires a GTIN/barcode pipeline (unlocked backlog, deferred until after
  Phase 3 URL enrichment) to populate stable keys. The `llm_draft_cache` is sufficient as the
  catalog source at current corpus size; promote to a canonical table when the GTIN pipeline
  is ready.
- **Apparel as a second modeled domain** — see P4 note above.

---

## Unlocked backlog (build when prioritized; each gated on its own ADR + dep/infra decision)

The hard block on these items was lifted on 2026-06-21 (ADR-0009). They are no longer prohibited
but are not part of the approved Phase 3 sequence. Any of them may be proposed and built when
prioritized, provided the standard gating is satisfied first: a `DESIGN.md` update, one or more
ADRs, and the dependency/infrastructure decision ("ask first" before any new dep lands).

**Image-upload / photo enrichment.** Upload an image to assist classification. Gated on its own
design + ADR. No active priority.

**Barcode enrichment.** Deferred until after Phase 3 step 2 (manufacturer URL enrichment). Better
suited to a native app than a browser tool; target native delivery when that platform is built.
Manufacturer URL enrichment (step 2) remains the prioritized "easier item input" path.

**Military/NSN domain.** Large strategic pivot — NSN catalog, military nomenclature, and
military-specific facets (MOLLE, ballistic rating, mil-spec) represent a distinct ontology and
likely a distinct user base. Requires a dedicated scoping ADR before any code or schema work.
The unlock is permission to write that ADR, not to add military facets incrementally.

**Native app.** Large strategic pivot — a native iOS/Android delivery target introduces a distinct
build pipeline, distribution model, and potentially a different auth/data-sync model. The web app
remains the primary target. Requires its own scoping ADR before any work begins.
