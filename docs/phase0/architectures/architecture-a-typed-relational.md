# Architecture A — Typed Relational Core + Domain Extensions

> **Phase 0 — Layer 0 (Faceted Data Model) competing-architecture proposal.**
> **Thesis owner:** Architecture A (Postgres/Drizzle-native, maximally type-safe).
> **Status:** Standalone proposal. Written blind to Architectures B and C. Builds directly on the nine Wave-1 investigation artifacts in `docs/phase0/investigation/`.
> **Date:** 2026-06-19

---

## 1. Thesis & Rationale

**Thesis: the facet space is a *typed relational schema*, not a document blob.** Armarium's load-bearing facts — `waterproofness`, `moisture_management`, `layering_role`, `insulation_type`, `packable`, `wind_resistance`, `weight`, `activity_fit`, `condition_fit`, `technical_vs_lifestyle` — are the same handful of dimensions for every wearable item, queried thousands of times by the recommendation engine. The decision-driver investigation proved that a *small* set of facets is decisive across all queries (Section 3 of `decision-drivers.md`). When a facet set is that stable and that hot, the right home is **typed Postgres columns** with **Postgres enums** for the controlled vocabularies, not JSON. Compile-time guarantees (Drizzle's inferred row types), database-enforced enums, native indexes on `waterproofness` and `layering_role`, and Zod schemas that *mirror the columns one-to-one* together make the dangerous failure modes from Wave-1 — silently upgrading the Kelty "30" to an EN rating, treating the Terre Planing's DWR as rain protection — into things the type system and the database CHECK constraints actively resist.

**The structure mirrors the domain's own shape: a universal core + domain extensions.** Every item shares a universal facet layer (the ~12 cross-domain facets every Wave-1 domain agent independently re-derived). On top of that, each *domain group* (insulation, shells, sleep, footwear, packs, accessories) gets a strongly-typed extension table joined 1:1 to the item, holding only the facets that domain actually uses — `capacity_l` never appears as a perpetual `null` on a fleece (the explicit anti-pattern from `domain-packs.md` §6). Materials are a **normalized, reusable library** referenced through a **named-role construction** (shell / membrane / insulation / lining), exactly as `material-behavior.md` §3.3 recommends, so "merino behaves like this" is computed once and reused everywhere. Capabilities (`rain_protection`, `wicking_base`, `packable_insulation`) and gap analysis are **not stored** — they are pure functions in framework-agnostic `src/core/` that read typed facets at query time, so the same engine can later back an MCP server. The honest cost — *adding a facet or a domain requires a migration* — is, in this thesis, a feature: facets are safety-relevant and rare-to-change, and a reviewed `drizzle-kit` migration is exactly the gate a wrong-spec-is-worse-than-missing system wants. Multi-label facets that are small and closed (layering roles, body zones, functions) are modeled as **typed Postgres enum arrays** with GIN indexes; the one genuinely open many-to-many (item↔material via named role) is a real join structure. We pay migration discipline and buy correctness, queryability, and type-safety end to end.

---

## 2. Facet Ontology

Facets are grouped into **(A) Universal** (on every item), **(B) Material-derived** (live on the shared materials library, *projected* onto items), and **(C) Domain-specific** (live in per-domain extension tables). For each: meaning, value-space shape, multi-label?, universal/domain, hard-vs-soft, and unknown/confidence handling.

**Two global encoding rules** (applied to every facet below):

1. **Hard facts** (composition, fill power, stated weight, stated temp number, UPF when printed): stored as a typed nullable column. **Null when not stated. Never inferred.** A parallel `*_source` enum (`manufacturer_spec | third_party | user_provided | unknown`) records provenance. A wrong hard fact is unrecoverable (`material-behavior.md` §5.1), so the schema makes "I don't know" the cheap default.
2. **Soft / derived facets** (every behavioral ordinal, every protection ceiling, every activity tag): stored as `{ value, confidence, source, reasoning? }`. In this typed model that is **either** (a) three sibling columns `facet`, `facet_confidence`, `facet_source` for hot, indexed facets, **or** (b) a typed JSONB `Evidence<T>` object for cold facets — see §3.4 for the rule deciding which. `confidence ∈ {high, medium, low, unknown}`; `value` may itself be null with `confidence = unknown`.

### Group A — Universal Facets (typed columns on `items`)

| # | Facet | Meaning | Value-space shape | Multi-label? | Hard/Soft | Unknown/confidence handling |
|---|---|---|---|---|---|---|
| A1 | `waterproofness` | Mechanism & degree of liquid-water exclusion. **The single most safety-critical facet** (`decision-drivers.md` rank 1; `domain-shells-wind.md` §2.1). | **Ordered enum**: `none < dwr_only < water_resistant < wp_breathable < wp_nonbreathable` | No | Soft (membrane = hard sub-input) | `null` if unverified → fails any `rain_protection` query as a gap. **Never defaults to a positive value.** Confidence column required. |
| A2 | `wind_resistance` | Whether the fabric blocks moving air. Independent axis from A1. | **Ordered enum**: `air_permeable < wind_resistant < windproof` | No | Soft | `null` = unknown; conservative (does not satisfy `wind_protection`). |
| A3 | `breathability` | Moisture-vapor / heat egress under exertion (MVTR proxy). | **Ordinal 5-pt**: `very_low < low < moderate < high < very_high` | No | Soft (derived from material+construction) | Confidence `medium` typical; MVTR numbers are marketing → never stored as hard. |
| A4 | `moisture_management` | How the skin/face fabric handles liquid sweat. The mechanical basis of "cotton kills" (`domain-base-layers.md` F1). | **Multi-label enum set**: `{wicking_spread, absorb_release, absorb_hold, dwr_face}` | **Yes** | Soft (near-deterministic from fiber) | Cotton/hemp → `absorb_hold` at `high` confidence (auto-derived). `null` only if fiber unknown. |
| A5 | `warmth_when_wet` | Does the item retain insulation value saturated, or become a cold conductor? Safety signal. | **Ordinal 3-pt**: `collapses < neutral < retains_warmth` (+ `unaffected` for fleece) | No | Soft | Deterministic from fiber/fill; high confidence when composition known. |
| A6 | `layering_role` | Where the item sits in a layer system. **Structural** — without it the engine cannot build systems (`decision-drivers.md` §6, rank 3). | **Multi-label enum set**: `{base, base_adjacent, mid, active_insulation, outer_shell, softshell_midouter, standalone, sleep_system}` | **Yes** | Soft | Required for all wearables. Multi-label is mandatory (R1 Air case). |
| A7 | `insulation_type` | Fill/construction class. Highest-stakes branch in insulation (`domain-mid-insulation.md` §2.1). | **Enum**: `down \| synthetic \| fleece_grid \| fleece_pile \| fleece_sherpa \| hybrid_* \| none \| unknown` | No | Hard (class is stated) | `none` for non-insulating items; `unknown` only if genuinely ambiguous. |
| A8 | `packable` / `packability` | Compresses small enough to carry "just in case." Load-bearing across A, C, D (`decision-drivers.md` rank 5). | **Ordinal**: `non_packable < bulky < moderate < packs_small < packs_to_pocket` | No | Soft (hard if stuff-sack stated) | Unlabeled ⇒ engine treats as `bulky`/unknown; never assume `packs_small`. |
| A9 | `weight_grams` | Garment/item weight. Universal pack-weight input. | **Continuous** (int grams) + `weight_size_ref` (e.g. "M") | No | **Hard** | `null` if not stated; never fabricated. |
| A10 | `upf_rating` | UV protection factor. Load-bearing in sun queries (`domain-base-layers.md` F6). | **Numeric** (int) when printed; **else** ordinal enum `none < low_lt15 < good_15_29 < very_good_30_49 < excellent_50_plus` | No | Hard if stated; Soft if inferred | **Never assume 50+ from material.** `null + confidence=unknown` when unrated. |
| A11 | `activity_fit` | Activity contexts the item suits. Primary trip→item match facet across **all** domains (`domain-footwear.md` §6.5). | **Multi-label enum set**: `{alpine, trail_hiking, backpacking, ski_touring, trail_running, climbing_active, climbing_static, mountaineering, travel, casual, water_sports, camp_rest}` | **Yes** | Soft | Confidence reflects how explicit manufacturer language is. |
| A12 | `condition_fit` | Weather envelope the item is suited for (temp band + precip/wind tolerance). | **Multi-label enum set** of bands: `{extreme_cold, cold, cool, mild, warm, hot, wet, dry, windy, high_uv}` | **Yes** | Soft | Derived; `null`/empty if insufficient basis. |
| A13 | `technical_vs_lifestyle` | Performance-vs-casual orientation. Prevents recommending fashion gear for technical objectives (`domain-footwear.md` §6.3). | **Ordinal 5-pt**: `lifestyle < mostly_lifestyle < hybrid < mostly_technical < technical` | No | Soft | The facet most prone to inter-agent drift → calibrated with anchor items (R1 Air=technical, Snap-T=lifestyle, Nano Puff=hybrid). |
| A14 | `body_zone_covered` | Anatomical zones covered. **Globally load-bearing** for gap/overlap detection (`domain-accessories.md` §6, "the single most important cross-domain argument"). | **Multi-label enum set**: `{head, face, neck, torso, arms, hands, wrists, waist, legs, lower_leg, ankles, feet, eyes}` | **Yes** | Soft (structural for many) | Must exist on **every** item, not just accessories. Enables "no hand coverage at 10°F" gap. |
| A15 | `function_purpose` | What the item *does*, independent of what it is. Globally load-bearing multi-label (`domain-accessories.md` §2.2, §6). | **Multi-label enum set**: `{warmth, sun_protection, wind_protection, water_resistance, waterproof, moisture_mgmt, dexterity, eye_protection_uv, eye_protection_glare, debris_filtration, carry, gear_retention, layering_component, standalone_solution}` | **Yes** | Soft | A buff = `{warmth, sun_protection, wind_protection, moisture_mgmt}`. Resist over-assignment; class-level inferences = `medium`. |

