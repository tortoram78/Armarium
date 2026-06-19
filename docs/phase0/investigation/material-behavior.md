# Material Behavior Investigation

**Phase 0 — Design/Discovery**
**Agent:** MATERIAL-BEHAVIOR investigation
**Date:** 2026-06-19

---

## 1. Material Behavioral Facet Set

A material profile is a named, reusable entity that describes a fabric, fill, or fiber blend. Its behavioral facets are divided into two tiers: **hard facts** (derived from composition, measurable) and **soft/derived** (inferred from composition + construction, confidence-marked).

### 1.1 Hard-fact facets (composition)

| Facet | Value space | Notes |
|---|---|---|
| `fiber_components` | Array of `{ fiber: string, pct: number \| null }` | Percentages must sum to ~100 if stated; null when unlisted |
| `fill_power_fp` | `integer \| null` | Down only (e.g. 550, 700, 850). Null for non-down |
| `fill_weight_gsm` | `number \| null` | Insulation g/m² for padded constructions |
| `membrane_type` | `string \| null` | e.g. "Gore-Tex Pro", "H2No", "eVent". Null if no membrane |
| `recycled_content_pct` | `number \| null` | 0–100; null when not stated |
| `bluesign_certified` | `boolean \| null` | |
| `is_organic` | `boolean \| null` | |

### 1.2 Soft/derived behavioral facets

Each soft facet carries: `value`, `confidence` (`high | medium | low`), `source` (`manufacturer_stated | derived_from_composition | llm_inferred | unknown`).

| Facet | Value space | Rationale |
|---|---|---|
| `breathability` | Ordinal 5-point: `very_low \| low \| medium \| high \| very_high` | Determinable from fiber hydrophilicity + construction |
| `dry_speed` | Ordinal 5-point: `very_slow \| slow \| medium \| fast \| very_fast` | Driven by fiber hydrophobicity + gsm |
| `warmth_for_weight` | Ordinal 5-point: `very_low \| low \| medium \| high \| very_high` | Driven by loft, fill power, fiber insulation |
| `wet_warmth_retention` | Ordinal 5-point (same) | Critical safety property: wool/synthetic fill retain; cotton/down collapse |
| `odor_resistance` | Ordinal 3-point: `low \| medium \| high` | Wool high; natural antibacterials high; synthetic low |
| `abrasion_resistance` | Ordinal 5-point | Nylon > polyester > wool > cotton |
| `water_absorption` | Ordinal 5-point: `very_low \| low \| medium \| high \| very_high` | Inverse of hydrophobicity |
| `stretch` | Ordinal 3-point: `none \| moderate \| high` | Elastane blends = high; most wovens = none |
| `hand_comfort` | Ordinal 3-point: `scratchy \| neutral \| soft` | Subjective but correlated with fiber type (merino soft, hemp stiff) |
| `packability` | Ordinal 3-point: `bulky \| moderate \| excellent` | Down/synthetics compress; fleece does not |
| `care_complexity` | Ordinal 3-point: `simple \| moderate \| delicate` | Wool = delicate; poly = simple |
| `wash_temperature_max_c` | `integer \| null` | Hard limit when manufacturer-stated |
| `dry_clean_only` | `boolean \| null` | |
| `tumble_dry_safe` | `boolean \| null` | |

### 1.3 Design notes on value spaces

- **Ordinal over numeric**: Behavioral properties like "dry speed" are not measured with a consistent industry metric across all fabrics; ordinal positions avoid false precision.
- **No composite "score"**: Facets are kept separate so the recommendation layer can weight them per-trip context (e.g., wet warmth retention matters more for a rainy alpine trip than a desert hike).
- **The value-space for `fiber_components` is the keystone**: every soft behavioral facet is principally derived from the fiber identity and blend ratios in `fiber_components`.

---

## 2. Composition → Behavior Mapping

### 2.1 Core fiber behavior table

