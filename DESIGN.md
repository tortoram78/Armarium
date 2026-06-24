# Armarium — DESIGN (Phase 0 synthesis)

> **Status: LIVE — Phase 2 complete; Phase 3 steps 1–2 in delivery.** This document began as the Phase 0
> design synthesis (9 investigation agents → 3 competing architectures → 3 adversarial audits) and is
> updated as each phase lands. Phase 1 (core + schema), Phase 2 (usable web app + NL parser + review
> lifecycle + Postgres + self-building cache + layering-system reasoning), Phase 3 step 1 (real
> auth + multi-user), and Phase 3 step 2 (manufacturer URL enrichment) are all reflected below.
> Source artifacts: [`docs/phase0/`](docs/phase0/). Key decisions:
> [ADR-0003](docs/decisions/0003-facet-ontology-and-data-model.md),
> [ADR-0004](docs/decisions/0004-llm-classification-contract.md),
> [ADR-0006](docs/decisions/0006-phase2-nl-parser-draft-lifecycle-postgres.md),
> [ADR-0007](docs/decisions/0007-classification-cache.md),
> [ADR-0008](docs/decisions/0008-auth-multi-user.md),
> [ADR-0010](docs/decisions/0010-layering-system-reasoning.md),
> [ADR-0011](docs/decisions/0011-manufacturer-url-enrichment.md),
> [ADR-0012](docs/decisions/0012-evidence-first-classification.md) *(north-star: evidence-first classification)*.

## 0. TL;DR

- **Model facets, not categories.** An item is a bundle of facet values across many dimensions; there
  is **no authoritative `category`/`item_kind`** that recommendations read. Grouping and packing
  advice are **emergent queries** over the facet space.
- **Storage = capability-first hybrid, governed by a facet registry.** The ~18 *load-bearing* facets
  are **typed Postgres columns** (fast, safe, indexable); cohesive domain clusters live in **optional,
  composable 1:1 group tables** (insulation, sleep, shell, carry, footwear) so a multi-domain item
  (insulated waterproof boot) is just *several groups at once*; the long tail lives in a
  **Zod-validated JSONB bag**. A single **facet registry in `src/core`** is the source of truth for
  every facet (key, value-space, ordering, tier, hard/soft), and generates the Zod validators.
- **Capabilities are first-class.** Recommendation reasons over derived predicates
  (`rain_protection`, `wicking_base`, `packable_insulation`, …), each returning
  **`satisfies | fails | blocked_unknown`**. Unknown/low-confidence inputs on a safety dimension
  **block** a positive claim and surface as *"verify"* — never a silent pass.
- **Unknown is first-class; specs are never fabricated.** Every soft value is `{ value|null,
  confidence, source, evidence }`. Hard facts (fill power, composition, EN rating) are `null` unless
  manufacturer/user-stated; an *inferred* hard fact is mechanically demoted to `null + unknown`.
- **Materials are a normalized, reusable library** referenced via named construction roles
  (shell / membrane / insulation / lining), with treatments (DWR, hydrophobic down) modeled separately
  because they wear off.

---

## 1. How the three layers map onto this design

| Layer | What it is | Where it lives |
|------|------------|----------------|
| **0 — Data foundation** | The faceted gear + material model | Postgres schema (§6) + the facet registry (§3) |
| **1 — Analysis (THE CORE)** | LLM enrich + classify a garment onto facets, validated to Zod, unknowns null | `src/core/` pipeline + rubric (§7, [rubric](docs/phase0/classification-rubric.md)) |
| **2 — Recommendation** | Trip → condition envelope → capability queries over inventory → picks + gaps | `src/core/capabilities` + `src/core/recommend` (§5, §8) |

`src/core/` is framework-agnostic (no `next/*`, no React, no DB singletons — deps are injected) so the
exact same core can later back an **MCP server**. The web app is one caller.

---

## 2. Guiding principle in practice: facets, not categories

A category model (`BaseLayer | MidLayer | Shell | …`) forces a single truth onto items that are
genuinely many things at once, and it hardcodes the very recommendations we want to *derive*. Wave-1
produced four items that each break a category model on their own:

- **Patagonia R1 Air** is simultaneously a next-to-skin layer, an active-insulation mid, and a
  standalone piece. → `layering_role` is a **multi-label set**, not one enum.
- **A buff** covers head + neck + face and provides warmth + sun + wind protection at once. →
  `body_zone_covered` and `function_purpose` are **multi-label sets**.
- **Terre Planing Hoody** has *some* weather resistance (DWR) but is **not** a rain shell. →
  `waterproofness` is an **ordered scale** where `dwr` sits structurally below any "waterproof" level.
- **An insulated waterproof boot** is footwear **and** a shell **and** insulation. → domain facets are
  **composable groups**, never a single discriminator.

So: **domains are emergent.** "Show me my shells" is the query `waterproofness ≥ wp_breathable OR
wind_resistance = windproof`, not a table lookup.

---

## 3. The facet ontology (the heart)

Every facet is declared once in the **registry** (`src/core/facets/registry.ts`). A registry entry:

```ts
type FacetDef = {
  key: string;                       // 'waterproofness'
  label: string;
  group: FacetGroup;                 // 'universal' | 'insulation' | 'sleep' | 'shell' | 'carry' | 'footwear' | 'identity'
  kind: 'boolean' | 'ordinal' | 'nominal' | 'continuous' | 'multilabel' | 'structured';
  levels?: readonly string[];        // ordinal/nominal/multilabel domain — ORDER IS CANONICAL HERE (not in Postgres)
  unit?: string;                     // continuous, e.g. 'g', 'L'
  multiLabel?: boolean;
  scope: 'universal' | 'domain';
  fact: 'hard' | 'soft';             // hard = manufacturer/user only; soft = inferable w/ confidence
  tier: 'column' | 'group' | 'jsonb';// physical storage
  capabilityGate: boolean;           // if true, MUST be tier 'column'|'group' (never jsonb) — see §5
};
```