### Group B — Material-Derived Facets (live on `materials`, projected onto items in `src/core`)

These are **not stored per item** (avoiding the re-derivation problem of `material-behavior.md` §3.3). They live once on the shared material record; `src/core` projects them onto the item through the named-role construction using the role-based precedence rules (`material-behavior.md` §6.4). Each is an `Evidence<Ordinal>` (value+confidence+source).

| # | Facet | Meaning | Value-space shape | Projection rule onto item |
|---|---|---|---|---|
| B1 | `dry_speed` | Time-to-dry after saturation. | Ordinal 5-pt `very_slow…very_fast` | Governed by **shell** material (outermost contacts air). |
| B2 | `wet_warmth_retention` | Loft/warmth retained wet. | Ordinal 5-pt | **Weakest link** across shell+insulation. Untreated down → `very_low`. |
| B3 | `warmth_for_weight` | Insulation per gram. | Ordinal 5-pt | Governed by **insulation** material if present, else shell. |
| B4 | `water_absorption` | Hydrophilicity. | Ordinal 5-pt | Shell material; overridden by DWR treatment / membrane. |
| B5 | `odor_resistance` | Days before odor problematic. | Ordinal 3-pt `low/medium/high` | Skin-contact layer (lining, else shell); upgraded by antimicrobial treatment. |
| B6 | `abrasion_resistance` | Durability vs. abrasion. | Ordinal 5-pt | Shell material. |
| B7 | `stretch` | Mobility. | Ordinal 3-pt `none/moderate/high` | Shell material (elastane → high). |
| B8 | `hand_comfort` | Next-to-skin softness / itch. | Ordinal 3-pt `scratchy/neutral/soft` | Skin-contact material; merino micron count drives it. |
| B9 | `material_packability` | Compressibility of the fabric/fill itself. | Ordinal 3-pt `bulky/moderate/excellent` | Insulation type primarily (down>synthetic>fleece). |
| B10 | `care_complexity` | Wash/care strictness. | Ordinal 3-pt `simple/moderate/delicate` | **Strictest** limit across all materials in construction. |

> **Why this split matters for the thesis.** B-facets are *derivable* from composition. Storing them per-item would mean two independent LLM calls could give two merino garments different `odor_resistance`. By normalizing them onto the material and projecting deterministically, identical materials behave identically *by construction* — the core benefit of a relational, normalized model (`material-behavior.md` §3.3, point 3).

### Group C — Domain-Specific Facets (typed columns in per-domain extension tables)

Only items in that domain group carry these; no perpetual nulls on unrelated items.

**C-shells (`item_shell_facets`)** — `domain-shells-wind.md`:

| Facet | Meaning | Shape | Hard/Soft | Unknown handling |
|---|---|---|---|---|
| `seam_sealing` | Taped/welded seams. Tie-breaker for waterproof claims. | Enum `none \| critical_seams \| fully_sealed` | Hard | `null` ⇒ assume not taped; caps `protection_ceiling`. |
| `dwr_presence` | DWR treatment + chemistry. | Enum `none \| present_standard \| present_c6 \| present_c8` | Hard | `null` ⇒ flag for review on softshell/dwr-activity items. |
| `hood_features` | Hood storm-worthiness. | **Multi-label enum set** `{fixed_hood, helmet_compatible, wire_brim, adjustment_points, draft_collar}` | Hard | Empty set = no hood. |
| `construction_type` | Hardshell/softshell/windshirt/dwr-activity. | Enum `hardshell_2l \| hardshell_2_5l \| hardshell_3l \| softshell \| windshirt \| dwr_activity_layer` | Hard | `null` if unknown. |
| `activity_fit_shell` | Static/active/versatile design intent. | Enum `static_only \| active_high_output \| versatile` | Soft | — |
| `protection_ceiling` | **Synthetic roll-up**: worst conditions credibly handled. The facet trip-planning queries first. | **Ordered enum** `light_spray < intermittent_rain < sustained_rain_low < sustained_rain_high < any_precipitation` | **Soft (derived)** | `null` if `waterproofness` is null (conservative null propagation, `domain-shells-wind.md` §7). Carries confidence + reasoning. |

**C-insulation (`item_insulation_facets`)** — `domain-mid-insulation.md` / shared `InsulationBehavior` (`domain-sleeping-bags.md` §4):

| Facet | Meaning | Shape | Hard/Soft | Unknown handling |
|---|---|---|---|---|
| `fill_power` | Loft per ounce (down). **Shared with sleeping bags.** | `int \| null` (550–950) | **Hard** | Never infer from brand/price. `null` if not stated. |
| `fill_species` | Duck/goose. | Enum `duck \| goose \| null` | Hard | `null` if unstated. |
| `fill_weight_g` | Grams of fill (not garment weight). | `numeric \| null` | Hard | Usually `null`; downgrades `warmth_to_weight` confidence. |
| `hydrophobic_treatment` | Down treated to resist water. | `boolean \| null` | Hard | **`null`, never `false`.** Absence ≠ untreated. |
| `wet_performance` | Behavioral wet outcome. | Enum `collapses_when_wet \| partially_retained \| largely_retained \| unaffected` | Soft (derived) | Down+untreated→collapses; synthetic→largely; fleece→unaffected. |
| `active_insulation_suitability` | Aerobic breathability. | Enum `active \| semi_active \| static` | Soft | high conf when type+breathability known. |
| `loft_category` | Worn thickness. | Ordinal `low/medium/high/very_high` | Soft | — |
| `warmth_category` | **Relative** warmth (NOT a temp number — jacket temp ratings are marketing, `domain-mid-insulation.md` §7.5). | Ordinal `low/moderate/high/very_high` | Soft | `medium` confidence; never a hard numeric. |

