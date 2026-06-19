# Architecture C — Capability-First Hybrid

> **Wave-2 competing-architecture proposal (blind).** One of three independent faceted data-model
> proposals for Armarium. Designed BACKWARD from recommendation + gap analysis. Builds directly on
> the nine Wave-1 investigation artifacts, especially `investigation/decision-drivers.md` (the facet
> load-bearing ranking and the canonical capability definitions) and `investigation/material-behavior.md`
> (the normalized material library + construction roles).
>
> Markdown only. Schema sketches inside this doc are illustrative, not migrated code.

---

## 1. Thesis & rationale

**Capabilities are the product; facets are the substrate; the schema is shaped to make capability
queries fast, safe, and honest.** The whole app exists to answer one class of question — *"for THIS
trip, what do I bring, and what am I missing?"* — and the Wave-1 decision-driver investigation already
proved that real planning queries read a *small, stable set* of facets (waterproofness, moisture
management, layering role, insulation type + treatment, packability, breathability, wind resistance,
UPF, temperature rating) and that recommendations are most cleanly expressed as **derived capability
predicates** over those facets (`rain_protection`, `wicking_base`, `packable_insulation`,
`wet_safe_insulation`, `sun_protection`, …). I take that finding as a load-bearing design constraint
rather than a suggestion: I make capabilities a **first-class, materialized query surface**, and I let
the *physical* storage of facets follow from how the capability layer reads them.

That yields a deliberate **hybrid**. The ~10–15 facets that the decision-driver ranking marks
LOAD-BEARING — the ones every capability predicate reads and the ones whose unknown values must
*block* a positive capability claim — are promoted to **typed, indexed columns** on `items` (each with
a companion confidence + source). They get the full weight of Postgres: btree/GIN indexes, `CHECK`
constraints, enum domains, fast `WHERE` clauses, and TypeScript types derived from one Zod schema. The
long tail — the dozens of situational and domain-specific facets enumerated across the seven domain
artifacts (hood storm features, sock cushion zone, pack suspension, lens category, draft collar,
stretch, odor, hand comfort, …) — lives in a **single validated JSONB `facets` bag** whose *shape* is
enforced by Zod at the `src/core` boundary (and queried with a GIN index), not by a column per facet.
Materials are a **normalized shared library** referenced through named **construction roles**
(shell / membrane / insulation / lining) plus a treatments join, exactly as the material-behavior
artifact recommends, so behavioral facets are derived once per fabric and reused. Capabilities are
**computed in `src/core`** from facets-with-confidence and **optionally materialized** to an
`item_capabilities` table for index-speed gap queries; the cache is keyed by a content hash so it can
never silently drift from the facets it was derived from. The cost is real and I confront it head-on in
§8: two query paths (columns + JSONB), a promotion judgment call that can go stale, and a
materialization that must be invalidated correctly. I argue the split is worth it precisely *because*
the promoted set is the decision-driver "hot set," which is the most stable part of the ontology, and
because the JSONB path keeps the cold tail extensible without migrations.

---

## 2. Facet ontology

Conventions used throughout:

- **Value-space shape** is one of: `boolean` · `ordinal` (a *named, ordered* scale — levels listed) ·
  `continuous+unit` · `multi-label set` · `enum-as-facet` (unordered nominal) · `int|null` · `text|null`.
- **Multi-label?** — does an item legitimately hold several values at once?
- **Scope** — `universal` (every item) vs `domain` (only meaningful for some item kinds).
- **Nature** — `hard fact` (only from a stated source; **never** inferred; `null` when absent) vs
  `soft/derived` (LLM- or rule-derived; always carries `value | confidence | source`, value may be `null`).
- **Promotion** — `COLUMN` (typed hot facet on `items`) vs `JSONB` (cold facet in the `facets` bag).
- **Unknown handling** — every facet stores `null` for unknown; soft facets additionally carry
  `confidence ∈ {high, medium, low, unknown}` and `source ∈ {manufacturer_stated, derived_from_composition,
  llm_inferred, user_provided, unknown}`. **A wrong value is worse than a null** (CLAUDE.md rule 2).

The **promotion rule** (justified in §8): a facet is a COLUMN iff it is (a) read by ≥1 capability
predicate in §6 AND (b) ranked LOAD-BEARING in `decision-drivers.md` §3 (decisive in ≥2 queries) OR is
structurally required to *build a layering system* / *block a capability on unknown*. Everything else is
JSONB. This is exactly the decision-driver "hot set," which is why it is stable.

### 2.0 Identity & ownership (universal columns — not facets, but on `items`)

| Field | Shape | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | **on day one** (CLAUDE.md rule 4); single fixed user in v0 |
| `name`, `brand`, `model` | text | display/identity |
| `item_kind` | enum-as-facet, **soft/derived** | NOT a routing category. `apparel \| insulation \| sleep \| footwear \| pack \| accessory \| other`. Used only to (i) scope which classification sub-prompt runs and (ii) decide which JSONB facet group to validate. **Never** used as a recommendation filter — recommendations read facets/capabilities, never `item_kind`. This is the one concession to "what kind of thing is this," and it is explicitly quarantined from the recommendation path. |
| `purchase_price`, `year_acquired`, `color`, `condition` | various | VANITY per decision-drivers §3 (ranks 17–20); stored, never a predicate |

> `item_kind` is the single most dangerous field in this proposal because it *looks* like the category
> bucket the guiding principle forbids. The guardrail: it is an ingest/validation router only, asserted
> nowhere in §5/§6 queries. An adversarial auditor should check that no capability predicate or grouping
> query reads `item_kind`. (See §8 weakness W4.)

### 2.A PROMOTED facets — typed columns on `items` (the hot set)

Each promoted soft facet is physically three columns: `<facet>` (the typed value), `<facet>_conf`
(confidence enum), `<facet>_src` (source enum). Hard facts carry `_src` (+ implicit high confidence) but
not a `_conf` scale. Enum value-spaces are Postgres `enum` domains so a bad string cannot be inserted.

