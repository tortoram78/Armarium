# Armarium — Product Study: the path to "fully featured & fully functional"

**Date:** 2026-06-24 · **Audience:** product owner · **Status:** decision input, not a commitment

> The ask was: *"Run a study to see what we need to do to get this to a fully featured, fully
> functional app. I want all the features."* This turns that into a concrete, prioritized, sequenced
> plan — ambitious about the vision, rigorous about sequencing and the architectural guardrails in
> `CLAUDE.md` (no hardcoded categories/trips; specs never fabricated; ask first before any new
> dependency/infra/provider). Every claim below is grounded in the actual code; where something is
> stubbed, offline, or absent, it says so.

---

## 1. Executive summary

**Where Armarium is today.** The faceted core is real and the invariants hold. Independent audit
of the live code confirms all five load-bearing properties: no hardcoded category/trip routing
(`src/core/closet.ts`, `src/core/recommend/derive.ts`), the mechanical hard-fact demotion guard is
wired and tested (`src/core/evidence.ts`), capability gates are registry-enforced to be stored hot
(`test/registry.test.ts`), registry↔classification coverage is checked (`test/cross-reference.test.ts`),
and the offline classifier refuses unknown items rather than fabricating (`src/core/classify/offline.ts`).
Phase 2 (closet → add-by-name → classify → review/save → plan → saved trips → verify/correct/re-plan)
and Phase 3 step 1 (Supabase Auth + RLS, email+password, dev passthrough) are shipped and wired end to
end (`src/middleware.ts`, `src/lib/auth.ts`, `src/app/actions.ts` all use `requireUserId()`; RLS in
`drizzle/0003_enable_rls_auth.sql`). 13 hermetic test files pass with zero env.

**The honest gap to "fully featured & fully functional."** Three gaps, in priority order. (1) **The
reasoning is still single-item.** `recommend()` evaluates each item independently against each
capability (`src/core/recommend/index.ts`); it never *combines* a base + mid + shell into a system,
which is exactly how real packing advice works — this is the project's whole point and where advice
still feels thin. (2) **The data is closet-only and largely inferred.** There is no manufacturer-URL
enrichment, no weather, no catalog; the offline classifier only knows a 7-item prototype corpus
(`src/core/seed-corpus.ts`), so without an API key the app cannot classify novel gear at all. (3) **The
app is operationally bare and not yet hardened for real multi-user traffic.** Zero observability, zero
rate-limiting on the LLM routes, no pagination, and the security-audit follow-ups (cross-tenant cache
attribution, future SSRF gate, auth-error normalization) are open.

**Recommended next sequence (top 8, one line each):**

1. **Layering-system reasoning** — combine items so a base+mid+shell can satisfy a capability together (the single highest-value reasoning upgrade; in Phase 2 scope, no new dep).
2. **Ops hardening bundle** — rate-limit the LLM routes + structured error/cost logging + render `facetError` nicely (cheap, protects the API budget and on-call before more users arrive).
3. **Manufacturer URL enrichment** (Phase 3 step 2) — paste-a-URL → `source:"manufacturer"` facts; **needs ADR + provider decision + an SSRF gate**.
4. **Weather auto-conditions** (Phase 3 step 3) — destination+dates → `TripConditions`; **needs ADR + provider decision** (Open-Meteo recommended).
5. **Trip CRUD + closet pagination** — rename/clone/delete trips and paginate the closet (table-stakes UX; no new shapes).
6. **Classification eval harness** — golden-set regression gated on `MODEL_ID`/prompt changes (protects the core from silent model drift).
7. **Catalog gap-fill suggestions** (Phase 3 step 4) — turn a gap into specific "what would fill it" guidance; **needs ADR + catalog-source decision**.
8. **Playwright E2E + weight/volume budgets** — catch RSC render bugs the build misses; add a pack-weight ceiling to the planner.

This respects the approved Phase 3 order but inserts two **in-Phase-2-scope** initiatives (layering,
ops hardening) ahead of enrichment, because they are cheaper, dependency-free, and de-risk everything
that follows. Rationale in §4.

---

## 2. Current-state inventory

Legend: **✓ works** · **◐ partial** · **✗ missing**. Files are cited; paths are absolute-from-repo-root.