**C-sleep (`item_sleep_facets`)** — `domain-sleeping-bags.md`. Embeds the shared `InsulationBehavior` (above) plus sleep-only facets:

| Facet | Meaning | Shape | Hard/Soft | Unknown handling |
|---|---|---|---|---|
| `temp_rating_stated` | The printed number. | `int \| null` + `temp_rating_unit` enum `F \| C` | **Hard** (the number only) | Stored verbatim; **meaningless without the standard**. |
| `temp_rating_standard` | **WHICH protocol** produced it. The most critical soft facet in the domain. | Enum `EN13537_comfort \| EN13537_lower_limit \| EN13537_extreme \| ISO23537_* \| marketing \| season \| null` | **Soft** | **MUST be `null` if not ≥medium-confidence determinable. NEVER silently upgrade a marketing "30" to EN comfort.** Carries its own confidence + note. |
| `bag_shape` | Geometry. | Enum `mummy \| semi_rectangular \| rectangular \| quilt \| double` | Hard | — |
| `has_hood` | Integrated hood. | `boolean \| null` | Hard | `null` if unconfirmed. |
| `draft_collar`, `zipper_draft_tube` | Heat-loss baffles. | `boolean \| null` each | Hard | `null`. |
| `pad_r_value_recommended` | Companion-pad hint (system-level). | `numeric \| null` | Soft (rule-of-thumb) | `low` confidence always. |

**C-footwear (`item_footwear_facets`)** — `domain-footwear.md`:

| Facet | Meaning | Shape | Hard/Soft | Unknown handling |
|---|---|---|---|---|
| `support_stiffness` | Midsole/shank stiffness. | Ordinal 1–5 | Soft | medium. |
| `ankle_height` | Collar height. | Enum `low \| mid \| high` | Soft (high conf when clear) | — |
| `water_management` | Membrane vs fast-drain — a **tension, not a gradient**. | Enum `waterproof_membrane \| water_resistant_dwr \| fast_drain_breathable` | Hard (membrane), Soft (claims) | Never infer GTX from "waterproof." `unknown` if not stated. |
| `crampon_compat` | C0–C3 welt/shank support. **Highest-stakes null** (injury). | Enum `C0_none \| C1 \| C2 \| C3 \| unknown` | Hard | **Never infer from "mountaineering boot."** `unknown` if unstated. |
| `outsole_compound` | Rubber. | Enum (vibram_megagrip, continental, proprietary, unknown) | Hard (logo) | `unknown` without logo confirmation. |
| `terrain_fit` | Terrain envelope. | **Multi-label enum set** (road…glacier) | Soft | medium + reasoning. |
| `insulation_footwear` | Integrated warmth. | Enum `insulated_rated \| insulated_unrated \| uninsulated \| unknown` | Hard | — |
| `stack_height_mm`, `drop_mm` | Cushioning geometry. | `numeric \| null` each | Hard | `null`. |

**C-packs (`item_pack_facets`)** — `domain-packs.md`:

| Facet | Meaning | Shape | Hard/Soft | Unknown handling |
|---|---|---|---|---|
| `capacity_l` | Internal volume. First-cut filter. | `numeric \| null` | **Hard** | `null`+low conf if from category name only. |
| `pack_weight_g` | Empty pack weight. | `numeric \| null` | Hard | `null`. |
| `frame_type` | Structural skeleton. | Enum `frameless \| framesheet \| semi_rigid \| internal_aluminum \| internal_carbon \| external_frame` | Hard/Soft | `null`. |
| `suspension_system` | Load-transfer system. | Enum `none \| minimal \| framesheet \| aluminum_stay \| full_suspension` | Soft | medium. |
| `max_comfortable_load_kg` | Inferred load ceiling. | `numeric \| null` | Soft | **always low** confidence. |
| `access_style` | Opening + organization. | **Multi-label enum set** (top_load, panel_load, clamshell, roll_top, hip_pockets, tool_loops, hydration_sleeve…) | Soft | medium. |
| `hydration_compat` | Bladder support. | Enum `none \| sleeve_only \| sleeve_plus_port \| bladder_included` | Hard | — |
| `technical_features` | Ice-axe loops, ski carry, etc. | **Multi-label enum set** | Hard | empty = absent (high conf assume-absent). |

**C-accessories (`item_accessory_facets`)** — `domain-accessories.md`. Most accessory signal already lives in universal `body_zone_covered` / `function_purpose` / `warmth`-adjacent facets; this table holds only the genuinely accessory-specific:

| Facet | Meaning | Shape | Hard/Soft | Unknown handling |
|---|---|---|---|---|
| `warmth_level` | Insulation/heat retention (extremities). | Ordinal `none<minimal<light<moderate<high<extreme` | Soft | medium + source cite. |
| `dexterity_level` | Fine-motor preservation (gloves/mitts). | Ordinal `full<high<moderate<low<minimal` | Soft | only when `body_zone_covered ∋ hands`. |
| `accessory_layering_role` | standalone/liner/shell for the glove/hat system. | **Multi-label enum set** `{standalone, liner, shell, over_layer}` | Soft | enables glove-system completeness check. |
| `lens_category` | Sunglass lens cat. Safety-critical on glaciers. | Enum `category_1..4 \| uv400 \| null` + `polarized boolean` | Hard | `null` if unstated; "100% UV" → uv400 medium, category unknown. |
| `sock_cushion_zone` / `gaiter_height` | Sub-facets. | Enums | Hard/Soft | `null`. |

### Vanity facets (stored, never decision predicates)

`color`, `brand`, `model_name`, `purchase_price`, `year_purchased`, `gender_cut`, `country_of_manufacture`. These live as plain columns on `items` (display/insurance/filtering) and are explicitly excluded from capability predicates (`decision-drivers.md` §3, ranks 17–20).

---

## 3. Data Model — Drizzle / Postgres Schema

Design lives in framework-agnostic `src/core/db/schema.ts` (no Next imports — so `src/core` can later back an MCP server, per the load-bearing rule). All controlled vocabularies are **Postgres enums** (`pgEnum`) — DB-enforced, not just app-enforced. Multi-label small-closed sets are **enum arrays** with GIN indexes. The one open many-to-many (item↔material by role) is a structured set of FK columns.

### 3.1 Enums (representative subset)

```ts
// src/core/db/enums.ts
export const waterproofnessEnum = pgEnum("waterproofness", [
  "none", "dwr_only", "water_resistant", "wp_breathable", "wp_nonbreathable",
]); // ORDERED — the order is load-bearing for >= comparisons in capabilities
export const windResistanceEnum = pgEnum("wind_resistance",
  ["air_permeable", "wind_resistant", "windproof"]);
export const breathabilityEnum = pgEnum("breathability",
  ["very_low", "low", "moderate", "high", "very_high"]);
export const confidenceEnum = pgEnum("confidence",
  ["high", "medium", "low", "unknown"]);
export const sourceEnum = pgEnum("source",
  ["manufacturer_spec", "third_party", "derived_from_composition",
   "llm_inferred", "user_provided", "unknown"]);
export const layeringRoleEnum = pgEnum("layering_role",
  ["base", "base_adjacent", "mid", "active_insulation", "outer_shell",
   "softshell_midouter", "standalone", "sleep_system"]);
export const bodyZoneEnum = pgEnum("body_zone",
  ["head","face","neck","torso","arms","hands","wrists","waist",
   "legs","lower_leg","ankles","feet","eyes"]);
export const functionPurposeEnum = pgEnum("function_purpose",
  ["warmth","sun_protection","wind_protection","water_resistance","waterproof",
   "moisture_mgmt","dexterity","eye_protection_uv","eye_protection_glare",
   "debris_filtration","carry","gear_retention","layering_component",
   "standalone_solution"]);
export const itemDomainEnum = pgEnum("item_domain",
  ["apparel_insulation","apparel_base","apparel_shell","sleep","footwear",
   "pack","accessory"]); // routes which extension table(s) apply
// ...protectionCeilingEnum, insulationTypeEnum, tempStandardEnum, etc.
```

