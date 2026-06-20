# Armarium Roadmap

**Scope anchor:** Phase 2 only. Items marked Gated require an explicit scope-unlock decision and a
`DESIGN.md` update before any implementation begins. See `CLAUDE.md` and `DESIGN.md` for the
definitive scope boundaries.

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

**Layering-system reasoning (combine items)**
Current recommendations evaluate items individually against capabilities. A layering system
reasons over item *combinations* — e.g. a wicking base + a fleece mid + a shell together satisfy
`sustained_rain_protection` even if no single item does alone. This is the highest-impact
reasoning upgrade for the recommendation engine. Requires a new capability predicate design and
cross-archetype tests.

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

## Gated (needs scope unlock before any implementation)

The items below are explicitly out of scope for Phase 2 per `CLAUDE.md`. Building any of them
requires: (1) a written scope-unlock decision with context and trade-offs surfaced to the user,
(2) a `DESIGN.md` update covering the data shapes and seams, and (3) ADR(s) for load-bearing
decisions within the new scope. Do not begin implementation until all three are in place.

**Real auth + multi-user + Supabase RLS**
Replace the one-password gate with proper authentication (Supabase Auth or similar), per-user
row isolation enforced by Postgres RLS, and a session model that ties `user_id` to an
authenticated identity. The `user_id` column is already on every user-owned table (architecture
rule #4) so the schema is ready; the application logic and auth middleware are not. This is the
prerequisite for any sharing or social features.

**Weather API auto-conditions**
Automatically populate `TripConditions` from a weather forecast API given a destination and
dates. Useful quality-of-life feature but introduces a new external service dependency and raises
accuracy/liability questions (a wrong forecast leading to a wrong packing list). Needs a clear
fallback story when the API is unavailable or the location is ambiguous.

**Manufacturer / URL / photo / barcode enrichment**
Enrich an item's classification using authoritative sources: manufacturer spec pages (URL
scrape), product barcodes, or photos. These paths produce `source:"manufacturer"` facts which
are the highest-confidence inputs the system accepts. Each channel is a distinct integration
with its own reliability, rate-limit, and legal considerations. Barcode lookup requires an
external catalog. Photo classification requires a vision model call. None of these are trivial
to make reliable and auditable.

**Catalog gap-fill suggestions ("buy to fill the gap")**
When the recommender surfaces a capability gap, suggest specific products from a catalog that
would fill it. This requires a product catalog (external dependency), matching logic between
capability requirements and catalog items, and careful framing (Armarium is a personal gear
manager, not a shopping engine). Out of scope until real auth and a catalog source are in place.
