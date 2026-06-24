# Progress Log

Reverse-chronological. Each entry is a meaningful checkpoint. This is the narrative spine of the
project; skim it to catch up fast.

## 2026-06-24 (Phase 3 step 3) — Weather auto-conditions: design + ADR-0015 recorded

Design and ADR recorded. Code implementation by core-reasoning-owner (pure derivation logic +
Zod schemas) and web-ui-owner (trip form auto-fill wiring) follows; server-fetcher plumbing by
schema-db-owner or web-ui-owner depending on task allocation.

**What this enables:** the trip form accepts a location string + start/end dates and
pre-populates the `TripConditions` fields (`temp_min_c`, `temp_max_c`, `precipitation`, `wind`)
from a real Open-Meteo forecast. The user sees the derived values, can edit any of them, and
submits normally. The recommendation engine is completely unchanged — it receives the same
`TripConditions` shape it always has.

**Provider decision: Open-Meteo** — free, no API key, no new npm dependency, plain HTTPS `fetch`.
Two APIs: geocoding (place name → lat/lon) and forecast (daily `temperature_2m_max`,
`temperature_2m_min`, `precipitation_sum`, `precipitation_probability_max`, `wind_speed_10m_max`
over the date window). Forecast horizon ≈ 16 days; beyond that the form falls back to manual
entry.

**Derivation contract (`forecastToConditions`) — a pure function:**
- `temp_min_c` / `temp_max_c`: min/max across the trip's daily temperature arrays.
- `precipitation`: tiered from max daily probability + total sum (`certain` ≥ 70 %; `likely` ≥ 40 %
  or sum > 5 mm; `possible` ≥ 15 % or sum > 1 mm; `none` otherwise).
- `wind`: tiered from max daily `wind_speed_10m_max` in km/h (`extreme` ≥ 62; `strong` ≥ 39;
  `moderate` ≥ 20; `light` ≥ 6; `calm` otherwise).
- `sun_exposure`, `duration_days`, `activity`, `exertion` — not derived; remain manual.
- Failed/missing forecast → leave conditions for manual entry (unknown is first-class; no
  fabricated conditions).

**Architecture split:**
- `src/core/weather/forecast-to-conditions.ts` — pure derivation (no I/O).
- `src/core/weather/open-meteo-schema.ts` — Zod schemas for API responses.
- `src/server/weather-fetcher.ts` — geocoding + forecast HTTP calls (injected, never imported into
  core).
- `src/app/plan/` — trip form wiring; calls the fetcher, passes result to `forecastToConditions`,
  pre-fills the form.

**Override-always:** auto-fill pre-populates; user can change any field. Manual entry is always
available. NL description path unchanged.

**Caching:** short-TTL in-memory cache keyed on `(normalized_location, start_date, end_date)`;
10-minute TTL, 50-entry cap suggested; no persistence in v1.

**Testing posture (same as ADR-0011):** unit tests for `forecastToConditions` use hardcoded
inputs (no HTTP, ≥ 3 archetypes); integration tests use fixture JSON files (captured API
responses); live verification on Vercel.

**ADR recorded:** [ADR-0015](../decisions/0015-weather-auto-conditions.md)

**DESIGN.md updated:** status banner (Phase 3 steps 1–3 in delivery), ADR-0015 added to key
decisions list, §12 updated (weather removed from deferred list with forward pointer to §16),
§16 added (full weather auto-conditions contract: provider, flow, derivation table, architecture
split, override-always principle, caching, testing).

---

## 2026-06-24 (Phase 3 — evidence-architecture) — Evidence store + claims LLM: ADR-0014 recorded

**What this records:** the concrete build contracts for ADR-0012 Elements 2 and 4 — the
`item_evidence` table and the claims-based LLM output. This is the design spec the build will
implement.

**Context:** Phases 1 (resolver keystone, `src/core/resolve/`) and 2 (cache split, ADR-0013) are
complete. Phase 3 is the heart of the migration: persisting every competing claim per
`(item_id, facet_key)` and switching the LLM from emitting a final `ItemClassification` to
emitting claims + `unresolvedQuestions`.

**The `item_evidence` table (the store):**

- Columns: `id` (uuid PK), `item_id` (uuid FK → `items.id` CASCADE), `facet_key` (text,
  dot-namespaced: `"universal.warmth"`, `"identity.brand"`, `"multilabel.layering_role"`,
  `"groups.insulation.fill_power"`), `value` (jsonb — scalar or array), `confidence`
  (`low|medium|high|unknown`), `source` (the `SOURCE` enum), `source_url` (text null),
  `extractor_version` (text null, e.g. `"llm-claims-v1"`), `evidence` (text NOT NULL),
  `observed_at` (timestamptz), `created_at` (timestamptz).
- Index `(item_id, facet_key)`.
- RLS via the parent item (subtype-table pattern from `drizzle/0003`): `EXISTS (SELECT 1 FROM
  items WHERE items.id = item_evidence.item_id AND items.user_id = (SELECT auth.uid()))`. Not
  globally readable.
- Multiple competing rows per `(item_id, facet_key)` are the point. The resolved hot columns on
  `items` remain the RESOLVED snapshot.

**The claims-based LLM contract (`LlmClaimsSchema`):**

