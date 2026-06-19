# Architecture B — Facet-Graph / Ontology-Driven Universal Facet Space

> Phase 0, Layer 0 proposal. One of three independent, blind competing-architecture proposals for Armarium. This document is standalone: it defines a complete faceted data model, classification target, querying strategy, and recommendation/gap engine, and confronts its own weaknesses.
>
> **Stack context:** Next.js App Router + TS, Postgres/Supabase via Drizzle ORM + drizzle-kit, Zod, `@anthropic-ai/sdk` (server-only), pnpm, Vercel. Core enrichment/classification lives in framework-agnostic `src/core/`. Model id lives in ONE config constant (`MODEL_ID`, default `"claude-sonnet-4-6"`).

---

## 1. Thesis & rationale

**Thesis: there are no domain tables. Every fact Armarium knows about an item is a *facet-assignment row* — `item_facets(item_id, facet_key, value_json, value_kind, confidence, source, evidence, …)` — validated against a `facet_definitions` ontology/registry that declares each facet's value-space, multi-label-ness, universal-vs-domain scope, hard-vs-soft nature, and any allowed enum levels.** "Sleeping bags", "shells", "base layers" are not tables, columns, or even enums — they are *emergent query predicates* over facet rows. Adding a facet ("crampon compatibility", "lens category", "kangaroo pocket") is a single `INSERT` into `facet_definitions` plus a Zod schema entry keyed off the registry — **no migration, no column, no domain table edit.** This is maximally faithful to the guiding principle ("no fixed category buckets; model dimensions; grouping is emergent") and maximally extensible: the Wave-1 footwear/packs/accessories domains each introduced ~12-16 new facets, and in this model each new domain is a batch of ontology rows, not a schema change.

The honest cost of this thesis is real and I confront it head-on in §3 and §8: a key-value/EAV-shaped store gives up compile-time column typing, makes naive queries verbose, and risks ontology sprawl (synonymous facet keys, drifting enum levels). The proposal's whole technical burden is showing that **(a) Zod schemas generated *from* the registry restore validation-time type safety**, **(b) Postgres JSONB + GIN/expression indexes restore acceptable query performance**, **(c) capability *views* restore query ergonomics for the recommendation engine**, and **(d) a governed, versioned, closed registry with a controlled-vocabulary key namespace prevents sprawl**. Materials get exactly the same treatment — a material is an entity whose behavioral facets are facet rows — and items reference materials through typed construction-role links (shell / membrane / insulation / lining), so the Wave-1 "derive item behavior from material" benefit (material-behavior.md §6) is preserved as a join, not a duplication.

---

## 2. Facet ontology

The heart of the design. In this architecture each facet below is **a row in `facet_definitions`**, not a column. I list them grouped, then show the registry-entry shape that makes them ROWS.

### 2.0 The registry-entry shape (how a facet is declared as a ROW)

Every facet in §2.1-§2.10 is declared once in `facet_definitions`. Conceptually:

```
facet_definitions row = {
  facet_key:        "waterproofness"        -- stable controlled-vocab key (the namespace)
  version:          1                        -- bumped on any value-space change
  group:            "weather_protection"     -- for UI/grouping only; NOT a category
  label:            "Waterproofness"
  meaning:          "Mechanism + degree of liquid-water exclusion."
  value_kind:       "ordinal_enum"           -- boolean | ordinal_enum | nominal_enum |
                                             --   continuous | multi_label_enum | structured
  enum_levels:      ["none","dwr_only","water_resistant",
                     "wp_breathable","wp_nonbreathable"]   -- ordered for ordinal_enum
  unit:             null                      -- e.g. "g", "L", "FP", "°F", "mm", "gsm"
  multi_label:      false                     -- true => value is a set
  scope:            "universal"               -- universal | domain
  applies_when:     null                      -- optional facet-predicate gate (domain facets)
  fact_class:       "hard" | "soft"           -- hard => never inferred; soft => confidence-marked
  safety_relevant:  true                      -- gates recommendation behavior on unknown
  default_on_unknown: "null"                  -- how a missing value is treated downstream
  zod_schema_ref:   "waterproofness@1"        -- key into the per-facet Zod registry (§4)
}
```

`value_kind` is the load-bearing typing primitive. The six kinds:

| `value_kind` | `value_json` shape | Wave-1 examples |
|---|---|---|
| `boolean` | `true` / `false` | `has_hood`, `is_organic`, `crampon_loops`, `treated_down` |
| `ordinal_enum` | one string from ordered `enum_levels` | `waterproofness`, `breathability`, `warmth_level`, `support_stiffness` |
| `nominal_enum` | one string from unordered `enum_levels` | `insulation_type`, `temp_rating_standard`, `construction_type` |
| `continuous` | `{ "value": number, "unit": "<unit>" }` | `weight_g`, `capacity_l`, `fill_power`, `upf_rating`, `temp_rating` |
| `multi_label_enum` | array of strings from `enum_levels` | `layering_role`, `body_zone_covered`, `function_purpose`, `activity_fit` |
| `structured` | small validated object | `fiber_components` (`[{fiber, pct}]`), `temp_rating` bundle |

The same physical `item_facets` row carries `confidence`, `source`, and `evidence` regardless of `value_kind` (§3, §4). This is what lets a buff's `body_zone_covered = ["neck","face","head"]` and a sleeping bag's `temp_rating = {value:30,unit:"F"}` live in one table with one schema.

> **Reading the tables below:** each entry's *value-space shape* maps to a `value_kind`; *multi-label?* maps to `multi_label`; *universal-vs-domain* maps to `scope`; *hard-vs-soft* maps to `fact_class`; *confidence/unknown handling* maps to `safety_relevant` + `default_on_unknown` and the §5/§7 rules.

---

### 2.1 Universal weather/moisture facets (cross-domain — apparel, footwear, accessories, packs)

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `waterproofness` | mechanism + degree of liquid-water exclusion | `ordinal_enum`: `none < dwr_only < water_resistant < wp_breathable < wp_nonbreathable` | no | universal | soft | **safety-relevant.** Unknown ⇒ `null`; NEVER default to a positive value. The Terre Planing danger case (§7). |
| `wind_resistance` | does the fabric block moving air | `ordinal_enum`: `air_permeable < wind_resistant < windproof` | no | universal | soft | unknown ⇒ `null`; correlated with but independent of waterproofness |
| `breathability` | vapor transmission under exertion | `ordinal_enum`: `very_low < low < moderate < high < very_high` | no | universal | soft | unknown ⇒ `null`; for shells `low`+ is the binding stack constraint |
| `dwr_present` | durable water-repellent surface treatment present | `boolean` | no | universal | soft (often hard-stated) | unknown ⇒ `null`, NOT `false`; freshness is a separate item-state concern |
| `seam_sealing` | seams taped/welded against needle-hole leak | `nominal_enum`: `none / critical_seams / fully_sealed` | no | domain (shells) | soft | unknown on a `wp_breathable` item ⇒ assume `none`; caps protection ceiling |
| `upf_rating` | UV protection factor | `continuous` (unit `UPF`) | no | universal | hard if stated, else soft | unknown ⇒ `null`; never infer a number from fabric alone above `confidence:low` |
| `protection_ceiling` | worst conditions item credibly handles (roll-up) | `ordinal_enum`: `light_spray < intermittent_rain < sustained_rain_low < sustained_rain_high < any_precipitation` | no | domain (shells) | **soft/derived** | derived from waterproofness+seam+hood; `null` if waterproofness is `null` (null propagation, §5) |