| # | Facet (column) | Meaning | Value-space (levels) | Multi-label? | Scope | Nature | Why promoted |
|---|---|---|---|---|---|---|---|
| C1 | `waterproofness` | Mechanism & degree of liquid-water exclusion | **ordinal**: `none < dwr_only < water_resistant < wp_breathable < wp_nonbreathable` (+`null`) | no | universal | soft/derived | Rank 1 LB; the single safety-critical binary split; read by `rain_protection`. **Unknown ⇒ blocks rain capability.** |
| C2 | `moisture_management` | How fiber handles liquid sweat at skin | **enum-as-facet** (multi-label): `{wicking_spread, absorb_release, absorb_hold, dwr_face}` (+`null`) | yes | universal | soft/derived | Rank 2 LB; drives every base-layer pick; `absorb_hold` = "cotton kills" fail. Read by `wicking_base`. |
| C3 | `dry_speed` | Time-to-dry after saturation | **ordinal**: `very_slow < slow < medium < fast < very_fast` (+`null`) | no | universal | soft/derived | LB across A/B/C; pairs with C2 for `wicking_base`; distinguishes Terre Planing's "dries fast ≠ stays dry". |
| C4 | `warmth_when_wet` | Insulation retained when saturated (worst-link, item level) | **ordinal**: `collapses < neutral < partial < largely_retained < unaffected` (+`null`) | no | universal | soft/derived | Rank 4 LB; the down-vs-synthetic / cotton axis. Read by `wet_safe_insulation`. |
| C5 | `layering_role` | Where the item sits in a stack | **multi-label set**: `{base, mid, insulation, shell, softshell_midouter, sleep, standalone, liner, over_layer}` (+`∅`) | yes | universal | soft/derived | Rank 3 LB; *structural* — the engine cannot build a system without it. Read by every layer-slot capability. |
| C6 | `insulation_type` | Fill/construction class | **enum-as-facet**: `down \| synthetic \| fleece_grid \| fleece_pile \| fleece_sherpa \| hybrid \| none` (+`null`) | no | universal | hard-ish/derived | Rank 4 LB; controls wet performance + packability ceiling. Read by `packable_insulation`, `wet_safe_insulation`. |
| C7 | `packable` | Compresses small enough to carry "just in case" | **ordinal**: `bulky < moderate < compact < pocketable` (+`null`); **default-on-unknown = treat as NOT packable** | no | universal | soft/derived | Rank 5 LB (A,C,D); gates day-pack & travel use. Read by `packable_insulation`, `travel_versatile`. |
| C8 | `breathability` | Vapor/heat offload (MVTR-ish) | **ordinal**: `very_low < low < moderate < high < very_high` (+`null`) | no | universal | soft/derived | Rank 6 LB; high-exertion queries fail on low-breathability shells. Read by `breathable_shell`. |
| C9 | `wind_resistance` | Does the face fabric block moving air | **ordinal**: `air_permeable < wind_resistant < windproof` (+`null`) | no | universal | soft/derived | Rank 7 LB; exposed-ridge axis, *separate* from waterproofness. Read by `wind_protection`. |
| C10 | `upf` | Tested UV protection factor | **continuous (int)** + ordinal view `{none,<15,15-29,30-49,50,50+}`; `null` when not stated | no | universal | hard fact | Rank 8 LB; binary sufficiency in sun queries. **Never inferred** — `null` if unstated. Read by `sun_protection`. |
| C11 | `temp_rating_f` + `temp_rating_standard` | Sleep/insulation thermal threshold + WHICH protocol produced it | `int|null` (°F, unit-tagged) **paired with** enum `{EN13537_comfort, EN13537_lower_limit, EN13537_extreme, ISO23537_*, marketing, season, null}` | no | domain (sleep; insulation uses soft `warmth_category` in JSONB) | hard number / **soft standard** | Rank 9 LB; the Kelty "30" case. Number is hard; **standard is the high-stakes soft facet** that must not be silently upgraded. |
| C12 | `treated_down` | Down fill hydrophobic-treated? | **boolean** `true|false|null` (**null ≠ false**) | no | domain (down items) | hard fact | Rank 4 LB (paired w/ insulation); upgrades `warmth_when_wet`; unknown stays conservative. |
| C13 | `weight_g` | Total item weight | **continuous (g)**, size-tagged; `null` if unstated | no | universal | hard fact | Situational LB (C,D) but cheap, universal, and summed across a kit; promoting it makes pack-weight roll-ups a column scan. |
| C14 | `body_zones` | Anatomical zones covered | **multi-label set**: `{head, face, neck, torso, arms, hands, wrists, legs, feet, ankles, eyes}` (+`∅`) | yes | universal | soft/derived | The accessories artifact's "globally load-bearing" facet for zone-gap detection ("no hand coverage"). Promoted because zone-gap analysis is a core query surface. |

**Why C13/C14 are promoted even though decision-drivers ranks `weight` only "situational":** both are
*universal, cheap, multi-query* and feed gap/roll-up queries (kit weight; zone coverage) that the
accessories and packs artifacts call structural. They are the two "promote on universality + query
centrality" exceptions to the strict rank rule, and I flag them as the softest promotion calls.

### 2.B COLD facets — the validated JSONB `facets` bag

These are situational or domain-specific (per the per-domain artifacts). They are stored under
`items.facets` (jsonb), shape-validated by a discriminated Zod union keyed on `item_kind`, and queried
via a GIN index. Each soft entry is `{ value, confidence, source, reasoning? }`; hard entries are
`{ value, source }`. Grouped by where they came from:

**Universal-but-situational (always allowed in the bag):**

| Facet | Meaning | Shape | Multi | Nature | Notes |
|---|---|---|---|---|---|
| `function_purpose` | What the item *does* | multi-label `{warmth, sun_protection, wind_protection, water_resistance, waterproof, dexterity, eye_protection_uv, eye_protection_glare, debris_filtration, blister_prevention, gear_retention, layering_component, standalone}` | yes | soft | Accessories artifact's other "global LB" facet; lives in JSONB because most predicates read the *typed* axes (C1/C9/C10) directly, and `function_purpose` is a coarse OR-rollup used for display + buff-style multi-function. |
| `technical_vs_lifestyle` | Performance vs casual continuum | ordinal `lifestyle < mostly_lifestyle < hybrid < mostly_technical < technical` | no | soft | Decision-drivers rank 13–14 situational (Query D). Calibration-prone (mid-insulation §7.6) → soft, low default confidence. |
| `activity_fit` | Activity contexts suited | multi-label (domain vocab) | yes | soft | Situational; refinement signal, not a hard gate. |
| `conditions_fit` | Temp/precip/wind envelope | `{ temp_min_f, temp_max_f, precip_tolerance, wind_tolerance }` | no | soft | Derived rollup for display + soft ranking. |
| `dwr_presence` | DWR treatment + chemistry | enum `{none, present_standard, present_c6, present_c8}` | no | hard-ish | Co-owned across domains; *modifies* C1 reasoning but is not itself a capability gate. |
| `seam_sealing` | Seam taping | ordinal `none < critical_seams < fully_sealed` | no | hard | Decision-drivers rank 12 situational; **downgrades** `rain_protection` to sustained-rain when `null`/`none` even if C1 is `wp_breathable`. |
| `carry_affordance` | Non-pack carry (kangaroo pocket etc.) | `{ has_pocket: bool, est_volume_l }` | no | soft | Packs artifact: the Marsupial's pocket modeled here, **not** as pack capacity. |

**Material-behavior cold facets** (per `material-behavior.md` §1.2 — most live on the *material* record,
but item-level overrides land here): `odor_resistance` (ord 3), `abrasion_resistance` (ord 5),
`water_absorption` (ord 5), `stretch` (ord 3), `hand_comfort` (ord 3), `care_complexity` (ord 3),
`loft_category` (ord 4), `warmth_for_weight` (ord 5), `wind_permeability` (mid-layer view of C9).