### Auth / multi-user — ◐ (shipped, with known deferrals)
- ✓ Supabase Auth email+password, cookie sessions via `@supabase/ssr`, middleware session refresh + route protection (`src/middleware.ts`, `src/lib/supabase/*`, `/login`, `/signup`).
- ✓ Dual-layer isolation: app-layer `WHERE user_id` on every query (`src/server/postgres-repo.ts`) **and** RLS on the public PostgREST surface (`drizzle/0003_enable_rls_auth.sql`); both mandatory (ADR-0008).
- ✓ Dev passthrough: with Supabase env absent, `isAuthConfigured()` is false and the app runs open on `DEFAULT_USER_ID` (`src/lib/auth.ts`) — keeps the gauntlet secret-free.
- ✗ OAuth (designed-for, deferred — needs deployed redirect domain). ✗ Email verification (deferred — needs SMTP; **any email can sign up unverified today**). ✗ Password reset, account settings, sign-out is the only account action. ✗ One-time re-attribution of `DEFAULT_USER_ID`-seeded rows to a real UUID (DESIGN.md §13 operational note).
- Minor doc-drift: `src/server/services.ts:21` comment still says "one-password gate" — auth is actually live; harmless but should be cleaned.

### Closet / browse — ✓ (the strongest screen)
- ✓ Emergent grouping by capability / layering_role / warmth / technical_vs_lifestyle / body_zone, each a facet query, never a stored bucket (`src/core/closet.ts`, `src/components/ClosetView.tsx`). Items legitimately appear in multiple groups.
- ✓ "Verify" markers surface unknown-deciding-facet items; per-item facet badges.
- ✗ No search/filter box, no free-text find, no sort control. ✗ No pagination — `listItems` returns all rows (`src/server/{memory,postgres}-repo.ts`); a 100+ item closet renders everything. ✗ No multi-select / bulk actions. ✗ No pending-draft banner (unreviewed drafts are invisible from the closet).

### Intake / classify — ◐ (works live; offline is corpus-only by design)
- ✓ Add-by-name → cache lookup first → LLM classify on miss → store as draft → review (`src/server/app-service.ts` `classifyToDraft`). Self-building KB upserts `source:"user"` on confirm/correct (`src/core/cache.ts`, `src/server/{memory,postgres}-cache.ts`); Postgres cache **is** wired (`services.ts:42` — the old roadmap "near-term" item is done).
- ✓ Validated-evidence-only: LLM output passes Zod + the demotion guard before any persistence (`src/core/classification.ts`).
- ◐ Offline mode (no `ANTHROPIC_API_KEY`) only knows the 7-item prototype corpus and **throws** on anything else (`src/core/classify/offline.ts`) — correct (never fabricates) but means the deployed app is non-functional for novel gear without a key.
- ✗ No image/photo/barcode intake (unlocked backlog, each gated on its own ADR). ✗ No bulk import (CSV / paste-a-list). ✗ No `pending_facets` review surface (the table and write path exist in schema/design; no UI consumes it).

### Item detail / edit — ✓ (with one rough edge)
- ✓ Full facet dossier (identity, universal, multi-label, domain groups, materials, treatments), capability readout, registry-driven hard-fact editor with `source:"user"` corrections that survive demotion (`src/app/items/[id]/page.tsx`, `src/components/FacetEditor.tsx`, `src/core/corrections.ts`). Delete uses a client `ConfirmButton` (RSC-boundary-safe).
- ◐ `?facetError=1` renders the raw flag string, not a friendly message (`src/app/items/[id]/page.tsx:117` — low-effort polish, on the roadmap).
- ✗ No photo, no notes/tags, no purchase-date/usage history, no duplicate detection.

### Planner / recommend — ◐ (general and honest, but single-item)
- ✓ NL description **or** structured form → `TripConditions` → `deriveRequirements` (9 capabilities, explicit tunable thresholds) → picks + severity-ranked gaps + `blocked_unknown`→"verify" (`src/app/plan/page.tsx`, `src/core/recommend/*`, `src/core/capabilities/index.ts`). Proven general across alpine/desert/rain/casual (`test/derive.test.ts`, `test/recommend.marcy.test.ts`).
- ✗ **No layering/combination reasoning** — each item is gated alone (`recommend()` in `src/core/recommend/index.ts`); a wicking base + fleece mid + shell can't *together* satisfy `weather_shell`. This is the biggest depth gap (see §3b).
- ✗ No weight/volume budget (modeled as hard facts but not consumed by the planner). ✗ No quantity/duration math (e.g., "3 days → N base layers"). ✗ No per-item "why not" explanation beyond the capability reason string. ✗ No comparison of two candidate items for one slot.