### 2.2 Universal thermal/insulation facets

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `insulation_type` | fill medium / construction class | `nominal_enum`: `down / synthetic / fleece_grid / fleece_pile / fleece_sherpa / hybrid_down_fleece / hybrid_synthetic_fleece / active_synthetic` | no | universal | hard | never default to unknown when extractable; null only when truly absent |
| `fill_power` | down loft per ounce | `continuous` (unit `FP`, ~450-900) | no | domain (down items) | hard | **never infer from brand/price.** Null+`source:unknown` if unstated. Shared bag↔jacket facet. |
| `fill_species` | duck vs goose | `nominal_enum`: `duck / goose` | no | domain (down) | hard | null if unstated |
| `fill_weight_g` | grams of fill (not garment weight) | `continuous` (unit `g`) | no | domain (insulated) | hard | usually `null`; do not fabricate |
| `treated_down` | hydrophobic down treatment present | `boolean` | no | domain (down) | hard if stated, else soft | unknown ⇒ `null`, NOT `false`; treated buys ~30-60 min, not indefinite |
| `wet_warmth_retention` | retains warmth when saturated | `ordinal_enum`: `very_low < low < medium < high < very_high` | no | universal | **soft/derived** | derived from `insulation_type`+`treated_down`; governed by weakest link in multi-layer (material-behavior.md §6.4) |
| `warmth_for_weight` | thermal output per gram | `ordinal_enum`: `very_low < low < moderate < high < very_high` | no | universal | soft/derived | confidence drops when `fill_weight_g` is null |
| `warmth_level` | absolute heat retention (accessories/garments) | `ordinal_enum`: `none < minimal < light < moderate < high < extreme` | no | universal | soft | unknown ⇒ `null`; primary cross with conditions for head/hand coverage |
| `active_insulation_suitability` | usable during sustained aerobic output | `ordinal_enum`: `static < semi_active < active` | no | universal | soft/derived | high confidence when `insulation_type`+breathability known |
| `loft_category` | uncompressed thickness | `ordinal_enum`: `low < medium < high < very_high` | no | domain (insulation) | soft | derived from type + fill weight |

### 2.3 Universal moisture-management / fiber-behavior facets

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `moisture_management` | how fiber handles liquid sweat at skin | `multi_label_enum`: `{wicking_spread, absorb_release, absorb_hold, dwr_face}` | **yes** | universal | soft | **safety-relevant** (cotton-kills). High-confidence inference from fiber. `absorb_hold` ⇒ fails wicking-base. |
| `dry_speed` | time-to-dry after saturation | `ordinal_enum`: `very_slow < slow < moderate < fast < very_fast` | no | universal | soft/derived | derived from fiber hydrophobicity + gsm; governed by shell (outer) layer |
| `odor_resistance` | days before odor problematic | `ordinal_enum`: `very_low < low < medium < high` | no | universal | soft | treatment-based ⇒ confidence-decaying; governed by skin-contact layer |
| `next_to_skin_comfort` | itch factor next to skin | `ordinal_enum`: `may_itch < neutral < soft_non_itch` | no | domain (next-to-skin) | soft | never `soft_non_itch` without micron count or "superfine" claim |
| `abrasion_resistance` | resists pack straps / rock / wear | `ordinal_enum`: `very_low < low < medium < high < very_high` | no | universal | soft/derived | governed by shell material; nylon > poly > wool > cotton |
| `stretch` | range-of-motion accommodation | `ordinal_enum`: `none < moderate < high` | no | universal | soft | elastane blend ⇒ `high` when stated |

### 2.4 Universal layering / role / function facets (the "buff" facets)

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `layering_role` | position(s) in a layering system | `multi_label_enum`: `{base, system_base, mid, shell, outer_in_calm_dry, standalone, liner, over_layer, sleep_system, base_adjacent}` | **yes** | universal | soft | **structural** — engine builds systems from it. Multi-label is mandatory (R1 Air, §7). |
| `body_zone_covered` | anatomical zones covered/protected | `multi_label_enum`: `{head, face, neck, torso, arms, hands, wrists, feet, ankles, lower_leg, eyes}` | **yes** | universal | soft | **globally load-bearing** (accessories.md §6). Enables zone-gap + overlap detection. The buff = `{neck,face,head}`. |
| `function_purpose` | what it does (not what it is) | `multi_label_enum`: `{warmth, sun_protection, wind_protection, water_resistance, waterproof, dexterity_preservation, eye_protection_uv, eye_protection_glare, debris_filtration, blister_prevention, ankle_support, gear_retention, layering_component, standalone_solution}` | **yes** | universal | soft | **globally load-bearing**; multi-label mandatory. A buff covers warmth+sun+wind at once. |
| `use_context` | technical-vs-lifestyle orientation | `ordinal_enum`: `lifestyle < mostly_lifestyle < hybrid < mostly_technical < technical` | no | universal | soft | calibrate against anchors: Snap-T/Marsupial=`lifestyle`, R1 Air=`technical`, Nano Puff=`hybrid` (mid-insulation.md §7.6) |
| `activity_fit` | activities/trip-types the item suits | `multi_label_enum`: `{trail_running, day_hiking, backpacking, alpine, mountaineering, ski_touring, climbing_active, climbing_static, approach_climbing, kayaking, cycling, camp_and_rest, travel, casual, everyday_lifestyle}` | **yes** | universal | soft | primary trip→item filter; medium confidence + evidence |
| `style` | aesthetic acceptability | `ordinal_enum`: `technical_looking < versatile < lifestyle < casual` | no | universal | soft | only load-bearing for casual-travel query (decision-drivers.md Query D) |

### 2.5 Sleep-system facets (domain; `applies_when layering_role ∋ sleep_system`)

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `temp_rating` | stated temperature rating | `structured`: `{ value:number, unit:"F"|"C" }` | no | domain | hard (the number only) | the number is hard; never store without unit (54°F gap) |
| `temp_rating_standard` | which protocol produced the number | `nominal_enum`: `EN13537_comfort / EN13537_lower_limit / EN13537_extreme / ISO23537_comfort / ISO23537_lower_limit / ISO23537_extreme / marketing / season` | no | domain | **soft** | **the most dangerous unknown.** Kelty "30" ⇒ `null`, `confidence:low`. NEVER silently upgrade marketing→EN (§7). |
| `bag_shape` | geometry | `nominal_enum`: `mummy / semi_rectangular / rectangular / quilt / double` | no | domain | hard | Kelty = `rectangular` |
| `has_hood` | integrated insulated hood | `boolean` | no | universal | hard | adds 5-10°F effective warmth; `null` if unconfirmed |
| `draft_collar` | neck baffle present | `boolean` | no | domain | hard | `null` if unconfirmed |
| `pad_r_value_recommended` | min companion pad R-value | `continuous` (unitless R) | no | domain | soft/derived | system-level hint, rule-of-thumb, `confidence:low` |