| Fiber | Breathability | Dry Speed | Warmth-for-weight | Wet-warmth retention | Odor resistance | Abrasion | Water absorption | Notes |
|---|---|---|---|---|---|---|---|---|
| **Merino wool** | high | slow | medium | high | high | low | high | Scales of cuticle trap air; antibacterial lanolin; felts if agitated hot |
| **Polyester (filament)** | medium | very_fast | low | medium | low | medium | very_low | Hydrophobic; wicks but doesn't absorb; odor bacteria colonize surface |
| **Polyester (fleece/pile)** | high (grid) / low (pile) | fast | medium–high | medium | low | medium | low | Construction matters enormously — see §2.3 |
| **Nylon (PA6/PA66)** | medium | fast | very_low | low | low | very_high | low | Strongest abrasion fiber; common in shell/reinforcement zones |
| **Cotton** | medium | very_slow | very_low | very_low | medium | low | very_high | Hydrophilic; loses all insulation when wet; the "cotton kills" failure mode |
| **Hemp** | medium | slow | very_low | very_low | medium | medium | high | Similar wet profile to cotton; stiffer hand; more durable than cotton |
| **Down (untreated)** | n/a | n/a | very_high | very_low | low | n/a | very_high | Fill, not fabric; lofts collapse when wet; worst-case wet failure |
| **Down (hydrophobic-treated)** | n/a | n/a | very_high | medium | low | n/a | low | Treatment buys ~30–60 min water-resistance, not indefinite |
| **Synthetic insulation (PrimaLoft, Thinsulate, etc.)** | n/a | n/a | high | high | medium | n/a | low | Polyester-based; insulates wet; heavier and less compressible than down |
| **Elastane/Lycra** | medium | fast | very_low | low | low | low | very_low | Never used alone; blended at 2–15% for stretch; changes drape, not warmth |
| **Organic cotton** | medium | very_slow | very_low | very_low | medium | low | very_high | Same profile as conventional cotton; benefit is sustainability, not performance |

### 2.2 Seed corpus analysis

#### 2.2.1 Hemp/Cotton Henley — 55% Hemp / 45% Organic Cotton

- **Composition (hard fact):** 55% hemp, 45% organic cotton
- **Why it is a weak cold/wet base layer:**
  - Both hemp and cotton are cellulosic (hydrophilic) fibers with high water absorption
  - Neither fiber has meaningful insulation loft when saturated — wet warmth retention is `very_low` for both
  - Dry speed is `slow` (hemp) to `very_slow` (cotton); the blend lands at `slow`
  - Cotton dye processes make cotton still more hydrophilic; hemp is marginally stiffer but equally wet-dead
  - "Cotton kills" applies here with near-full force: soaked in cold rain or sweat, this garment wicks heat away and provides no warmth buffer
  - **Derived profile:** breathability `medium`, dry speed `slow`, wet warmth retention `very_low`, water absorption `high`
  - **The only scenarios where it is appropriate**: sedentary warm-weather use, casual everyday (not outdoor activity)
  - **What it does well**: sustainability credentials (organic cotton + hemp), comfort hand, lower environmental footprint — these matter but are orthogonal to cold/wet safety

#### 2.2.2 Patagonia Terre Planing Board Shorts — 100% Recycled Polyester + DWR

- **Composition (hard fact):** 100% recycled polyester
- **Recycled content (hard fact):** 100%
- **DWR:** treatment (not a material fiber — modeled separately, see §4)
- **Derived profile:** dry speed `very_fast`, water absorption `very_low`, abrasion resistance `medium`, odor resistance `low`, breathability `medium`, warmth-for-weight `very_low`
- **Confidence:** `high` for dry speed and water absorption (well-established polyester behavior); `medium` for breathability (depends on weave tightness not given)
- **Key point:** the DWR is a surface treatment that degrades with washing and abrasion; it cannot be part of the fiber facet — it is a separate `treatment` entity with a `durability` property (§4)

#### 2.2.3 Patagonia R1 Air — Polartec Power Air (poly grid fleece)

- **Composition:** polyester (grid/gridded fleece construction — confirmed Polartec Power Air)
- **Construction matters here critically**: grid/pointelle construction = high air permeability = high breathability — this is a structural property, not a fiber property alone
- **Derived profile:** breathability `very_high`, warmth-for-weight `medium`, dry speed `fast`, odor resistance `low`, water absorption `low`
- **Note on construction:** the behavioral modifier "grid construction → high breathability" is a material-level construction note, not an item-level override. The material record for this specific fabric captures it.
- **Use case derivation:** best suited as an active mid/base hybrid when breathability is paramount; not a static warmth layer

#### 2.2.4 Patagonia Synchilla Snap-T — poly pile fleece

