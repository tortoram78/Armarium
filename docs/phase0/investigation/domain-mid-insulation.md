# Domain Investigation: Mid-Layers / Insulation

**Agent:** DOMAIN-DIMENSION investigation agent — Mid-Layers / Insulation  
**Date:** 2026-06-19  
**Phase:** 0 — Design / Discovery  
**Scope:** Fleece (grid, pile, sherpa), down jackets/sweaters/vests, synthetic insulation jackets, active-insulation pieces, hybrid constructions.

---

## 1. Domain Scope

### What "mid-layer / insulation" covers

This domain spans garments and constructions whose **primary thermodynamic function is trapping dead air** to retain body heat. That function can be continuous with a base layer (active-insulation) or discrete (a static loft layer under a shell). The boundaries are deliberately fuzzy and must not be hardcoded.

Items that belong here in whole or in part:
- **Grid fleece** (Polartec Power Grid, Patagonia R1-style): lightweight, highly breathable, used as active-insulation or first mid-layer.
- **Pile / mid-weight fleece** (Polartec 200/300, snap-T-style): moderate warmth, less breathable, lifestyle or camp-use emphasis.
- **Sherpa / high-pile fleece**: maximum warmth-by-loft, very poor windproofness, often lifestyle.
- **Down jackets / sweaters / vests**: highest warmth-to-weight, compressible, fill-power-differentiated, crippled when wet.
- **Synthetic insulation jackets / sweaters / vests** (PrimaLoft, Thermoball, Coreloft, Octaloft, etc.): moderate warmth-to-weight, retain warmth when wet, vary widely in breathability.
- **Active-insulation pieces** (Polartec Alpha, Polartec Power Stretch Pro with insulation): designed to vent during exertion; breathable enough to wear without an outer shell during high-output activities.
- **Hybrid constructions**: insulated body + fleece sleeves/panels, or stretch-woven panels in a down jacket.

### What real selection decisions hinge on

A user selecting a mid/insulation layer is answering, simultaneously:
1. How cold is it and how hard am I working? (warmth need vs heat buildup)
2. Will it get wet — rain, sweat, stream crossings?
3. Is this going in a pack or on my body all day?
4. Am I wearing a shell over this, or is this the outer layer?
5. How much weight and packed volume can I afford?
6. Static rest (camp, belay, travel) or continuous movement (hiking, skinning, climbing)?

Every single one of these is a FACET QUERY, not a category lookup. The same Patagonia R1 Air answers "yes, active-use mid" and "no, not a belay jacket" and "barely adequate below 15°C at rest" — multiple facets, one item.

---

## 2. Decision-Driving Facets

### 2.1 Insulation Type  
**What it captures:** The fill medium and its construction class.  
**Value-space:** `down` | `synthetic` | `fleece_grid` | `fleece_pile` | `fleece_sherpa` | `hybrid_down_fleece` | `hybrid_synthetic_fleece` | `hybrid_synthetic_stretch` | `unknown`  
**Why it drives decisions:** Dictates the entire wet-performance, packability, durability, and care profile. Down and synthetic are physically different systems. Fleece is a knit construct — it insulates by trapping air in the pile, not by filling — and behaves differently from filled jackets under compression or wind. Down vs synthetic is the single highest-stakes branch in insulation selection.  
**Load-bearing:** YES. This is a first-class facet that must never default to unknown when extractable from manufacturer data.

### 2.2 Fill Power (Down Only)  
**What it captures:** Loft per ounce of down; higher = more dead-air per gram = more warmth-to-weight.  
**Value-space:** integer (typically 550–950), or null if synthetic/fleece.  
**Why it drives decisions:** 650 fp is a budget/mid-tier down experience. 800+ fp is expedition-grade. The same temperature rating requires less fill weight at higher fill power, so the jacket can be lighter or packable in a smaller stuff sack. This is directly comparable to sleeping-bag fill power — the facet is SHARED.  
**Load-bearing:** YES for down items. Must be null with confidence=low for synthetic items; null for fleece items.  
**Source type:** Manufacturer-stated (hard fact). Treat any LLM-derived fill power as confidence=low unless it is quoting a known spec.