### 2.6 Footwear facets (domain; `applies_when activity_fit ∋ {day_hiking, mountaineering, …}` or `function_purpose ∋ ankle_support`)

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `support_stiffness` | longitudinal shank stiffness | `ordinal_enum` 5-pt: `1_flexible < 2_minimal < 3_moderate < 4_stiff < 5_full_shank` | no | domain | soft | interacts with crampon class; medium confidence from category+desc |
| `ankle_height` | collar height vs ankle joint | `ordinal_enum`: `low < mid < high` | no | domain | soft | high confidence when boot/low-cut is visually clear |
| `water_management` | water strategy (boot-specific) | `nominal_enum`: `waterproof_membrane / water_resistant_dwr / fast_drain_breathable` | no | domain | hard (membrane) / soft | a TENSION not a quality gradient; do not default to membrane |
| `crampon_compat` | crampon attachment class | `nominal_enum`: `C0_none / C1 / C2 / C3` | no | domain | hard | **highest-stakes null** — never infer from "mountaineering boot"; unstated ⇒ `null` |
| `outsole_compound` | rubber compound | `nominal_enum`: `vibram_megagrip / vibram_xs / vibram_montagna / continental / proprietary / unknown` | no | domain | hard if logo'd | never infer Vibram from feel; `confidence:low` otherwise |
| `terrain_fit` | terrain types it performs on | `multi_label_enum`: `{road, groomed_trail, singletrack, rocky_trail, talus, off_trail, soft_snow, firm_snow, slickrock, canyon_wet, technical_rock, glacier}` | **yes** | domain | soft | inherently `confidence:medium` + reasoning |

### 2.7 Pack/carry facets (domain; `applies_when function_purpose ∋ gear_retention` AND item is a pack)

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `capacity_l` | internal volume | `continuous` (unit `L`) | no | domain | hard | first-order filter; `null`+low if inferred from category name |
| `suspension_system` | load-transfer structure | `ordinal_enum`: `none < minimal < framesheet < aluminum_stay < full_suspension` | no | domain | soft | determines max comfortable load; medium confidence |
| `max_comfortable_load_kg` | comfortable load ceiling | `continuous` (unit `kg`) | no | domain | soft | always `confidence:low`, body-dependent |
| `frame_type` | structural skeleton | `nominal_enum`: `frameless / framesheet / semi_rigid / internal_aluminum / internal_carbon / external` | no | domain | hard if stated | feeds suspension + weight |
| `access_style` | how the pack opens / organizes | `multi_label_enum`: `{top_load, panel_load, clamshell, roll_top, hip_pockets, hydration_sleeve, tool_loops, laptop_sleeve}` | **yes** | domain | soft | technical requirement for travel/alpine filtering |
| `technical_carry_features` | alpine/ski features | `multi_label_enum`: `{ice_axe_loop, crampon_patch, ski_carry, helmet_carry, rope_strap, avy_pocket}` | **yes** | domain | hard (present/absent) | assume absent unless confirmed (`confidence:high` on absence) |
| `carry_affordance` | non-pack carry on any item | `multi_label_enum`: `{kangaroo_pocket, chest_pocket, hip_pocket, hydration_sleeve}` | **yes** | universal | hard | the Marsupial's kangaroo pocket lives HERE, not in `capacity_l` (packs.md §5) |

### 2.8 Accessory facets (domain; `applies_when body_zone_covered ⊆ {head, hands, neck, …}` and item is small/worn)

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `dexterity_level` | fine motor control preserved (gloves) | `ordinal_enum`: `minimal < low < moderate < high < full` | no | domain | soft | only meaningful when `body_zone_covered ∋ hands` |
| `lens_category` | sunglass lens UV/light class | `nominal_enum`: `category_1 / category_2 / category_3 / category_4 / uv400` | no | domain | hard | safety-critical on glaciers; `null` if only "100% UV" claimed |
| `sock_cushion_zone` | sock cushion placement | `nominal_enum`: `minimal / light / medium / heavy / targeted` | no | domain | soft | "spec unknown — verify before alpine trip" if `null` |
| `gaiter_height` | gaiter coverage | `nominal_enum`: `ankle / mid / knee / full_mountaineering` | no | domain | hard (structural) | clear from product type |

### 2.9 Hard-fact identity & provenance facets (universal)

| facet_key | meaning | value-space shape | multi? | scope | fact_class | confidence/unknown |
|---|---|---|---|---|---|---|
| `weight_g` | item total weight | `continuous` (unit `g`) | no | universal | hard | size-dependent; store with size caveat in `evidence`; `null` if unstated |
| `packed_size` | packed bulk / compressibility | `ordinal_enum`: `non_packable < bulky < moderate < compressible < packs_to_pocket` | no | universal | soft | unlabeled ⇒ assume worse end; can't derive from material alone |
| `packable` | feasibly carried/stowed | `boolean` | no | universal | soft/derived | unlabeled ⇒ assume `false` |
| `fiber_components` | composition | `structured`: `[{ fiber:string, pct:number|null }]` | n/a | universal | **hard** | NEVER inferred; pct null when unlisted; the keystone all soft fiber facets derive from |

### 2.10 Vanity facets (stored, never decision predicates)

`color`, `brand`, `purchase_price` (+ `currency`, `purchase_date`), `year_purchased`, `country_of_manufacture`, `fit_cut`, `gender_cut`, `recycled_content_pct`, `is_organic`, `bluesign_certified`. These are facet rows like any other — they just never appear in capability predicates. (`recycled_content_pct` / `is_organic` are vanity for *recommendation* but feed a `sustainability` UI badge.) Modeling them as rows means a future "sustainability-weighted" query is a new capability view, not a schema change.

> **Note on the buff (worth stating up front):** the buff is the cleanest argument for this design. It is one `items` row with `body_zone_covered=["neck","face","head"]`, `function_purpose=["warmth","sun_protection","wind_protection","debris_filtration"]`, `layering_role=["standalone","liner"]`, `upf_rating={value:50,unit:"UPF"}`. Three separate queries ("neck UV", "head-warmth backup", "face wind block") all retrieve it from the *same rows*, with no category gymnastics — see §7.

---

## 3. Data model (proposed Drizzle/Postgres schema)

Five tables carry the entire model: `facet_definitions` (the ontology), `items`, `materials`, `item_facets` + `material_facets` (the EAV fact rows), and `item_materials` (typed construction links). Capabilities are **views**, not tables.

### 3.1 `facet_definitions` — the ontology/registry (governs everything)