- **Composition:** polyester pile fleece (Synchilla = Patagonia's house pile fleece, typically recycled poly)
- **Construction:** pile = higher loft than grid = more trapped air = more warmth, less breathability
- **Derived profile:** breathability `low`, warmth-for-weight `high`, dry speed `fast`, odor resistance `low`, water absorption `low`
- **Contrast with R1 Air:** same base fiber (polyester) but opposite breathability and warmth profile because of construction — reinforces why construction type is a material-record property, not just fiber identity

#### 2.2.5 Kelty 550 Fill Power Down Sleeping Bag

- **Fill power (hard fact):** 550 FP
- **Fill composition:** down (species/percentage not stated → null)
- **Shell composition:** not specified in seed data → null
- **Treatment:** not stated; assume untreated unless marked
- **Derived fill profile:** warmth-for-weight `high` (550 FP is entry-level performance down; lower than 700–900 FP bags but still far above synthetic), packability `excellent`, wet warmth retention `very_low` (untreated down), odor resistance `low`
- **Note:** 550 FP is the fill material. The shell fabric is a separate material record. The sleeping bag's item construction record links both.

### 2.3 Grid fleece vs pile fleece: the construction modifier

| Construction | Breathability | Warmth | Water absorption |
|---|---|---|---|
| Grid/pointelle fleece | very_high | medium | low |
| Pile fleece | low–medium | high | low |
| Stretch woven poly | medium | low | very_low |

**This shows that fiber alone is insufficient** — construction type belongs on the material record, not just fiber identity.

---

## 3. Item ↔ Material Relationship Model

### 3.1 The four construction cases

| Case | Example | Challenge |
|---|---|---|
| A — Simple single-fabric tee | Hemp/Cotton Henley | One fabric, no layers |
| B — Blend | Same Henley (55/45) | Blend IS the material record; percentages live in `fiber_components` |
| C — Down jacket | Kelty bag; any insulated jacket | Face fabric (a material) + DWR treatment + down fill (another material) + lining (another material) |
| D — 3-layer hardshell | Gore-Tex Pro jacket | Outer face fabric + membrane layer + inner backer/lining, all bonded |

### 3.2 Options considered

**Option 1: One material per item**
- Works for Case A. Fails Cases C and D entirely — silently loses insulation properties or membrane identity.
- REJECTED.

**Option 2: Weighted material list per item**
```
item.materials = [
  { material_id: "hemp-cotton-55-45", weight_pct: 100 }
]
```
- Handles blends by putting percentages inside the material record's `fiber_components`, not here
- But for a down jacket, how do you weight "30% shell fabric, 70% insulation"? Weight by mass? Volume? Neither maps to behavior.
- REJECTED — weight percentages are semantically wrong for multi-layer constructions.

**Option 3: Structured construction (named roles)**
```
item.construction = {
  shell:       { material_id: "recycled-poly-woven" },
  membrane:    { material_id: "gore-tex-pro" },          // or null
  insulation:  { material_id: "down-550fp" },             // or null
  lining:      { material_id: "recycled-poly-taffeta" }, // or null
  treatments:  [{ treatment_id: "dwr", zone: "shell" }]
}
```
- Handles all four cases
- Each named slot maps to a behavioral role that the recommendation layer understands
- A simple tee: only `shell` is populated, rest null
- A down jacket: `shell` + `insulation`, `membrane` null
- A 3-layer hardshell: `shell` + `membrane` + `lining`, `insulation` null
- RECOMMENDED — see §3.3

### 3.3 Recommended design: Structured construction referencing a shared material library

**Architecture:**

```
materials (shared library table)
  id: uuid
  slug: string                  // e.g. "merino-18.5-micron", "recycled-poly-grid-fleece"
  display_name: string
  fiber_components: jsonb       // [{ fiber, pct }]
  construction_type: string | null  // "grid_fleece" | "pile_fleece" | "woven" | "knit" | "fill" | "membrane"
  fill_power_fp: int | null
  fill_weight_gsm: float | null
  recycled_content_pct: float | null
  is_organic: bool | null
  bluesign_certified: bool | null
  // Derived behavioral facets (all with confidence+source):
  breathability: { value, confidence, source }
  dry_speed: { value, confidence, source }
  warmth_for_weight: { value, confidence, source }
  wet_warmth_retention: { value, confidence, source }
  odor_resistance: { value, confidence, source }
  abrasion_resistance: { value, confidence, source }
  water_absorption: { value, confidence, source }
  stretch: { value, confidence, source }
  hand_comfort: { value, confidence, source }
  packability: { value, confidence, source }
  care_complexity: { value, confidence, source }
  wash_temperature_max_c: int | null
  tumble_dry_safe: bool | null
  dry_clean_only: bool | null

item_constructions (one per item, embedded or separate table)
  item_id: uuid (FK → gear_items)
  shell_material_id: uuid | null (FK → materials)
  membrane_material_id: uuid | null (FK → materials)
  insulation_material_id: uuid | null (FK → materials)
  lining_material_id: uuid | null (FK → materials)
  // treatments handled separately (§4)

treatments_on_items (join table)
  item_id: uuid
  treatment_id: uuid (FK → treatments)
  applied_zone: "shell" | "all" | "fill" | ...
  condition: "new" | "degraded" | "refreshed" | null
```

**Why a shared library (normalized), not per-item embedded:**

1. **Derive behavior once, reuse everywhere.** Merino wool behavior is computed once in the `materials` row and reused by every merino garment. If new research refines the odor resistance score for merino, one update propagates everywhere.
2. **Consistency**: Two items made of "Patagonia Capilene Cool" polyester share the same material record — their dry speed and breathability are consistent by construction, not by coincidence of two independent LLM calls.
3. **The "derive item behavior from material" benefit is only achievable if the material is a first-class shared entity.** Per-item embedding makes this derivation a re-derivation.
4. **Catalog seeding**: the canonical material library can be seeded once with known fabrics (merino, recycled poly, nylon 6.6, etc.) and items reference them; unknown items get a new material record created during ingest.

**How the four cases are handled:**

| Case | Construction record | Notes |
|---|---|---|
| A — Hemp/Cotton Henley | `shell = hemp-cotton-55-45`, rest null | Single material covers it |
| B — 55/45 blend | Same as A; percentages live in `materials.fiber_components` | Blend = one material record with two fiber_components entries |
| C — Down jacket | `shell = recycled-poly-woven`, `insulation = down-550fp`, `membrane` null | Each slot references a separate material; behavioral derivation combines shell + fill profiles |
| D — 3-layer hardshell | `shell = face-fabric`, `membrane = gore-tex-pro`, `lining = tricot-backer` | Three material records; system knows membrane → waterproof = true |

---

## 4. Coatings, Treatments, and Membranes

### 4.1 Why treatments are not materials

A DWR coating is applied to a fabric's surface. It:
- Wears off (state changes over time/washes)
- Does not change the fiber's intrinsic behavior, only its surface interaction with water
- Can be reapplied (Nikwax, Grangers)
- Is meaningless as a "fiber" — it has no breathability, no warmth, no hand feel on its own

A membrane (Gore-Tex, eVent, H2No) is a distinct layer bonded to fabric. It:
- Has its own behavioral properties (waterproofness rating, breathability rating)
- IS a material in the sense that it has fiber/polymer identity and behavioral properties
- Gets its own `materials` row with `construction_type = "membrane"`
- Tracked in `item_constructions.membrane_material_id`

### 4.2 Treatment model

```
treatments (shared library)
  id: uuid
  slug: string              // "dwr", "hydrophobic-down-treatment", "antimicrobial-silverescent"
  display_name: string
  type: "surface_coating" | "fill_treatment" | "antimicrobial" | "uv_protective"
  waterproof_effect: bool
  breathability_effect: "none" | "slight_reduction" | "moderate_reduction"
  wears_off: bool           // DWR = true; antimicrobial fused to fiber = false
  refresh_method: string | null  // "tumble dry low", "wash with Nikwax TX.Direct", null

treatments_on_items (join table — see §3.3)
  item_id: uuid
  treatment_id: uuid
  applied_zone: "shell" | "fill" | "all"
  condition: "factory_fresh" | "good" | "degraded" | "refreshed" | null
```

**Key behaviors:**

- **DWR on shell**: `waterproof_effect = true`, `wears_off = true`. The recommendation layer can flag "DWR may need refreshing" if `condition = "degraded"` and the trip is wet.
- **Hydrophobic down treatment** (e.g. Nikwax Down, Allied Feather DownTek): `type = "fill_treatment"`, `wears_off = true`, upgrades effective `wet_warmth_retention` from `very_low` to `medium` for the item — but this upgrade is on the item's computed profile, not on the underlying material record (the base down material remains `very_low`).
- **Antimicrobial treatments** (Polygiene, Silvadur): `wears_off = false` (fused), effectively upgrades `odor_resistance` facet for the item.

### 4.3 Item-level behavioral overrides from treatments

Treatments produce **item-level overrides** on top of material-derived facets:

```
item_computed_behavior (derived, not stored unless cached)
  wet_warmth_retention = max(shell_material.wet_warmth_retention, 
                              treatment_boost_if_hydrophobic_down)
  water_resistance = true  // if DWR treatment present and condition != "degraded"
  odor_resistance = max(material.odor_resistance, 
                         treatment_boost_if_antimicrobial)
```

This derivation happens at read time (or cached on write). The treatment does not mutate the material library.

---

## 5. Confidence and Provenance Rules

### 5.1 Hard-fact vs soft-fact boundary

| Property class | Examples | Rule |
|---|---|---|
| **Hard fact** | `fiber_components`, `fill_power_fp`, `recycled_content_pct` | Null when not stated. Never inferred. Only set from manufacturer-stated data. A wrong composition is unrecoverable. |
| **Soft/derived** | All behavioral facets | Always carry `{ value, confidence, source }`. Never null the value field when derivable from composition — but confidence drops accordingly. |

### 5.2 Confidence levels

| Level | When to use |
|---|---|
| `high` | Manufacturer-stated AND cross-checkable (e.g. "100% polyester → dry speed fast" is near-deterministic) |
| `medium` | Derived from composition with well-established fiber science, but construction or blend ratio introduces uncertainty |
| `low` | Inferred from partial data (unknown blend %, non-standard fiber, ambiguous construction) |

### 5.3 Source markers

| Source | When |
|---|---|
| `manufacturer_stated` | The spec sheet / label / brand website explicitly states this value |
| `derived_from_composition` | Computed from fiber_components using the fiber behavior table (§2.1); fully automated |
| `llm_inferred` | LLM classified it from a product description without explicit composition; must flag confidence appropriately |
| `unknown` | No basis for inference; value = null for soft facets only |

### 5.4 Concrete example — Hemp/Cotton Henley facets

```json
{
  "fiber_components": [
    { "fiber": "hemp", "pct": 55 },
    { "fiber": "organic_cotton", "pct": 45 }
  ],
  "dry_speed": {
    "value": "slow",
    "confidence": "high",
    "source": "derived_from_composition"
  },
  "wet_warmth_retention": {
    "value": "very_low",
    "confidence": "high",
    "source": "derived_from_composition"
  },
  "breathability": {
    "value": "medium",
    "confidence": "medium",
    "source": "derived_from_composition"
  },
  "fill_power_fp": null,
  "membrane_type": null
}
```

### 5.5 Rules for LLM-driven ingest pipeline

1. **Composition is extracted first.** If the product page states fiber percentages, those are hard facts. Pipeline must not "infer" a composition it cannot read — missing composition = null.
2. **Behavioral facets are derived second.** After composition is stored, a deterministic function maps known fibers to behavioral ranges before any LLM call. The LLM is only invoked to handle non-standard fibers, proprietary blends, or construction details not in the fiber table.
3. **LLM output is Zod-validated before storage.** The behavioral facet schema has required `confidence` and `source` fields — the LLM cannot emit a bare number and have it stored.
4. **No guessing fill power.** If fill power is not stated, `fill_power_fp = null`. A guess here would mislead warmth recommendations.

---

## 6. What Is Derivable from Material vs Must Be Stated Per-Item

### 6.1 Material-derivable (from shared material library)

These item facets can be computed from the item's `construction` record (which references materials) without any additional per-item data:

| Item facet | How derived |
|---|---|
| `dry_speed` | Dominant shell material's `dry_speed`; modified up by DWR treatment |
| `wet_warmth_retention` | Worst-case: shell + insulation combined. Down → very_low unless hydrophobic treatment present |
| `water_absorption` | Shell material `water_absorption`, overridden by DWR/membrane |
| `odor_resistance` | Shell (or insulation if fill-down) material facet; upgraded by antimicrobial treatment |
| `breathability` | Shell material facet; reduced by membrane (membranes always reduce breathability somewhat) |
| `warmth_for_weight` | Primarily insulation material if present; else shell material |
| `care_requirements` | Derived from strictest care limit across all materials in construction |
| `packability` | Primarily insulation type (down > synthetic > fleece) |
| `abrasion_resistance` | Primarily shell material |
| `stretch` | Shell material (elastane blend = high) |
| `hand_comfort` | Shell/lining material |
| `sustainability` | `recycled_content_pct` + `is_organic` from materials referenced |

### 6.2 Must be stated per-item (not derivable from material alone)

| Item facet | Why it cannot be derived |
|---|---|
| `weight_grams` | Depends on garment size, cut, and amount of fill — not material alone |
| `packed_size` | Depends on construction volume, not just material type |
| `layering_role_facets` | Purpose/function context (base/mid/outer/standalone) requires understanding the whole garment, not just fiber |
| `conditions_fit` (temperature range) | Requires knowing insulation amount (gsm), not just insulation type |
| `gender_cut` / `sizing` | Purely item-level |
| `price` / `brand` / `model_name` | Item identity fields |
| `owned_since` / `condition_of_item` | User-specific fields |
| `waterproof_rating_mm` | Depends on membrane spec (which is in the membrane material record, but the specific rating is a garment-level test result) |
| `fit_type` (slim/regular/relaxed) | Garment attribute |

### 6.3 Derivation confidence by layer

```
insulation_material.warmth_for_weight → item warmth facet     confidence: high (clear causal chain)
shell_material.dry_speed → item dry_speed                     confidence: high
shell_material.odor_resistance → item odor_resistance         confidence: medium (body contact surface matters)
construction.membrane ≠ null → item.waterproof = true         confidence: high (deterministic)
shell_material.breathability, reduced by membrane             confidence: medium (membrane breathability varies by spec)
```

### 6.4 The synthesis rule for multi-layer items

When an item has both shell and insulation materials, behavioral derivation uses **role-based precedence**:

- **Wet warmth retention**: governed by the WEAKEST link (if shell lets water in and insulation collapses, system is "very_low" even if insulation is synthetic)
- **Dry speed**: governed by shell (outermost layer contacts drying air)
- **Warmth-for-weight**: governed by insulation layer if present, else shell
- **Breathability**: governed by MOST restrictive layer (a breathable shell behind a non-breathable membrane = non-breathable)
- **Odor resistance**: governed by the skin-contact layer (lining or shell if no lining)

This means the recommendation layer can derive "this down jacket in rain without a waterproof shell = dangerous wet warmth failure" purely from material + construction data, without any per-item behavioral override — which is precisely the benefit the guiding principle is designed to enable.

---

## Appendix A: Canonical Fiber Slug Reference

Slugs for the shared material library (seed catalog):

| Slug | Human name |
|---|---|
| `merino-wool` | Merino wool (micron not specified) |
| `merino-wool-18.5` | Merino wool 18.5 micron |
| `polyester-filament` | Polyester (filament, woven/knit) |
| `polyester-grid-fleece` | Polyester grid/power-air fleece |
| `polyester-pile-fleece` | Polyester pile fleece |
| `polyester-recycled` | 100% recycled polyester |
| `nylon-6` | Nylon 6 (PA6) |
| `nylon-66` | Nylon 6.6 (PA66) |
| `cotton` | Conventional cotton |
| `organic-cotton` | Organic cotton (GOTS) |
| `hemp` | Hemp |
| `hemp-cotton-55-45` | 55% hemp / 45% organic cotton blend |
| `down-550fp` | Goose/duck down, 550 fill power |
| `down-700fp` | Down, 700 fill power |
| `down-hydrophobic` | Hydrophobic-treated down (treatment separate) |
| `synthetic-insulation-primaloft` | PrimaLoft synthetic insulation |
| `synthetic-insulation-generic` | Generic polyester synthetic insulation |
| `gore-tex-pro` | Gore-Tex Pro membrane |
| `gore-tex-paclite` | Gore-Tex Paclite membrane |
| `h2no-membrane` | Patagonia H2No membrane |
| `event-membrane` | eVent membrane |
| `elastane` | Elastane / Lycra / Spandex |

---

*End of investigation artifact.*