**Domain groups (validated only when `item_kind` matches):**

- **`sleep`** (sleeping-bags artifact): `fill_power int|null`, `fill_species {duck,goose,null}`,
  `fill_weight_g`, `bag_shape {mummy,semi_rectangular,rectangular,quilt,double}`, `has_hood bool|null`,
  `draft_collar bool|null`, `zipper_draft_tube bool|null`, `shell_dwr bool|null`,
  `pad_r_value_recommended num|null` (system hint), `use_mode {car_camping,backpacking,ul,mountaineering}`
  (emergent), `packed_volume_l`.
- **`footwear`**: `support_stiffness ord 1–5`, `ankle_height {low,mid,high}`,
  `water_management {waterproof_membrane,water_resistant_dwr,fast_drain_breathable}`,
  `outsole_compound`, `outsole_geometry[]`, `terrain_fit[]`, `crampon_compat {C0,C1,C2,C3}`,
  `cushion {maximal,moderate,minimal,zero_drop}`, `stack_mm`, `drop_mm`, `upper_material[]`,
  `insulation_footwear {insulated_rated,insulated_unrated,uninsulated}`, paired `socks {…}`.
- **`pack`**: `capacity_l num|null`, `suspension {none,minimal,framesheet,aluminum_stay,full}`,
  `frame_type`, `max_load_kg num|null` (always low-confidence), `access_style[]`,
  `hydration_compat {none,sleeve,sleeve_port,bladder_included}`, `trip_duration[]`,
  `water_resistance_pack[]`, `pack_fabric` + `denier`, `technical_features[]` (ice-axe loops etc.),
  `torso_adjust`.
- **`accessory`**: `warmth_level ord {none,minimal,light,moderate,high,extreme}`,
  `water_resistance_level`, `wind_protection_level`, `dexterity_level` (gloves),
  `lens_category {1,2,3,4,uv400}` + `polarized bool`, `gaiter_height`, `sock_cushion_zone`,
  `conditions_temperature_range`.

> **Why these are JSONB, not columns.** They are (a) decisive in ≤1 query type per decision-drivers, or
> (b) meaningful for only a slice of items (a `capacity_l` column is `null` on every garment — the packs
> artifact §6 explicitly calls flat-null padding "noise/false symmetry"), or (c) still-evolving vocab.
> Putting them behind a Zod-validated JSONB bag keeps the schema tight, the classification prompts
> domain-scoped, and the ontology extensible without a migration per new facet.

### 2.C Where confidence/source/unknown physically live

- **Promoted soft facet** → three columns: `waterproofness`, `waterproofness_conf`, `waterproofness_src`.
- **Promoted hard fact** → value column + `<facet>_src` (e.g. `upf`, `upf_src`).
- **Cold facet** → embedded in the JSONB object: `{ "value": …, "confidence": …, "source": …, "reasoning": … }`.
- **Material soft facet** → same `{value,confidence,source}` triplet inside the `materials` row's
  behavioral JSONB (derived once per fabric; see §3).
- **Unknown** is *always representable*: `null` value + `confidence: "unknown"` + `source: "unknown"`.
  The schema **requires** the confidence/source companions to be present (NOT NULL on the columns,
  required keys in the Zod object) so a value can never be stored "bare." This is CLAUDE.md rule 2 made
  physical.

---

## 3. Data model (Drizzle / Postgres)

Five core tables + two derived/cache structures. TS sketches are Drizzle-ish and abbreviated; enums are
declared once with `pgEnum` and reused. `user_id` is on every user-owned table.

### 3.1 Enums (declared once, reused as Postgres domains)

```ts
// src/db/schema/enums.ts (sketch)
export const waterproofness = pgEnum("waterproofness",
  ["none","dwr_only","water_resistant","wp_breathable","wp_nonbreathable"]);
export const ordinal5      = pgEnum("ordinal5",
  ["very_low","low","moderate","high","very_high"]);         // breathability, etc.
export const drySpeed      = pgEnum("dry_speed",
  ["very_slow","slow","medium","fast","very_fast"]);
export const wetWarmth     = pgEnum("wet_warmth",
  ["collapses","neutral","partial","largely_retained","unaffected"]);
export const windResistance= pgEnum("wind_resistance",
  ["air_permeable","wind_resistant","windproof"]);
export const packable       = pgEnum("packable",
  ["bulky","moderate","compact","pocketable"]);
export const insulationType = pgEnum("insulation_type",
  ["down","synthetic","fleece_grid","fleece_pile","fleece_sherpa","hybrid","none"]);
export const tempStandard   = pgEnum("temp_standard",
  ["EN13537_comfort","EN13537_lower_limit","EN13537_extreme",
   "ISO23537_comfort","ISO23537_lower_limit","ISO23537_extreme","marketing","season"]);
export const confidence     = pgEnum("confidence", ["high","medium","low","unknown"]);
export const source         = pgEnum("source",
  ["manufacturer_stated","derived_from_composition","llm_inferred","user_provided","unknown"]);
export const itemKind       = pgEnum("item_kind",
  ["apparel","insulation","sleep","footwear","pack","accessory","other"]);
// multi-label sets (layering_role, moisture_management, body_zones) stored as text[]
// constrained by CHECK (col <@ ARRAY[...allowed...]) — array, not enum, to allow multi-value + GIN.
```

### 3.2 `materials` — normalized shared library (per material-behavior §3.3)

Behavior derived **once per fabric**, reused by every item that references it. Hard composition facts as
columns; the derived behavioral facets as a validated JSONB block (each `{value,confidence,source}`).

```ts
export const materials = pgTable("materials", {
  id: uuid().primaryKey().defaultRandom(),
  // user_id NULL = shared/seed catalog row; non-null = user-created during ingest
  userId: uuid("user_id"),
  slug: text().notNull().unique(),            // "polyester-grid-fleece", "down-550fp", "gore-tex-pro"
  displayName: text().notNull(),
  // --- hard facts (never inferred; null when unstated) ---
  fiberComponents: jsonb().$type<{ fiber: string; pct: number | null }[]>(),
  constructionType: text(),                   // grid_fleece|pile_fleece|woven|knit|fill|membrane|null
  fillPowerFp: integer(),
  fillWeightGsm: doublePrecision(),
  recycledContentPct: doublePrecision(),
  isOrganic: boolean(),
  bluesignCertified: boolean(),
  membraneType: text(),                        // "Gore-Tex Pro" | null
  // --- derived behavioral facets, each {value,confidence,source} ---
  behavior: jsonb().$type<MaterialBehavior>().notNull(),  // Zod-validated at write
}, (t) => ({
  slugIdx: index("materials_slug_idx").on(t.slug),
  behaviorGin: index("materials_behavior_gin").using("gin", t.behavior),
}));
// MaterialBehavior keys: breathability, dry_speed, warmth_for_weight, wet_warmth_retention,
// odor_resistance, abrasion_resistance, water_absorption, stretch, hand_comfort, packability,
// care_complexity (+ wash_temperature_max_c, tumble_dry_safe, dry_clean_only as hard nullable).

export const treatments = pgTable("treatments", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),            // "dwr", "hydrophobic-down", "antimicrobial-silverescent"
  displayName: text().notNull(),
  type: text().notNull(),                     // surface_coating|fill_treatment|antimicrobial|uv_protective
  waterproofEffect: boolean(),
  breathabilityEffect: text(),                // none|slight_reduction|moderate_reduction
  wearsOff: boolean(),
  refreshMethod: text(),
});
```