```ts
// src/core/db/schema/facet-definitions.ts  (framework-agnostic; no Next imports)
export const valueKind = pgEnum("value_kind", [
  "boolean", "ordinal_enum", "nominal_enum", "continuous", "multi_label_enum", "structured",
]);
export const factClass = pgEnum("fact_class", ["hard", "soft"]);
export const facetScope = pgEnum("facet_scope", ["universal", "domain"]);

export const facetDefinitions = pgTable("facet_definitions", {
  facetKey:          text("facet_key").notNull(),         // controlled-vocab key (the namespace)
  version:           integer("version").notNull().default(1),
  group:             text("group").notNull(),             // UI grouping ONLY — not a category
  label:             text("label").notNull(),
  meaning:           text("meaning").notNull(),
  valueKind:         valueKind("value_kind").notNull(),
  enumLevels:        jsonb("enum_levels").$type<string[] | null>(),   // ordered for ordinal
  unit:              text("unit"),                        // "g","L","FP","°F","mm","gsm","UPF"…
  multiLabel:        boolean("multi_label").notNull().default(false),
  scope:             facetScope("scope").notNull(),
  appliesWhen:       jsonb("applies_when").$type<FacetPredicate | null>(), // domain gate
  factClass:         factClass("fact_class").notNull(),
  safetyRelevant:    boolean("safety_relevant").notNull().default(false),
  defaultOnUnknown:  text("default_on_unknown").notNull().default("null"),
  zodSchemaRef:      text("zod_schema_ref").notNull(),    // → per-facet Zod registry (§4)
  deprecated:        boolean("deprecated").notNull().default(false),
  supersededBy:      text("superseded_by"),               // facet_key of replacement, if any
}, (t) => ({
  pk: primaryKey({ columns: [t.facetKey, t.version] }),   // versioned definitions
}));
```

This table is **seeded, not user-edited** in v0; rows are added by code review (the governance gate, §8). It is the single source of truth that every Zod schema, every UI grouping, and every capability view reads from.

### 3.2 `items` — thin identity row (NO domain columns)

```ts
export const items = pgTable("items", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull(),                   // EVERY user-owned table, day one
  name:      text("name").notNull(),                      // "Patagonia R1 Air Full-Zip Hoody"
  brand:     text("brand"),                               // denormalized for display only
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byUser: index("items_user_idx").on(t.userId),
}));
```

There is deliberately no `item_type`, no `category`, no `domain` column. "What kind of thing is this" is answered by querying its facet rows. (A denormalized `primary_kind` *cache* could be added later for UI breadcrumbs — strictly a read optimization, never a constraint.)

### 3.3 `item_facets` — the universal fact-row table (the core of the architecture)

```ts
export const factSource = pgEnum("fact_source", [
  "manufacturer_stated", "third_party_stated",
  "derived_from_composition", "llm_inferred", "user_confirmed", "unknown",
]);
export const factConfidence = pgEnum("fact_confidence", ["high", "medium", "low", "unknown"]);

export const itemFacets = pgTable("item_facets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  userId:      uuid("user_id").notNull(),                 // denormalized from items for RLS/filtering
  itemId:      uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  facetKey:    text("facet_key").notNull(),               // FK → facet_definitions.facet_key
  facetVersion:integer("facet_version").notNull(),        // which definition version validated this
  valueKind:   valueKind("value_kind").notNull(),         // copied from def for query-time discrimination
  valueJson:   jsonb("value_json").notNull(),             // the validated value (shape per value_kind)
  confidence:  factConfidence("confidence").notNull(),
  source:      factSource("source").notNull(),
  evidence:    text("evidence"),                          // short quote / inference basis; NULL ok
  isUnknown:   boolean("is_unknown").notNull().default(false), // explicit "we don't know" marker
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // one assignment per (item, facet) for single-value facets; multi-label packs into one row's array
  uniq:        uniqueIndex("item_facets_item_facet_uq").on(t.itemId, t.facetKey),
  byItem:      index("item_facets_item_idx").on(t.itemId),
  // btree on (facet_key, value_kind) — fast "all items with facet X"
  byFacet:     index("item_facets_facet_idx").on(t.facetKey),
  // GIN on value_json — containment queries for multi_label / structured (see §3.7)
  valueGin:    index("item_facets_value_gin").using("gin", t.valueJson),
  // EXPRESSION btree for the hottest scalar enum facets — see §3.7
  wpExpr:      index("item_facets_wp_idx")
                 .on(sql`(${t.valueJson} #>> '{}')`)
                 .where(sql`${t.facetKey} = 'waterproofness'`),
}));
```

**How confidence/source/unknown are physically stored:** every fact carries its own `confidence`, `source`, `evidence`, and an explicit `isUnknown` boolean *in the same row as the value*. An unknown safety-relevant facet is a real row with `valueJson: null`, `isUnknown: true`, `confidence: "unknown"`, `source: "unknown"` — it is queryable and auditable, distinct from "facet never assigned" (no row). This directly implements material-behavior.md §5 and decision-drivers.md §5: a wrong spec is worse than a missing one, and the engine can ask "is this facet *known* before I rely on it for a safety capability?"

### 3.4 `materials` & `material_facets` — materials are entities, faceted identically

A material is just another faceted entity. Its behavioral facets (`breathability`, `dry_speed`, `wet_warmth_retention`, `abrasion_resistance`, `fiber_components`, `construction_type`, `fill_power`, etc. — the §2.2/§2.3 facets) are rows in `material_facets`, validated against the *same* `facet_definitions` registry. This is the keystone: there is no second ontology for materials.

```ts
export const materials = pgTable("materials", {
  id:          uuid("id").primaryKey().defaultRandom(),
  slug:        text("slug").notNull().unique(),           // "polyester-grid-fleece","down-550fp"
  displayName: text("display_name").notNull(),
  // NOTE: no userId — material library is shared/global (seeded catalog + ingest-created)
}, (t) => ({}));

export const materialFacets = pgTable("material_facets", {
  id:         uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull().references(() => materials.id, { onDelete: "cascade" }),
  facetKey:   text("facet_key").notNull(),
  facetVersion: integer("facet_version").notNull(),
  valueKind:  valueKind("value_kind").notNull(),
  valueJson:  jsonb("value_json").notNull(),
  confidence: factConfidence("confidence").notNull(),
  source:     factSource("source").notNull(),
  evidence:   text("evidence"),
  isUnknown:  boolean("is_unknown").notNull().default(false),
}, (t) => ({
  uniq:     uniqueIndex("material_facets_mat_facet_uq").on(t.materialId, t.facetKey),
  byMat:    index("material_facets_mat_idx").on(t.materialId),
  byFacet:  index("material_facets_facet_idx").on(t.facetKey),
  valueGin: index("material_facets_value_gin").using("gin", t.valueJson),
}));
```

### 3.5 `item_materials` — typed construction-role links

Items reference materials through *named construction roles*, exactly as material-behavior.md §3.3 recommends (Option 3, "structured construction"). Roles, however, are not hardcoded enums baked into a `item_constructions` table with fixed columns — they are values of a `construction_role` facet vocabulary, so a new role (e.g. `cuff`, `reinforcement`, `footbox_synthetic`) is an ontology addition, not a column.

```ts
export const constructionRole = pgEnum("construction_role", [
  "shell", "membrane", "insulation", "lining", "fill", "footbox", "reinforcement",
]);