### 2.3 Fill Weight / Insulation Weight (Down or Synthetic)  
**What it captures:** Grams of fill used in the garment, not total garment weight.  
**Value-space:** numeric (grams) or null.  
**Why it drives decisions:** Combined with fill power (for down) or specific synthetic loft tables, determines actual warmth output. Two jackets at 800 fp can have very different warmth if one uses 60 g of fill and the other uses 120 g. Often not published; must be null-with-source=unknown when absent.  
**Load-bearing:** Moderately load-bearing. Useful when published; do not fabricate.

### 2.4 Warmth-to-Weight Ratio  
**What it captures:** A normalized sense of how much thermal insulation per gram of garment weight.  
**Value-space:** Continuous relative scale (`very_low` | `low` | `moderate` | `high` | `very_high`) with confidence. Not a CLO or RV number — those require lab measurement.  
**Why it drives decisions:** The primary sorting facet when weight is constrained (backpacking, alpinism). A down sweater at 300 g beats a pile fleece at 600 g if warmth is equivalent.  
**Load-bearing:** YES. This is an LLM-derived soft facet; confidence should reflect whether fill weight and fill power are known.

### 2.5 Wet Performance / Warmth-When-Wet  
**What it captures:** Whether the insulation retains meaningful loft and warmth when saturated.  
**Value-space:**  
- `collapses_when_wet` — untreated down: loft drops precipitously, warmth-loss severe.  
- `partially_retained` — hydrophobic-treated down (Nikwax Hydrophobic Down, DriDown, DownTek): loft degrades but more slowly; recovers faster on drying.  
- `largely_retained` — synthetic fills (PrimaLoft Gold, Thermoball, etc.): matrix holds structure when wet.  
- `unaffected` — fleece: no loft collapse; continues to insulate even when saturated (though heavier).  
- `unknown`  
**Why it drives decisions:** A rainy Pacific Northwest trip or a river canyoneering approach invalidates untreated down as a mid-layer choice. This is the primary axis on which down and synthetic diverge. A facet query "wet_performance: largely_retained OR unaffected" immediately excludes untreated down.  
**Load-bearing:** VERY HIGH. One of the top-three decision-driving facets.

### 2.6 Hydrophobic Down Treatment  
**What it captures:** Whether down fill has been treated to resist water absorption.  
**Value-space:** `treated` | `untreated` | `unknown`  
**Why it drives decisions:** Modifies wet_performance from `collapses_when_wet` toward `partially_retained`. A distinct facet because treatment is a manufacturer-stated hard fact, while wet_performance is the behavioral outcome. Keeping them separate allows correct confidence assignment.  
**Load-bearing:** YES for down items. Must be null for synthetic/fleece.  
**Source type:** Manufacturer-stated when disclosed. Often requires inference if not explicit — assign confidence accordingly.

### 2.7 Active-Insulation Suitability / Aerobic Breathability  
**What it captures:** Whether the garment is designed and performs well during sustained aerobic output (hiking, skinning, running) without causing heat buildup and soaking from sweat.  
**Value-space:** `active` | `semi_active` | `static` | `unknown`  
- `active` — breathable enough to wear as outer layer during moderate-to-hard exertion (grid fleece, Polartec Alpha pieces, open-cell synthetic constructions like R1 Air).  
- `semi_active` — tolerable during light exertion; warm and sweaty at harder outputs (mid-weight fleece, lighter synthetic jackets).  
- `static` — belay jacket / camp jacket; will soak out from sweat during sustained movement (high-fill-weight down, thick pile fleece).  
**Why it drives decisions:** For a ski tourer or trail runner, a `static` piece is a liability in motion. For a belayer at a granite crag, an `active` piece may be too breathable to stay warm. This facet gates entire use cases.  
**Load-bearing:** YES. LLM-derived, but strongly supported by insulation type: fleece_grid → active; high fill-weight down → static.  
**Confidence rule:** Confidence = high when both insulation_type and a breathability spec (CFM or description) are known; medium when only type is known.

### 2.8 Wind Permeability  
**What it captures:** How easily wind penetrates the outer face fabric, disrupting the insulating air layer.  
**Value-space:** `highly_permeable` | `moderate` | `wind_resistant` | `windproof`  
**Why it drives decisions:** A pile fleece or unbaffled grid fleece is highly wind-permeable — worn alone in any breeze it loses most of its warmth; must be paired with a windshell. A synthetic jacket with woven DWR face fabric may be wind-resistant enough to use as outer layer in light wind. Down jackets vary widely based on face fabric.  
**Load-bearing:** YES. Often underpublished; frequently an LLM-derived facet from face fabric description.