- New Zod schema: `{ name, claims: LlmClaim[], unresolvedQuestions: string[] }`.
- Each `LlmClaim`: `{ facetKey, value, confidence, source: "inferred", evidence }`. Source is
  locked to `"inferred"` in the schema — the LLM cannot assert manufacturer or user authority.
- The hard-fact demotion guard (ADR-0004) moves to the claim boundary: an LLM claim with a
  hard-fact `facetKey` and non-null value has `source:"inferred"` (non-authoritative), so the
  guard demotes it to `null+unknown` before writing to `item_evidence`. Same protection, moved
  inward.
- `unresolvedQuestions` surfaces in the review UI as targeted prompts; not written to
  `item_evidence`.

**The resolve flow:**

```
LLM → claims  ┐
URL enrichment → claims (source:"manufacturer")  ├→ all claims per facet_key
Material derivation → claims (source:"derived_from_material") │  → resolveFacet() (UNCHANGED)
User correction → claim (source:"user")  ┘  → assemble ItemClassification (UNCHANGED shape)
                                          → PERSIST: claims → item_evidence; resolved → items hot columns
```

`resolveFacet` and `resolveBehavioralFacets` are reused unchanged. `ItemClassification` remains
the downstream contract for capability gates and recommendations.

**What stays unchanged (explicit ripple boundary):** `ItemClassification` shape,
`parseClassification`, `Evidence<T>`/`HardFact<T>`, `Claim<V>`/`resolveFacet`/`SOURCE_PRECEDENCE`,
all capability predicates, the recommendation layer, `llm_draft_cache`/`user_overrides`,
`pending_facets` (see below), the offline classifier and seed corpus.

**`pending_facets` integration:** novel facet keys the LLM extracts that are not in the registry
are written to BOTH `item_evidence` (never lost) AND `pending_facets` (the existing review queue),
preserving the ADR-0004 "never silently drop" guarantee. Novel-key claims are not resolved against
the registry and do not appear in the assembled `ItemClassification`.

**Offline items / cache hits:** when an item classified by the offline classifier, seed corpus, or
draft cache is saved after review, its resolved facets are recorded as `source:"inferred"` claims
in `item_evidence` (extractor_version `"offline-classifier-v1"` or `"seed-v1"`). Every saved item
gets an evidence trail.

**Migration:** a new Drizzle migration adds `item_evidence` + RLS. No data backfill for existing
items (they keep their resolved `classification` snapshot). Backfill of existing items' resolved
facets as historical claims is an optional future step, not part of v1.

**ADR recorded:** [ADR-0014](../decisions/0014-evidence-store-claims-llm.md)

---

## 2026-06-24 (Phase 2 — evidence-architecture) — Cache split: ADR-0013 recorded

**What this records:** the concrete implementation decisions for splitting the single shared
`classification_cache` into two scoped stores, resolving the cross-tenant correction leakage
documented as a known trade-off in ADR-0007 and flagged by the Phase 3 step 1 security audit.

**The parent target:** ADR-0012 Element 5 set the architectural target (three-tier cache split).
This ADR records the *concrete* choices for the Phase 2 implementation of that element.

**The two tables being built:**

- **`llm_draft_cache`** — global, no `user_id`, service-role-only. Holds LLM-emitted and seed
  classifications as low-authority drafts. A hit here is a starting draft; review still gates
  saving. Replaces `source:"llm"` and `source:"seed"` rows. `canonical_facts` is explicitly
  deferred to Phase 4 (requires the canonical products table).
- **`user_overrides`** — per-user, `user_id` NOT NULL, primary key `(user_id, key)`. Holds a
  user's confirmed or explicitly corrected classifications, scoped so they never affect another
  user. RLS: `(select auth.uid()) = user_id` (the ADR-0008 / drizzle-0003 pattern).

**Lookup precedence:** `user_overrides(userId, key)` (authority `user`) first, then
`llm_draft_cache(key)` (authority `draft`), else miss → LLM. Mirrors the ADR-0012 Element 3
resolver hierarchy (`user > inferred/llm`).

**Migration of existing rows (the load-bearing choice):** ALL existing `classification_cache`
rows, including `source:"user"` rows, migrate to `llm_draft_cache` as drafts. Rationale: the
old `source:"user"` rows were already global/shared with no `user_id` — we cannot attribute them
to a real identity without fabrication. Demoting them to shared drafts preserves availability;
users who previously corrected an item re-correct through the normal review flow, and their new
correction correctly lands in `user_overrides`. `classification_cache` is dropped after migration.

**What this resolves:** the cross-tenant correction leakage identified as an open trade-off in
ADR-0007 Consequences and as a finding in the Phase 3 step 1 security audit. ADR-0007 is not
superseded; its open consequence is closed by this ADR.

**ADR recorded:** [ADR-0013](../decisions/0013-cache-split-per-user-overrides.md)

---

## 2026-06-24 (north-star architecture) — Evidence-first classification: ADR-0012 recorded

**What this records:** the target architecture for Armarium's classification pipeline — not a
single shipped feature, but the direction that individual phases will implement incrementally.

**The principle:** classification is not a one-time answer; it is an auditable argument. Facts are
claims from identified sources. A deterministic resolver picks the winner by explicit precedence.
The LLM is one extractor among several, never the authority on the final value.