export const itemMaterials = pgTable("item_materials", {
  id:         uuid("id").primaryKey().defaultRandom(),
  itemId:     uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  role:       constructionRole("role").notNull(),
  zone:       text("zone"),                               // "all","shell","fill" for treatments
  confidence: factConfidence("confidence").notNull(),
  source:     factSource("source").notNull(),
}, (t) => ({
  byItem: index("item_materials_item_idx").on(t.itemId),
  uniq:   uniqueIndex("item_materials_item_role_uq").on(t.itemId, t.role, t.materialId),
}));
```

A simple Henley: one `shell` link. A down jacket: `shell` + `insulation`. A 3L hardshell: `shell` + `membrane` + `lining`. Treatments (DWR, antimicrobial, hydrophobic-down) are modeled as the `dwr_present` / `treated_down` item facets plus, if richer modeling is wanted, a `material` of `construction_type: "treatment"` linked at a `zone` — but in v0 the booleans suffice. The "derive item behavior from material" benefit (material-behavior.md §6) is then a **join + reduce**: `wet_warmth_retention` for an item with no explicit item-level row falls back to `min(over construction-role materials of their wet_warmth_retention)`, computed in a capability view (§3.6) — weakest-link semantics, for free, no per-item duplication.

### 3.6 Capability views — grouping & recommendation predicates live HERE

Capabilities (decision-drivers.md §4) are **materialized views** (or plain views in v0) over facet rows. Each capability is a derived boolean/degree per item. Because views read `item_facets` by `facet_key`, adding a capability is a `CREATE VIEW`, not a migration touching item rows.

```sql
-- v_item_scalar: pivot the hot scalar facets into one wide row per item for ergonomic querying.
-- This is the "query ergonomics" recovery layer: capability SQL reads this, not raw EAV.
CREATE VIEW v_item_scalar AS
SELECT
  i.id AS item_id, i.user_id,
  MAX(f.value_json) FILTER (WHERE f.facet_key='waterproofness')   #>> '{}'      AS waterproofness,
  MAX(f.value_json) FILTER (WHERE f.facet_key='wind_resistance')  #>> '{}'      AS wind_resistance,
  MAX(f.value_json) FILTER (WHERE f.facet_key='breathability')    #>> '{}'      AS breathability,
  MAX(f.value_json) FILTER (WHERE f.facet_key='moisture_management')            AS moisture_management, -- array
  MAX(f.value_json) FILTER (WHERE f.facet_key='insulation_type')  #>> '{}'      AS insulation_type,
  MAX(f.value_json) FILTER (WHERE f.facet_key='layering_role')                  AS layering_role,        -- array
  MAX(f.value_json) FILTER (WHERE f.facet_key='packable')                       AS packable,
  MAX(f.value_json) FILTER (WHERE f.facet_key='treated_down')                   AS treated_down,
  MAX(f.value_json) FILTER (WHERE f.facet_key='upf_rating' )      #>> '{value}' AS upf,
  -- carry the "is this known?" flags so capabilities can refuse on unknown safety facets:
  bool_or(f.is_unknown) FILTER (WHERE f.facet_key='waterproofness')             AS waterproofness_unknown
FROM items i
LEFT JOIN item_facets f ON f.item_id = i.id
GROUP BY i.id, i.user_id;

-- A capability = a view selecting items whose facet predicate holds AND whose
-- safety-relevant inputs are known. Unknown ⇒ NOT satisfied (decision-drivers §5).
CREATE VIEW cap_rain_protection AS
SELECT item_id, user_id FROM v_item_scalar
WHERE waterproofness IN ('wp_breathable','wp_nonbreathable')
  AND waterproofness_unknown = false;        -- unknown never satisfies a safety capability

CREATE VIEW cap_wicking_base AS
SELECT item_id, user_id FROM v_item_scalar
WHERE layering_role ? 'base'                  -- jsonb array contains 'base' (GIN-backed)
  AND (moisture_management ? 'wicking_spread' OR moisture_management ? 'absorb_release');

CREATE VIEW cap_packable_insulation AS
SELECT item_id, user_id FROM v_item_scalar
WHERE (layering_role ? 'mid' OR layering_role ? 'shell')
  AND insulation_type IN ('down','synthetic','active_synthetic')
  AND packable = 'true'
  AND NOT (layering_role ? 'sleep_system');   -- exclude sleeping bags even if packable