### 3.3 `items` — typed hot facets + JSONB cold facets

```ts
export const items = pgTable("items", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),                       // rule 4: day one
  name: text().notNull(),
  brand: text(), model: text(),
  itemKind: itemKind("item_kind").notNull(),               // ingest/validation router ONLY (see §2.0)

  // ---- PROMOTED HOT FACETS (each soft = value + _conf + _src) ----
  waterproofness: waterproofness(),
  waterproofnessConf: confidence("waterproofness_conf").notNull().default("unknown"),
  waterproofnessSrc: source("waterproofness_src").notNull().default("unknown"),

  moistureManagement: text("moisture_management").array(),  // multi-label, CHECK <@ allowed
  moistureManagementConf: confidence().notNull().default("unknown"),
  moistureManagementSrc: source().notNull().default("unknown"),

  drySpeed: drySpeed(), drySpeedConf: confidence().notNull().default("unknown"),
  drySpeedSrc: source().notNull().default("unknown"),

  warmthWhenWet: wetWarmth(), warmthWhenWetConf: confidence().notNull().default("unknown"),
  warmthWhenWetSrc: source().notNull().default("unknown"),

  layeringRole: text("layering_role").array(),              // multi-label, CHECK <@ allowed
  layeringRoleConf: confidence().notNull().default("unknown"),
  layeringRoleSrc: source().notNull().default("unknown"),

  insulationType: insulationType(), insulationTypeSrc: source().notNull().default("unknown"),
  breathability: ordinal5(), breathabilityConf: confidence().notNull().default("unknown"),
  breathabilitySrc: source().notNull().default("unknown"),
  windResistance: windResistance(), windResistanceConf: confidence().notNull().default("unknown"),
  windResistanceSrc: source().notNull().default("unknown"),
  packable: packable(), packableConf: confidence().notNull().default("unknown"),
  packableSrc: source().notNull().default("unknown"),

  upf: integer(), upfSrc: source("upf_src").notNull().default("unknown"),     // hard fact
  weightG: doublePrecision("weight_g"), weightGSrc: source().notNull().default("unknown"),
  weightSizeTag: text(),                                     // "M mens" caveat

  // sleep-thermal (domain but promoted because rank-9 LB + the Kelty danger case)
  tempRatingF: integer("temp_rating_f"),                    // hard number
  tempRatingStandard: tempStandard("temp_rating_standard"), // SOFT; null when undocumented
  tempRatingStandardConf: confidence().notNull().default("unknown"),

  treatedDown: boolean("treated_down"),                     // true|false|NULL (null ≠ false)
  treatedDownSrc: source().notNull().default("unknown"),

  bodyZones: text("body_zones").array(),                    // multi-label, CHECK <@ allowed

  // ---- COLD FACETS (Zod-validated, GIN-indexed) ----
  facets: jsonb().$type<FacetsBag>().notNull().default({}),

  // ---- vanity / identity ----
  purchasePrice: doublePrecision(), yearAcquired: integer(), color: text(), conditionNote: text(),

  createdAt: timestamp().defaultNow(), updatedAt: timestamp().defaultNow(),
}, (t) => ({
  userIdx: index("items_user_idx").on(t.userId),
  // hot-facet btree indexes for the capability WHERE clauses:
  wpIdx: index("items_wp_idx").on(t.waterproofness),
  windIdx: index("items_wind_idx").on(t.windResistance),
  insulIdx: index("items_insul_idx").on(t.insulationType),
  breatheIdx: index("items_breathe_idx").on(t.breathability),
  // GIN on the multi-label arrays + the cold bag:
  layerGin: index("items_layer_gin").using("gin", t.layeringRole),
  zonesGin: index("items_zones_gin").using("gin", t.bodyZones),
  moistGin: index("items_moist_gin").using("gin", t.moistureManagement),
  facetsGin: index("items_facets_gin").using("gin", t.facets),  // jsonb_path_ops for @> queries
}));
```

### 3.4 `item_constructions` — links items to materials by role (per material-behavior §3.3)

```ts
export const itemConstructions = pgTable("item_constructions", {
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  shellMaterialId:      uuid("shell_material_id").references(() => materials.id),
  membraneMaterialId:   uuid("membrane_material_id").references(() => materials.id),
  insulationMaterialId: uuid("insulation_material_id").references(() => materials.id),
  liningMaterialId:     uuid("lining_material_id").references(() => materials.id),
}, (t) => ({ pk: primaryKey({ columns: [t.itemId] }) }));

export const treatmentsOnItems = pgTable("treatments_on_items", {
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  treatmentId: uuid("treatment_id").notNull().references(() => treatments.id),
  appliedZone: text("applied_zone"),          // shell|fill|all
  condition: text(),                          // factory_fresh|good|degraded|refreshed|null
}, (t) => ({ pk: primaryKey({ columns: [t.itemId, t.treatmentId] }) }));
```

> Construction roles feed the *derivation* of several hot facets (`warmth_when_wet`, `dry_speed`,
> `breathability`, `insulation_type`) via the §6.1 synthesis rule — but the **derived value is written to
> the `items` columns at ingest** (with confidence reflecting the weakest link), so recommendation reads
> never have to traverse `materials` at query time. Materials are the *provenance*; the columns are the
> *hot copy*. (Re-derivation on material edit is handled by the same invalidation hash as capabilities — §3.6.)

### 3.5 `item_capabilities` — materialized capability cache (the centerpiece)

Capabilities are **computed in `src/core`** (pure functions over facets-with-confidence; see §6). For
query speed they are materialized into a narrow table that gap analysis can index-scan. The cache is
**content-addressed**: `facet_hash` is a hash of the exact inputs the predicates read; if it doesn't
match the item's current inputs, the cache row is stale and ignored/recomputed. This is how the split is
kept from going stale (§8 W3).