**Why now:** Phase 3 step 2 (URL enrichment) introduces `source:"manufacturer"` as a second
significant claim source alongside LLM inference. Material behavior derivation
(`source:"derived_from_material"`, ADR-0011 §14.6) is the designed-for next step. As claim sources
accumulate, the current implicit merger (`enrich/merge.ts`) will not scale. The resolver keystone
(Migration Phase 1) consolidates that logic before the next source lands. The cache split (Phase 2)
addresses the cross-tenant correction leakage documented as a known trade-off in ADR-0007.

**The 8-element target (summary):**
1. Canonical products — global product identity table (deferred, Phase 4)
2. Evidence store — `item_evidence` table: multiple competing claims per `(item_id, facet_key)` (Phase 3)
3. Resolver layer — `src/core/resolve/` with explicit `resolve(claims[])` and precedence table (**in progress, Phase 1**)
4. LLM = extractor — LLM emits claims + `unresolvedQuestions`; resolver decides final value (Phase 3)
5. Cache split — `llm_draft_cache` (global) / `user_overrides` (user-scoped) / `canonical_facts` (Phase 2)
6. Targeted review — impact-ranked unknowns from capability evaluation output (Phase 6)
7. Versioned snapshots — `schema_version`/`resolver_version`/`classifier_version` on items (Phase 5)
8. Layer separation — capability ≠ classification ≠ recommendation: **already done; preserve**

**What already exists (and must be preserved):** `Evidence<T>` / `HardFact<T>` shapes, mechanical
demotion guard, `Source` union with precedence concepts, `pending_facets` queue, per-facet `*_src`
columns, lossless `classification` JSONB, three-state capabilities, layer separation. This is
evolution, not rewrite.

**Relationship to prior ADRs:** extends ADR-0003 (hybrid storage — unchanged), ADR-0004
(classification contract — demotion guard preserved, promoted), ADR-0007 (cache — split resolves
cross-tenant trade-off), ADR-0011 (enrichment — resolver absorbs merge.ts). No ADR is superseded.

**ADR recorded:** [ADR-0012](../decisions/0012-evidence-first-classification.md)

**DESIGN.md updated:** status banner pointer added; §15 (new) — evidence-first target architecture
summary table with phase status per element.

---

## 2026-06-24 (Phase 3 step 2) — Manufacturer URL enrichment: design + ADR complete; implementation begins

Design and ADR recorded. Code implementation by core-reasoning-owner, schema-db-owner, and
web-ui-owner follows. See [ADR-0011](../decisions/0011-manufacturer-url-enrichment.md) and
[DESIGN.md §14](../../DESIGN.md).

**What is being built:** paste a manufacturer product URL → server-side SSRF-gated fetch →
JSON-LD + OpenGraph extraction → `source:"manufacturer"` partial overlay onto `ItemClassification`
→ merged via existing Zod contract + demotion guard → user reviews in the existing review UI.

**Key design decisions:**
- Parse strategy: schema.org `Product` JSON-LD + OpenGraph/meta only (no new dependency in v1;
  DOM parser is an explicit `ask-first` future upgrade).
- SSRF gate: layered — (1) URL-shape gate + manufacturer allowlist in `src/core/enrich/`
  (pure, no I/O); (2) DNS/IP resolution check blocks private/loopback/link-local ranges in
  `src/server/`; (3) redirect cap (3), size cap (2 MB), timeout (10 s).
- Architecture: parser + URL-shape gate are pure `src/core/enrich/`; network fetch + DNS check are
  injected from `src/server/`; UI lives in `src/app/`. Enforces the purity invariant unchanged.
- Provenance precedence: `user` > `manufacturer` > `inferred`/`llm` > `derived_from_material`
  > `unknown`. A manufacturer fact replaces an inferred value; a user correction still wins.
- Testing: fixture-based (offline) for all unit + integration tests; live verification on Vercel.
- Bridge to next initiative: `source:"manufacturer"` composition data is the primary input the
  material behavior derivation engine (composition → `source:"derived_from_material"` behavioral
  facets) will consume when built.

**ADR recorded:** [ADR-0011](../decisions/0011-manufacturer-url-enrichment.md)

**DESIGN.md updated:** status banner, §12 (URL enrichment removed from "out of scope" list), §14
(new section: full enrichment contract — parse strategy, SSRF gate, architecture split, output
shape, bridge to derivation engine, testing reality).

---

## 2026-06-24 (Phase 2) — Layering-system reasoning: combination-aware capability evaluation

Branch `claude/charming-franklin-441bvj`. Commit `bf116b4`. All gates green: 77 tests passing.

### What was built

**`src/core/recommend/combine.ts`** — combination evaluator activated only when no single item
already satisfies a derived requirement. Composes over:

- The `layering_role` facet (already `capabilityGate: true`, stored hot as a Postgres array),
  partitioned into four structural slots: next-to-skin/base (0), active-insulation/mid (1),
  static-insulation (2), wind/weather-shell (3). `sleep_system` and `accessory` excluded.
  Items must occupy **distinct slots** to form a system — two items in the same slot do not count
  as layers.
- Per-capability `CAPABILITY_COMBINATION` strategy metadata declared in
  `src/core/capabilities/index.ts` alongside existing per-item predicates. Two strategies:
  `additive_warmth` (slot warmth ranks sum toward a thermal target derived from `temp_min_c`) and
  `shell_over_warmth` (conjunctive: one slot satisfies a protective sub-capability AND a distinct
  slot meets a warmth-base floor — both arms required).