### 3.2 The universal `items` table

```ts
// src/core/db/schema.ts
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),            // EVERY user-owned table, from day 0
  // --- identity / vanity ---
  name: text("name").notNull(),
  brand: text("brand"),
  modelName: text("model_name"),
  itemDomain: itemDomainEnum("item_domain").notNull(), // selects extension table(s)
  color: text("color"),
  purchasePriceCents: integer("purchase_price_cents"),
  yearPurchased: integer("year_purchased"),

  // --- A1 waterproofness (hot facet → 3-column form) ---
  waterproofness: waterproofnessEnum("waterproofness"),          // null = unknown
  waterproofnessConfidence: confidenceEnum("waterproofness_confidence"),
  waterproofnessSource: sourceEnum("waterproofness_source"),
  // --- A2 wind_resistance ---
  windResistance: windResistanceEnum("wind_resistance"),
  windResistanceConfidence: confidenceEnum("wind_resistance_confidence"),
  // --- A3 breathability ---
  breathability: breathabilityEnum("breathability"),
  breathabilityConfidence: confidenceEnum("breathability_confidence"),
  // --- A5 warmth_when_wet ---
  warmthWhenWet: warmthWhenWetEnum("warmth_when_wet"),
  warmthWhenWetConfidence: confidenceEnum("warmth_when_wet_confidence"),
  // --- A7 insulation_type (hard) ---
  insulationType: insulationTypeEnum("insulation_type"),
  // --- A8 packability ---
  packability: packabilityEnum("packability"),
  packabilityConfidence: confidenceEnum("packability_confidence"),
  // --- A9 weight (hard) ---
  weightGrams: integer("weight_grams"),
  weightSizeRef: text("weight_size_ref"),
  weightSource: sourceEnum("weight_source"),
  // --- A10 upf (hard-if-stated; numeric + ordinal fallback) ---
  upfRatingNumeric: integer("upf_rating_numeric"),
  upfRatingOrdinal: upfOrdinalEnum("upf_rating_ordinal"),
  upfConfidence: confidenceEnum("upf_confidence"),
  upfSource: sourceEnum("upf_source"),
  // --- A13 technical_vs_lifestyle ---
  technicalVsLifestyle: techLifestyleEnum("technical_vs_lifestyle"),
  technicalVsLifestyleConfidence: confidenceEnum("tech_lifestyle_confidence"),

  // --- A4, A6, A11, A12, A14, A15: MULTI-LABEL enum arrays + a parallel
  //     confidence per facet (one confidence for the set; per-tag reasoning
  //     in the cold JSONB evidence blob if needed) ---
  moistureManagement: moistureMgmtEnum("moisture_management").array(),
  layeringRole: layeringRoleEnum("layering_role").array(),         // structural
  activityFit: activityFitEnum("activity_fit").array(),
  conditionFit: conditionFitEnum("condition_fit").array(),
  bodyZoneCovered: bodyZoneEnum("body_zone_covered").array(),      // GLOBAL
  functionPurpose: functionPurposeEnum("function_purpose").array(),// GLOBAL
  multiLabelConfidence: jsonb("multi_label_confidence")
    .$type<Record<string, "high"|"medium"|"low"|"unknown">>(),

  // --- cold/rare soft facets + per-tag reasoning: typed JSONB evidence ---
  softEvidence: jsonb("soft_evidence").$type<SoftEvidenceBag>(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("items_user_idx").on(t.userId),
  domainIdx: index("items_domain_idx").on(t.userId, t.itemDomain),
  // facet indexes for hot capability queries:
  waterproofIdx: index("items_waterproof_idx").on(t.userId, t.waterproofness),
  insulationIdx: index("items_insulation_idx").on(t.userId, t.insulationType),
  // GIN indexes for multi-label membership queries:
  layeringGin: index("items_layering_gin").using("gin", t.layeringRole),
  bodyZoneGin: index("items_bodyzone_gin").using("gin", t.bodyZoneCovered),
  functionGin: index("items_function_gin").using("gin", t.functionPurpose),
  activityGin: index("items_activity_gin").using("gin", t.activityFit),
}));
```

### 3.3 Materials library + named-role construction

The keystone of the thesis: materials are **shared, normalized, and reusable** (`material-behavior.md` §3.3). B-facets live here once. The item↔material link is a **structured construction** with named roles, not a weighted list (the explicit rejection in §3.2 of that doc).

```ts
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),     // "hemp-cotton-55-45", "down-550fp"
  displayName: text("display_name").notNull(),
  // --- HARD facts (composition) ---
  fiberComponents: jsonb("fiber_components")
    .$type<Array<{ fiber: string; pct: number | null }>>(),   // null pct = unlisted
  constructionType: text("construction_type"), // grid_fleece|pile_fleece|woven|knit|fill|membrane
  fillPowerFp: integer("fill_power_fp"),        // down only; null otherwise
  fillWeightGsm: numeric("fill_weight_gsm"),
  membraneType: text("membrane_type"),          // "Gore-Tex Pro" | null
  recycledContentPct: numeric("recycled_content_pct"),
  isOrganic: boolean("is_organic"),
  bluesignCertified: boolean("bluesign_certified"),
  // --- B-facets: each an Evidence<Ordinal> typed JSONB ---
  breathability: jsonb("breathability").$type<Evidence<Ordinal5>>(),
  drySpeed: jsonb("dry_speed").$type<Evidence<Ordinal5>>(),
  warmthForWeight: jsonb("warmth_for_weight").$type<Evidence<Ordinal5>>(),
  wetWarmthRetention: jsonb("wet_warmth_retention").$type<Evidence<Ordinal5>>(),
  odorResistance: jsonb("odor_resistance").$type<Evidence<Ordinal3>>(),
  abrasionResistance: jsonb("abrasion_resistance").$type<Evidence<Ordinal5>>(),
  waterAbsorption: jsonb("water_absorption").$type<Evidence<Ordinal5>>(),
  stretch: jsonb("stretch").$type<Evidence<Ordinal3>>(),
  handComfort: jsonb("hand_comfort").$type<Evidence<Ordinal3>>(),
  materialPackability: jsonb("material_packability").$type<Evidence<Ordinal3>>(),
  careComplexity: jsonb("care_complexity").$type<Evidence<Ordinal3>>(),
  // hard care limits:
  washTempMaxC: integer("wash_temp_max_c"),
  tumbleDrySafe: boolean("tumble_dry_safe"),
  dryCleanOnly: boolean("dry_clean_only"),
}, (t) => ({ slugIdx: uniqueIndex("materials_slug_idx").on(t.slug) }));

// Treatments are NOT materials (material-behavior.md §4): they wear off,
// have no intrinsic warmth/hand, and change surface interaction only.
export const treatments = pgTable("treatments", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),      // "dwr", "hydrophobic-down", "polygiene"
  displayName: text("display_name").notNull(),
  type: text("type").notNull(),               // surface_coating|fill_treatment|antimicrobial|uv
  waterproofEffect: boolean("waterproof_effect"),
  breathabilityEffect: text("breathability_effect"), // none|slight|moderate reduction
  wearsOff: boolean("wears_off"),
  refreshMethod: text("refresh_method"),
});

// NAMED-ROLE construction: one row per item, FKs into materials by role.
export const itemConstructions = pgTable("item_constructions", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  shellMaterialId: uuid("shell_material_id").references(() => materials.id),
  membraneMaterialId: uuid("membrane_material_id").references(() => materials.id),
  insulationMaterialId: uuid("insulation_material_id").references(() => materials.id),
  liningMaterialId: uuid("lining_material_id").references(() => materials.id),
});

// Treatments applied to an item, with zone + degradation state.
export const itemTreatments = pgTable("item_treatments", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  treatmentId: uuid("treatment_id").notNull().references(() => treatments.id),
  appliedZone: text("applied_zone"),   // shell | fill | all
  condition: text("condition"),        // factory_fresh | good | degraded | refreshed | null
}, (t) => ({ itemIdx: index("item_treatments_item_idx").on(t.itemId) }));
```