### Trips — ◐ (create + re-plan only)
- ✓ Save trip, view result, **re-plan against current closet** after corrections (`replanTrip`), result snapshot persisted (`src/app/trips/[id]/page.tsx`, ADR-0006).
- ✗ No rename / clone / delete / edit-conditions — `GearRepository` exposes only `saveTrip` + `updateTripResult` (`src/core/ports.ts`); trips are otherwise immutable. ✗ No packing checklist / "mark packed" output. ✗ No trip sharing/export.

### Persistence — ✓ (clean hexagonal port)
- ✓ Repository port (`src/core/ports.ts`) with in-memory (default, zero-env) and Postgres impls; selected by `DATABASE_URL` (`src/server/services.ts`). Postgres reads reconstruct from a lossless `classification` jsonb column; hot columns are projected for indexing. RLS + 4 migrations applied (`drizzle/0000`–`0003`).
- ◐ `updateClassification` (Postgres) upserts group rows but does **not** delete rows removed by a re-classification (ADR-0006 Part B latent note) — harmless today (reads use jsonb) but a bug-in-waiting if group tables are ever read directly.
- ✗ No backups/export, no soft-delete, no `updatedAt` on trips, no migration for `pending_facets` writes from the app.

### Enrichment — ✗ (none built; all Phase 3 / backlog)
- ✗ Manufacturer URL (Phase 3 step 2), ✗ weather (step 3), ✗ catalog gap-fill (step 4), ✗ image/photo/barcode (backlog). No outbound product-fetch code exists anywhere — confirmed by search. The only authoritative-source path today is a manual user correction.

### Observability — ✗ (effectively zero)
- ✗ No Sentry/structured logging/error capture; no `console.*` in `src/`. ✗ No LLM token/cost/latency accounting (the Anthropic SDK returns `usage` per call — currently discarded). ✗ No request tracing, no health endpoint, no audit log. Operators are flying blind on cost, failures, and drift.

### Mobile / native — ◐ web responsive only
- ◐ The web UI is Tailwind-responsive and works on mobile browsers (a Safari cookie-refresh pitfall is already handled in `src/middleware.ts`). ✗ No native app, no PWA/offline, no install target (native = unlocked-backlog strategic pivot per ADR-0009).

### Trust & safety — ✗ (audit follow-ups open)
- ✗ No rate-limiting on the classify/parse server actions (`src/app/actions.ts`) — a single user can exhaust the API budget. ✗ No SSRF gate (not yet needed — no outbound fetch — but **mandatory before URL enrichment**). ◐ Cross-tenant cache: `classification_cache` is intentionally shared and locked to service-role (ADR-0007/0008), which is correct, but a `source:"user"` correction from one tenant silently shapes every tenant's next add — acceptable for a shared KB, worth an explicit product decision (§5). ✗ Auth-error normalization (signup/login surface raw Supabase errors). ✗ No CAPTCHA / abuse throttle on signup (compounds the unverified-email gap).

---

## 3. Gap analysis to "fully featured"

Grounded in DESIGN.md's vision: *model facets richly enough that packing advice emerges from
reasoning over them.* "Fully featured" = the reasoning is deep, the data is authoritative, the UX is
complete, and it is safe to run for many users.

### (a) Core UX completeness & polish
- **Browse at scale:** search/filter/sort + pagination (closet is all-rows today). **Drafts visibility:** a "N awaiting review" banner. **Friendly errors:** `facetError`, auth errors. **Trip lifecycle:** rename/clone/delete/edit-conditions + a packing checklist output. **Item richness:** notes/tags, usage history, duplicate detection. None of these touch the faceted invariant; they are conventional product surface.