**Output contract extension (backward-compatible).** `CapabilityOutcome` adds
`satisfiedBySystem?: ItemSystem[]` where `ItemSystem = { items: ItemRef[] }`. `status` is
`"satisfied"` when `satisfiedBy.length > 0 || satisfiedBySystem.length > 0`. Existing consumers
compile and render without change.

**Unknown-blocks preserved.** An unknown/low-confidence value on any participating item demotes
the system outcome to `blocked_unknown`. A fabricated system satisfy is never emitted.

**No registry or schema changes.** All facets read by the combination evaluator are already
`capabilityGate: true` and stored hot; the strategy metadata is reasoning metadata beside the
predicates, not a new facet. The registry-gates-hot invariant and the cross-reference test are
untouched.

**Generality proof.** `test/recommend.layering.test.ts` — ≥3 cross-archetype tests: cold-dry
additive warmth surfaces correctly; cold-wet conjunctive surfaces correctly and drops when either
arm is removed (asserted); mild trip does not over-trigger; unknown facet demotes to
`blocked_unknown`. Per the engineering lesson, ≥3 distinct archetypes are the minimum bar for any
reasoning feature.

### Open follow-up

`satisfiedBySystem` is present in `CapabilityOutcome` and persisted in `trips.result_snapshot`
but is not yet displayed in `src/app/trips/[id]/page.tsx`. Wiring that UI surface is the next
step — until then, system satisfaction is computed correctly but invisible to the user.

### ADR recorded

[ADR-0010](../decisions/0010-layering-system-reasoning.md) captures: the combination strategy
design, the slot partition, the `additive_warmth` and `shell_over_warmth` strategies, the
output-contract extension, and the alternatives rejected (outfit templates, category routing,
combination-without-slot-constraint, materialized combination cache).

### DESIGN.md updated

Section §5 documents that capability satisfaction is now single-item OR combination-of-layers
(emergent over `layering_role` + strategy metadata). Section §8 (Marcy walkthrough) notes how the
engine would handle a full three-layer kit. Status banner updated.

### Roadmap updated

"Layering-system reasoning" ticked as done with pointer to ADR-0010 and the open UI follow-up.

---

## 2026-06-21 (governance) — Scope unlock: image/photo/barcode, military/NSN, native app

The user directed that the three previously hard-blocked items be moved from "do not build; stop
and flag" to an **unlocked backlog**: image-upload / photo enrichment, barcode enrichment, the
military/NSN domain, and a native app. They may now be proposed and built when prioritized.

The gating discipline is unchanged. Each item still requires a `DESIGN.md` update, one or more
ADRs, and the dependency/infrastructure decision before any implementation. The "ask first before
adding a dependency or introducing new infrastructure" rule remains fully in force.

Key nuances recorded in ADR-0009:

- **Barcode** is deferred until after Phase 3 step 2 (manufacturer URL enrichment) and is
  explicitly flagged as better suited to a native app than a browser tool. Manufacturer URL
  enrichment remains the prioritized "easier item input" path.
- **Military/NSN domain** and **a native app** are large strategic pivots. The unlock is permission
  to write a scoping ADR for each — not a green light to add military facets or start a native
  build without one.

The approved Phase 3 sequence (auth → URL enrichment → weather → catalog gap-fill) is unaffected.

ADR recorded: [ADR-0009](../decisions/0009-scope-unlock.md)

---

## 2026-06-21 (Phase 3 step 1) — Real auth + multi-user: Supabase Auth, RLS, multi-user wiring

Phase 3 step 1 is in delivery. The design, ADR, and documentation are complete; code implementation
by the relevant owners follows.

### What is being built

**Supabase Auth with email+password.** The one-password `APP_PASSWORD` gate and the fixed
`ARMARIUM_USER_ID` env var are superseded. Users sign up and sign in with email+password via
Supabase Auth (auto-confirm for now; email verification follows once SMTP is configured). OAuth
(Google, GitHub) is designed-for but deferred — it requires a deployed redirect domain and external
OAuth app registration that cannot be validated in the sandbox; it slots in later as a small additive
change.

**Cookie-based sessions via `@supabase/ssr`.** App Router middleware reads and refreshes the session
cookie on every request. Server Components and Route Handlers receive a pre-refreshed Supabase client.

**Multi-user wiring.** `getCurrentUserId()` and `requireUserId()` at the request boundary supply the
authenticated `auth.uid()` UUID to the `userId` parameter already present on every `app-service.ts`
function (built in Phase 2). All Drizzle queries already carry `WHERE user_id = $userId`; no
query-layer changes are needed.

**RLS on all user-owned tables.** Row-level security policies enforce `(select auth.uid()) = user_id`
on `items`, `trips`, and `pending_facets`; the subtype tables (`item_insulation`, `item_sleep`,
`item_shell`, `item_carry`, `item_footwear`, `item_treatments`, material link tables) are gated via
their parent item. `materials` and `treatments` are readable by any authenticated user (shared
reference libraries). `classification_cache` is locked to the service-role connection (shared KB — see
ADR-0007). RLS guards the public PostgREST surface that the anon key exposes; app-layer `user_id`
filtering guards the owner-role Drizzle path (which bypasses RLS). Both layers are mandatory — neither
is redundant.