> **How confidence/source/unknown are physically stored.** Three physical mechanisms, one logical contract:
> - **Hard facts** → a typed nullable column (`fillPowerFp int`, `weightGrams int`) + a `*_source` enum. `null` = "not stated"; the value column is never written from inference.
> - **Hot soft facets** (waterproofness, breathability, …) → three sibling columns `facet` / `facet_confidence` / `facet_source`. Indexed; queryable in SQL (`WHERE waterproofness IN ('wp_breathable','wp_nonbreathable')`).
> - **Cold soft facets + B-facets + per-tag reasoning** → typed JSONB `Evidence<T> = { value: T | null; confidence; source; reasoning?; evidenceQuote? }`. Type-safe via Drizzle `.$type<…>()` and validated by the same Zod schema the LLM emits.

### 3.4 The hot-vs-cold rule (when columns, when JSONB)

A facet is stored as **typed columns** (hot) iff it is *either* (a) queried in a capability predicate that runs over the whole inventory (waterproofness, layering_role, insulation_type, body_zone, function_purpose, packability, weight, condition_fit, activity_fit), *or* (b) safety-critical (temp_rating_standard, crampon_compat). Everything else (B-facets, `reasoning` strings, rare accessory sub-facets) is **typed JSONB**. This keeps the indexed surface tight and the migration cadence low while preserving end-to-end types: JSONB is still `.$type<…>()`-annotated and Zod-validated.

### 3.5 Extension tables (1:1, domain-routed)

Each is keyed on `itemId` (PK = FK), joined 1:1, present only for items in that domain (`itemDomain` routes which). Sketch for two:

```ts
export const itemShellFacets = pgTable("item_shell_facets", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  seamSealing: seamSealingEnum("seam_sealing"),
  dwrPresence: dwrPresenceEnum("dwr_presence"),
  hoodFeatures: hoodFeatureEnum("hood_features").array(),
  constructionType: shellConstructionEnum("construction_type"),
  activityFitShell: shellActivityEnum("activity_fit_shell"),
  protectionCeiling: protectionCeilingEnum("protection_ceiling"),       // ORDERED
  protectionCeilingConfidence: confidenceEnum("protection_ceiling_confidence"),
  protectionCeilingReasoning: text("protection_ceiling_reasoning"),
}, (t) => ({ ceilIdx: index("shell_ceiling_idx").on(t.protectionCeiling) }));

export const itemSleepFacets = pgTable("item_sleep_facets", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  // shared InsulationBehavior (fill_*) lives in item_insulation_facets, joined too,
  // OR is duplicated as columns here — we choose a shared insulation table (see note).
  tempRatingStated: integer("temp_rating_stated"),       // the NUMBER only (hard)
  tempRatingUnit: tempUnitEnum("temp_rating_unit"),
  tempRatingStandard: tempStandardEnum("temp_rating_standard"),   // null unless ≥medium
  tempRatingStandardConfidence: confidenceEnum("temp_rating_standard_confidence"),
  tempRatingStandardNote: text("temp_rating_standard_note"),
  bagShape: bagShapeEnum("bag_shape"),
  hasHood: boolean("has_hood"),
  draftCollar: boolean("draft_collar"),
  zipperDraftTube: boolean("zipper_draft_tube"),
  padRValueRecommended: numeric("pad_r_value_recommended"),
});

// Shared InsulationBehavior table — used by BOTH insulated apparel and sleep
// (domain-sleeping-bags.md §4: "down is down"). 1:1 to items, present when
// insulation_type ∈ {down, synthetic, hybrid_*}.
export const itemInsulationFacets = pgTable("item_insulation_facets", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  fillPower: integer("fill_power"),               // hard, shared
  fillSpecies: fillSpeciesEnum("fill_species"),   // duck|goose|null
  fillWeightG: numeric("fill_weight_g"),
  hydrophobicTreatment: boolean("hydrophobic_treatment"),  // null ≠ false
  wetPerformance: wetPerformanceEnum("wet_performance"),
  activeInsulationSuitability: activeInsulEnum("active_insulation_suitability"),
  loftCategory: loftEnum("loft_category"),
  warmthCategory: warmthCatEnum("warmth_category"),         // relative, NOT a temp
});
```

> **Insulation sharing decision.** `InsulationBehavior` (fill_power, fill_species, hydrophobic_treatment, wet_performance, warmth_for_weight) is **one shared 1:1 table** (`item_insulation_facets`) joined to *both* sleeping bags and insulated jackets — honoring the Wave-1 consensus that "down is down" (`domain-sleeping-bags.md` §4, `domain-mid-insulation.md` §6.1). Sleep-only facets (`temp_rating_*`, `bag_shape`, draft baffles) live in `item_sleep_facets`. A sleeping bag therefore has rows in **both** `item_insulation_facets` and `item_sleep_facets`; a down jacket has a row only in `item_insulation_facets`. This is the relational expression of "shared insulation sub-model, divergent outer product."

### 3.6 Relations & indexing summary

- `items 1:1 item_constructions`, `items 1:1 item_{shell,insulation,sleep,footwear,pack,accessory}_facets`, `items 1:N item_treatments`.
- `item_constructions N:1 materials` (×4 role FKs); `item_treatments N:1 treatments`.
- **Indexes for facet/capability queries:** B-tree on `(user_id, waterproofness)`, `(user_id, insulation_type)`, `protection_ceiling`, `temp_rating_standard`; **GIN** on every enum-array facet (`layering_role`, `body_zone_covered`, `function_purpose`, `activity_fit`, `condition_fit`) so multi-label membership (`layering_role && '{shell}'`) is index-backed.

---

## 4. Classification Target (Evidence Shape)

The LLM emits **one validated object per item**, Zod-parsed in `src/core/classify/` **before** any DB write. **Contract: unvalidated text never persists.** The Zod schema *mirrors the columns* of §3 — same enum members, same null semantics — so a validated object maps field-for-field into `items` + extension tables via a pure mapper. The model id is read from **one config constant** (`MODEL_ID`, default `"claude-sonnet-4-6"`).

### 4.1 Generic evidence wrappers (mirror the storage contract)

```ts
// src/core/classify/evidence.ts
export const Confidence = z.enum(["high", "medium", "low", "unknown"]);
export const Source = z.enum([
  "manufacturer_spec","third_party","derived_from_composition",
  "llm_inferred","user_provided","unknown",
]);

// Soft facet: value may be null WITH confidence=unknown. Cross-field rule:
// if value === null then confidence must be "unknown".
export const Evidence = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: Confidence,
    source: Source,
    reasoning: z.string().max(280).optional(),
    evidenceQuote: z.string().max(280).optional(),
  }).refine(
    (e) => e.value !== null || e.confidence === "unknown",
    { message: "null value must carry confidence=unknown" },
  );

// Hard fact: a nullable scalar + a source. NO confidence field — a hard fact is
// either stated (source=manufacturer_spec) or null. The LLM cannot invent one.
export const HardFact = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({ value: valueSchema.nullable(), source: Source });
```