```ts
export const itemCapabilities = pgTable("item_capabilities", {
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),                  // denormalized for per-user gap scans
  capability: text().notNull(),                       // "rain_protection" | "wicking_base" | ...
  status: text().notNull(),                           // "satisfies" | "blocked_unknown" | "fails"
  confidence: confidence().notNull(),                 // min-confidence of contributing facets
  blockingFacet: text("blocking_facet"),              // e.g. "waterproofness" when status=blocked_unknown
  reasoning: text(),                                  // human-readable, for the advisory surface
  facetHash: text("facet_hash").notNull(),            // hash(inputs) → staleness guard
  computedAt: timestamp().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.itemId, t.capability] }),
  // the gap-analysis hot path: "which of my items satisfy capability X?"
  capLookup: index("item_caps_lookup").on(t.userId, t.capability, t.status),
}));
```

Crucially the table stores **three** statuses, not a boolean: `satisfies` (predicate met at acceptable
confidence), `fails` (predicate definitively not met), and **`blocked_unknown`** (a *required* input is
`null`/low-confidence, so the positive claim is withheld). `blocked_unknown` is what makes "unknown
waterproofness ⇒ not rain-capable ⇒ surfaced as *verify*" a first-class, queryable state rather than a
silent pass (decision-drivers §5). Materialization is optional: the same `src/core` function can run
live for ≤dozens of items; the table is the perf escape hatch the thesis asks for.

### 3.6 Staleness control (one mechanism for both derived copies)

Two derived artifacts can drift from source: the hot-facet *copy* of material-derived values (§3.4) and
the *capability* cache (§3.5). Both use the same guard: a deterministic `facet_hash` over the precise
inputs. On read, the recommendation layer can either (a) trust rows whose hash matches a freshly computed
input hash, or (b) recompute live. A background revalidation job (or an ingest-time write) refreshes rows.
There is **no trigger-based magic**; invalidation is explicit and testable in `src/core`.

### 3.7 Trips & inventory

```ts
export const trips = pgTable("trips", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text().notNull(),
  rawQuery: text(),                                   // "Mount Marcy, mid-June, alpine summit, ..."
  conditionEnvelope: jsonb().$type<ConditionEnvelope>(),  // parsed: temp range, precip p, intensity, duration, social
  requiredCapabilities: text("required_capabilities").array(),  // derived from envelope
  createdAt: timestamp().defaultNow(),
}, (t) => ({ userIdx: index("trips_user_idx").on(t.userId) }));

// v0 inventory = the items rows with ownership flag; explicit table keeps "owned" vs "catalog" clean.
export const inventory = pgTable("inventory", {
  userId: uuid("user_id").notNull(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  acquiredAt: timestamp(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.itemId] }) }));
```

`ConditionEnvelope` = `{ temp_min_f, temp_max_f, precip_prob, wind_exposure, activity_intensity,
duration_hours, overnight: bool, social_context }`. The mapping `envelope → required_capabilities` lives
in `src/core` (deterministic rules per decision-drivers §6 "condition-appropriate system assembly").

---

## 4. Classification target (evidence shape)

The LLM emits, **per item**, a single EVIDENCE object validated by Zod **before any persistence**
(CLAUDE.md rule 1). The contract: *unvalidated model text never reaches the DB or UI*. The object is the
union of (a) hot-facet evidence and (b) a `facets` bag whose shape is discriminated by `item_kind`. Every
soft field is the `{value,confidence,source,reasoning?}` triple; unknown is `value:null` +
`confidence:"unknown"` + `source:"unknown"` — the schema makes the companions **required**, so the model
*cannot* emit a bare value.

```ts
// src/core/classify/schema.ts (Zod sketch)
const Confidence = z.enum(["high","medium","low","unknown"]);
const Source = z.enum(["manufacturer_stated","derived_from_composition","llm_inferred","user_provided","unknown"]);

// generic soft-facet wrapper: value is nullable, companions REQUIRED
const soft = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ value: v.nullable(), confidence: Confidence, source: Source, reasoning: z.string().optional() });

const hard = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ value: v.nullable(), source: Source });   // hard facts: null when unstated, no inference

export const ItemEvidence = z.object({
  identity: z.object({ name: z.string(), brand: z.string().nullable(), model: z.string().nullable() }),
  itemKind: z.enum(["apparel","insulation","sleep","footwear","pack","accessory","other"]),

  // ---- promoted hot facets ----
  hot: z.object({
    waterproofness: soft(z.enum(["none","dwr_only","water_resistant","wp_breathable","wp_nonbreathable"])),
    moistureManagement: soft(z.array(z.enum(["wicking_spread","absorb_release","absorb_hold","dwr_face"]))),
    drySpeed: soft(z.enum(["very_slow","slow","medium","fast","very_fast"])),
    warmthWhenWet: soft(z.enum(["collapses","neutral","partial","largely_retained","unaffected"])),
    layeringRole: soft(z.array(z.enum(["base","mid","insulation","shell","softshell_midouter",
                                       "sleep","standalone","liner","over_layer"]))),
    insulationType: hard(z.enum(["down","synthetic","fleece_grid","fleece_pile","fleece_sherpa","hybrid","none"])),
    breathability: soft(z.enum(["very_low","low","moderate","high","very_high"])),
    windResistance: soft(z.enum(["air_permeable","wind_resistant","windproof"])),
    packable: soft(z.enum(["bulky","moderate","compact","pocketable"])),
    upf: hard(z.number().int()),                          // never inferred
    weightG: hard(z.number()).and(z.object({ sizeTag: z.string().optional() })),
    tempRatingF: hard(z.number().int()),                  // sleep
    tempRatingStandard: soft(z.enum(["EN13537_comfort","EN13537_lower_limit","EN13537_extreme",
                                     "ISO23537_comfort","ISO23537_lower_limit","ISO23537_extreme",
                                     "marketing","season"])),
    treatedDown: hard(z.boolean()),
    bodyZones: soft(z.array(z.enum(["head","face","neck","torso","arms","hands","wrists","legs","feet","ankles","eyes"]))),
  }),

  // ---- materials (drive material-derived hot facets + the normalized library) ----
  construction: z.object({
    shell:      z.object({ slug: z.string(), fiberComponents: z.array(z.object({ fiber: z.string(), pct: z.number().nullable() })) }).nullable(),
    membrane:   z.object({ slug: z.string() }).nullable(),
    insulation: z.object({ slug: z.string(), fillPowerFp: z.number().int().nullable(), fillSpecies: z.enum(["duck","goose"]).nullable() }).nullable(),
    lining:     z.object({ slug: z.string() }).nullable(),
    treatments: z.array(z.object({ slug: z.string(), zone: z.string(), condition: z.string().nullable() })),
  }),

  // ---- cold facets: discriminated by itemKind ----
  facets: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("sleep"), fillWeightG: hard(z.number()), bagShape: hard(z.enum([...])),
               hasHood: hard(z.boolean()), draftCollar: hard(z.boolean()), padRValueRecommended: soft(z.number()), /* … */ }),
    z.object({ kind: z.literal("footwear"), supportStiffness: soft(z.number().int().min(1).max(5)),
               waterManagement: soft(z.enum(["waterproof_membrane","water_resistant_dwr","fast_drain_breathable"])),
               cramponCompat: hard(z.enum(["C0","C1","C2","C3"])), terrainFit: soft(z.array(z.string())), /* … */ }),
    z.object({ kind: z.literal("pack"), capacityL: hard(z.number()), suspension: soft(z.enum([...])),
               technicalFeatures: hard(z.array(z.string())), /* … */ }),
    z.object({ kind: z.literal("accessory"), warmthLevel: soft(z.enum([...])), lensCategory: hard(z.enum([...]).nullable()), /* … */ }),
    z.object({ kind: z.literal("apparel"), /* universal cold facets only */ }),
    z.object({ kind: z.literal("insulation"), warmthCategory: soft(z.enum(["low","moderate","high","very_high"])), /* … */ }),
    z.object({ kind: z.literal("other") }),
  ]),
});
export type ItemEvidence = z.infer<typeof ItemEvidence>;
```

