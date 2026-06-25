# Armarium Roadmap

**Scope anchor:** Phase 2 is complete. On **2026-06-20 the user greenlit Phase 3** — real auth +
multi-user, manufacturer (URL) enrichment, weather auto-conditions, and catalog gap-fill — to be
built in the sequence in the "Approved — Phase 3" section below. Each still needs its own `DESIGN.md`
update + ADR(s) + the one provider decision noted before its build begins. On **2026-06-21 the user
unlocked the previously blocked items** (image-upload / photo / barcode enrichment, military/NSN
domain, native app) — they are now an **unlocked backlog**, each still gated on its own ADR +
dependency/infra decision before any implementation. See `CLAUDE.md` and ADR-0009 for details.

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

## Active — Closet-database: turning the closet into a first-class inventory (approved 2026-06-25)

The product inversion approved on 2026-06-25 (ADR-0021 / ADR-0022 / ADR-0023; DESIGN.md §19):
ownership becomes the root entity; classification/enrichment is an optional async follow-up;
the closet becomes a general-purpose, any-domain personal inventory database. All five phases
below are additive over the existing capability-first hybrid — the facet core, evidence contract,
capability predicates, enrichment pipeline, and trip engine are reused unchanged.

### Closet P1 — Foundation *(DESIGN.md §19 + ADR-0021/0022/0023 are the gating docs)*

**Goal:** any possession can be recorded instantly; the full inventory layer is live; the
closet is a real, browsable database rather than a classification side-effect.

Deliverables:
- Additive schema migration: `ownership_status`, `quantity`, `condition`, `acquired_at`,
  `price_paid_cents`, `acquired_from`, `storage_location`, `size`, `color`, `user_notes`,
  `domains` columns on `items`; backfill `inInventory → ownership_status`.
- `recordOwnership(name)` path: instant persist via all-unknown classification + DEFAULT_INVENTORY,
  background enrichment enqueued. Capture latency target under 1 second.
- Degrade-not-throw on the name-classify path: corpus miss / LLM error → all-unknown, never throw.
- Basic closet list: surface `ownership_status` and `condition` in the closet card; filter to
  `status = 'owned'` by default (loaned / retired / sold visible in a secondary view).

**Demoable outcome:** user types a name, hits enter, sees the item in their closet under 1 second.
The item shows as "pending classification" and upgrades in place as background enrichment completes.
User can record a camera or board game with the same flow as a jacket.

**Gating:** DESIGN.md §19 + ADR-0021 + ADR-0022 + ADR-0023 (written; covers the schema delta and
the decoupled capture contract). Background job infrastructure choice (`ask-first` before any new
dep lands) must be made before implementation begins.

---

### Closet P2 — Browse at scale

**Goal:** a closet with 50–500 items is navigable, searchable, and actionable without scrolling
through a flat list.

Deliverables:
- Full-text search across `name`, `brand`, `model`, `user_notes`.
- Filter panel: by `ownership_status`, `condition`, `domains`, `activity_fit`, `body_zone_covered`,
  and key facets (waterproofness, warmth, layering role for gear items).
- Sort: by name, date added, `acquired_at`, `condition`, brand.
- Wire `listItemsPage` keyset pagination (the cursor-paginated repo method exists but is dead code);
  dense closet list with inline quick-actions (edit condition, change status, delete).
- Bulk-action: select multiple items → change status / condition / delete.

**Demoable outcome:** user types "jacket" into the closet search and sees all jackets, filterable
by condition and activity. Navigating 200-item closet is fast.

**Gating:** P1 complete. Requires its own DESIGN.md update (search query design, filter facet
selection, pagination contract) + ADR for any new full-text-search dependency before implementation.

---

### Closet P3 — Capture at scale

**Goal:** adding a large existing collection is not a one-item-at-a-time exercise.

Deliverables:
- **URL-paste async path:** user pastes a product URL; item is recorded instantly as all-unknown;
  enrichment from the URL runs in the background (reuses ADR-0011 / ADR-0019 / ADR-0020 tiers).
- **Batch / paste-a-list:** user pastes a newline-separated list of item names; all items are
  recorded in one action.
- **Dedupe detection:** before recording, check for existing items with a normalized-name match;
  surface a "you may already have this" prompt.
- **Name typeahead:** suggest from the classification cache as the user types, so common items
  are found rather than re-entered with variant spellings.
- **Background-enrich review queue:** a queue view showing items whose enrichment produced
  low-confidence or unknown results, surfaced for optional user review. Replaces the current
  blocking review-before-save flow for the fast-capture path.

**Demoable outcome:** user pastes a list of 20 item names; all 20 appear in the closet within
2 seconds; enrichment populates specs in the background over the following 30 seconds.

**Gating:** P2 complete. Each sub-feature (URL-paste async, batch entry, dedupe, typeahead,
review queue) needs its own design note and the background job infrastructure from P1.

---

### Closet P4 — Curation and portability

**Goal:** users can organize their closet their way and take their data with them.

Deliverables:
- **Collections:** user-defined groups of items (e.g. "Ski kit", "Ultralight backpacking setup").
  A collection is a join table (`collection_items`) with a name and optional description;
  items can belong to multiple collections (no hardcoded grouping). Collections require their
  own DESIGN.md section + ADR.
- **User tags:** freeform labels on items (`user_tags text[]`, GIN-indexed). Distinct from
  `domains` (behavioral scope) and from facets (evidence-graded properties).
- **CSV export:** export the user's full closet — one row per item, including inventory layer
  and key facets — as a CSV download. No new dependency; plain text generation.
- **Apparel as second modeled domain:** complete facet ontology (size range, care instructions,
  season) + classification prompt + capability predicates for apparel. Requires its own
  DESIGN.md section + ADR. Items already storable with `domains = ['apparel']` from P1;
  this adds the reasoning layer.

**Demoable outcome:** user creates a "3-day ski trip" collection, exports their closet to CSV,
and sees their jackets classified with apparel facets (size, care label) alongside gear facets.

**Gating:** P3 complete. Collections and user tags are schema changes requiring their own ADRs.
Apparel domain requires a full ontology design pass.

---

### Closet P5 — Frontier

**Goal:** the catalog builds itself; adding items requires minimal user effort.

Deliverables:
- **Self-building canonical catalog:** items enriched from manufacturer pages + web search are
  promoted to a global `canonical_products` table (DESIGN.md §15, element 1) so repeat items
  skip enrichment entirely. The KB improves with every user.
- **Photo / vision capture:** user photographs a tag or item; vision AI extracts name, brand,
  and model; the item is pre-filled for confirmation. Slots into the evidence resolver as
  `source:'vision_inferred'` (DESIGN.md §18.1 extension point). Requires its own ADR + the
  infra/cost decision for vision API usage.
- **Additional domain ontologies:** electronics, collectibles, or other domains as prioritized.
  Each requires its own DESIGN.md section + ADR.

**Demoable outcome:** user photographs the tag on a jacket; name and brand are pre-filled;
confirming adds the item to the closet with manufacturer specs already populated.

**Gating:** P4 complete. Canonical catalog requires DESIGN.md §15 element 1 implementation.
Vision capture requires its own ADR and a provider decision before any implementation.

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