### 4.2 The per-item classification object

```ts
// src/core/classify/itemClassification.ts
export const ItemClassification = z.object({
  identity: z.object({
    name: z.string(), brand: z.string().nullable(),
    modelName: z.string().nullable(),
    itemDomain: z.enum(["apparel_insulation","apparel_base","apparel_shell",
                        "sleep","footwear","pack","accessory"]),
  }),

  // --- universal facets, each mirroring its column shape ---
  universal: z.object({
    waterproofness: Evidence(z.enum(
      ["none","dwr_only","water_resistant","wp_breathable","wp_nonbreathable"])),
    windResistance: Evidence(z.enum(["air_permeable","wind_resistant","windproof"])),
    breathability: Evidence(z.enum(["very_low","low","moderate","high","very_high"])),
    warmthWhenWet: Evidence(z.enum(["collapses","neutral","retains_warmth","unaffected"])),
    insulationType: HardFact(z.enum(
      ["down","synthetic","fleece_grid","fleece_pile","fleece_sherpa",
       "hybrid_down_fleece","hybrid_synthetic_fleece","hybrid_synthetic_stretch",
       "none","unknown"])),
    packability: Evidence(z.enum(
      ["non_packable","bulky","moderate","packs_small","packs_to_pocket"])),
    weightGrams: HardFact(z.number().int().positive()),  // null if not stated
    upf: z.object({                                      // numeric XOR ordinal
      numeric: z.number().int().nullable(),
      ordinal: z.enum(["none","low_lt15","good_15_29",
                       "very_good_30_49","excellent_50_plus"]).nullable(),
      confidence: Confidence, source: Source,
    }),
    technicalVsLifestyle: Evidence(z.enum(
      ["lifestyle","mostly_lifestyle","hybrid","mostly_technical","technical"])),
    // multi-label sets — each a set of enums + one set-level confidence
    moistureManagement: z.object({
      values: z.array(z.enum(["wicking_spread","absorb_release","absorb_hold","dwr_face"])),
      confidence: Confidence, source: Source }),
    layeringRole: z.object({
      values: z.array(z.enum(["base","base_adjacent","mid","active_insulation",
        "outer_shell","softshell_midouter","standalone","sleep_system"])).min(1),
      confidence: Confidence, source: Source }),
    activityFit: z.object({ values: z.array(z.string()), confidence: Confidence, source: Source }),
    conditionFit: z.object({ values: z.array(z.string()), confidence: Confidence, source: Source }),
    bodyZoneCovered: z.object({ values: z.array(z.enum(
      ["head","face","neck","torso","arms","hands","wrists","waist",
       "legs","lower_leg","ankles","feet","eyes"])), confidence: Confidence, source: Source }),
    functionPurpose: z.object({ values: z.array(z.string()), confidence: Confidence, source: Source }),
  }),

  // --- construction: materials by NAMED ROLE (slugs resolved/created in src/core) ---
  construction: z.object({
    shell: MaterialRef.nullable(),       // MaterialRef = { slug, displayName, fiberComponents,
    membrane: MaterialRef.nullable(),    //   constructionType, fillPowerFp, recycledPct, ...,
    insulation: MaterialRef.nullable(),  //   plus each B-facet as Evidence<Ordinal> }
    lining: MaterialRef.nullable(),
    treatments: z.array(z.object({
      slug: z.string(), appliedZone: z.string().nullable(),
      condition: z.enum(["factory_fresh","good","degraded","refreshed"]).nullable(),
    })),
  }),

  // --- exactly ONE domain block, discriminated by itemDomain ---
  domain: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shell"),
      seamSealing: HardFact(z.enum(["none","critical_seams","fully_sealed"])),
      dwrPresence: HardFact(z.enum(["none","present_standard","present_c6","present_c8"])),
      protectionCeiling: Evidence(z.enum(["light_spray","intermittent_rain",
        "sustained_rain_low","sustained_rain_high","any_precipitation"])),
      /* ...hoodFeatures, constructionType, activityFitShell... */ }),
    z.object({ kind: z.literal("sleep"),
      tempRatingStated: HardFact(z.number().int()),
      tempRatingUnit: z.enum(["F","C"]).nullable(),
      tempRatingStandard: Evidence(z.enum(["EN13537_comfort","EN13537_lower_limit",
        "EN13537_extreme","ISO23537_comfort","ISO23537_lower_limit","ISO23537_extreme",
        "marketing","season"])),   // value null + conf=unknown is the SAFE default
      fillPower: HardFact(z.number().int()),
      fillSpecies: HardFact(z.enum(["duck","goose"])),
      hydrophobicTreatment: HardFact(z.boolean()),  // null ≠ false
      /* ...bagShape, hasHood, draftCollar... */ }),
    z.object({ kind: z.literal("insulation"), /* fill_*, wet_performance, ... */ }),
    z.object({ kind: z.literal("footwear"),
      cramponCompat: HardFact(z.enum(["C0_none","C1","C2","C3"])), /* ... */ }),
    z.object({ kind: z.literal("pack"), /* capacity_l, suspension, ... */ }),
    z.object({ kind: z.literal("accessory"), /* warmth_level, dexterity, lens, ... */ }),
    z.object({ kind: z.literal("none") }),   // base layers etc. with no extra domain table
  ]),
});
export type ItemClassification = z.infer<typeof ItemClassification>;
```

### 4.3 Mapping into the schema + the persistence contract

1. **Generate** with `MODEL_ID` (config constant), tool/JSON-mode prompt that lists *only the facets for that item's domain* (domain-scoped prompts, per `domain-packs.md` §8 — better LLM quality than one bloated prompt).
2. **Parse** with `ItemClassification.safeParse`. On failure → reject, **nothing persists**, surface for retry. This is the hard wall: unvalidated text never reaches the DB.
3. **Resolve materials**: for each `MaterialRef`, upsert into `materials` by `slug` (seed catalog from `material-behavior.md` Appendix A; create new rows for unknown fabrics). B-facets land on the material row, validated by the same `Evidence` schema.
4. **Map** the validated object → typed inserts: `universal.*` → `items` columns; `Evidence.value/confidence/source` → the three sibling columns (hot) or JSONB (cold); `construction` → `item_constructions` FKs + `item_treatments`; the discriminated `domain` block → the matching extension table.
5. **Cross-field invariants enforced in Zod *and* mirrored as DB CHECK constraints**: e.g. `protection_ceiling` non-null ⇒ `waterproofness` non-null (null propagation); `temp_rating_standard='EN13537_comfort'` requires `confidence ∈ {high,medium}`; `fill_power` non-null ⇒ `insulation_type='down'`.

---

## 5. Grouping as Emergent Queries

No `category` column exists. "Closets" are SQL/Drizzle queries over the facet space. Four concrete examples (each a real Drizzle query, abbreviated):

**Q1 — "My wicking base layers" (NOT a category lookup; a moisture+role predicate).**
```sql
SELECT * FROM items
WHERE user_id = $1
  AND layering_role && ARRAY['base','base_adjacent']::layering_role[]   -- GIN
  AND moisture_management && ARRAY['wicking_spread','absorb_release']::moisture_management[]
  AND NOT (moisture_management && ARRAY['absorb_hold']::moisture_management[]);
```
The hemp Henley (`{absorb_hold}`) is correctly **excluded**; the Terre Planing (`{wicking_spread}`, role `{base, standalone}`) is **included**.