### 2.9 Layering Role  
**What it captures:** Intended position in the layering system.  
**Value-space:** Bitmask / multi-value: `[ "sole_layer", "mid_under_shell", "mid_under_hardshell", "outer_in_calm_dry", "base_over" ]`  
**Why it drives decisions:** Some items are designed to be compressed by a shell and therefore have no DWR and no face-fabric durability designed for direct abrasion. Others (synthetic jackets with woven face) are designed to be outer layers. Fleece almost always works as mid_under_shell.  
**Load-bearing:** Moderate. Mostly LLM-derived from construction and material cues.

### 2.10 Packability / Compressibility  
**What it captures:** Whether the garment stuffs small enough to pack away when not needed.  
**Value-space:** `stuff_sack_included` | `stuffs_into_pocket` | `stuffs_small` | `moderate` | `bulky` | `unknown`  
**Why it captures decisions:** Critical for alpine or backpacking use. A stuff-sack down sweater disappears; a sherpa fleece does not. This is a PRIMARY trip-planning constraint — if your pack is small, bulky = excluded.  
**Load-bearing:** HIGH for trip planning. Manufacturer-stated when a stuff sack is included; LLM-derived otherwise from construction type (fleece = moderate to bulky; high-loft down = high compressibility; pile = bulky).

### 2.11 Loft Category  
**What it captures:** How thick the insulating layer is when worn and not compressed.  
**Value-space:** `low` | `medium` | `high` | `very_high`  
**Why it drives decisions:** High loft = more warmth AND more resistance to mobility (affects layering under a shell). Very-high-loft down jackets can restrict arm swing; pile fleece can add bulk under a shell.  
**Load-bearing:** Moderate. LLM-derived from insulation type and fill weight/power when available.

### 2.12 Face Fabric DWR / Moisture Resistance  
**What it captures:** Whether the outer fabric has a durable water repellent finish.  
**Value-space:** `dwr_treated` | `no_dwr` | `unknown`  
**Why it drives decisions:** For a down jacket under a shell, DWR on the face fabric is almost irrelevant (the shell handles moisture). For a down jacket used as outer layer in a light mist, DWR prevents the shell fabric from wetting out and slowing dry-out of the down below. For fleece, DWR matters minimally since fleece continues to insulate when wet regardless.  
**Load-bearing:** Low to moderate depending on layering role. Manufacturer-stated hard fact.

### 2.13 Intended Use Context / Activity Fit  
**What it captures:** The conditions and activities the garment is designed for.  
**Value-space:** Multi-value: `[ "alpine", "trail_hiking", "ski_touring", "everyday_lifestyle", "camp_and_rest", "travel", "trail_running", "climbing_static", "climbing_active" ]`  
**Why it drives decisions:** This facet is the primary filter for trip recommendations. A lifestyle pile fleece maps to everyday_lifestyle + camp_and_rest. The R1 Air maps to alpine + ski_touring + climbing_active. A belay jacket maps to climbing_static + camp_and_rest.  
**Load-bearing:** HIGH. LLM-derived; confidence should reflect how explicit the manufacturer's use-case language is.

### 2.14 Technical vs Lifestyle Orientation  
**What it captures:** Whether the garment is designed primarily for technical outdoor performance or for everyday casual wear.  
**Value-space:** `technical` | `mostly_technical` | `hybrid` | `mostly_lifestyle` | `lifestyle`  
**Why it drives decisions:** Lifestyle-oriented insulation is often heavier-per-warmth, less durable in the field, more fashion-forward. For a serious mountain objective, a lifestyle piece should be flagged as a lower-confidence choice. This is NOT a binary — it is a continuum.  
**Load-bearing:** Moderate. LLM-derived. Risk of inconsistency between agents; calibrate carefully.