### (b) Depth of the faceted reasoning — *the project's whole point; where advice feels thin*
- **Layering systems (highest impact).** Real advice is "base + mid + shell *together* handle this," not "you own a shell." Today each item is gated individually (`src/core/recommend/index.ts`). Faceted-safe approach: a new combination-aware predicate that composes per-item `CapResult`s over `layering_role` slots — still emergent, no hardcoded outfits. Needs ≥3 cross-archetype tests (per the engineering lesson on generality).
- **Quantity & duration reasoning.** Multiday trips need *counts* (sleep system, N base layers). Derive from `duration` in the envelope (`src/core/conditions.ts` already carries it) — a new requirement kind, not a hardcoded list.
- **Weight/volume budgets.** `weight_grams`/`capacity_liters` are modeled as hard facts but unused by the planner; add a budget-vs-actual breakdown alongside gaps (roadmap item; depends on populated values, which enrichment improves).
- **Richer condition envelope.** Humidity, multi-day temperature *swing*, river-crossing/approach, sun-exposure duration. Each is a new facet/condition field flowing through the same `deriveRequirements`, never a per-trip branch.
- **Explanation quality.** Surface *why an item fails* a capability (which facet, what threshold) and let the user compare two candidates for one slot — the data is already there in `CapResult`/evidence.

### (c) Data & enrichment — turning inference into authority
- **Manufacturer URL (Phase 3 step 2):** the highest-leverage data upgrade — `source:"manufacturer"` is the top of the confidence hierarchy and feeds the shared KB. Hard parts are the **provider/parse strategy** and an **SSRF gate** (sandbox can't reach arbitrary hosts; verify on Vercel — engineering-log lesson).
- **Weather (step 3):** removes manual condition entry; needs a clean fallback for ambiguous locations / API-down. Open-Meteo (no key) keeps the "ask-first" cost low.
- **Catalog gap-fill (step 4):** gap → specific item suggestion, framed as guidance not shopping. Source decision: reuse the KB vs a curated seed.
- **Photo/barcode (backlog):** photo assists classification; barcode is better native-first and deferred behind URL enrichment (ADR-0009). Each needs its own ADR + the dependency decision.
- **Offline-mode reality:** the deployed app is only useful with `ANTHROPIC_API_KEY` set; the corpus-only offline path is a dev/test affordance, not a product mode. Worth stating plainly to the owner.

### (d) Multi-user / sharing / social
- Foundation is in (per-user isolation). "Fully featured" *could* mean: share a trip/packing list (read-only link), share a closet, follow another user's gear, community gear reviews feeding the KB. **None designed.** This is a genuine product fork (§5) — it ranges from a tiny export-link feature to a full social layer with very different infra/moderation needs. The shared KB already has a quasi-social dimension (one user's correction helps all).

### (e) Mobile / native
- Web-responsive today. Native unlocks barcode/camera and offline use but is a strategic pivot (new pipeline, distribution, possibly different sync/auth) gated on its own scoping ADR (ADR-0009). A **PWA** is a lighter middle path (installable, some offline) that doesn't require leaving the Next stack — worth considering before a full native build.

### (f) Ops / observability / logging
- Add structured error capture + LLM `usage` (cost/latency/drift) logging — the roadmap notes this can be done with **no new external dependency** (a lightweight log table) before reaching for Sentry. Add a health check. This is currently the single biggest operational risk: no visibility into cost or failures in production.

### (g) Trust & safety (the audit follow-ups)
- **Rate-limit** the LLM routes (in-memory token bucket is enough at current scale). **SSRF gate** before any URL enrichment (allowlist/deny-internal-IPs, size/time caps). **Auth-error normalization** + signup abuse throttle (compounded by unverified email). **Cross-tenant cache** posture: confirm the shared-KB decision is intended at multi-user scale, or add per-tenant overlay if a user's correction shouldn't leak to strangers.

---

## 4. Prioritized build sequence

Numbered, with *What · Why · Effort (S/M/L) · Risk · Dependencies · Needs ADR/provider-decision?*
The approved Phase 3 order (auth→URL→weather→catalog) is respected; the **two deviations are called
out** — both are in-Phase-2 scope, dependency-free, and de-risk the enrichment work that follows.