**Mapping evidence → storage** (pure function in `src/core`, no DB import):

1. `parse` the model's JSON with `ItemEvidence`. On failure → **reject**, never store (rule 1).
2. **Composition first** (material-behavior §5.5): upsert `materials` rows by `slug` (hard facts only);
   run the deterministic fiber→behavior derivation to fill each material's `behavior` block with
   `source:"derived_from_composition"`; the LLM only supplies behavior for non-standard fibers.
3. **Hot facets** → `items` typed columns + their `_conf`/`_src` companions. The material-derivable hot
   facets (`warmth_when_wet`, `dry_speed`, `breathability`, `insulation_type`) are computed by the §6.1
   synthesis rule from the construction roles, with confidence = the weakest contributing link; an
   explicit LLM/manufacturer value *overrides* a derivation only at ≥ its confidence.
4. **Cold facets** → validated `facets` JSONB.
5. Compute `item_capabilities` (§6) and write the cache with a fresh `facet_hash`.

Because the wrapper makes `confidence`/`source` required and `value` nullable, the "never fabricate; null
+ marker" rule is structurally enforced, and a hard fact (`upf`, `treatedDown`, `tempRatingF`) literally
has no place to put an inference — it is `null` unless a source stated it.

---

## 5. Grouping as emergent queries

The "closet" has **no category tabs**. Every grouping is a query over the facet/capability space. Four
concrete examples (Drizzle-ish / SQL-ish):

**(a) "Wicking base layers" (typed-column facet query — no `item_kind`):**
```sql
SELECT * FROM items
WHERE 'base' = ANY(layering_role)
  AND moisture_management && ARRAY['wicking_spread','absorb_release']  -- overlap
  AND dry_speed >= 'fast';   -- ordinal compare via enum order
-- Hemp Henley (absorb_hold, slow) and Synchilla (mid only) correctly excluded.
```

**(b) "Everything that can shed wind on an exposed ridge" (mixes column + cold JSONB):**
```sql
SELECT i.* FROM items i
WHERE i.wind_resistance = 'windproof'
   OR i.waterproofness IN ('wp_breathable','wp_nonbreathable')          -- sealed shell ⇒ wind stop
   OR i.facets @> '{"function_purpose":{"value":["wind_protection"]}}'; -- cold-facet GIN hit
```

**(c) Capability-based grouping — "show my closet organized by what it can DO"
(reads the materialized cache, the centerpiece query):**
```sql
SELECT capability, json_agg(json_build_object('item', item_id, 'status', status, 'confidence', confidence))
FROM item_capabilities
WHERE user_id = $me AND status IN ('satisfies','blocked_unknown')
GROUP BY capability;
-- Emergent "buckets" (rain_protection, wicking_base, packable_insulation, sun_protection, …) that are
-- DERIVED, not stored as categories. 'blocked_unknown' items surface under a "verify to unlock" heading.
```