**Dev fallback.** When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent,
`isAuthConfigured()` returns false and the app runs open with `DEFAULT_USER_ID` — identical to
Phase 2 behaviour. The gauntlet (typecheck / lint / build / test) remains secret-free.

**Sandbox migration path.** The cloud sandbox's HTTP/HTTPS proxy blocks raw Postgres connections
(ports 5432/6543). `scripts/db-mgmt-migrate.mjs` applies migration SQL over the Supabase Management
API (HTTPS) instead. `pnpm db:migrate` continues to work from any DB-connected environment (Vercel,
local).

### ADR recorded
[ADR-0008](../decisions/0008-auth-multi-user.md) captures the load-bearing decisions: provider
choice (Supabase Auth; OAuth deferred), session model (`@supabase/ssr` cookies), the dual-layer
enforcement model (RLS guards the public API surface; app-layer filtering guards the owner-role
path — both mandatory), the dev fallback contract (`isAuthConfigured` / `getCurrentUserId` /
`requireUserId`), and email verification deferral.

### Design updated
[`DESIGN.md` §13](../../DESIGN.md) documents the full multi-user model: auth provider + session,
the `user_id` flow from middleware through `app-service.ts`, the RLS policy table, the auth helper
contract, and operational notes (sandbox migration, seeded-data re-attribution).

### Deploy runbook updated
[`docs/deploy.md`](../deploy.md) replaces `APP_PASSWORD`/`ARMARIUM_USER_ID` guidance with the
Supabase Auth env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), documents
`SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` for the Management API migrator, and clarifies
that dev-mode / `DEFAULT_USER_ID` applies only when the Supabase env is absent.

### Deferred within Phase 3 step 1
- OAuth sign-in (designed-for; requires deployed redirect domain + provider console setup)
- Email verification (requires SMTP configuration in Supabase)

---

## 2026-06-20 (Phase 2) — Verify→correct→re-plan loop + self-building classification cache (gates green)

Branch `claude/charming-franklin-441bvj`. All four gates green: `typecheck` / `lint` / `test` (64
passing) / `build`. Live verification: all routes HTTP 200; live LLM classification confirmed
end-to-end.

### What was built

**Verify → correct → re-plan loop** (`src/core/corrections.ts`, server action + `replanTrip` in
`src/server/app-service.ts`, `updateTripResult` in the Postgres + memory repos):

- `applyUserCorrections` takes a flat map of form field values (path → raw string or string[]) and
  builds `source:"user"` `Evidence<T>`/`HardFact<T>` envelopes onto a clone of the
  `ItemClassification`. Missing paths are left untouched; group fields are skipped if the item
  lacks that group.
- `EDITABLE_UNIVERSAL`, `EDITABLE_GROUPS`, and `EDITABLE_MULTILABEL` registries enumerate exactly
  the facets that gate capabilities — editing a facet no capability reads is excluded.
- Because the user is an authoritative source, a corrected hard fact (fill_power, temp_rating,
  seam_sealing, capacity_liters, UPF) carries `source:"user"` through the `HardFact` wrapper and
  survives the mechanical demotion guard. This is what makes a correction actually move a capability
  outcome (satisfies ↔ fails ↔ blocked_unknown), not just update the display.
- `replanTrip(id)` fetches the saved trip's conditions, re-runs `planTrip` against the corrected
  closet, and persists the new `RecommendationResult` via `updateTripResult`.
- UI: a hard-fact editor on the item detail page; a "Re-plan" button on the trip result page;
  verify→`/items/[id]?edit=1` deep links from blocked capabilities.
- Proof: `test/verify-loop.integration.test.ts` (2 cases: facet correction propagates through
  re-plan and is persisted; inventory change propagates through re-plan).

**Self-building classification cache / knowledge base** (`src/core/cache.ts`,
`src/core/ports.ts` ClassificationCacheRepository port, `src/server/memory-cache.ts`,
`src/server/postgres-cache.ts`, `classification_cache` table in `src/db/schema.ts`):

- `normalizeCacheKey(name)` produces a stable lookup key: lowercase, accent-folded,
  punctuation collapsed to spaces, whitespace trimmed. v0 keys on name only.
- Flow in `classifyToDraft`: check cache FIRST (before the classifier). Cache HIT reuses the stored
  classification — no LLM call. Cache MISS classifies (live or offline) then writes back as
  `source:"llm"` with `modelId` recorded for drift tracking.
- `confirmDraft` upserts `source:"user"` on confirmation (user endorsed the full classification).
  `updateItemClassification` upserts `source:"user"` on any facet correction. Both paths return
  `fromCache: boolean` to the caller.
- In-memory impl (`memory-cache.ts`) is seeded lazily from `SEED_CORPUS` with `source:"seed"`
  entries; all prototype names are instant hits with no LLM call in dev/offline.
- Postgres impl (`postgres-cache.ts`): Drizzle `onConflictDoUpdate` upsert; `createdAt` is
  preserved on collision; lazy singleton (zero connection side effects at import time).
- Proof: `test/cache.test.ts` (3 cases: seeded item served from KB; cache consulted before
  classifier, proven by the fact that a pre-seeded novel name does not throw the offline
  classifier; a user correction feeds the KB and the next add reflects it).

**Known latent notes recorded for near-term hardening:**
- `getCacheRepository()` in `services.ts` currently returns `memoryCache` in both branches;
  the Postgres branch wiring is the next step pending the `classification_cache` migration.