**Q2 — "Everything that protects against wind, by body zone" (cross-domain, multi-label).**
```sql
SELECT id, name, body_zone_covered FROM items
WHERE user_id = $1
  AND function_purpose && ARRAY['wind_protection']::function_purpose[];
```
Surfaces a windproof shell, a wind-resistant buff, *and* a softshell together — three domains, one query — because `function_purpose` + `body_zone_covered` are universal (`domain-accessories.md` §6).

**Q3 — "Packable insulation I could actually carry on a day hike."**
```sql
SELECT i.* FROM items i
JOIN item_insulation_facets f ON f.item_id = i.id
WHERE i.user_id = $1
  AND i.layering_role && ARRAY['mid','active_insulation']::layering_role[]
  AND i.insulation_type IN ('down','synthetic')
  AND i.packability IN ('packs_small','packs_to_pocket')
  AND i.layering_role && ARRAY['sleep_system']::layering_role[] = false; -- exclude bags
```
The Kelty (role `{sleep_system}`) is excluded even though it's packable — exactly the "wearable is implicit" rule (`decision-drivers.md` §4).

**Q4 — "Lifestyle-acceptable layers for a casual travel weekend."**
```sql
SELECT * FROM items
WHERE user_id = $1
  AND technical_vs_lifestyle IN ('lifestyle','mostly_lifestyle','hybrid')
  AND packability <> 'non_packable'
  AND activity_fit && ARRAY['casual','travel']::activity_fit[];
```
Surfaces the Synchilla Snap-T / Marsupial (lifestyle pile fleece) and down-ranks the R1 Air — emergent, no bucket.

> Each query is a typed Drizzle expression returning `InferSelectModel<typeof items>` — full compile-time row types, full index support, zero category enums.

---

## 6. Recommendation + Gap Analysis

### 6.1 Capability concept

A **capability** is a pure predicate function in `src/core/capabilities/` that reads typed facets and returns `{ satisfied: boolean; satisfiedBy: ItemId[]; partial: Array<{itemId, missing}>; confidenceFloor }`. Capabilities are **never stored** — they are computed at query time, so the same functions back the web app and (later) the MCP server. Canonical set (from `decision-drivers.md` §4), each expressed over §3 columns:

```ts
// src/core/capabilities/index.ts
export const rainProtection = (i: ItemFacets) =>
  ["wp_breathable","wp_nonbreathable"].includes(i.waterproofness ?? "")
  && i.waterproofnessConfidence !== "unknown"
  && (i.shell?.seamSealing !== "none");          // null seam ⇒ assume not taped
export const windProtection = (i: ItemFacets) =>
  i.windResistance === "windproof" || rainProtection(i);
export const breathableShell = (i: ItemFacets) =>
  i.layeringRole.includes("outer_shell") && ["high","very_high"].includes(i.breathability ?? "");
export const wickingBase = (i: ItemFacets) =>
  i.layeringRole.some(r => r==="base"||r==="base_adjacent")
  && i.moistureManagement.some(m => m==="wicking_spread"||m==="absorb_release");
export const packableInsulation = (i: ItemFacets) =>
  i.layeringRole.some(r => r==="mid"||r==="active_insulation")
  && ["down","synthetic"].includes(i.insulationType ?? "")
  && ["packs_small","packs_to_pocket"].includes(i.packability ?? "")
  && !i.layeringRole.includes("sleep_system");
export const sleepWarmthAdequate = (i: SleepFacets, lowF: number) =>
  i.tempRatingStandard != null && i.tempRatingStdConfidence !== "unknown"
  && convertToF(i.tempRatingStated, i.tempRatingUnit) <= lowF;     // null standard ⇒ NOT adequate
```

**The unknown-propagation rule is baked in:** any capability whose deciding facet has `confidence = unknown` returns `satisfied=false` and emits an "uncertain — verify" advisory rather than a false positive (`decision-drivers.md` §5). A `null` waterproofness can never satisfy `rainProtection`.

The engine: (1) parse trip → **condition envelope** (temp range, precip prob, intensity, duration, social context); (2) map envelope → **required capability set**; (3) for each capability scan inventory; (4) emit picks / partials / gaps and assemble a **layer system** (base→mid→shell), evaluating *system completeness* not just individual items (`decision-drivers.md` §6).

### 6.2 Walking the Marcy query against the exact 3-item inventory

Trip: *"Mount Marcy, mid-June, alpine summit, cold and windy, long day hike."* Condition envelope: sustained cold (30–45°F) + 30+ mph gusts above treeline + convective-storm precip possible + 8–12 hr, no resupply, day-pack volume. Required capability set: **`{rain_protection, wind_protection, breathable_shell, wicking_base, packable_insulation}`** (and a thermal-adequate layer system for a cold static summit stop).

Inventory facet values (as my model stores them):

| Item | Key stored facets | Capability reads |
|---|---|---|
| **Terre Planing Hoody** | `waterproofness=dwr_only` (conf high), `wind_resistance=wind_resistant`, `breathability=high`, `moisture_management={wicking_spread, dwr_face}`, `layering_role={base, standalone, softshell_midouter}`, `upf=40`, shell.`protection_ceiling=light_spray`, shell.`construction_type=dwr_activity_layer` | **FAILS** `rain_protection` (`dwr_only` ∉ {wp_breathable, wp_nonbreathable}; `protection_ceiling=light_spray` < `sustained_rain_low`). **PARTIAL** `wind_protection` (`wind_resistant`, not `windproof`). **Contributes** breathable wind-resistant approach layer / sun layer. |
| **Kelty Galactic 30** | `insulation_type=down`, insul.`fill_power=550`, `fill_species=duck`, `hydrophobic_treatment=null`, `wet_performance=collapses_when_wet`, `layering_role={sleep_system}`, `packability=packs_small`, sleep.`temp_rating_stated=30`, `temp_rating_standard=null (conf low)` | **Zero contribution** to a worn layer system: `packableInsulation` excludes it (`sleep_system` role). Not a wearable mid. (Were this a camping trip, untreated-down + wet would flag, and the unverified rating standard would force a conservative warning.) |
| **Hemp/Cotton Henley** | `moisture_management={absorb_hold}`, `warmth_when_wet=collapses`, `layering_role={base, standalone}`, `breathability=moderate`, material `dry_speed=slow` | **FAILS** `wicking_base` (`absorb_hold` ∉ wicking modes; `warmth_when_wet=collapses`). Actively flagged as a **hypothermia vector** in cold-wet wind. |

**Recommended picks from inventory:** **none fully satisfy** the trip. One **conditional partial**: the Terre Planing *may* be suggested as a breathable wind-resistant *approach* layer over a (missing) wicking base — **with an explicit warning** that it is not waterproof and will wet through at the summit in precipitation. No spurious recommendations.

**The 3 surfaced gaps** (exactly matching `decision-drivers.md` §2):

| # | Capability missing | Predicate violated (in my schema) | Severity |
|---|---|---|---|
| 1 | **Waterproof / windproof shell** | No item with `waterproofness ∈ {wp_breathable, wp_nonbreathable}` AND `wind_resistance='windproof'` (and `protection_ceiling ≥ sustained_rain_low`) | CRITICAL — trip-blocking |
| 2 | **Packable wearable insulation** | No item with `layering_role ∋ {mid, active_insulation}` AND `insulation_type ∈ {down, synthetic}` AND `packability ∈ {packs_small, packs_to_pocket}` (Kelty excluded: `sleep_system`) | HIGH — cold summit stop unsafe |
| 3 | **Wicking base layer** | No item with `layering_role ∋ {base}` AND `moisture_management ∩ {wicking_spread, absorb_release} ≠ ∅` (Henley fails: `absorb_hold`) | HIGH — hypothermia risk on descent |