**(d) Zone-coverage map — "what covers each body zone, and where are the holes?"
(multi-label GIN + roll-up; the accessories artifact's structural query):**
```sql
SELECT zone, json_agg(i.name)
FROM items i, unnest(i.body_zones) AS zone
WHERE i.user_id = $me
GROUP BY zone;   -- zones with no row = coverage gap (e.g. 'hands' absent ⇒ no hand protection owned)
```

None of these reads `item_kind` or any fixed category; each is a position query over dimensions, exactly
as the guiding principle requires.

---

## 6. Recommendation + gap analysis

This is the section the whole architecture is shaped for.

### 6.1 The two derivation rules (in `src/core`, pure)

**Multi-layer synthesis** (material-behavior §6.4) — how item-level hot facets combine across construction
roles: `warmth_when_wet` = weakest link (shell lets water in AND fill collapses ⇒ `collapses`);
`dry_speed` = governed by shell; `warmth_for_weight` = insulation if present else shell; `breathability`
= most restrictive layer (membrane caps it); `odor_resistance` = skin-contact layer.

**Confidence propagation** (shells-wind §3, sleeping-bags §7, decision-drivers §5): a derived facet's
confidence is the **min** of its inputs; if a required input is `null`, the derived facet is `null` (e.g.
`waterproofness=null ⇒ protection_ceiling=null`; `seam_sealing=null` *downgrades* a `wp_breathable` shell
so it cannot claim sustained-rain).

### 6.2 Capabilities as predicates (precise; `:=` reads facet thresholds)

Each capability is a pure function `(item) → {satisfies | fails | blocked_unknown, confidence, blocker?}`.
The **blocking rule** is uniform: if any *required* facet is `null` or below a confidence floor, return
`blocked_unknown` naming that facet — **never** `satisfies`. (Decision-drivers §5 unknown-propagation.)

| Capability | Predicate (`satisfies` iff) | Required-for-block facets | Block ⇒ "verify" message |
|---|---|---|---|
| `rain_protection` | `waterproofness ∈ {wp_breathable, wp_nonbreathable}` **AND** (`seam_sealing = fully_sealed` OR trip-duration < 1h) | `waterproofness` (and `seam_sealing` for sustained rain) | "waterproofness unverified — do not rely on for rain" |
| `wind_protection` | `wind_resistance = windproof` **OR** `waterproofness ∈ {wp_breathable, wp_nonbreathable}` | `wind_resistance` *and* `waterproofness` (both null ⇒ block) | "wind protection unverified" |
| `breathable_shell` | `'shell' ∈ layering_role` **AND** `breathability ∈ {high, very_high}` | `layering_role`, `breathability` | — |
| `wicking_base` | `'base' ∈ layering_role` **AND** `moisture_management ∩ {wicking_spread, absorb_release} ≠ ∅` **AND** `warmth_when_wet ≠ collapses` | `moisture_management`, `warmth_when_wet` | "moisture behavior unverified" |
| `packable_insulation` | `layering_role ∩ {mid, insulation} ≠ ∅` **AND** `insulation_type ∈ {down, synthetic, fleece_*}` **AND** `packable ∈ {compact, pocketable}` (wearable ⇒ excludes `sleep`) | `insulation_type`, `packable` | "packability unverified" |
| `wet_safe_insulation` | `insulation_type = synthetic` **OR** (`insulation_type = down` **AND** `treated_down = true`) | `insulation_type`, `treated_down` (null down ⇒ block) | "hydrophobic down unconfirmed — may fail wet" |
| `sun_protection` | `upf ≥ 30` **AND** `'long' sleeve / hood` **AND** target zones ⊆ `body_zones` | `upf` (null ⇒ block; **never** inferred) | "no tested UPF — cannot rely on for sun" |
| `sleep_warmth_adequate` | `temp_rating_f ≤ expected_low` **AND** `temp_rating_standard ∈ EN/ISO_*` | `temp_rating_standard` (marketing/null ⇒ **block, not fail**) | "rating is nominal — verify EN/ISO standard" |
| `travel_versatile` | `technical_vs_lifestyle ∈ {lifestyle, hybrid}` **AND** `packable ≥ compact` **AND** `weight_g ≤ threshold` | `packable` | — |

`fails` (definitive no) is distinct from `blocked_unknown` (withheld): Terre Planing `waterproofness =
dwr_only` is a *fail* for `rain_protection` (we KNOW it isn't waterproof); an item with
`waterproofness = null` is *blocked* (we don't know). The recommendation surface treats them differently
— a fail is a real gap; a block is a "verify this item" prompt that *may* close the gap.

### 6.3 The Marcy walkthrough — against the exact 3-item inventory

**Query:** *"Mount Marcy, mid-June, alpine summit, cold and windy, long day hike."* Parsed
`ConditionEnvelope` → `temp 30–45°F`, `precip_prob: moderate (convective)`, `wind_exposure: high`,
`activity_intensity: high (ascent) + static (summit)`, `duration: 8–12h`, `overnight: false`. Mapped
**required capabilities** (decision-drivers §6 cold-alpine-active row): `wicking_base`,
`packable_insulation`, `breathable_shell`, `rain_protection`, `wind_protection`.

**Per-item contribution (facets → capability statuses, from the cache):**

| Item | Key hot facets | Capability evaluation |
|---|---|---|
| **Terre Planing Hoody** | `waterproofness=dwr_only`, `wind_resistance=wind_resistant`, `breathability=high`, `moisture_management=[wicking_spread,dwr_face]`, `dry_speed=fast`, `layering_role=[shell,standalone,base]`, `warmth_when_wet=neutral`, `upf=40` | `rain_protection` → **FAILS** (dwr_only known < wp_breathable). `wind_protection` → **FAILS** (wind_resistant, not windproof; not a sealed shell). `breathable_shell` → *partial*: breathability `high` qualifies but it is not a *rain/wind* shell, so it does not complete the shell slot. `wicking_base` → could satisfy on the *base* role (wicking + neutral), but it is not the cold-need; offered only as approach layer. **Net: usable as a breathable wind-ish approach layer; NOT the protective shell.** |
| **Kelty Galactic 30** | `insulation_type=down`, `treated_down=null`, `layering_role=[sleep]`, `temp_rating_f=30`, `temp_rating_standard=null (conf unknown)`, `packable=compact(for a bag)` | `packable_insulation` → **FAILS** the wearable test (`layering_role={sleep}`, no `mid/insulation`). All worn-layer capabilities → not applicable. **Net: zero contribution to a day-hike packing list.** (If it *were* camping: `wet_safe_insulation` → **blocked_unknown** on `treated_down=null`, and `sleep_warmth_adequate` → **blocked_unknown** on `temp_rating_standard=null` — the Kelty "30" danger surfaced, not silently trusted.) |
| **Hemp/Cotton Henley** | `moisture_management=[absorb_hold]`, `warmth_when_wet=collapses`, `dry_speed=slow`, `layering_role=[base]`, `breathability=moderate` | `wicking_base` → **FAILS** (`absorb_hold` ∉ wicking set AND `warmth_when_wet=collapses`). **Net: do NOT recommend; flag as a cold-wet hazard ("cotton kills").** |

**Recommended picks from inventory:** *none fully satisfies the system.* Conditional partial offer: the
Terre Planing **may** be suggested as a breathable approach layer over a (missing) wicking base, with an
explicit caveat that it provides **no** waterproof/windproof protection and will wet through at the
summit. No spurious recommendation is produced.

**The three surfaced gaps (priority order):**

| # | Capability missing | Why (predicate result) | Severity |
|---|---|---|---|
| 1 | `rain_protection` **+** `wind_protection` (protective shell) | No item `satisfies`; Terre Planing **fails** both (dwr_only / wind_resistant). | CRITICAL — exposed-summit, trip-blocking |
| 2 | `packable_insulation` | No worn insulation; Kelty `fails` the wearable test (sleep-only role). | HIGH — cold static summit stop unsafe |
| 3 | `wicking_base` | Only base layer (Henley) **fails** (absorb_hold + collapses). | HIGH — hypothermia risk on descent |

**Advisory surface (human-readable, generated from `reasoning`):** "No waterproof/windproof shell — your
Terre Planing is water-resistant only and will wet through in summit rain/mist. Add a hardshell or
wp-breathable jacket." · "No packable insulation for the cold summit stop." · "Your only base layer is a
hemp/cotton henley — it holds moisture and chills dangerously when wet; add merino or synthetic." This is
**exactly** the decision-drivers §2 canonical output: three gaps, zero spurious picks.

> Note how the architecture earns this: each gap is a single indexed read of `item_capabilities`
> (`WHERE user_id=$me AND capability=$c AND status='satisfies'` returns empty ⇒ gap); the fail-vs-block
> distinction is what prevents the Henley/Terre Planing from sneaking in and what flags the Kelty's
> nominal rating instead of trusting "30."

---

## 7. Hard-case resolutions

| Item / case | Facet/capability assignment in this model | How the model gets it right |
|---|---|---|
| **Terre Planing — water-resistant ≠ waterproof** | `waterproofness=dwr_only` (NOT water_resistant, NOT wp_breathable), `dwr_presence=present_standard` (cold), `wind_resistance=wind_resistant`, `breathability=high`, `dry_speed=fast`, `moisture_management=[wicking_spread,dwr_face]`, `upf=40` (hard), `layering_role=[shell,standalone,base]`. Capability: `rain_protection` = **FAILS**, `wind_protection` = **FAILS**, `sun_protection` = **satisfies** (upf 40, hood, long sleeve). | The `dwr_only` ordinal level sits *below* the `wp_breathable` threshold the predicate requires, so it can never satisfy rain/wind protection — the canonical danger case is structurally impossible to mis-recommend. "Dries fast" lives in `dry_speed`, kept separate from "stays dry" (`waterproofness`). |
| **The buff — multi-zone, multi-function** | `body_zones=[neck,face,head]` (multi-label), cold `function_purpose=[warmth,sun_protection,wind_protection,debris_filtration]` (multi-label), `upf` from spec or `null` (never inferred), `layering_role=[standalone,liner]`, accessory `warmth_level`. | Two multi-label facets (`body_zones`, `function_purpose`) let one item answer "neck UV?", "head-warmth backup?", and "face wind?" — three queries, one row, no category gymnastics (accessories §5). |
| **Kelty "Galactic 30" — rating present, standard unknown** | `temp_rating_f=30` (hard), `temp_rating_standard=null` + `tempRatingStandardConf=unknown` + note "marketing/season; EN cert not documented". `fill` cold facets: `fill_power=550`, `fill_species=duck`, `treated_down=null`. `insulation_type=down`. | The number is stored; the *standard* is `null`, NOT fabricated to `EN13537_comfort`. `sleep_warmth_adequate` returns **blocked_unknown** (not `satisfies`) on a cold trip → "verify EN/ISO standard," exactly the sleeping-bags §5.1 anti-pattern guard. |
| **Hemp Henley — weak wet base layer** | `moisture_management=[absorb_hold]`, `warmth_when_wet=collapses`, `dry_speed=slow`, `odor_resistance=low` (cold), all `confidence:high source:derived_from_composition` (cotton-dominant deterministic chain, base-layers §7). `layering_role=[base]`. | `wicking_base` = **FAILS** (definitive, not blocked — we *know* the composition). Surfaced as a hazard, not silently omitted. Still findable for "warm-dry casual" via `technical_vs_lifestyle=lifestyle`. |
| **R1 Air — multi-role** | `insulation_type=fleece_grid`, `breathability=very_high`, `dry_speed=very_fast`, `wind_resistance=air_permeable`, `warmth_when_wet=unaffected`, `layering_role=[base,mid,standalone]` (multi-label!), `dwr_presence=none`. Cold: `active_insulation_suitability=active`, `technical_vs_lifestyle=mostly_technical`. | The multi-label `layering_role` is the whole trick: a query for "active breathable mid for ski touring" finds it; "warm belay layer" excludes it (low warmth, air_permeable); "shell" excludes it (no waterproofness). One item, many emergent roles (mid-insulation §5.1). |

---

## 8. Tradeoffs & weaknesses (honest self-assessment)

**Strengths.**
- **Recommendation + gap analysis is the fast path by construction.** A gap query is one indexed read of
  `item_capabilities`; the hot facets every predicate needs are typed columns with btree/GIN indexes.
  The architecture is shaped around the exact query the app exists to answer.
- **Safety is structural, not procedural.** `blocked_unknown` as a distinct, queryable status makes
  "unknown ⇒ withhold the positive claim ⇒ surface verify" impossible to forget; the Zod wrapper makes
  "null + confidence + source" the only legal shape, so a fabricated spec has nowhere to live.
- **Type safety where it counts.** The hot facets are Postgres enums + TS types from one Zod schema — the
  decisive facets get compile-time and DB-time guarantees.

**Weaknesses (named, with mitigations).**

- **W1 — Two query paths.** Hot facets are SQL columns; cold facets are JSONB `@>`/path queries. Authors
  must know which path a facet is on, and a cold→hot promotion later is a migration *plus* a query
  rewrite. *Mitigation:* the promotion set = decision-drivers' LOAD-BEARING ranking, the most stable part
  of the ontology; a thin `src/core` query-builder hides "column vs JSONB" behind one `facetFilter(name,
  op, val)` API so call sites don't hardcode the path.
- **W2 — The promotion split can go stale as the ontology evolves.** If a Wave-3 audit or real usage
  promotes a facet from "situational" to "decisive" (e.g. `seam_sealing` turns out to gate many queries),
  it should become a column but starts in JSONB. *Mitigation:* promotion is a reversible, well-scoped
  migration (add 3 columns, backfill from JSONB, repoint the query-builder); I treat the split as a
  *tunable*, and I deliberately kept the JSONB schema Zod-validated so a promoted facet already has a
  known shape to migrate from. This is the single biggest "judgment call" risk and I rate it MEDIUM.
- **W3 — Capability materialization staleness.** `item_capabilities` and the material-derived hot-facet
  copies can drift from their inputs. *Mitigation:* content-addressed `facet_hash` (§3.6) — a row is only
  trusted if its hash matches freshly computed inputs; otherwise recompute live (cheap at v0 scale). No
  trigger magic; invalidation is explicit and unit-testable in `src/core`. The cache is *optional* — the
  same pure function runs live — so a staleness bug degrades to "slower," not "wrong."
- **W4 — `item_kind` smells like a category.** It is an ingest/validation router (chooses the
  classification sub-prompt + which JSONB group to validate), explicitly forbidden from §5/§6 queries.
  *Risk:* a future contributor reaches for `WHERE item_kind='shell'`. *Mitigation:* documented guardrail +
  an audit assertion ("no recommendation/grouping query references `item_kind`"). If even this feels too
  close to the line, `item_kind` can be replaced by a derived `validation_profile` chosen from
  `layering_role`/`function_purpose` — but that adds a chicken-and-egg at ingest, so I keep the explicit
  router and quarantine it.
- **W5 — LLM-classification ergonomics.** The discriminated-union evidence object is large; a single call
  must fill hot facets + construction + the right domain group. Risk of the model emitting plausible-but-
  unsourced values, or mis-picking `item_kind`. *Mitigation:* composition-first pipeline (material-behavior
  §5.5) — deterministic fiber→behavior derivation does most soft facets *before* the LLM, so the model is
  mostly confirming/handling non-standard cases; hard facts have no inference slot in the schema; Zod
  rejection on parse failure (rule 1). Calibration-prone facets (`technical_vs_lifestyle`) carry low
  default confidence and anchored prompt examples (mid-insulation §7.6).
- **W6 — Multi-label ordinal comparisons in SQL.** Ordinal enums compare via declared enum order
  (works), but multi-label arrays need `&&`/`@>` and can't express "≥ moderate on any element" tidily.
  *Mitigation:* such comparisons are pushed into `src/core` predicate functions rather than raw SQL; SQL
  does the coarse filter, `src/core` does the fine ordinal/confidence logic.
- **W7 — Derived hot-facet copy duplicates material truth.** Writing `warmth_when_wet` onto `items` (copy)
  *and* deriving it from `materials` is denormalization. *Mitigation:* materials remain the single source
  of provenance; the copy exists only to keep recommendation reads off the join, guarded by the same hash.
  Editing a material triggers recompute of dependents — explicit, not implicit.

**Weakest point, stated plainly:** W2 (the typed/JSONB promotion boundary) is the load-bearing judgment
call of this entire architecture. I have anchored it to the decision-driver ranking to make it as
principled and stable as possible, and made both the JSONB shape and the promotion migration cheap and
reversible — but if that ranking is wrong about which facets are "decisive," this design pays for it in
migrations. I accept that trade because it is *exactly* the bet the capability-first thesis makes: the
hot set is the recommendation surface, and the recommendation surface is the product.
