# Progress Log

Reverse-chronological. Each entry is a meaningful checkpoint. This is the narrative spine of the
project; skim it to catch up fast.

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
  Server Components cannot pass event handlers to server-action forms, so interactive confirm/discard
  buttons required a client `ConfirmButton` wrapper.
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