- `updateClassification` in the Postgres repo does not delete group rows removed by a
  re-classification (documented in ADR-0006 Part B; tracked in the roadmap).
- The item page does not render `?facetError=1` as a friendly message (tracked in the roadmap).

### Verification evidence
- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 warnings/errors
- `pnpm test` — 64 tests passed
- `pnpm build` — compiled successfully (hard gate)
- Live server: all routes (`/`, `/items/new`, `/login`, `/items/[id]`, `/plan`, `/trips`,
  `/trips/[id]`) HTTP 200
- Live LLM classification: item added by name → classified by `claude-sonnet-4-6` → draft stored
  → review page rendered → confirmed into closet — end-to-end confirmed

### Deferred (designed-for, not built)
Multi-user auth, weather API, barcode/photo/URL enrichment, image upload, catalog gap-fill, native
app, military/NSN domain — all remain out of scope per CLAUDE.md.

### ADR recorded
[ADR-0007](../decisions/0007-classification-cache.md) captures the cache design: name-only key
(v0 scope decision), source provenance (llm/user/seed), corrections-feed-the-KB, review as safety
valve, and known caveats.

### Roadmap recorded
[`docs/roadmap.md`](../roadmap.md) maps the full path from current state to a complete app:
done-this-phase, near-term in-scope items, and gated items requiring explicit scope unlock.

---

## 2026-06-19 (Phase 2) — Usable web app + durable Postgres + NL parser (gates green)

Branch `claude/charming-franklin-441bvj`. All four gates green: `typecheck` / `lint` / `test` (51
passing) / `build`. Live verification: closet, plan, trips, /items/new, /login, item detail all
HTTP 200; live LLM classification confirmed end-to-end.

### What was built

**Review-before-save add flow** (`src/app/items/new`, `/items/[id]/review`, `src/app/actions.ts`):
- Adding an item by name classifies it → stores it as a DRAFT (`StoredItem.draft = true`, excluded
  from the closet) → redirects to `/items/[id]/review`.
- The review page shows the full evidence tree (identity, universal facets, multi-label, domain
  groups, materials, treatments, capability preview). The user confirms (promotes into closet via
  `setDraft(…, false)`) or discards (deletes the draft row).
- A facet-correction editor (`FacetEditor` client component) lets the user override any universal
  or multi-label facet; corrections carry `source: "user"`. The updated object is re-validated
  by `safeParseClassification` before persisting — invalid payloads are rejected and shown inline.
  Server Components cannot pass event handlers to server-action forms, so the delete-confirm
  button on the item detail page required a client `ConfirmButton` wrapper
  (`src/components/ConfirmButton.tsx`).
- New port method `setDraft(userId, id, draft)` added to `GearRepository`; `StoredItem.draft: boolean`
  is new in the port contract (see `src/core/ports.ts`).

**NL trip parsing** (`src/core/recommend/parse-conditions.ts`):
- Live path: Anthropic call (injected client, `MODEL_ID` constant) → model emits a partial
  `TripConditions` JSON → `PartialConditionsSchema` (Zod, closed enum literals) validates it →
  merged onto `defaultConditions`. The model is instructed to omit fields it cannot determine
  (no guess); unresolved fields fall back to the default, never to a fabricated value.
- Offline / no-key path: `parseConditionsHeuristic` — deterministic keyword→enum mapping with
  explicit-temperature extraction (Fahrenheit converted to Celsius). Conservative: unrecognised
  text falls to mild defaults, so the user can correct via the structured form.
- Either path emits the same `TripConditions` envelope `deriveRequirements` reasons over — NL input
  never bypasses the structured contract.
- Cross-archetype test suite (`test/parse-conditions.test.ts`, 5 cases across alpine / desert /
  sustained-rain / casual / Fahrenheit conversion). Per the engineering lesson, ≥3 distinct
  archetypes are required so the parser cannot secretly collapse onto one.
- Composition root (`src/server/services.ts`) selects live vs offline based on `ANTHROPIC_API_KEY`.

**Web surface** (`src/app/**`):
- Closet (`/`) with emergent facet grouping (no hardcoded categories).
- Item detail (`/items/[id]`) with inventory toggle, facet editor, delete confirm.
- Plan a trip (`/plan`): NL description form + structured conditions form + trip presets
  (`TRIP_PRESETS` are prototype data; no trip is hard-coded into the engine).
- Saved trips (`/trips`) and trip result (`/trips/[id]`): picks, severity-ranked capability gaps,
  `blocked_unknown` capabilities shown as "verify" (never silently passes).
- One-password gate (`APP_PASSWORD` env var, `/login`, `SESSION_COOKIE`).

**Durable Postgres** (`src/server/postgres-repo.ts`, migration `drizzle/0001_*`):
- Full `GearRepository` implementation behind the existing port interface.
- Lazy singleton: `getDb()` throws only on first query — importing the module has zero connection
  side effects; build and test need no `DATABASE_URL`.
- Write path: projects typed/hot columns from `classification` at insert/update for indexability
  (`projectIdentity`, `projectUniversal`, `projectMultilabel`). Group tables are upserted after
  the items row (`upsertGroups`). FK `onDelete: "cascade"` cleans group rows on item delete.