Human-readable advisory (engine surface): *"No waterproof shell for an exposed alpine summit — your Terre Planing is water-resistant only (DWR) and will wet through in sustained rain or mist. No packable insulation for the cold summit stop. Your only base layer is a hemp/cotton henley, which holds sweat and chills dangerously in cold wind. Consider: a seam-sealed waterproof-breathable shell, a packable synthetic or treated-down mid, and a merino/synthetic wicking base."*

---

## 7. Hard-Case Resolutions

| Item | Facet values my model assigns | Why it resolves correctly |
|---|---|---|
| **Terre Planing** (water-resistant ≠ waterproof) | `waterproofness = dwr_only` (NOT `water_resistant`, NOT `wp_breathable`); shell.`protection_ceiling = light_spray`; shell.`construction_type = dwr_activity_layer`; shell.`dwr_presence = present_standard`; `function_purpose = {sun_protection, wind_protection, moisture_mgmt}` (**no `waterproof`, no `water_resistance`**) | `rain_protection` predicate requires `waterproofness ∈ {wp_breathable, wp_nonbreathable}` → DWR-only fails. The ordered enum + the `function_purpose` set both deny it rain credit. **Cannot** be recommended as rain protection. The canonical danger case is defeated at the type level. |
| **The buff** (multi-zone + multi-function) | `body_zone_covered = {neck, face, head}`; `function_purpose = {warmth, sun_protection, wind_protection, moisture_mgmt}`; `accessory_layering_role = {standalone, liner}`; `upf` per spec | Both globally-load-bearing facets are **enum arrays** with GIN indexes, so a neck-UV query, a head-warmth query, and a face-wind query each retrieve it — three queries, one item, all correct, no category gymnastics (`domain-accessories.md` §5). |
| **Kelty "Galactic 30"** (rating present, standard unknown) | sleep.`temp_rating_stated = 30`, `temp_rating_unit = F` (hard); sleep.`temp_rating_standard = null`, `…_confidence = low`, `…_note = "marketing/season-style; EN cert not documented"`; `fill_power=550`, `fill_species=duck`, `hydrophobic_treatment=null`, `wet_performance=collapses_when_wet` | The **number and the standard are separate columns**; a DB CHECK + Zod refinement forbids writing `EN13537_comfort` without ≥medium confidence. The "30" can never be silently upgraded to a manikin-tested rating. `sleepWarmthAdequate` returns false on a `null` standard → conservative, safe (`domain-sleeping-bags.md` §5.1, §7). |
| **Hemp Henley** (weak wet base) | `moisture_management = {absorb_hold}`, `warmth_when_wet = collapses`, material.`dry_speed = slow`, material.`wet_warmth_retention = very_low`, `odor_resistance = low`, `layering_role = {base, standalone}` — all auto-derived at `high` confidence from the cotton-dominant `fiber_components` (the deterministic "cotton kills" inference chain, `domain-base-layers.md` §7) | `wicking_base` fails (`absorb_hold`). Surfaced for warm-dry casual use, flagged as a liability for cold/wet. The facets do the work — no special-case code. |
| **R1 Air** (multi-role) | `insulation_type = fleece_grid`, insul.`active_insulation_suitability = active`, `wind_resistance = air_permeable`, `layering_role = {base_adjacent, mid, active_insulation, standalone}`, `breathability = very_high`, `moisture_management = {wicking_spread}`, `warmth_category = low`, `technical_vs_lifestyle = technical`, `function_purpose = {warmth, moisture_mgmt, layering_component}` | The **multi-label `layering_role`** lets one item be base-adjacent *and* mid *and* active-insulation. "Aerobically breathable mid for ski touring" finds it; "warm belay jacket" excludes it (`active`, low warmth). No enum forces a single bucket (`domain-mid-insulation.md` §5.1). |

---

## 8. Tradeoffs & Weaknesses (Honest Self-Assessment)

**Strengths.**
- **Type-safety end to end.** Postgres enums + Drizzle inferred types + Zod schemas that mirror columns mean an illegal `waterproofness` value cannot exist in the DB, the app, or the LLM output. The safety-critical failure modes (Kelty rating upgrade, Terre Planing rain credit) are blocked by CHECK constraints and ordered enums, not by convention.
- **Query ergonomics & performance.** Hot facets are indexed columns; multi-label facets have GIN indexes. Capability scans are index-backed SQL, not full-table JSONB traversals. This scales as inventories grow and as the recommendation engine runs many capability predicates per trip.
- **Materials normalization is "more correct, not a compromise"** (`material-behavior.md`, `domain-sleeping-bags.md` §4): identical fabrics behave identically by construction; one research update propagates everywhere.
- **No null noise.** Domain extension tables mean `capacity_l` never sits as a perpetual null on a fleece — the explicit anti-pattern is avoided structurally.

**Weaknesses (named honestly).**
- **Migration cost is the central tax.** Every new facet or new domain group requires a `drizzle-kit` migration *and* (for enums) an `ALTER TYPE … ADD VALUE`, which is non-transactional in older Postgres and can't remove a value cleanly. If the facet ontology is still churning in Layers 1–2, this is friction. **Mitigation / why acceptable:** facets are safety-relevant and Wave-1 showed the *decisive* set is small and stable; the `softEvidence` JSONB escape hatch absorbs experimental/rare facets without a migration until they earn promotion to a column. The migration gate is exactly the human review a wrong-spec-is-worse system wants.
- **LLM-classification ergonomics: the discriminated union is rigid.** The model must emit exactly one domain block matching `itemDomain`, and an item that genuinely spans two domain groups (a softshell with real insulation; an insulated boot) is awkward — it fits the *universal* facets fine but only one extension table. **Mitigation:** the shared `item_insulation_facets` table is join-not-route, so insulated items in *any* domain can carry it; truly hybrid pieces lean on the rich universal layer + JSONB. Still, this is the sharpest edge versus a schemaless approach.
- **Multi-label-with-confidence is lossy.** Storing one `confidence` per enum-array set (not per tag) is a deliberate simplification; per-tag confidence falls to the JSONB `multiLabelConfidence` map, which is *not* indexed. A query like "high-confidence wind_protection only" must filter in `src/core`, not SQL.
- **Three physical encodings for one logical contract (column-triple vs. JSONB-Evidence) is cognitive overhead** and a place for drift between what Zod enforces and what a column allows; it must be held in sync by the mapper and the CHECK constraints. The hot/cold rule (§3.4) is a judgment call that could be re-litigated.
- **Derived-facet projection is engine-resident, not stored.** Because B-facets are projected onto items at query time (not denormalized), a naive query that forgets to join `item_constructions → materials` sees an incomplete picture. The discipline lives in `src/core`; bypassing it (raw SQL) can mislead. A cached `item_computed_behavior` materialized view is a future option but adds invalidation complexity.
- **Ordered-enum comparisons depend on declaration order.** `waterproofness`/`protection_ceiling` comparisons (`>=`) rely on the enum's Postgres sort order matching semantic order. Correct today, but a careless future reordering would silently break capability predicates. Mitigated by encoding the order in one place and unit-testing the predicates.

**Weakest point, stated plainly:** if the facet ontology proves *unstable* during Layer 1/2 development, the migration-per-facet discipline that is this thesis's strength becomes its biggest drag, and the discriminated-union domain modeling will fight genuinely multi-domain items. The bet is that Wave-1 correctly identified a small, stable, safety-critical decisive facet set — and that bet is exactly where a JSONB-first competitor would push back.

---

*End of Architecture A proposal — Typed Relational Core + Domain Extensions.*