```

The full canonical capability set (decision-drivers.md §4) — `rain_protection`, `wind_protection`, `breathable_shell`, `wicking_base`, `packable_insulation`, `wet_safe_insulation`, `sun_protection`, `sleep_warmth_adequate`, `travel_versatile` — is nine such views. **Adding `crampon_safe_footwear` is one `CREATE VIEW` reading `crampon_compat` rows.** That is the whole extensibility claim, demonstrated.

### 3.7 Indexing strategy (the "acceptable performance" recovery)

The EAV/JSONB design is only viable with the right indexes. Three layers:

1. **`item_facets(facet_key)` btree** — answers "give me every facet row for facet X" (the join key for every capability view). Cheap and always used.
2. **GIN on `value_json`** — answers multi-label containment (`value_json ? 'base'`, `value_json @> '["mid"]'`) for the `multi_label_enum` facets (`layering_role`, `body_zone_covered`, `function_purpose`, `activity_fit`, `terrain_fit`, …). This is exactly Postgres's strength; jsonb `?`/`@>` operators are GIN-accelerated.
3. **Partial expression btree per hot scalar facet** — e.g. `((value_json #>> '{}')) WHERE facet_key='waterproofness'`. A handful of these (waterproofness, breathability, insulation_type, temp_rating_standard) make the safety-critical scalar lookups index-only. Because they are *partial* (gated on `facet_key`), they are tiny and add negligible write cost.

For v0's data scale (single user, dozens of items, a seeded material catalog) even a sequential scan is sub-millisecond; the indexes are forward-looking for when the closet and material library grow. Capability **materialized views** with `REFRESH` on ingest convert the recommendation path from "join EAV at query time" to "select from a pre-pivoted row" — the migration cost from view → materialized view is a one-line change because the view definition is unchanged.

---

## 4. Classification target (evidence shape)

The LLM emits **a set of facet assignments**, each validated against the ontology before anything touches the DB. The contract: **unvalidated text never persists.** The pipeline runs in `src/core/` (no Next imports), so it can later back an MCP server.

### 4.1 The validated object the LLM emits, per item

```ts
// src/core/classification/schema.ts
import { z } from "zod";

const Confidence = z.enum(["high", "medium", "low", "unknown"]);
const Source = z.enum([
  "manufacturer_stated", "third_party_stated",
  "derived_from_composition", "llm_inferred", "user_confirmed", "unknown",
]);

// Provenance envelope shared by EVERY facet assignment.
const Envelope = z.object({
  confidence: Confidence,
  source: Source,
  evidence: z.string().nullable(),   // short quote or inference basis; null allowed, never fabricated
});

// A single facet assignment. value is unknown HERE — it is refined by the per-facet
// schema selected from the registry by facetKey (§4.2). isUnknown encodes "we don't know".
const FacetAssignment = Envelope.extend({
  facetKey: z.string(),
  value: z.unknown(),                // refined per-facet at validation time
  isUnknown: z.boolean().default(false),
});

export const ItemClassification = z.object({
  facets: z.array(FacetAssignment),
  materials: z.array(z.object({       // construction-role material links the LLM proposes
    role: z.enum(["shell","membrane","insulation","lining","fill","footbox","reinforcement"]),
    materialSlug: z.string(),         // matched/created against the material library
    confidence: Confidence,
    source: Source,
  })).default([]),
});
```

This is the shape produced via `@anthropic-ai/sdk` server-side with structured outputs — `client.messages.parse({ model: MODEL_ID, output_config: { format: zodOutputFormat(ItemClassification) }, … })` using `MODEL_ID = "claude-sonnet-4-6"` (the one config constant), adaptive thinking on. The SDK guarantees the response parses to `ItemClassification` *shape*; the second, semantic validation pass (§4.3) enforces the *ontology*.

### 4.2 Per-facet schemas keyed off the ontology (where type safety is recovered)

Each `value_kind` + `enum_levels` in `facet_definitions` generates a precise Zod refinement. A registry maps `facetKey → ZodType`:

```ts
// src/core/classification/facet-registry.ts
// Built at startup FROM facet_definitions rows — single source of truth, no drift.
export function buildFacetSchema(def: FacetDefinition): z.ZodTypeAny {
  switch (def.valueKind) {
    case "boolean":          return z.boolean();
    case "ordinal_enum":
    case "nominal_enum":     return z.enum(def.enumLevels as [string, ...string[]]);
    case "multi_label_enum": return z.array(z.enum(def.enumLevels as [string, ...string[]])).min(1);
    case "continuous":       return z.object({ value: z.number(), unit: z.literal(def.unit!) });
    case "structured":       return STRUCTURED_SCHEMAS[def.zodSchemaRef]; // e.g. fiber_components
  }
}
// fiber_components, temp_rating, etc. have hand-written structured schemas:
export const STRUCTURED_SCHEMAS = {
  "fiber_components@1": z.array(z.object({ fiber: z.string(), pct: z.number().min(0).max(100).nullable() })),
  "temp_rating@1":      z.object({ value: z.number(), unit: z.enum(["F","C"]) }),
};
```

Because the per-facet schema is derived from the same registry row that the DB validates against, the LLM's `value` for `waterproofness` is checked to be exactly one of `enum_levels`, `upf_rating.value` is a number with `unit:"UPF"`, `body_zone_covered` is a non-empty subset of its level set — **compile-time-style guarantees, enforced at validation time.** An out-of-vocabulary value (LLM hallucinates `waterproofness: "very_waterproof"`) fails this refinement and is rejected (§4.3).

### 4.3 Mapping into `item_facets` + the unvalidated-text barrier

```ts
// src/core/classification/ingest.ts  (server-only, no Next)
export async function ingestClassification(itemId, userId, raw: unknown, defs: FacetDefMap) {
  // 1. Structural validation — SDK already parsed, but re-assert at the boundary.
  const parsed = ItemClassification.parse(raw);

  // 2. Per-facet semantic validation against the ontology.
  const rows: NewItemFacet[] = [];
  for (const a of parsed.facets) {
    const def = defs.get(a.facetKey);
    if (!def || def.deprecated) continue;          // unknown/deprecated facet_key → DROP (no sprawl)
    if (a.isUnknown) {
      rows.push(unknownRow(itemId, userId, def));  // explicit null+unknown row (safety-relevant facets)
      continue;
    }
    const schema = buildFacetSchema(def);
    const r = schema.safeParse(a.value);
    if (!r.success) continue;                       // value off-vocabulary → DROP, never coerce
    // 3. HARD-FACT GUARD: hard facets may only come from a stated source, never inferred.
    if (def.factClass === "hard" && (a.source === "llm_inferred" || a.source === "unknown")) {
      rows.push(unknownRow(itemId, userId, def));   // demote a guessed hard fact to explicit unknown
      continue;
    }
    rows.push({
      itemId, userId, facetKey: def.facetKey, facetVersion: def.version,
      valueKind: def.valueKind, valueJson: r.data,
      confidence: a.confidence, source: a.source, evidence: a.evidence, isUnknown: false,
    });
  }
  // 4. Only validated rows reach the DB. The raw LLM text is discarded here.
  await db.insert(itemFacets).values(rows);
  await linkMaterials(itemId, parsed.materials);
}
```

The contract is mechanical: the only path from LLM output to `item_facets` runs through `ItemClassification.parse` → per-facet `safeParse` → hard-fact-source guard. Anything that fails is dropped (or demoted to an explicit unknown row), never written as free text. **Unvalidated text never reaches the DB or UI.** This implements material-behavior.md §5.5 (composition extracted as hard fact, behavior derived second, LLM only for non-standard cases, Zod-validated before storage, no guessed fill power) and decision-drivers.md §5 (unknown=null with confidence marker, never silently upgraded).

> **Derivation split:** §4 covers what the LLM *emits*. Deterministic derivations (cotton-kills inference chain — base-layers.md §7.1; weakest-link `wet_warmth_retention` — material-behavior.md §6.4; `protection_ceiling` roll-up — shells-wind.md §2.8) run as a second deterministic pass in `src/core/derive/` that reads stored hard facets + material links and writes `source: "derived_from_composition"` soft-facet rows. The LLM is invoked only for facets the composition table can't determine. This keeps derived facets consistent across items (computed once from the same rule) rather than re-inferred per LLM call.

---

## 5. Grouping as emergent queries

"The closet" is never a category lookup — every grouping is a query over facet rows. Four concrete examples (Drizzle-flavored; all read `v_item_scalar` or `item_facets` directly):

**(a) "My shells" — emergent, by behavior not label.** No `shell` table; select items whose `layering_role` array contains `shell`:
```sql
SELECT i.id, i.name FROM items i JOIN item_facets f ON f.item_id=i.id
WHERE i.user_id = :uid AND f.facet_key='layering_role' AND f.value_json ? 'shell';
```
The Terre Planing surfaces here (it *is* a shell-role piece) — but `cap_rain_protection` (§3.6) correctly *excludes* it, so "is a shell" and "provides rain protection" are different emergent queries, which is the whole point.

**(b) "Everything that warms my hands at ≤25°F" — zone × warmth cross-facet.** The accessory zone-gap query:
```sql
SELECT i.id, i.name FROM items i
WHERE EXISTS (SELECT 1 FROM item_facets f WHERE f.item_id=i.id AND f.facet_key='body_zone_covered' AND f.value_json ? 'hands')
  AND EXISTS (SELECT 1 FROM item_facets f WHERE f.item_id=i.id AND f.facet_key='warmth_level'
              AND (f.value_json #>> '{}') IN ('moderate','high','extreme'));
```

**(c) "Wet-safe insulation I own" — material-derived, via construction links.** Down-but-untreated is excluded by reading the derived row:
```sql
SELECT i.id, i.name FROM items i JOIN item_facets f ON f.item_id=i.id
WHERE i.user_id=:uid AND f.facet_key='wet_warmth_retention' AND (f.value_json #>> '{}') IN ('medium','high','very_high');
```
This row is derived (§4 note) from `insulation_type` + `treated_down` + construction-role materials, so synthetic and treated-down items group in, untreated 550FP duck down (the Kelty) groups out — emergent from facets, no rule in the query.

**(d) "Lifestyle-leaning layers for a casual trip" — the Query-D grouping.** Snap-T and Marsupial cluster here without a "lifestyle" category:
```sql
SELECT i.id, i.name FROM items i JOIN item_facets f ON f.item_id=i.id
WHERE i.user_id=:uid AND f.facet_key='use_context' AND (f.value_json #>> '{}') IN ('lifestyle','mostly_lifestyle')
  AND EXISTS (SELECT 1 FROM item_facets p WHERE p.item_id=i.id AND p.facet_key='packable' AND p.value_json='true'::jsonb);
```

Every "category" the UI ever shows is one of these queries. There is no place in the system where an item is *assigned to* a bucket.

---

## 6. Recommendation + gap analysis

### 6.1 Capability concept

A **capability** is a derived predicate (a view, §3.6) over facet rows; a **requirement set** is the capabilities a trip's condition envelope demands; a **recommendation** is the emergent join of inventory against the requirement set, partitioned into *picks* (items satisfying a capability), *gaps* (capabilities with zero satisfying items), and *partials* (items that would satisfy but for an unknown or below-threshold facet). The engine (`src/core/recommend/`) parses the query → condition envelope → required capability set, then for each capability `SELECT … FROM cap_X WHERE user_id=:uid`. Crucially, a capability view excludes items whose safety-relevant input is `isUnknown` (§3.6) — so an unverified jacket never produces a dangerous false-positive rain pick.

### 6.2 Walking the Marcy query against the exact 3-item inventory

**Query:** "Mount Marcy, mid-June, alpine summit, cold and windy, long day hike." **Envelope:** sustained cold (30-45°F summit), wind (30+ mph gusts above treeline), afternoon precip possible, high exertion on approach + cold static summit stop, day-pack (packability matters, no camping weight). **Required capabilities:** `rain_protection`, `wind_protection`, `breathable_shell`, `wicking_base`, `packable_insulation` (a base+mid+shell system — decision-drivers.md §6).

**Inventory & facet contributions:**

- **Patagonia Stretch Terre Planing Hoody** — `waterproofness=dwr_only` (confidence high, source manufacturer_stated), `wind_resistance=wind_resistant`, `breathability=high`, `moisture_management=["wicking_spread","dwr_face"]`, `dry_speed=very_fast`, `upf_rating={50?}` → stored as stated 40, `layering_role=["shell","standalone","system_base"]`, `protection_ceiling=light_spray`. **Contribution:** satisfies `breathable_shell` (it *is* a shell-role, breathable piece) and is a positive on the approach for breathable wind resistance. **Does NOT satisfy `rain_protection`** — `cap_rain_protection` requires `waterproofness ∈ {wp_breathable, wp_nonbreathable}`; `dwr_only` fails the predicate. Does NOT satisfy `wind_protection` at full confidence — `wind_resistant ≠ windproof` against 30+ mph gusts. **Net: usable as a breathable approach layer with an explicit "not waterproof, will wet out at the summit" warning; not the rain/wind shell this trip demands.**
- **Kelty Galactic 30** — `layering_role=["sleep_system"]`, `insulation_type=down`, `fill_power={value:550,unit:FP}`, `fill_species=duck`, `treated_down=null/isUnknown`, `temp_rating={value:30,unit:F}`, `temp_rating_standard=null/isUnknown` (the rating-standard danger, §7), `packable=true`. **Contribution: ZERO.** `cap_packable_insulation` explicitly excludes `layering_role ∋ sleep_system`, so the bag is never recommended as a worn mid-layer. It stays in the car.
- **Hemp/Cotton Henley** — `fiber_components=[{hemp,55},{cotton,45}]`, `moisture_management=["absorb_hold"]` (derived, cotton-kills chain), `wet_warmth_retention=very_low`, `dry_speed=slow`, `layering_role=["base"]`, `warmth_level=light`. **Contribution: role-correct, performance-wrong.** `cap_wicking_base` requires `moisture_management ∋ {wicking_spread, absorb_release}`; `absorb_hold` fails. **Net: NOT recommended; flagged as a hypothermia vector in cold wind when sweat-wet.**

**Engine output — recommendations:** NONE fully satisfy. Conditional partial: the Terre Planing *may* be suggested as a breathable approach layer over a (missing) wicking base, with the explicit caveat that it provides no rain/wind-shell protection at the summit.

**Three surfaced gaps (priority order):**

| # | Missing capability | Predicate that no item satisfies | Severity |
|---|---|---|---|
| 1 | **Waterproof / windproof shell** | no item: `waterproofness ∈ {wp_breathable,wp_nonbreathable}` AND `wind_resistance=windproof` | CRITICAL — trip-blocking; exposed summit |
| 2 | **Packable wearable insulation (mid)** | no item: `layering_role ∋ mid` AND `insulation_type ∈ {down,synthetic}` AND `packable=true` (bag excluded) | HIGH — cold static summit stop unsafe without it |
| 3 | **Wicking base layer** | no item: `layering_role ∋ base` AND `moisture_management ∋ {wicking_spread,absorb_release}` | HIGH — hemp Henley is a hypothermia risk on the descent |

Human-readable surface mirrors decision-drivers.md §2 exactly: "You have no waterproof shell for an exposed alpine summit; your Patagonia hoody is water-resistant and will wet out in rain or sustained mist." / "You have no packable insulation for the cold summit stop." / "Your only base layer is a hemp/cotton henley; cotton holds moisture and chills dangerously when wet — bring merino or synthetic." This is the canonical test, and the facet-graph model produces exactly these three gaps and no spurious recommendation.

---

## 7. Hard-case resolutions

Each case below is "what facet rows does the model assign", and why that produces the correct behavior. This is where the ROW model earns its keep.

**Terre Planing (water-resistant ≠ waterproof — the canonical danger).** Rows: `waterproofness = dwr_only` (NOT `water_resistant`, NOT `wp_breathable`; conf high, source manufacturer), `dwr_present = true`, `wind_resistance = wind_resistant`, `breathability = high`, `protection_ceiling = light_spray` (derived; capped because waterproofness is sub-membrane), `function_purpose = ["sun_protection","wind_protection","water_resistance"]` — note `water_resistance`, never `waterproof`. The capability view `cap_rain_protection` requires `waterproofness ∈ {wp_breathable, wp_nonbreathable}`, so `dwr_only` is structurally excluded. **It cannot be counted as rain protection** — the danger is designed out at the predicate level, not by a special-case `if`.

**The buff (multi-zone + multi-function — where the row model shines).** One item, rows: `body_zone_covered = ["neck","face","head"]`, `function_purpose = ["warmth","sun_protection","wind_protection","debris_filtration"]`, `layering_role = ["standalone","liner"]`, `upf_rating = {value:50,unit:"UPF"}`, `warmth_level = light`. Three independent emergent queries — "neck UV protection" (`body_zone_covered ? 'neck' AND function_purpose ? 'sun_protection'`), "head-warmth backup" (`body_zone_covered ? 'head' AND function_purpose ? 'warmth'`), "face wind block" (`body_zone_covered ? 'face' AND function_purpose ? 'wind_protection'`) — all retrieve the same row set, correct all three times. A column/category model would force "is this headwear or neckwear?"; the multi-label `value_json` arrays + GIN containment make all three true simultaneously with no gymnastics.

**Kelty "Galactic 30" (rating present, standard unknown).** Rows: `temp_rating = {value:30, unit:"F"}` (hard fact, conf high), `temp_rating_standard = null` with `isUnknown=true, confidence=low, evidence="marketing/season-style; EN 13537 cert not documented"`, `fill_power = {value:550,unit:"FP"}`, `fill_species=duck`, `treated_down = null/isUnknown`, `bag_shape=rectangular`, `wet_warmth_retention=very_low` (derived). The `temp_rating_standard` row being an *explicit unknown* (not a fabricated `EN13537_comfort`) is the anti-pattern guard from sleeping-bags.md §5.1/§7: `cap_sleep_warmth_adequate` treats an unknown standard conservatively and surfaces "rating is nominal — verify EN/ISO standard before trusting at 30°F." The number is stored; the unverified claim that it *means* EN-comfort-30 is refused.

**Hemp Henley (weak wet base layer).** Rows: `fiber_components=[{hemp,55},{cotton,45}]` (hard), then the cotton-kills derivation chain (base-layers.md §7.1) writes `moisture_management=["absorb_hold"]`, `wet_warmth_retention=very_low`, `dry_speed=slow`, `odor_resistance=low`, all `source: derived_from_composition, confidence: high`. `layering_role=["base"]` (role correct). `cap_wicking_base` excludes it (`absorb_hold ∉ {wicking_spread, absorb_release}`); the recommender flags it as dangerous in cold-wet, and groups it under casual/warm-dry use via `use_context`. No special case — the fiber facet drives everything.

**R1 Air (multi-role).** Rows: `insulation_type=fleece_grid`, `layering_role=["system_base","mid","outer_in_calm_dry","base_adjacent"]` (multi-label — all valid at once), `active_insulation_suitability=active`, `breathability=very_high`, `wind_resistance=air_permeable`, `moisture_management=["wicking_spread"]`, `next_to_skin_comfort=may_itch` (grid texture), `activity_fit=["alpine","ski_touring","climbing_active","trail_running"]`, `weight_g≈312`. A query for "aerobically breathable mid for ski touring" (`layering_role ? 'mid' AND active_insulation_suitability='active'`) finds it; a query for "warm belay jacket" (`active_insulation_suitability='static'`) correctly excludes it; it is *not* a wind shell (`air_permeable`) so it never satisfies `wind_protection`. The model never has to "decide" whether it's a base or a mid — it occupies both role values, and the trip query selects the relevant one.

---

## 8. Tradeoffs & weaknesses (honest self-assessment)

**Extensibility — the strongest dimension.** Adding a facet, a value level, a new domain (footwear, packs, accessories were each ~12-16 facets in Wave-1), or a new construction role is an `INSERT`/`CREATE VIEW`, never a table migration. A future MCP server reads the same `src/core/` registry. This is the design's reason to exist and it delivers cleanly.

**Type safety — recovered at validation time, lost at compile time. This is the central honest cost.** Drizzle gives `item_facets.valueJson: jsonb` — TypeScript sees `unknown`/`Json`, not "a waterproofness enum". The compiler will *not* catch a query that compares `waterproofness` against `'waterproff'`. I recover safety three ways: (1) per-facet Zod schemas generated from the registry validate every value at the ingest boundary, so no bad value persists; (2) a generated `FacetValue<K>` TypeScript mapped type (built from the registry at codegen time) gives typed accessors for reading facets in app code; (3) capability views centralize the string literals in one reviewed place. But it is genuinely weaker than a column-per-facet schema where `waterproofness` is a `pgEnum` the compiler enforces everywhere. **A competing "wide table / typed columns" architecture wins outright on compile-time safety; my mitigation narrows but does not close that gap.**

**Query ergonomics — the second real cost.** A naive facet query is verbose (`EXISTS (SELECT 1 FROM item_facets WHERE facet_key=… AND value_json ? …)` per predicate). I recover ergonomics with the `v_item_scalar` pivot view and capability views, so the recommendation engine writes `SELECT … FROM cap_rain_protection`, not raw EAV joins — but the *authoring* of those views still touches raw jsonb operators, and a multi-facet ad-hoc query a developer writes by hand is more error-prone than `WHERE waterproofness = 'wp_breathable'` on a typed column. Repository-layer helper functions (`facetEquals(key, val)`, `facetContains(key, member)`) blunt this.

**Query performance — acceptable, with caveats.** GIN on `value_json` handles multi-label containment well; partial expression btrees handle hot scalars. At v0 scale (one user, dozens of items) performance is a non-issue. The honest caveat: a query filtering on N scalar facets does N self-joins/EXISTS against `item_facets` unless it goes through `v_item_scalar`; the pivot view + materialized capability views are *mandatory* for ergonomic performance, which means a real (if modest) maintenance surface (refresh on ingest). A typed-column design needs none of that machinery.

**LLM-classification ergonomics — a genuine plus.** Emitting a flat array of `{facetKey, value, confidence, source, evidence}` is a natural shape for structured output, and the per-facet Zod schemas (derived from the registry) give the validator precise per-value enforcement. The hard-fact-source guard (§4.3) mechanically prevents the worst failure (a guessed fill power or fabricated EN rating persisting). One subtlety: the LLM must be prompted with the *current* facet vocabulary (the registry's keys + enum levels) so it emits in-vocab values; a stale prompt produces droppable values. This is a prompt-sync discipline, manageable but real.

**Ontology-governance risk — the biggest long-term threat, and inherent to the thesis.** "Adding a facet is just an INSERT" cuts both ways: nothing structurally stops two facets `waterproofness` and `water_proofing`, or `breathability`'s levels drifting between ingests, or the LLM inventing `layering_role: "midlayer"` vs `"mid"`. Mitigations: (1) `facet_definitions` is **closed and seeded** — only code-review adds rows, never the LLM or end users (the ingest path *drops* unknown keys, §4.3); (2) `facet_key` is a **controlled vocabulary** with a naming convention, reviewed like an API; (3) facets are **versioned** (`facet_key + version` PK), so changing an enum level is a new version with a `supersededBy` migration path, not a silent edit; (4) a CI lint asserts every `zod_schema_ref` resolves and every capability view references only live facet keys. Even so, this is the dimension where the architecture is most likely to rot under sloppy maintenance, and I rate it the weakest point.

**Other weaknesses, stated plainly:** (a) **referential integrity is convention, not FK** — `item_facets.facet_key` references `facet_definitions` but value-shape correctness is enforced by Zod at ingest, not by the DB, so a row inserted by a path that bypasses `ingest.ts` could be malformed (mitigate: all writes go through the repo layer; a CHECK-constraint-via-trigger could validate `value_kind` matches the def). (b) **unknown-vs-absent semantics add cognitive load** — every consumer must distinguish "no row" from "row with `isUnknown=true`", and getting this wrong reintroduces the false-positive-rain danger; it is correct but easy to misuse. (c) **derived facets must be recomputed** when their inputs change (a user later sets `treated_down=true` on the Kelty) — the derive pass must re-run, or `wet_warmth_retention` goes stale; this is a cache-invalidation problem a typed design with computed-at-read-time columns avoids. (d) **`v_item_scalar` enumerates hot facets explicitly** — it is itself a hand-maintained pivot, so a new hot scalar facet means editing the view; it is *not* fully schema-free at the ergonomics layer, only at the storage layer.

**Net:** this architecture maximizes extensibility and fidelity to "no categories" at a real, acknowledged cost in compile-time type safety, query ergonomics, and governance discipline. It is the right choice if Armarium expects to keep absorbing new domains and facets indefinitely (which Wave-1 strongly suggests) and is willing to pay for a governed registry + a validation-and-views recovery layer. It is the wrong choice if the facet set is expected to stabilize quickly, in which case a typed-column or hybrid design buys back the safety and ergonomics this one spends.