| # | Initiative | What | Why / user-value | Effort | Risk | Dependencies | ADR / provider decision? |
|---|-----------|------|------------------|:------:|------|--------------|--------------------------|
| 1 | **Layering-system reasoning** *(deviation: in-Phase-2 scope, ahead of enrichment)* | Combination-aware capability eval: base+mid+shell can satisfy a requirement together | The core promise — advice that reflects how people actually layer; today it's single-item only | **M** | Med — must stay emergent (no hardcoded outfits); needs ≥3 cross-archetype tests so it can't collapse onto one case | None (pure `src/core`) | **No new dep.** ADR recommended for the new predicate design (load-bearing reasoning change) |
| 2 | **Ops hardening bundle** *(deviation: in-Phase-2 scope, ahead of enrichment)* | Rate-limit classify/parse routes + log LLM `usage` & errors to a light table + render `facetError`/auth errors nicely | Protects the API budget and gives operators cost/failure visibility **before** more users and before enrichment adds outbound calls | **S–M** | Low | None (roadmap: no external dep needed) | **No** (in-memory limiter + DB table; a hosted limiter/Sentry *would* be ask-first) |
| 3 | **Manufacturer URL enrichment** *(Phase 3 step 2)* | Paste-a-URL → server fetch + parse → `source:"manufacturer"` facts into the KB | Authoritative specs are the top of the confidence hierarchy; biggest data-quality upgrade; easier item input | **L** | **High** — SSRF surface; brittle parsing; sandbox can't reach arbitrary hosts (verify on Vercel) | Auth (done); **SSRF gate (item 2's posture helps)** | **YES** — ADR + the fetch/parse-provider decision; **ask-first** before any parser/HTML dep |
| 4 | **Weather auto-conditions** *(Phase 3 step 3)* | Destination+dates → forecast → prefilled `TripConditions` (user still adjusts) | Removes manual condition entry; better first-pass plans | **M** | Med — geocoding ambiguity, API-down fallback | URL-enrichment fetch/SSRF patterns reused | **YES** — provider decision (**Open-Meteo**, no key, recommended); ask-first |
| 5 | **Trip CRUD + closet pagination** | Rename/clone/delete/edit trips; cursor pagination on `listItems`/`listTrips` | Table-stakes UX; trips are immutable and the closet is all-rows today | **S–M** | Low | None (thin repo methods + actions) | **No** |
| 6 | **Classification eval harness** | Golden-set of names→expected facets, run on `MODEL_ID`/prompt change; CI offline, live opt-in | Protects the faceted core from silent model drift (the `model_id` column already exists for targeting) | **M** | Low | None | **No** |
| 7 | **Catalog gap-fill suggestions** *(Phase 3 step 4)* | Gap → specific items that would fill it, as guidance | Closes the loop: gap analysis → actionable next step | **M–L** | Med — must read as guidance, not shopping; matching logic | KB from items 1–3 as source | **YES** — catalog-source decision (reuse KB vs curated seed); ask-first if any external catalog |
| 8 | **Playwright E2E + weight/volume budgets** | Browser tests against `next start` (catch RSC render bugs build misses) + pack-weight ceiling in planner | Confidence on redirect chains/verify-loop; budget-aware packing | **M** | Low | Budgets depend on populated weights (item 3 helps) | **No** (Playwright is a devDep — borderline; confirm) |

**Why the two deviations.** Items 1 and 2 sit *before* enrichment deliberately. **Layering** is the
highest user-value upgrade, costs nothing in dependencies, and is the feature most aligned with the
project's reason for existing — it should not wait behind two provider-gated initiatives. **Ops
hardening** must precede enrichment because (a) the LLM routes are already an unmetered budget risk
today, and (b) the SSRF gate and request logging it establishes are prerequisites for safely shipping
the outbound fetch in item 3. Auth (Phase 3 step 1) is already done, so the approved sequence's intent
— foundation first — is preserved; we are inserting cheap, enabling work, not reordering the
provider-gated steps among themselves (URL → weather → catalog order is intact).

**Audit-hardening placement.** Rate-limiting + auth-error normalization land in item 2; the **SSRF
gate** lands with item 3 (its first real consumer); the **cross-tenant cache** question is a §5
decision (likely "keep shared," documented). This avoids building a gate with no consumer while still
front-loading the cheap protections.

---

## 5. Open product decisions for the owner