- Read path: reconstructs `StoredItem` entirely from the `classification` jsonb column (lossless
  source of truth) + the row's own scalars (`id`, `userId`, `name`, `inInventory`, `draft`,
  `rawText`, `createdAt`). Typed columns are not consulted on reads.
- Every query is `WHERE user_id = $userId` (architecture rule #4).
- `getRepository()` (in `src/server/services.ts`) selects `postgresRepository` when `DATABASE_URL`
  is set, `memoryRepository` otherwise.
- Migration `drizzle/0001_clammy_gertrude_yorkes.sql` adds `items.classification` (jsonb NOT NULL)
  and `items.draft` (boolean NOT NULL DEFAULT false) to the Phase 1 schema.

**Known latent note for future hardening:** `updateClassification` upserts group rows that are
present in the new classification but does not delete a group row that was removed (e.g. an item
re-classified away from the insulation group). Harmless in v0 because reads use the jsonb
source-of-truth column, not the group tables. Document and fix before group-table reads are relied
upon.

### Verification evidence
- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 warnings/errors
- `pnpm test` — 51 tests passed
- `pnpm build` — compiled successfully (hard gate)
- Live server: closet `/`, `/items/new`, `/login`, `/items/[id]`, `/plan`, `/trips`, `/trips/[id]`
  all HTTP 200
- Live LLM classification: item added by name → classified by `claude-sonnet-4-6` → draft stored →
  review page rendered → confirmed into closet — end-to-end confirmed

### Deferred (designed-for, not built)
Multi-user auth, weather API, barcode/photo/URL enrichment, image upload, catalog gap-fill, native
app, military/NSN domain — all remain out of scope per CLAUDE.md.

### ADR recorded
[ADR-0006](../decisions/0006-phase2-nl-parser-draft-lifecycle-postgres.md) captures the three
load-bearing Phase 2 decisions: NL parsing with offline fallback, review-before-save draft
lifecycle, and Postgres persistence shape.

---

## 2026-06-19 (Phase 1) — Foundation + general recommendation engine (gates green)

Approved (hybrid backbone + all five group stubs) → built Phase 1 foundation.

- **Scaffold:** Next 14 App Router + TS + Tailwind + Drizzle + Zod + Anthropic SDK + vitest/tsx; all
  four gates (`typecheck`/`lint`/`build`/`test`) green and kept green. DB/API-key never needed at
  build/test (clients lazy/injected).
- **Core (`src/core`, framework-agnostic):** facet registry + canonical vocab (ordinal ordering in
  code); `Evidence<T>`/`HardFact<T>` with the mechanical demotion guard; the Zod `ItemClassification`
  contract; 3-state capabilities (`satisfies|fails|blocked_unknown`); the recommender.
- **General trip engine (ADR-0005):** structured `TripConditions` → `deriveRequirements` → `planTrip`.
  The recommender is **no longer Marcy-specific** — desert/rain/casual/alpine each derive different
  requirements; the seed gear is prototype data only. (Product is general-purpose; see CLAUDE.md.)
- **Drizzle schema** (hybrid: hot columns + arrays + JSONB + composable group tables) + generated
  migration `0000`. Lazy injected DB client.
- **Tests: 35 green** — evidence demotion, capability 3-state, registry invariant, classification
  contract, the cross-archetype derive tests, and the end-to-end Marcy (exactly 3 gaps).

**Next (building the usable app):** repository abstraction (in-memory + Postgres) so it runs with or
without Supabase; the real add-by-name classification pipeline (prompt + Anthropic call) + NL trip
parser with graceful fallbacks; the web UI (closet with emergent facet grouping, add/review, plan, saved
trips) + one-password gate; route handlers/server actions calling core.

## 2026-06-19 (synthesis) — Phase 0 coherence gate: DESIGN.md + STOP for approval

- **Audit C → SOUND-WITH-FIXES.** Strength: the `item_capabilities` 3-state status
  (`satisfies|fails|blocked_unknown`). Critical fix: cache can go silently stale when a *capability
  predicate* changes → add `capability_version` (checked with `facet_hash`); make capability gates
  hot-only; `item_kind` must not be authoritative.
- **All three audits in → coherence gate passed.** Wrote the single integrated artifact
  [`DESIGN.md`](../../DESIGN.md) + the [classification rubric/prompt](../phase0/classification-rubric.md)
  + [ADR-0003](../decisions/0003-facet-ontology-and-data-model.md) (storage architecture) and
  [ADR-0004](../decisions/0004-llm-classification-contract.md) (classification contract).
- **Recommended design:** capability-first **hybrid** backbone (Architecture C) — typed hot facets +
  composable optional domain groups (`item_insulation/sleep/shell/carry/footwear`) + Zod-validated JSONB
  tail — **governed by a facet registry** (Architecture B's best idea) that generates the Zod validators
  and a CI facet-key lint, **wearing** A's null-first `Evidence<T>`/`HardFact<T>` shapes. Capabilities
  are first-class 3-state predicates; unknown safety inputs ⇒ `blocked_unknown` ("verify"), never a
  silent pass. No authoritative category. Every auditor's top fix folded in (DESIGN.md §10).
- **Verified by design walkthrough:** Marcy query against the 3 owned items → Terre Planing usable as a
  caveated approach layer, and **exactly the 3 intended gaps** (waterproof/windproof shell, packable
  wearable insulation, adequate wicking base). Terre Planing can never count as rain protection
  (`waterproofness=dwr`); Kelty "30" stored with `standard=null, confidence=low` (never upgraded).
- **STOP — awaiting approval.** One load-bearing fork surfaced to the user: storage architecture
  (approve hybrid vs prefer pure-A / pure-B). No migrations or feature code until approved.
- Phase 0 has no code yet, so its gate is the **coherence gate** (one integrated DESIGN.md, no silent
  contradictions) — `pnpm typecheck/lint/build/test` become live in Phase 1.

## 2026-06-19 (later) — Phase 0 Waves 2–3: competing architectures + adversarial audits

- **Wave 2 — three blind competing architectures** written to `docs/phase0/architectures/` (Opus):
  - **A — typed relational:** universal typed columns + per-domain extension tables; capabilities as
    pure `src/core` functions computed at query time.
  - **B — facet-graph / EAV:** every fact is a row in `item_facets` validated against a
    `facet_definitions` ontology; "domains" are emergent queries; adding a facet = INSERT, no migration.
  - **C — capability-first hybrid:** ~14 load-bearing facets as typed columns + a Zod-validated JSONB
    "cold bag"; first-class capabilities with a 3-state `satisfies | fails | blocked_unknown`.
  - **Convergence (strong signal):** all three make DWR/water-resistant *structurally* unable to count
    as rain protection, and all three surface exactly the 3 canonical Marcy gaps. They diverge on the
    **storage architecture** (the load-bearing decision synthesis must resolve).
- **Wave 3 — adversarial audits** (`docs/phase0/audits/`, one per proposal):
  - **A → SOUND-WITH-FIXES:** single-domain discriminated union loses safety columns on multi-domain
    gear (insulated waterproof boot) → make `itemDomains` an array; close `z.string()` multi-label
    enums; keep ordered-enum levels in `src/core`, not Postgres declaration order. **Harvest:**
    null-first `Evidence<T>`/`HardFact<T>` wrappers (cleanest unknown-handling seen).
  - **B → SOUND-WITH-FIXES:** type-safety is aspirational (JSONB is `unknown` to TS) → needs
    registry-driven codegen + a CI lint asserting every facet-key literal exists in the ontology;
    don't *silently discard* novel LLM-extracted facets → a `pending_facets` review queue; the
    "no migration" claim is really "no column-schema migration" (enum-level changes still need data
    migration). **Harvest:** the `isUnknown` 3-state row + the hard-fact-source guard (can't be
    bypassed by prompt wording).
  - **C → audit running.**
- **Emerging synthesis direction (to be finalized after audit C):** a **hybrid backbone (C)** —
  capability-first, typed hot facets + governed JSONB long tail — that **harvests** A's null-first
  evidence shapes and B's facet-registry/ontology governance (the registry de-risks C's typed/JSONB
  promotion boundary: promotion changes only physical storage, never a facet's definition).
- **Next:** audit C → synthesize `DESIGN.md` + proposed Drizzle schema + classification rubric →
  surface the storage-architecture decision to the user → **STOP for approval.**

## 2026-06-19 — Phase 0 kickoff: knowledge base + design swarm

- Wrote [`CLAUDE.md`](../../CLAUDE.md): stack, three-layer architecture, guiding principle (facets,
  not categories), load-bearing rules, orchestration rules, out-of-scope, commands, verify-before-done.
- Established the repo as a **living knowledge base** (`docs/` structure, ADRs, this log) per explicit
  direction: capture all research/agent output as committed markdown, never discard it.
- Recorded [ADR-0001](../decisions/0001-faceted-data-model.md) (faceted data model) and
  [ADR-0002](../decisions/0002-repository-as-knowledge-base.md) (repository as knowledge base).
- Launched **Wave 1** of the Phase 0 discovery swarm: **9 parallel investigation agents**
  - 7 domain agents: base layers · mid/insulation · shells/wind · sleeping bags · packs · footwear · accessories
  - 1 decision-driver agent (reasons backward from real planning queries to find load-bearing facets)
  - 1 material-behavior agent (composition → behavior; the item↔material relationship model)
  - Each writes a structured artifact to [`docs/phase0/investigation/`](../phase0/investigation/).
- **Next:** Wave 2 (3 blind competing-architecture proposals) → Wave 3 (3 adversarial audits) →
  synthesis into `DESIGN.md` + proposed Drizzle schema + classification rubric → **STOP for approval.**

### Emerging cross-cutting signals (from Wave 1 — to reconcile at synthesis)
- A shared **insulation-behavior** sub-model (fill type / power / treatment → wet performance,
  warmth-for-weight, packability) should be reused by *both* insulated garments and sleeping bags.
- **Moisture management / warmth-when-wet** is safety-critical and spans every textile domain
  ("cotton kills" → the hemp/cotton henley collapses when wet).
- **waterproof ≠ water-resistant/DWR** must be distinct facet values; unknown waterproofness = `null`
  (never assumed waterproof). The Terre Planing is the canonical danger case.
- Several facets want to be **multi-label** (layering role, function/purpose, body-zone-covered) — the
  buff and the R1 Air break single-value categories.
- Ambiguous **ratings** (sleeping-bag "30", garment warmth) must store the number *and* the
  standard/confidence separately; never upgrade a marketing number to a certified rating.