> **Why a registry (harvested from Architecture B).** It is the single source of truth that (a)
> generates the Zod validators for *both* the typed columns and the JSONB bag, (b) makes the
> hot/cold *promotion boundary* a non-event — promoting a facet changes only its `tier`, never its
> definition or validator — and (c) lets CI assert that every facet key referenced in a capability or
> query literal exists in the registry (closes Architecture B's "type-safety is aspirational" hole and
> Architecture C's promotion-staleness risk).

Ordinal **ordering lives in `levels` (code), not in Postgres enum declaration order** — so capability
comparisons like `waterproofness ≥ wp_breathable` can never be silently corrupted by an `ALTER TYPE`
(Audit A's fix).

### 3.1 Universal behavioral facets — typed columns on `items`

| Facet | Kind / levels (ordered low→high) | Multi | Fact | Gate | Notes |
|-------|----------------------------------|:----:|:----:|:----:|-------|
| `waterproofness` | ordinal: `none < dwr < water_resistant < wp_breathable < wp_nonbreathable` | – | soft | ✓ | **`dwr`/`water_resistant` are NOT waterproof.** Unknown ⇒ null ⇒ never counts as rain protection. |
| `wind_resistance` | ordinal: `none < wind_resistant < windproof` | – | soft | ✓ | Independent of waterproofness (a windshirt is windproof, not waterproof). |
| `breathability` | ordinal: `low < moderate < high < very_high` | – | soft | ✓ | Gates `breathable_shell`, active-layer choice. |
| `moisture_management` | nominal: `wicks` / `neutral` / `absorbs_holds` | – | soft | ✓ | "Cotton kills" ⇒ `absorbs_holds`. |
| `dry_speed` | ordinal: `slow < moderate < fast < very_fast` | – | soft | – | Distinct from "stays dry". |
| `warmth_when_wet` | ordinal: `collapses < neutral < retains` | – | soft | ✓ | Safety-critical. down→collapses(unless treated); synthetic→neutral/retains; cotton→collapses. |
| `warmth` | ordinal: `minimal < light < moderate < high < very_high` | – | soft | ✓ | Anchored examples in rubric to stop drift (Snap-T = moderate; 800FP alpine = high+). |
| `packability` | ordinal: `bulky < moderate < packable < ultra_packable` | – | soft | ✓ | Gates `packable_insulation`, daypack/travel viability. |
| `technical_vs_lifestyle` | ordinal: `lifestyle < mostly_lifestyle < versatile < mostly_technical < technical` | – | soft | – | Drives the casual/travel query, suppresses lifestyle pieces for alpine. |
| `upf` | continuous (int) or null | – | **hard** | ✓ | Manufacturer-stated only; null if unstated. |
| `weight_grams` | continuous (`g`) | – | hard | – | null if unknown; user-recall ⇒ confidence medium. |

### 3.2 Multi-label facets — Postgres enum arrays on `items` (GIN-indexed)

| Facet | Members (open-ish, registry-closed) | Gate | Notes |
|-------|--------------------------------------|:----:|-------|
| `layering_role` | `next_to_skin, base, active_insulation, static_insulation, mid, wind_shell, weather_shell, sleep_system, standalone, accessory` | ✓ | The structural facet that lets the engine build base/mid/shell systems. |
| `function_purpose` | `warmth, insulation, wind_protection, rain_protection, water_resistance, sun_protection, moisture_wicking, cooling, abrasion_protection, carry, sleep, lifestyle` | – | `water_resistance ≠ rain_protection` — Terre Planing gets the former, never the latter. |
| `body_zone_covered` | `head, face, neck, torso, arms, hands, legs, feet, eyes` | – | Enables zone-coverage gap detection ("no hand warmth below freezing"). |
| `activity_fit` | `hiking, backpacking, alpine, climbing, trail_running, watersports, travel, everyday, camp` | – | Shared vocabulary across all domains. |
| `conditions_fit` | `cold, cool, mild, warm, hot, rain, snow, wind, high_sun, high_exertion, static` | – | Item-level suitability tags; trips carry a *structured* envelope (§6). |

### 3.3 Shared insulation sub-model — `item_insulation` (used by garments **and** sleeping bags)

The single biggest cross-domain finding: **"down is down."** Insulated jackets and sleeping bags share
the same physics, so they share one optional group table.

| Facet | Kind | Fact | Notes |
|-------|------|:----:|-------|
| `fill_type` | nominal: `down, synthetic, fleece_grid, fleece_pile, other` | hard | |
| `fill_power` | continuous (FP) | hard | down only; null otherwise/if unknown |
| `fill_species` | nominal: `duck, goose` / null | hard | Kelty = `duck` |
| `fill_weight_g` | continuous (`g`) | hard | **usually null** — manufacturers omit it; downgrades any derived warmth |
| `hydrophobic_treatment` | boolean / null | hard | null ≠ false (absence of claim ≠ absence of treatment) |
| `wet_performance` | ordinal: `collapses < retains_some < unaffected` | soft (derived) | from fill_type + treatment |
| `warmth_for_weight` | ordinal | soft (derived) | downgraded confidence when fill_weight null |

### 3.4 Other composable domain groups (optional 1:1, attach only when relevant)

- **`item_sleep`** — `temp_rating_value` (num), `temp_rating_unit` (`F|C`), **`temp_rating_standard`**
  (`en_iso_comfort | en_iso_limit | en_iso_lower | manufacturer_season | marketing_unknown` / **null**),
  `temp_rating_confidence`, `shape` (`mummy | rectangular | quilt`), `pad_r_value_recommended` (num|null).
  → The Kelty "30" stores `value:30, unit:F, standard:null, confidence:low` — **never upgraded** to an
  EN comfort rating.
- **`item_shell`** — `protection_ceiling` (ordinal: `none < light_spray < light_rain < sustained_rain
  < storm`, soft/derived, **gate**), `seam_sealing` (`none | critical | fully` / null, **gate** —
  promoted to a column because it gates `rain_protection`, per Audit C), `hood` (bool), `pit_zips`
  (bool).
- **`item_carry`** — `capacity_liters` (num, gate), `suspension` (`frameless | framesheet |
  internal_frame | external_frame`), `max_comfortable_load_kg` (num, soft), `access_style` (tags).
- **`item_footwear`** — `support_stiffness` (ordinal 1–5), `ankle_height` (`low | mid | high`),
  **`crampon_compat`** (`none | C1 | C2 | C3` / **null — NEVER inferred**, manufacturer-only;
  a wrong value is a slope-detachment safety failure), `water_management` (`fast_drain_breathable |
  dwr | waterproof_membrane`).

### 3.5 The long tail — `items.facets` JSONB bag

Rare/situational facets (e.g. `pocket_count`, `pit_zip_length`, `print_pattern`, brand-specific
features) live in one Zod-validated JSONB column, GIN-indexed. **Invariant:** a facet that *gates a
capability* may **never** live in JSONB — it must be a column or group field (Audit C, F2). CI enforces
this from the registry.

---

## 4. Confidence, source & the "unknown is first-class" contract

Two evidence shapes (harvested from Architecture A, hardened by Architecture B's source guard):

```ts
// Soft, inferable facets — confidence-graded.
type Evidence<T> =
  | { value: T;    confidence: 'low' | 'medium' | 'high'; source: Source; evidence: string }
  | { value: null; confidence: 'unknown';                 source: 'unknown'; evidence?: string };

// Hard facts — a non-null value REQUIRES a non-inferred source.
type HardFact<T> =
  | { value: T;    source: 'manufacturer' | 'user'; evidence: string }   // stated
  | { value: null; source: 'unknown';               evidence?: string }; // unknown — NEVER guessed

type Source = 'manufacturer' | 'user' | 'inferred' | 'derived_from_material' | 'unknown';
```

**The demotion guard (mechanical, not prompt-dependent):** if the LLM returns a hard-fact key with a
value but `source ∉ {manufacturer, user}`, the validator **rewrites it to `{ value:null, source:
'unknown' }`**. A fabricated fill-power or EN rating has nowhere to live. Three distinct states are
representable and queryable:

- **known** — value + source + confidence,
- **known-unknown** — `null` + `unknown` (we looked; it isn't stated),
- **never-assessed** — facet absent from the item entirely.

Physical storage: hot soft facet `x` → columns `x`, `x_confidence`, `x_source`. Hard fact → `x`,
`x_source`. JSONB facets carry the same `{value,confidence,source,evidence}` envelope.

---

## 5. The capability layer (recommendation substrate)

A **capability** is a pure predicate in `src/core/capabilities/` over an item's resolved facets,
returning a 3-state result (harvested from Architecture C, its strongest contribution):

```ts
type CapResult = 'satisfies' | 'fails' | 'blocked_unknown';
```

`blocked_unknown` is what makes *"unknown ⇒ surface 'verify', never satisfy"* a first-class, testable
property instead of app logic someone forgets. Example definitions:

```ts
rain_protection      := waterproofness ∈ {wp_breathable, wp_nonbreathable}      // unknown ⇒ blocked_unknown
wind_protection      := wind_resistance = windproof OR waterproofness ≥ wp_breathable
breathable_shell     := (rain_protection|wind_protection) AND breathability ≥ high
wicking_base         := layering_role ∋ {next_to_skin, base} AND moisture_management = wicks
                        AND warmth_when_wet ≠ collapses
packable_insulation  := layering_role ∋ {active_insulation, static_insulation} AND insulation_type ≠ none
                        AND packability ≥ packable                                // sleep_system excluded
sun_protection       := upf ≥ 30 OR function_purpose ∋ sun_protection
sleep_to(envelope)   := item_sleep present AND effective_comfort ≤ target_temp   // standard=null ⇒ blocked_unknown
```

**Invariant:** every facet read by a capability is `capabilityGate: true` ⇒ stored hot (column/group),
never JSONB — so capabilities have one query path and can't read stale cold data.

**Capability satisfaction is single-item OR combination-of-layers.** A `CapabilityOutcome` is
`"satisfied"` when either (a) at least one item individually satisfies the capability's predicate
(`satisfiedBy: ItemRef[]`), or (b) a *set* of items in **distinct structural layering slots** jointly
satisfies it (`satisfiedBySystem: ItemSystem[]`). Combination is evaluated only when (a) fails first,
so it never over-triggers. The structural slots are derived from the `layering_role` facet (a
capability-gated hot column): next-to-skin/base = slot 0, active-insulation/mid = slot 1,
static-insulation = slot 2, wind/weather-shell = slot 3; sleep and accessory roles are excluded.
Each combinable capability declares an aggregation **strategy** alongside its predicate (in
`src/core/capabilities/index.ts`): `additive_warmth` (slot warmth ranks sum toward a thermal target
derived from `temp_min_c`) or `shell_over_warmth` (one slot satisfies a protective sub-capability
AND a distinct slot meets a warmth-base floor — both arms required). No outfit templates, no category
routing: combination logic is entirely emergent from `layering_role` values and strategy metadata.
Unknown/low-confidence facets on any participating item demote the system outcome to `blocked_unknown`
— a fabricated system satisfy is worse than a flagged "verify." See
[ADR-0010](docs/decisions/0010-layering-system-reasoning.md) for full rationale.

**v0 = compute-on-read.** A personal closet is small-N; capabilities are evaluated live in `src/core`.
This is always correct and sidesteps cache staleness entirely. The **optional** materialization
(`item_capabilities` table) is specified for later **with both invalidation keys** — a content
`facet_hash` *and* a `capability_version` bumped on any predicate change (Audit C's Critical fix) — so
it is never silently wrong.

---

## 6. Proposed Drizzle schema (PROPOSAL — not migrated)

`user_id` is on every user-owned table from day one (architecture rule #4 — planted in Phase 1; tied
to a real authenticated identity in Phase 3 step 1; see §13 for the multi-user model). The
`materials`/`treatments` libraries are intentionally **shared/global** (no `user_id`).
Sketch (illustrative Drizzle/TS; enums abbreviated — full level lists come from the registry):

```ts
// ---- shared libraries (no user_id) ----
export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),                              // 'Patagonia recycled polyester 100%'
  fiberComponents: jsonb('fiber_components').$type<{ fiber: string; pct: number | null }[]>(),
  constructionType: text('construction_type'),              // woven|knit|grid_fleece|pile_fleece|membrane|insulation_fill
  // derived behavioral facets, each {value,confidence,source,evidence} in JSONB or split columns:
  behavior: jsonb('behavior').$type<MaterialBehavior>(),    // breathability, dry_speed, wet_warmth_retention, ...
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const treatments = pgTable('treatments', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),                             // 'dwr' | 'hydrophobic_down'
  description: text('description'),
});

// ---- core item (user-owned) ----
export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  brand: text('brand'), model: text('model'),
  priceCents: integer('price_cents'), priceSource: text('price_source'),
  weightGrams: integer('weight_grams'), weightSource: text('weight_source'),

  // universal hot soft facets (value + confidence + source) — abbreviated:
  waterproofness: text('waterproofness'),  waterproofnessConf: text('waterproofness_conf'), waterproofnessSrc: text('waterproofness_src'),
  windResistance: text('wind_resistance'), windResistanceConf: text('wind_resistance_conf'), windResistanceSrc: text('wind_resistance_src'),
  breathability: text('breathability'),    breathabilityConf: text('breathability_conf'), breathabilitySrc: text('breathability_src'),
  moistureManagement: text('moisture_management'), /* + _conf, _src */
  drySpeed: text('dry_speed'), warmthWhenWet: text('warmth_when_wet'), warmth: text('warmth'),
  packability: text('packability'), technicalVsLifestyle: text('technical_vs_lifestyle'),
  upf: integer('upf'), upfSource: text('upf_source'),       // hard fact

  // multi-label arrays (GIN-indexed):
  layeringRole: text('layering_role').array(),
  functionPurpose: text('function_purpose').array(),
  bodyZoneCovered: text('body_zone_covered').array(),
  activityFit: text('activity_fit').array(),
  conditionsFit: text('conditions_fit').array(),

  // long-tail facets, Zod-validated, GIN-indexed (never capability gates):
  facets: jsonb('facets').$type<Record<string, FacetEnvelope>>().default({}),

  // material construction roles (named, nullable):
  shellMaterialId: uuid('shell_material_id').references(() => materials.id),
  membraneMaterialId: uuid('membrane_material_id').references(() => materials.id),
  insulationMaterialId: uuid('insulation_material_id').references(() => materials.id),
  liningMaterialId: uuid('lining_material_id').references(() => materials.id),

  rawText: text('raw_text'),                                // the source text the LLM classified
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- composable domain groups (optional 1:1; an item may have SEVERAL) ----
export const itemInsulation = pgTable('item_insulation', { itemId: uuid('item_id').primaryKey().references(()=>items.id), /* fill_type, fill_power, fill_species, fill_weight_g, hydrophobic_treatment, wet_performance, warmth_for_weight (+conf/src) */ });
export const itemSleep   = pgTable('item_sleep',   { itemId: uuid('item_id').primaryKey().references(()=>items.id), /* temp_rating_value, _unit, _standard, _confidence, shape, pad_r_value_recommended */ });
export const itemShell   = pgTable('item_shell',   { itemId: uuid('item_id').primaryKey().references(()=>items.id), /* protection_ceiling, seam_sealing, hood, pit_zips (+conf/src) */ });
export const itemCarry   = pgTable('item_carry',   { itemId: uuid('item_id').primaryKey().references(()=>items.id), /* capacity_liters, suspension, max_comfortable_load_kg, access_style */ });
export const itemFootwear= pgTable('item_footwear',{ itemId: uuid('item_id').primaryKey().references(()=>items.id), /* support_stiffness, ankle_height, crampon_compat, water_management (+conf/src) */ });

export const itemTreatments = pgTable('item_treatments', {
  itemId: uuid('item_id').notNull().references(() => items.id),
  treatmentId: uuid('treatment_id').notNull().references(() => treatments.id),
  condition: text('condition'),                             // factory_fresh | degraded | refreshed
});

// ---- novel LLM extractions parked for review (never silently discarded) — Audit B ----
export const pendingFacets = pgTable('pending_facets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  itemId: uuid('item_id').references(() => items.id),
  rawKey: text('raw_key').notNull(), rawValue: jsonb('raw_value'),
  evidence: text('evidence'), createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- trips (user-owned, revisitable) ----
export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  rawDescription: text('raw_description'),
  conditions: jsonb('conditions').$type<TripEnvelope>(),    // temp band, precip, wind, sun, exposure, duration, activity, exertion
  resultSnapshot: jsonb('result_snapshot').$type<RecommendationResult>(), // picks + gaps at save time
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// (optional, later) materialized capability cache with BOTH invalidation keys:
// item_capabilities(item_id, capability_key, status, facet_hash, capability_version, computed_at)
```

Indexes: GIN on the five multi-label arrays + on `items.facets`; btree on `user_id`; btree on the hot
ordinal facets used by capabilities. CHECK/registry-validated enums at the Zod boundary (and optionally
DB enums for storage validation, with ordering still owned by the registry).

---

## 7. Layer 1 — the analysis / classification pipeline (the core)

Pipeline (`src/core/`), all deps injected (Anthropic client, model id constant `MODEL_ID =
"claude-sonnet-4-6"`):

1. **Resolve materials** — parse composition/construction from the input text; upsert into the shared
   `materials` library; attach construction-role links. Composition % is a **hard fact** (null if not
   stated).
2. **Classify** — one LLM call returns an **`ItemClassification`** evidence object: an array of facet
   assignments `{ key, value|null, confidence, source, evidence }` covering the universal facets + the
   relevant group facets (the LLM is told which groups apply based on what it found — derived from
   `layering_role`/`function_purpose`, **not** a category enum). Uses the Anthropic SDK's structured
   output; the prompt + rubric live in [`docs/phase0/classification-rubric.md`](docs/phase0/classification-rubric.md).
3. **Validate** — registry-derived Zod parses the object. Multi-label values validate against the
   **closed** registry level sets (no free strings — Audit A). The **hard-fact demotion guard** runs.
   Unknown facet keys are **parked in `pending_facets`**, never dropped (Audit B). *Unvalidated model
   text never reaches the DB or UI.*
4. **Persist** — map validated facets to the typed columns / group tables / JSONB bag.
5. **Review (UI, Phase 2)** — user can confirm/correct; corrections set `source: 'user'`, raising
   confidence.

**Contract:** the boundary between the model and the system is the Zod schema. Everything downstream
consumes validated, evidence-shaped data only.

---

## 8. Recommendation & gap analysis — the canonical Marcy walkthrough

Trip *"Mount Marcy, mid-June, alpine summit, cold and windy, long day hike"* → **envelope**: cold
(~30–45 °F w/ windchill), windy, afternoon-storm-possible, exposed alpine, long duration, high exertion
→ cold static stops. **Required capabilities:** `wicking_base`, `packable_insulation`, `wind_protection`,
`rain_protection`, `breathable_shell`.

Against the **exact 3 owned items**:

| Item | Facets that matter | Contributes | Capability result |
|------|--------------------|-------------|-------------------|
| **Terre Planing Hoody** | `waterproofness=dwr`, `wind_resistance=wind_resistant`, `breathability=high`, `upf=40`, `dry_speed=fast`, `function ∋ water_resistance` (∌ rain_protection) | A breathable sun/active top; partial wind | `rain_protection=fails`; `wind_protection=fails` (not windproof); `sun_protection=satisfies` |
| **Kelty Galactic 30** | `layering_role=[sleep_system]`, insulation down/550 | Nothing for a *worn* day-hike layer | excluded from `packable_insulation` (sleep role) |
| **hemp Henley** | `layering_role=[base]`, `moisture_management=absorbs_holds`, `warmth_when_wet=collapses` | Casual dry warmth only | `wicking_base=fails` (cotton kills) |

**Output:** zero items fully satisfy the envelope. Recommended (with caveats): Terre Planing as a
breathable approach/sun layer. **Gaps surfaced (exactly the three intended):**

1. **Waterproof/windproof shell — CRITICAL.** No item reaches `waterproofness ≥ wp_breathable`.
2. **Packable wearable insulation — HIGH.** No worn item satisfies `packable_insulation` (the down is
   locked in a sleeping bag).
3. **Adequate wicking base layer — HIGH.** The only base layer is cotton-blend → `wicking_base=fails`.

This falls out of facet/capability queries — no category logic, no hardcoding.

**Combination extension (Phase 2, ADR-0010).** If the same user owned a wicking synthetic base
(slot 0), a fleece mid (slot 1), and a waterproof-breathable shell (slot 3), the engine would now
surface that trio as a *joint* satisfier of `adequate_warmth` (via `additive_warmth` strategy) and
`waterproof_insulated_system` (via `shell_over_warmth` strategy) — without the items individually
satisfying those thresholds. Combination is only attempted after the single-item pass fails, so
items that satisfy individually are never double-counted. The seed corpus has no such system (the
only warm item is a sleeping bag, excluded from worn-layer slots), so the Marcy walkthrough is
unchanged: the three gaps remain gaps.

---

## 9. Edge-case handling (seed corpus + the buff)

| Item | Key facet assignment | Why it's correct |
|------|----------------------|------------------|
| **Terre Planing** | `waterproofness=dwr` (not waterproof); `function ∋ water_resistance`, ∌ rain_protection | DWR/fast-dry can never count as rain protection — structural, not special-cased. |
| **Kelty Galactic 30** | `item_sleep.temp_rating={value:30,unit:F,standard:null,confidence:low}`; `item_insulation={down,550,duck}` | The "30" is preserved but **not** upgraded to a certified standard. |
| **R1 Air** | `layering_role=[next_to_skin, active_insulation, standalone]`; `waterproofness=none` | Multi-role without forcing one truth. |
| **hemp Henley** | material `[{hemp,55},{cotton,45}]` → `moisture_management=absorbs_holds`, `warmth_when_wet=collapses` | Cellulosic/hydrophilic ⇒ weak cold/wet base layer; near-deterministic from composition. |
| **Synchilla Snap-T / Marsupial** | `technical_vs_lifestyle=mostly_lifestyle`, `activity_fit=[everyday,camp]`; Marsupial carry-pocket = a `carry_affordance` facet, **not** `item_carry` | Surfaced for casual trips, suppressed for alpine — no exclusion rule needed. |
| **a buff** | `body_zone_covered=[head,neck,face]`, `function_purpose=[warmth,sun_protection,wind_protection]` | One item, found correctly by three different queries. |

---

## 10. Architectural decision & rejected alternatives

The swarm produced three sound proposals (all **SOUND-WITH-FIXES** on audit). They agree on every
**behavioral** requirement (DWR≠rain; unknown blocks; Marcy → 3 gaps) and diverge only on **storage**.
Recommended = **C (capability-first hybrid) as backbone, governed by B's registry, wearing A's evidence
shapes and composable groups.**

| | **A — typed relational** | **B — facet-graph / EAV** | **C — capability hybrid** |
|--|--------------------------|---------------------------|----------------------------|
| Storage | typed columns + per-domain extension | every fact is a row vs an ontology | hot columns + JSONB bag |
| Type-safety | ★★★ | ★ (runtime only) | ★★ |
| Extensibility | ★ (migration/facet) | ★★★ (insert/facet) | ★★ |
| Query ergonomics | ★★★ | ★★ | ★★★ (hot) |
| Faithful to "no categories" | ★★ (domain discriminator) | ★★★ | ★★ (needs care re `item_kind`) |
| Audit verdict | SOUND-W/-FIXES | SOUND-W/-FIXES | SOUND-W/-FIXES |

**Why C as backbone:** the product *is* recommendations + gap analysis; designing storage backward from
the capability layer (and making `blocked_unknown` a first-class state) puts safety in the schema, not
in convention. Personal closets are small-N, so the hybrid's hot path is plenty fast and the JSONB tail
keeps us from migrating for every rare facet.

**Harvested from A:** the null-first `Evidence<T>`/`HardFact<T>` shapes (cleanest unknown handling
seen); **composable optional group tables instead of A's single domain discriminator** (this fixes A's
own worst flaw — an insulated waterproof boot is just `item_insulation + item_shell + item_footwear`);
ordinal ordering kept in code.

**Harvested from B:** the **facet registry** as the single source of truth (generates Zod, enables a CI
facet-key lint, and *neutralizes C's promotion-boundary risk* — promotion changes `tier` only); the
3-state unknown model; the hard-fact-source guard; the **`pending_facets`** queue so novel extractions
are never silently discarded.

**Rejected (with reasons):**
- **Pure A** — single-domain discriminator fights genuinely multi-domain gear; migration-per-facet is
  drag while the ontology is still settling.
- **Pure B** — loses compile-time safety (everything is `unknown` to TS), heavier ontology governance,
  capability *views* over EAV are harder to maintain/test than typed predicates; "no migration" is
  really "no *column* migration" (enum-level changes still need data migration).
- **Pure C (unhardened)** — capability-cache could go silently stale on predicate changes, `item_kind`
  risked re-introducing a category, and a denormalized material "hot copy" risked drift. All three are
  designed out above (compute-on-read for v0; no authoritative category; materials referenced not
  copied — item facets are the LLM's item-level assessment, with material composition as *evidence*).

**Audit fixes folded in:** `itemDomains` → composable groups (A‑F1); closed multi-label enums, not
`z.string()` (A‑F2); ordering in code (A‑F3); registry codegen + CI facet-key lint (B‑F1); `pending_facets`
(B‑F2); capability gates must be hot, no JSONB gates (C‑F2); for v0 no cache, and when added,
`facet_hash` **+** `capability_version` (C‑F1); `item_kind` is not authoritative — applicable groups are
derived from facets (C‑F3).

---

## 11. Open questions to confirm before Phase 1

1. **Storage architecture (the one load-bearing fork):** approve the **hybrid backbone** above, or
   prefer pure-A (max type-safety, more migrations) or pure-B (max extensibility, less type-safety)?
2. **Scope of seeded domain groups for v0:** the seed corpus only exercises apparel + one sleeping bag.
   Build all five group tables now (insulation, sleep, shell, carry, footwear) for completeness, or
   only insulation + sleep + shell now and add carry/footwear when first needed? (Recommend: build all
   five table stubs, populate only what the seed needs.)
3. **`technical_vs_lifestyle`** as a 5-level ordinal vs a simpler 3-level — fine as proposed?

---

## 12. Out of scope for v0 (updated as Phase 3 lands)

**Real auth + multi-user** and **manufacturer URL enrichment** have moved out of this list — they
are now designed and being built (Phase 3 steps 1–2; see §13 and §14).

Still out of scope / deferred: barcode enrichment (deferred until after Phase 3 step 2 and better
suited to a native app — ADR-0009); photo/image enrichment; weather API (Phase 3 step 3);
military/NSN domain; native app; catalog gap-fill suggestions (Phase 3 step 4). Each requires its
own `DESIGN.md` update + ADR(s) before any implementation.

---

## 13. Multi-user model and auth posture (Phase 3 step 1)

Architecture rule #4 required `user_id` on every user-owned table from the first migration; Phase 3
step 1 ties that column to a real authenticated identity. The model described here supersedes the Phase 2
one-password gate (`APP_PASSWORD` / `ARMARIUM_USER_ID`). See [ADR-0008](docs/decisions/0008-auth-multi-user.md)
for full rationale and rejected alternatives.

### Auth provider and session

**Supabase Auth** with email+password is the sign-in method for Phase 3 step 1. Supabase Auth
integrates natively with Postgres RLS through `auth.uid()` — no cross-service JWT mapping is needed.
Sessions are **cookie-based** via `@supabase/ssr`, refreshed in App Router middleware on every request.
Server Components and Route Handlers receive a pre-refreshed client.

**OAuth** (Google, GitHub, etc.) is designed-for but deferred. It requires an external OAuth app
registration and a deployed redirect domain that cannot be validated in the cloud sandbox. It slots in
as an additive change (one `signInWithOAuth` call + Supabase dashboard config) once a deployed redirect
URL is available; no schema or RLS rework is required.

**Email verification** is deferred. Signup uses auto-confirm initially (no SMTP configured). Real
email confirmation follows once SMTP is set up in the Supabase project. Known limitation: in the
interim, any email address can be used at signup without verification.

### The `user_id` flow

```
Request → App Router middleware
         ↓  @supabase/ssr refreshes session cookie
         ↓  session JWT contains auth.uid()
Server Component / Route Handler / Server Action
         ↓  getCurrentUserId()  →  userId: string (UUID)
         ↓  requireUserId()     →  same, but redirects/throws if no session
src/server/app-service.ts  (functions already accept userId param)
         ↓
Postgres query: WHERE user_id = $userId
```

Every user-owned table operation already accepts a `userId` parameter at the `app-service.ts` layer
(built in Phase 2). Phase 3 step 1 wires `getCurrentUserId()` and `requireUserId()` at the
request boundary to supply that parameter from the real session instead of from the fixed env var.

### Enforcement model (dual-layer — both are mandatory)

The database is reached through two paths that require distinct enforcement:

**Path 1 — App server (Drizzle + postgres.js, owner/service role, bypasses RLS).** All Drizzle
queries run as the Postgres owner role, which bypasses row-level security by design. The
`WHERE user_id = $userId` clause in every query — already present in `src/server/postgres-repo.ts` —
is the primary enforcement mechanism for application traffic.

**Path 2 — Public PostgREST API (Supabase anon key, subject to RLS).** Supabase exposes every table
through a public REST endpoint authenticated by `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which ships to the
browser. Without RLS, any holder of this key can read or write any row. RLS is mandatory on every
user-owned table to prevent cross-user data exposure through the public API surface.

| Table | RLS policy | Rationale |
|---|---|---|
| `items`, `trips`, `pending_facets` | `(select auth.uid()) = user_id` on all operations | User-owned; no cross-user access |
| `item_insulation`, `item_sleep`, `item_shell`, `item_carry`, `item_footwear`, `item_treatments`, material link tables | Join to parent `items.user_id` | Gated via parent item |
| `materials`, `treatments` | Readable by `authenticated`; INSERT/UPDATE service-role only | Shared reference libraries; no user_id |
| `classification_cache` | No public-role access; service-role only | Shared KB — see ADR-0007; not user-owned |

Neither layer is redundant: removing app-layer filtering leaves cross-user leakage on the owner-role
path; removing RLS leaves the public anon-key endpoint unguarded.

### Auth helper contract (application boundary)

Three helpers at the application boundary are the only code that knows whether auth is configured:

- `isAuthConfigured()` — true when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  are both present.
- `getCurrentUserId()` — returns the authenticated user's UUID when auth is configured and a valid
  session exists; returns `DEFAULT_USER_ID` otherwise (open dev / test mode).
- `requireUserId()` — same as `getCurrentUserId()`, but redirects to sign-in (or throws) if auth
  is configured and no valid session is present. Used in server actions and route handlers.

All code downstream of these helpers receives a plain `userId: string` (UUID) and has no knowledge
of the auth layer. This is what keeps the gauntlet (typecheck / lint / build / test) secret-free:
when Supabase env vars are absent, `isAuthConfigured()` returns false and the app runs open with
`DEFAULT_USER_ID` — no Supabase SDK is invoked at build or test time.

### Operational notes

- **Migrations in the cloud sandbox:** the sandbox's HTTP/HTTPS proxy blocks outbound TCP on ports
  5432 and 6543, so `drizzle-kit migrate` cannot reach Supabase from inside the sandbox.
  `scripts/db-mgmt-migrate.mjs` applies pending migration SQL over the Supabase Management API
  (HTTPS). From any DB-connected environment (Vercel, local with a real network path), `pnpm db:migrate`
  works normally.
- **Seeded data re-attribution:** rows seeded under `DEFAULT_USER_ID` are not automatically migrated
  to a new auth UUID when switching from open dev mode to a real Supabase Auth session. A one-time
  re-attribution step is required for that transition.

---

## 14. Manufacturer URL enrichment (Phase 3 step 2)

A user pastes a product URL; the server fetches the page; structured data is extracted and merged
as `source:"manufacturer"` facts onto the item classification. See
[ADR-0011](docs/decisions/0011-manufacturer-url-enrichment.md) for full rationale and rejected
alternatives. This section documents the contract that code owners implement against.

### 14.1 Why this matters: the provenance hierarchy

The existing `Source` union is:

```ts
type Source = 'manufacturer' | 'user' | 'inferred' | 'derived_from_material' | 'unknown';
```

Precedence (highest to lowest): `user` > `manufacturer` > `inferred`/`llm` > `derived_from_material` > `unknown`.

Before URL enrichment, the only way to satisfy the demotion guard's "stated source" precondition
for hard facts (fill power, composition %, UPF, crampon compatibility, EN temp standard) was a
manual user correction. URL enrichment makes `source:"manufacturer"` reachable without user data
entry — the most significant quality improvement to the classification pipeline since Phase 1.

A user correction still outranks a manufacturer fact. The merger does not overwrite `source:"user"`
values.

### 14.2 Parse strategy: JSON-LD + OpenGraph/meta; no new dependency in v1

**What is extracted:**

- **Schema.org `Product` JSON-LD** (`<script type="application/ld+json">` blocks with
  `@type:"Product"` or inside a `@graph` array): `name`, `brand`, `description`, `weight`,
  `material`, `color`, `offers.price`.
- **OpenGraph and HTML meta tags** (`<meta property="og:*">`, `<meta name="*">`): product name
  and description as fallback.

**How:** defensive regex to locate the JSON-LD script block, then `JSON.parse`. A failed parse is
silently discarded (not a hard error); extraction continues with the next block. Results are Zod-
validated before any value is used. Anything that does not parse cleanly is treated as absent.

**A DOM/HTML-parser library (cheerio, node-html-parser) is not used in v1.** It is explicitly
deferred as an `ask-first` future upgrade if JSON-LD+OG coverage proves insufficient post-rollout.

### 14.3 SSRF gate: mandatory, layered

SSRF protection is non-negotiable. The gate is layered:

**Layer 1 — URL-shape gate (pure, `src/core/enrich/url-gate.ts`):**
- `https:` only; other schemes rejected before any network activity.
- Hostname must exactly match or be a subdomain of an entry on the **manufacturer allowlist**
  (hardcoded in `src/core/enrich/url-gate.ts`; additions require a code change — deliberate
  friction).
- No credentials (`user:password@host`). No non-standard ports (443 only). No IP-literal
  hostnames.

**Layer 2 — DNS/IP resolution check (`src/server/enrich-fetcher.ts`):**
- After the URL passes the shape gate, resolve the hostname and block any returned IP in:
  loopback, RFC 1918 private, link-local/APIPA, multicast, reserved, IPv6 unspecified.
- Guards against DNS rebinding and allowlist entries with unexpected DNS resolution.

**Layer 3 — Network fetch caps:**
- Max 3 redirects; each redirect target is re-checked against the URL-shape gate and allowlist.
- Max 2 MB response size; 10-second total timeout.

Both Layer 1 and Layer 2 are mandatory. Neither is redundant.

### 14.4 Architecture split (enforces the purity invariant)

| What | Where |
|------|-------|
| URL-shape gate + allowlist | `src/core/enrich/url-gate.ts` — pure predicate, no I/O |
| JSON-LD + OG parser | `src/core/enrich/parse-product-page.ts` — pure function on a string |
| Enrichment merger (overlay onto `ItemClassification`) | `src/core/enrich/merge.ts` — pure |
| Network fetch + DNS/IP check | `src/server/enrich-fetcher.ts` — injected into core as `(url) => Promise<string>` |
| "Enrich by URL" UI and route handler | `src/app/items/enrich/` |

Core receives the page body as a plain string; it never calls `fetch` or DNS. This mirrors the
existing injection pattern for the Anthropic client and the database.

### 14.5 Output: partial overlay, existing Zod contract applies unchanged

The parser emits `Partial<ItemClassification>`. The merger writes only fields that are explicitly
stated on the page; absent fields are left at their existing values (no `null`-writing for missing
specs). The merged object then passes through the existing Zod validation and demotion guard
(ADR-0004) — manufacturer-sourced data gets no special path.

### 14.6 Bridge to the material behavior derivation engine

Composition percentage extracted with `source:"manufacturer"` is the highest-confidence input the
material behavior derivation engine could receive. When that engine is built — deriving behavioral
facets (breathability, dry speed, warmth-when-wet) from authoritative material composition +
construction type as `source:"derived_from_material"` — it will consume `source:"manufacturer"`
composition facts as its primary signal. URL enrichment supplies the ingredient; derivation
consumes it.

### 14.7 Testing reality

The cloud sandbox cannot initiate outbound HTTPS to arbitrary manufacturer hosts. Enrichment tests
use **fixture HTML files** (saved snapshots of real manufacturer pages) injected as page-body
strings. The SSRF gate and the parser are pure functions and are covered by unit tests that run
completely offline. Live end-to-end verification (paste a real URL; confirm extracted specs appear
in the review UI) is performed on Vercel after deployment.

---

## 15. Target architecture: evidence-first classification

**Principle:** classification is not a one-time answer — it is an auditable argument. Facts are
CLAIMS from identified sources; a deterministic resolver produces the resolved facet value by
explicit provenance precedence; the LLM is an extractor that proposes claims, never the authority.

The full target architecture (8 elements with current-state groundings) and the migration sequence
are in [ADR-0012](docs/decisions/0012-evidence-first-classification.md). Summary:

| Element | Target | Phase status |
|---------|--------|-------------|
| 1. Canonical products | Global `canonical_products` table + `user_items.canonical_product_id` | Net-new; deferred (Phase 4) |
| 2. Evidence store | `item_evidence` table: multiple competing claims per `(item_id, facet_key)` | Net-new; deferred (Phase 3) |
| 3. Resolver layer | `src/core/resolve/` — deterministic `resolve(claims[])` with explicit precedence | **Phase 1 — in progress** |
| 4. LLM = extractor | LLM emits claims array + `unresolvedQuestions`; resolver decides the final value | Deferred (Phase 3) |
| 5. Cache split | `llm_draft_cache` (global) / `user_overrides` (user-scoped) / `canonical_facts` (global, curated) | Phase 2 (after resolver) |
| 6. Targeted review | Surface only recommendation-impacting unknowns, ranked by blocked-capability severity | Deferred (Phase 6) |
| 7. Versioned snapshots | `schema_version`, `resolver_version`, `classifier_version` on items + reclassification UI | Deferred (Phase 5) |
| 8. Layer separation | capability ≠ classification ≠ recommendation — **already done** (ADR-0003, ADR-0005) | Complete; preserve |

This is an incremental evolution of what is already built. The evidence shapes (`Evidence<T>`,
`HardFact<T>`), the demotion guard, the provenance concepts, and the layer separation are the
foundation. No phase requires a big-bang rewrite or a breaking change to the capability or
recommendation contracts.