Genuine forks that need a human call **before** the dependent build begins. Each is a crisp question
with a recommended default. (Per `CLAUDE.md`, every provider/dependency choice is itself an
"ask-first" decision and an ADR.)

1. **URL-enrichment fetch & parse strategy?** Plain server `fetch` + lightweight HTML/JSON-LD parsing
   for a small allowlist of cooperative manufacturers, vs a hosted scraping/extraction API for broad
   coverage? **Recommended default:** start with `fetch` + structured-data (JSON-LD/OpenGraph) parsing
   on an allowlist — minimal new surface, no new infra — and treat a hosted extractor as a later,
   separately-ADR'd upgrade. *(Blocks item 3. Decide the SSRF gate at the same time.)*

2. **Weather provider?** Open-Meteo (free, no key, no account) vs a keyed provider (OpenWeather/Tomorrow)
   with richer history/alerts? **Recommended default:** **Open-Meteo** — keeps the "ask-first" cost at
   zero and is sufficient to prefill conditions. *(Blocks item 4.)*

3. **How much social/sharing — and when?** Nothing, a read-only share-a-trip/packing-list link, or a
   full social layer (shared closets, follows, community reviews feeding the KB)? **Recommended
   default:** ship a **read-only trip/packing-list export link** as a small feature when item 5 lands;
   defer the full social layer until there's a user base — it carries moderation, privacy, and infra
   cost disproportionate to a personal gear tool today.

4. **Catalog source for gap-fill?** Reuse the self-building classification KB as the suggestion source
   vs curate a seed catalog vs pull an external product catalog? **Recommended default:** **reuse the
   KB** (it grows with use and adds no dependency); revisit an external catalog only if coverage proves
   thin. *(Blocks item 7.)*

5. **Native app / PWA timing?** Stay web-only, ship a **PWA** (installable + some offline, no stack
   change), or commit to a native build (unlocks barcode/camera but is a strategic pivot)? **Recommended
   default:** **PWA next, native later** — a PWA captures most mobile value cheaply; gate a native build
   on its own scoping ADR (ADR-0009) and on barcode demand after URL enrichment proves out.

6. **Target user breadth (and the unverified-email gap)?** Single-owner / invite-only (current de-facto
   posture; email verification still off) vs open public signup? **Recommended default:** keep it
   **invite-or-small-group** until email verification (SMTP) + signup abuse throttle land — opening
   public signup before then exposes the unverified-email and unmetered-LLM risks together. Promote
   email verification + a signup throttle into item 2's bundle if public launch is near-term.

---

### Appendix — what is genuinely shipped vs stubbed (quick reference)

| Area | State | Evidence |
|------|-------|----------|
| Faceted core + invariants | ✓ shipped, audited | `src/core/**`; `test/registry.test.ts`, `test/cross-reference.test.ts`, `test/evidence.test.ts` |
| Auth + RLS multi-user | ✓ shipped (OAuth/email-verify deferred) | `src/middleware.ts`, `src/lib/auth.ts`, `drizzle/0003_enable_rls_auth.sql`, ADR-0008 |
| Classification + self-building KB | ✓ shipped (Postgres cache wired) | `src/server/app-service.ts`, `src/server/postgres-cache.ts`, `services.ts:42` |
| Offline classifier | ◐ corpus-only, throws on unknown (no fabrication) | `src/core/classify/offline.ts` (7-item `seed-corpus.ts`) |
| Layering/combination reasoning | ✗ single-item only | `src/core/recommend/index.ts` |
| Weight/volume budgets | ✗ modeled, not used by planner | `src/core/conditions.ts`, registry hard facts |
| Trip CRUD (rename/clone/delete) | ✗ create + re-plan only | `src/core/ports.ts` |
| Pagination | ✗ all-rows | `src/server/{memory,postgres}-repo.ts` |
| URL / weather / catalog enrichment | ✗ none built (Phase 3 / backlog) | search-confirmed absent |
| Photo / barcode | ✗ none (unlocked backlog) | ADR-0009 |
| Observability / logging / cost accounting | ✗ none | search-confirmed absent in `src/` |
| Rate-limiting / SSRF gate | ✗ none | search-confirmed absent |
| E2E / Playwright / eval harness | ✗ none | `test/` is unit/integration only (13 files) |