### 2.15 Durability / Abrasion Resistance  
**What it captures:** How well the garment withstands pack straps, rock contact, and repeated use.  
**Value-space:** `high` | `moderate` | `low` | `unknown`  
**Why it drives decisions:** Thin-shell down jackets (10D or 15D nylon face) are extremely delicate; unsuitable for scrambling or bushwhacking. Pile fleece is quite durable by fabric, but the pile can snag. Grid fleece is robust. Synthetic jackets with woven face are often more durable than equivalent down.  
**Load-bearing:** Moderate. LLM-derived from face fabric denier/description.

### 2.16 Weight (Total Garment)  
**What it captures:** Stated or measured garment weight in grams (or ounces).  
**Value-space:** numeric (grams) + source_type + confidence.  
**Why it drives decisions:** Direct input to pack weight calculations. Also a proxy for warmth category and compressibility.  
**Load-bearing:** HIGH. Manufacturer-stated hard fact. Never fabricate; null if not found.

---

## 3. Hard Facts vs Soft Facets

### 3.1 Hard Facts (Manufacturer-Stated)

| Facet | Source | Notes |
|---|---|---|
| fill_power | Manufacturer spec | Integer. Down only. Null for synthetic/fleece. |
| fill_type | Manufacturer spec | "goose down", "duck down", "PrimaLoft Gold", "Polartec Alpha", etc. |
| fill_weight_grams | Manufacturer spec | Often not published. Null with confidence=low. |
| weight_grams | Manufacturer spec | Often listed on product page. R1 Air: ~312 g (~11 oz). |
| face_fabric_dwr | Manufacturer spec | Stated in tech specs or hangtag. |
| hydrophobic_down_treatment | Manufacturer spec | Named treatment ("DownTek", "NikWax Hydrophobic") or stated. |
| material_composition | Manufacturer spec | Percentages by material. |

### 3.2 Soft Facets (LLM-Derived)

| Facet | Basis for LLM derivation | Confidence range |
|---|---|---|
| warmth_to_weight | fill_power + fill_weight + insulation_type | medium–high when inputs known |
| wet_performance | insulation_type + hydrophobic_treatment | high when both known |
| active_insulation_suitability | insulation_type + breathability description | medium–high |
| wind_permeability | face_fabric description + construction | medium |
| layering_role | construction + DWR + face fabric weight | medium |
| packability | insulation_type + fill_weight + stuff_sack stated | medium–high |
| loft_category | fill_power + fill_weight OR construction description | medium |
| activity_fit | full text of product page + use-case language | medium |
| technical_vs_lifestyle | product language, price, silhouette description | medium |
| durability | face fabric denier + type | medium |

### 3.3 Confidence Schema

Every soft facet value must carry:
```
value: <the derived value>
confidence: "high" | "medium" | "low" | "unknown"
source: "manufacturer_stated" | "llm_derived_from_specs" | "llm_inferred" | "unknown"
evidence: <short quote or null>
```

---

## 4. Material Linkage

### 4.1 Down

Down is a three-dimensional cluster of filaments that traps dead air in three dimensions. Its thermal performance is dramatically density-dependent:

- **Fill power** governs loft-per-ounce. 550 fp duck down (like Kelty Galactic 30 bag) is serviceable but heavier than 800 fp goose down for equivalent warmth.
- **Duck vs goose down**: goose clusters are generally larger and achieve higher fill powers; duck down tends to cap around 700–750 fp for commodity grades. The Kelty Galactic 30 uses "duck down 550 fp" — a meaningful distinction.
- **Hydrophobic treatment**: DWR on individual down fibers delays (does not prevent) loft collapse when wet. Treated down is meaningfully better in damp conditions than untreated, but NOT comparable to synthetic in heavy sustained rain. This is a continuous improvement, not a binary swap.
- **Baffling construction**: sewn-through vs box-baffle affects cold spots; relevant to sleeping bags (Kelty Galactic 30 is likely sewn-through at that price point) and down jackets alike.
- **Loft recovery**: down regains loft after compression over time; synthetic does not recover as fully.

**Shared facets with sleeping bags:** fill_power, fill_type, hydrophobic_treatment, wet_performance, warmth_to_weight. The Kelty Galactic 30 and a down sweater use the same underlying facets — the insulation behavior model is SHARED across domains.

### 4.2 Synthetic Fills

Synthetic insulation is engineered fiber matrix replicating the dead-air trapping of down:

- **PrimaLoft Gold / Bio**: microfiber, very fine, mimics down feel, significantly water-resistant. Top-tier synthetic for warmth-to-weight.
- **Thermoball (The North Face)**: spherical clusters, closer to down feel, compresses well, retains warmth when wet. Mid-tier warmth-to-weight.
- **Coreloft / Octaloft / Sustans / generic`: heavier constructions, less expensive, more durable to washing, less packable.
- **Polartec Alpha / Alpha Direct**: specifically engineered for aerobic output — open construction allows moisture vapor escape; used in active-insulation pieces. Not a fill in the belay-jacket sense; a breathable insulation layer for moving.
- All synthetics: maintain ~70–80% of rated warmth when wet. Does not collapse like down. Does NOT recover loft after compression as well as down (permanent loft memory loss over time with heavy use).

### 4.3 Fleece Constructions

Fleece insulates by mechanical air-trapping in the pile structure, NOT by filling channels. This means:

- **Grid fleece** (e.g., Patagonia R1, Polartec Power Grid): channels in the knit promote airflow and moisture vapor transport. Warmth-per-weight is low-moderate; aerobic breathability is high. Functions as active-insulation mid. Wind-permeable — loses most effectiveness in wind alone.
- **Pile fleece / classic mid-weight** (Patagonia Synchilla Snap-T): dense uniform pile, higher warmth but poor breathability. Lifestyle and camp use. Highly wind-permeable. Does not compress.
- **Sherpa / high-pile**: maximum loft, zero wind resistance, very soft. Lifestyle and lounge. Heaviest and bulkiest.
- **Performance fleece** (Polartec Power Stretch, Power Air): knit constructions with some stretch; used in hybrid pieces.
- **Fleece in wet conditions**: ALL fleece types continue to insulate when wet, unlike down. They do become heavy and slow to dry. This is the key cross-domain differentiation: fleece_wet_performance = `unaffected` (warmth retained, but weight penalty).

### 4.4 Behavioral Summary Matrix

| Material Class | Warmth/Weight | Wet Warmth | Packability | Wind Resist | Breathability |
|---|---|---|---|---|---|
| High-fp goose down untreated | Very High | Collapses | Excellent | Face-fabric dep. | Low–Mod |
| High-fp goose down treated | Very High | Partial | Excellent | Face-fabric dep. | Low–Mod |
| PrimaLoft Gold synthetic | High | Largely retained | Good | Face-fabric dep. | Low–Mod |
| Polartec Alpha (active synth) | Moderate | Largely retained | Moderate | Low–Mod | High |
| Grid fleece (Power Grid/R1) | Low–Moderate | Unaffected | Moderate | Very Low | Very High |
| Pile fleece (mid-weight) | Moderate | Unaffected | Poor | Very Low | Low–Mod |
| Sherpa / high-pile | Moderate–High | Unaffected | Very Poor | Very Low | Low |

---

## 5. Edge Cases and Hard-to-Classify Items

### 5.1 Patagonia R1 Air Full-Zip Hoody

**The hardest item in the seed corpus for category thinking.** It is simultaneously:
- A mid-layer (insulates between base and shell)
- An active-insulation piece (breathable enough to wear without a shell)
- A grid fleece (material construction)
- Technically a "mid-layer" by position but "not insulation" by the conventional sense of that term

Under category thinking this is a nightmare: is it a base layer? a fleece? an insulation layer? No fixed enum captures it.

Under the FACET model this is trivial:
- `insulation_type: fleece_grid`
- `active_insulation_suitability: active`
- `wind_permeability: highly_permeable`
- `layering_role: [mid_under_shell, outer_in_calm_dry_warm]`
- `activity_fit: [alpine, ski_touring, trail_hiking, climbing_active]`
- `warmth_to_weight: low_to_moderate`

A query for "aerobically breathable mid-layer for ski touring" finds it. A query for "warm belay jacket" correctly excludes it. No category enum required. The item inhabits its facets; queries extract it.

### 5.2 Patagonia Synchilla Snap-T Pullover

Lifestyle-leaning pile fleece. Technically insulates, but:
- `technical_vs_lifestyle: mostly_lifestyle`
- `active_insulation_suitability: static` (sweaty at exertion)
- `wind_permeability: highly_permeable` (needs a wind layer)
- `packability: bulky` (does not compress)
- `activity_fit: [camp_and_rest, everyday_lifestyle, casual_hiking]`

A recommendation engine querying for an alpine ski tour mid-layer would down-rank it (or flag it with a caveat) without needing a hard category exclusion. The facets express the limitation. Under category thinking, it would either be in "mid-layers" (and then wrongly recommended) or excluded by category rule (and then unavailable even for a casual day hike where it's perfect).

### 5.3 Patagonia Outdoor Everyday Marsupial

Similar to Snap-T — lifestyle pile fleece with a kangaroo pocket. Same facet profile. The FACET model handles the "is it outdoor gear or fashion?" ambiguity naturally: it has a `technical_vs_lifestyle` continuum, not a binary. It is in the closet; it is real gear the user owns; it should be surfaced for appropriate trips (casual, car camping, town) and down-ranked for technical objectives.

### 5.4 Down vs Synthetic in Rain

This is the central wet-performance edge case. The facet model handles it with `wet_performance` + `hydrophobic_down_treatment`. There is no need for a "use synthetic in the rain" rule hardcoded in the recommendation layer. Instead:
- Trip conditions have a `precipitation` facet (e.g., `high_moisture_probability: true`).
- Recommendation queries filter or weight by `wet_performance != collapses_when_wet` when precipitation is high.
- A user's untreated down jacket gets a conditional recommendation: "suitable if shell stays dry; not recommended for sustained rain without waterproof shell."

### 5.5 Active-Insulation as Its Own Facet vs Category

Some brands sell "active insulation" as a marketing category (Rab Cirrus Flex, Arc'teryx Atom SL). The RIGHT answer is: `active_insulation_suitability: active` is a facet value, not a product category. An R1 Air is active insulation by behavior even though Patagonia doesn't call it that by name. A Nano Puff Hoody is semi-active at best. The facet captures the truth regardless of marketing language.

### 5.6 Patagonia Stretch Terre Planing Hoody — Near-Domain

This item (from the seed corpus) is a fast-drying, DWR-treated, non-waterproof recycled polyester piece for watersports. It is NOT in the mid-insulation domain — it lacks an insulating construction. However, it shares: `face_fabric_dwr: dwr_treated`, `material: recycled_polyester`. The FACET model correctly places it as a sun/wind layer with hydrophobic properties, not an insulation layer, without any category rule needed.

---

## 6. Cross-Domain Facet Overlaps

### 6.1 Sleeping Bags (Kelty Galactic 30)

The Kelty Galactic 30 sleeping bag is NOT a mid-layer garment, but it shares a substantial facet vocabulary:

| Shared Facet | Sleeping Bag Expression | Mid-Layer Expression |
|---|---|---|
| `insulation_type` | "down" (duck) | "down" (goose/duck) or synthetic |
| `fill_power` | 550 fp | 550–900 fp |
| `fill_weight_grams` | Not always stated | Not always stated |
| `hydrophobic_down_treatment` | untreated / treated | untreated / treated |
| `wet_performance` | collapses_when_wet | same |
| `warmth_to_weight` | relative scale | relative scale |
| `loft_category` | affects temperature rating | affects garment warmth |
| `packability` | stuff sack size | stuff sack / compression |

**This means the insulation behavior sub-model (fill_type, fill_power, hydrophobic treatment, wet_performance) should be a SHARED REUSABLE schema across gear types, not duplicated per domain.** A `InsulationBehaviorFacets` block can be embedded in both a sleeping bag schema and a down jacket schema.

This is globally load-bearing for the Armarium data model.

### 6.2 Base Layers

Cross-domain overlap with base layers:
- `active_insulation_suitability` is relevant to both: a merino base layer scores `active`; a pile fleece scores `static`.
- `moisture_management` (wicking, fast-dry): base layers emphasize this; grid fleece is the mid-layer most like a base layer in moisture behavior.
- `material_odor_resistance`: merino vs synthetic base layers; also relevant to grid fleece worn next-to-skin.
- The R1 Air is often worn next-to-skin as a base-like layer — its facets must accommodate this. `layering_role` should include `base_adjacent` as a valid value.

### 6.3 Shells / Outer Layers

Cross-domain overlap with hardshells and softshells:
- `wind_permeability`: shell facet `windproof: true` directly complements mid-layer `wind_permeability: highly_permeable`. A recommendation pairing a pile fleece with a windshell is a FACET JOIN, not a rule.
- `face_fabric_dwr`: shells have this strongly; mid-layers have it weakly (when they have it). Shared facet name, wildly different confidence thresholds.
- `layering_role`: mid-layers express `mid_under_shell`; shells express `outer_over_mid`. A FACET JOIN finds compatible pairings.
- `packability`: both shells and mid-layers contribute to pack volume. Cross-domain sum of packability scores gives total pack bulk for a kit.

### 6.4 Footwear / Sleeping Pads (Distant Overlap)

Insulation facets (warmth_to_weight, temperature_rating, insulation_type) are structurally analogous to sleeping pad R-value and footwear insulation. The schema pattern is reusable.

---

## 7. Unknown / Confidence Handling Notes

### 7.1 The Null-First Principle

For this domain specifically: **never infer fill power from price or brand.** A "Patagonia down jacket" does not have a deterministic fill power — they range from 600 to 800+ fp depending on the specific product. Source is required. If fill power is not on the product page or spec sheet, it is `null` with `confidence: unknown, source: unknown`.

### 7.2 Fill Weight is Almost Always Unknown

Manufacturers routinely publish fill power and garment weight, but rarely publish fill weight (grams of down). This means `warmth_to_weight` for a given down jacket must often be derived from total weight alone (a weaker proxy). The confidence on `warmth_to_weight` should be downgraded when fill weight is null.

### 7.3 "Active Insulation" Claims

Some manufacturers apply "active insulation" marketing language loosely. The LLM must derive `active_insulation_suitability` from the construction description (grid construction, open-cell foam, Polartec Alpha etc.) rather than from the product name. A product called "Active Jacket" may score only `semi_active` if its breathability specs do not support the claim.

### 7.4 Hydrophobic Down: Stated vs Inferred

If a manufacturer says "hydrophobic down" without naming a specific treatment, assign:
- `hydrophobic_down_treatment: treated`
- `confidence: medium`
- `source: llm_derived_from_product_description`

If the product page says nothing about water treatment for a down product, assign:
- `hydrophobic_down_treatment: unknown` (do NOT default to `untreated`)
- `confidence: low`

It is better to know "we don't know" than to falsely assert `untreated` and then under-recommend the item for wet conditions.

### 7.5 Temperature Ratings

Garment insulation temperature ratings are NOT standardized (unlike EN 13537 for sleeping bags). Manufacturer-stated temperature claims for jackets are marketing, not lab results. This domain SHOULD NOT surface a numeric temperature rating as a hard fact. Instead use `warmth_category: low | moderate | high | very_high` as an LLM-derived soft facet with `confidence: medium` and a note that it is relative and activity-dependent.

### 7.6 Lifestyle vs Technical: Calibrate Consistently

The `technical_vs_lifestyle` facet is subjective and the single most likely facet to drift between agents in a multi-agent system. The classification rubric must define anchors:

- **Lifestyle anchor**: Snap-T, Marsupial, fashion-pile pullovers — scored `lifestyle` or `mostly_lifestyle`.
- **Technical anchor**: R1 Air, Polartec Alpha piece, 800fp alpine down jacket — scored `technical` or `mostly_technical`.
- **Hybrid anchor**: Patagonia Nano Puff Hoody — widely used technically, also lifestyle-acceptable — scored `hybrid`.

These three items should be the calibration examples in the LLM classification prompt for this facet.

### 7.7 Unknown Source Provenance

If a spec is found on a third-party review site (e.g., OutdoorGearLab, REI) vs the manufacturer's own product page, the confidence and source type differ:

- Manufacturer product page: `source: manufacturer_stated, confidence: high`
- Third-party review quoting specs: `source: third_party_stated, confidence: medium`
- LLM general knowledge without a quotable source: `source: llm_inferred, confidence: low`

For fill power and fill weight especially, `llm_inferred` should be treated as `null` in any downstream comparison or recommendation. The item should be flagged for enrichment from a real product page.

---

*End of investigation artifact — Mid-Layers / Insulation domain.*
