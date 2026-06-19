# Domain Investigation: Accessories

_Phase 0 — Discovery artifact. Read CLAUDE.md before editing._

---

## 1. Domain Scope

**What accessories cover:** Small, body-worn items that do not constitute primary apparel but cover specific body zones — head (hats, beanies, sun hats, hoods), neck/face (buffs, neck gaiters, balaclavas), hands (gloves, mittens, liner gloves), feet (socks, gaiters), and eyes (sunglasses). Belts sit at the edge: functional (pants retention, gear attachment) but rarely a comfort or safety driver.

**Why they matter disproportionately:**

Extremities and exposed surfaces lose heat and UV damage at dramatically higher rates than the torso. The hands and head together account for a large fraction of total-body heat loss. Sunburn at altitude occurs with far less exposure than at sea level. Wet socks cause blisters and hypothermia risk faster than a wet jacket. A missing buff in a cold wind is a worse decision than a missing second fleece layer — the extremity problem manifests faster and with fewer recovery options in the field.

The consequence: accessories are frequently the **marginal item** in a kit — the thing that separates a comfortable summit from a miserable one. They are also low-weight and high-portability, meaning the cost of bringing them is low, but the decision of *which* item to bring (merino liner vs. waterproof shell glove vs. both) requires nuanced reasoning about conditions.

**What a real selection decision hinges on:**

- What body zone(s) will be exposed to the hazard (cold, sun, wind, rain, abrasion)?
- What is the severity and duration of the condition (alpine summit wind vs. trailhead chill)?
- Is the item a standalone solution or a layer in a system (liner gloves inside shell mitts)?
- What is the dexterity penalty (thick mitt vs. thin glove) against the task requirements (camera, map, rope)?
- What is the packability cost — does the item fit in a jacket pocket as a backup?
- Are multiple hazards present simultaneously (cold + sun at high altitude requires warmth AND UPF)?

These questions cannot be answered by category membership. They require facet-level reasoning.

---

## 2. Decision-Driving Facets

Each facet below is described with its name, what it captures, value-space shape, and why it drives a real decision. **Load-bearing** = required for useful recommendations. **Vanity** = useful for display/filtering but rarely changes a pack decision.

---

### 2.1 body_zone_covered — MULTI-LABEL — LOAD-BEARING

**What it captures:** Which anatomical zones of the body the item covers or protects. This is a multi-label set, not an enum. A buff can simultaneously cover neck, face (balaclava-pulled-up), and head (hat-pulled-down). A balaclava covers head, face, and neck at once. A sun hat covers head and offers partial face/neck shadow.

**Value space:** `Set<"head" | "face" | "neck" | "hands" | "wrists" | "feet" | "ankles" | "lower_leg" | "eyes">`. Never a single value for many items.

**Why it drives decisions:** The recommendation engine must know which body zones are covered to detect gaps ("user has no hand coverage for sub-freezing temps") and to avoid redundant packing ("buff covers neck already — no separate neck gaiter needed"). Without this as a multi-label facet, the system cannot reason about zone-coverage gaps or overlaps.

---

### 2.2 function_purpose — MULTI-LABEL — LOAD-BEARING

**What it captures:** What the item does, not what it looks like. A buff provides warmth AND sun protection AND wind protection AND dust/debris filtration simultaneously. These are not mutually exclusive; the item performs all of them.

**Value space:** `Set<"warmth" | "sun_protection" | "wind_protection" | "water_resistance" | "waterproof" | "dexterity_preservation" | "eye_protection_uv" | "eye_protection_glare" | "debris_filtration" | "blister_prevention" | "ankle_support" | "gear_retention" | "layering_component" | "standalone_solution">`.

**Why it drives decisions:** A user heading into a cold, high-altitude, sunny environment needs items that cover `sun_protection` AND `warmth`. If function_purpose is a single enum, a buff classified as "warmth" will be missed when querying for sun protection, even though it provides UPF 50+ on many models. Multi-label is mandatory.

---

### 2.3 warmth_level — ORDINAL SCALE — LOAD-BEARING

**What it captures:** How much insulation or heat retention the item provides. Distinct from material — a fleece beanie and a merino beanie can have similar warmth levels via different mechanisms.

**Value space:** Ordinal: `"none" | "minimal" | "light" | "moderate" | "high" | "extreme"`. Or a numeric scale (1–5) with known uncertainty. NOT a free-text string.

**Why it drives decisions:** The primary question for head/hand/neck coverage in cold conditions. A cotton sun hat has warmth_level = "none". An expedition mitten has warmth_level = "extreme". Recommending the wrong warmth tier is the most common meaningful mistake in accessory selection. This facet, crossed with `conditions_temperature_range`, is the core recommendation signal.

---

### 2.4 upf_rating — NUMERIC OR CATEGORICAL — LOAD-BEARING

**What it captures:** UV Protection Factor — how much UV radiation the item blocks. A hard fact when stated by the manufacturer; soft/inferred otherwise.

**Value space:** Numeric (e.g., 50, 50+) when manufacturer-stated. Categorical approximation (`"none" | "low_<15" | "moderate_15-29" | "good_30-49" | "very_good_50" | "excellent_50plus"`) when inferred from material and weave. Confidence marker required.

**Why it drives decisions:** High-altitude and desert trips require UV coverage for exposed body zones. A buff with UPF 50+ covers the neck and face zone with sun protection; a standard cotton bandana provides effectively none. This facet, combined with body_zone_covered, lets the system detect "face/neck UV exposure gap" even when the user owns a sun hat (head only).

---

### 2.5 water_resistance_level — ORDINAL — LOAD-BEARING

**What it captures:** How well the item resists water ingress, from none to fully waterproof/breathable membrane.

**Value space:** `"none" | "dwr_treated" | "water_resistant" | "waterproof_breathable" | "waterproof_non_breathable"`. For gloves this is critical; for socks (wool absorbs but insulates wet) the nuance differs.

**Why it drives decisions:** Wet gloves in cold conditions are a safety issue, not just a discomfort. A wool liner glove stays warm wet; a down-filled mitten does not. In rain, a waterproof shell glove over a liner is correct; in dry cold, the liner alone is sufficient. This facet distinguishes those scenarios.

---

### 2.6 wind_protection_level — ORDINAL — LOAD-BEARING

**What it captures:** How well the item blocks wind-driven heat loss. A woven buff blocks wind; a knit beanie does not (until a wind shell is added). Distinct from water resistance.

**Value space:** `"none" | "low" | "moderate" | "high"`. Often inferred from weave density, face fabric type, or manufacturer description. Confidence varies.

**Why it drives decisions:** Alpine and exposed ridge situations require wind protection at head and hands even when temperatures are moderate. A fleece beanie without a wind shell is insufficient above treeline in wind; a hardshell hat layer or windproof glove changes the recommendation.

---

### 2.7 dexterity_level — ORDINAL (gloves/mitts only) — LOAD-BEARING for hands

**What it captures:** How much fine motor control the item preserves. A bare-hand rating is the ceiling. Liner gloves are near-ceiling. Lobster mitts are low. Expedition box mitts are minimal.

**Value space:** `"full" | "high" | "moderate" | "low" | "minimal"`. Only meaningful for items with body_zone_covered containing "hands".

**Why it drives decisions:** Rock climbing, camera operation, map navigation, and zipper operation require different dexterity thresholds. A guide who needs to handle ropes cannot wear box mitts; a photographer cannot wear thick insulated mittens for hours. Dexterity gates what activities the item is compatible with.

---

### 2.8 layering_role — CATEGORICAL WITH MULTI-VALUE — LOAD-BEARING

**What it captures:** Whether the item is a standalone solution, a liner (worn under another layer), a shell (worn over a liner), or compatible with both roles. Liner gloves are classic examples: worn alone in mild cold, or inside shell mitts in extreme cold.

**Value space:** `Set<"standalone" | "liner" | "shell" | "over_layer">`. Multi-label: a thin merino beanie can be standalone (cool weather) or worn under a helmet or a heavier hat (liner role).

**Why it drives decisions:** The system must know whether the user's glove collection forms a complete system (liner + shell) or only covers one temperature band. A liner glove without a shell is a gap in severe cold; a shell glove without a liner is a gap in severe cold (shell gloves are rarely insulated adequately alone at extremes). Layering_role enables the "system completeness" check.

---

### 2.9 packability — ORDINAL — LOAD-BEARING

**What it captures:** How small the item compresses and how easy it is to carry as a backup. A thin merino beanie stuffs into a jacket pocket; a wide-brim sun hat does not.

**Value space:** `"very_packable" | "packable" | "moderate" | "bulky" | "non_packable"`. Weight and compressed volume are relevant sub-facets if known.

**Why it drives decisions:** Many accessories are "carry just in case" items. High packability means the system can recommend them as low-cost additions to any kit. Low packability (wide-brim hat, full gaiters) means they need to be justified by condition severity. Packability crosses with trip_type: fast-and-light alpine vs. basecamp vs. car camping changes the threshold.

---

### 2.10 material_primary — CATEGORICAL (multi-label for blends) — LOAD-BEARING

**What it captures:** The primary fiber/material of the item. For accessories, material drives warmth-when-wet, odor resistance, dexterity (for gloves), UPF contribution, and durability.

**Value space:** `"merino_wool" | "synthetic_fleece" | "down" | "hardshell_membrane" | "softshell" | "nylon" | "polyester" | "cotton" | "synthetic_blend" | "gore_tex" | "other"`. Blended items take multiple values with percentage confidence when known.

**Why it drives decisions:** See Section 4 (Material Linkage) for detail. Short answer: merino stays warm wet and resists odor; cotton fails wet; membrane waterproofs but reduces breathability; fleece blocks little wind but insulates well.

---

### 2.11 conditions_temperature_range — RANGE or CATEGORICAL — LOAD-BEARING

**What it captures:** The temperature range (°F or °C) or categorical band in which the item performs as intended.

**Value space:** Numeric range when stated (e.g., 20–40°F). Categorical: `"extreme_cold_below_0f" | "cold_0_to_25f" | "cool_25_to_45f" | "mild_45_to_65f" | "warm_above_65f"`. Often inferred, with explicit confidence.

**Why it drives decisions:** The most basic selector for warmth-class accessories. Crossing this with forecast temperature is the first-pass filter.

---

### 2.12 activity_compatibility — MULTI-LABEL — LOAD-BEARING

**What it captures:** What activities or trip types the item is suited to. A neoprene glove is suited to kayaking; an insulated ski glove is not. Running socks differ from mountaineering socks in thickness and cushion placement.

**Value space:** `Set<"hiking" | "mountaineering" | "skiing" | "trail_running" | "climbing" | "kayaking" | "cycling" | "hunting" | "casual" | "travel">`.

**Why it drives decisions:** Item-activity fitness is a cross-check against trip context. A buff that is perfect for trail running (lightweight, moisture-wicking) may be insufficient for ski touring (needs more face coverage and warmth).

---

### 2.13 lens_category (sunglasses only) — CATEGORICAL — LOAD-BEARING for eye protection

**What it captures:** The lens type and UV/visible light blocking standard. Category 3 blocks 82–92% of visible light (standard bright sun). Category 4 blocks 92–97% (glaciers, high altitude). UV400 = blocks all UV up to 400nm.

**Value space:** `"category_1" | "category_2" | "category_3" | "category_4" | "uv400"`, with polarization as a boolean sub-facet.

**Why it drives decisions:** Glacier travel and snowfields require Category 4 and side shields. Casual hiking requires Category 2–3. The wrong lens on a glacier causes snow blindness. This facet is narrow-domain but safety-critical when it applies.

---

### 2.14 sock_cushion_zone / gaiter_height — DOMAIN-SPECIFIC SUB-FACETS — MODERATE

**What they capture:** For socks: where cushion is concentrated (heel, ball, full-length, minimal). For gaiters: ankle-height (trail gaiter) vs. knee-height (hiking gaiter) vs. mountaineering gaiter.

**Value space:** Sock: `"minimal" | "light" | "medium" | "heavy" | "targeted"`. Gaiter: `"ankle" | "mid" | "knee" | "full_mountaineering"`.

**Why they drive decisions:** Blister prevention and debris protection depend on these. A trail runner needs a no-show with targeted heel cushion; a mountaineering boot wearer needs a full gaiter to keep snow out and crampons compatible. Important but not globally load-bearing.

---

### VANITY FACETS (display/filtering, rarely changes recommendation)

- **color** — personal preference; load-bearing only for visibility/safety contexts (hi-vis hunting).
- **brand** — loyalty signal, not a condition-fit signal.
- **price_tier** — useful for gap-filling suggestions; not a condition recommendation driver.
- **gender_fit** — relevant for sizing but not for condition-fit reasoning.

---

## 3. Hard Facts vs. Soft Facets

### Hard Facts (objective, manufacturer-stated, source-traceable)

| Facet | Example | Confidence approach |
|---|---|---|
| `upf_rating` | UPF 50+ (Outdoor Research stated) | HIGH if manufacturer spec; LOW if inferred from material |
| `material_primary` | 100% merino 18.5 micron | HIGH if tag/spec; MEDIUM if inferred from product description |
| `lens_category` | Category 4, UV400 | HIGH if stated; treat unknown as null |
| `waterproof_membrane` | Gore-Tex, eVent, H2No | HIGH if stated; MEDIUM if "waterproof" in description without membrane name |
| `weight_grams` | 45g | HIGH if stated; LOW/null if inferred |
| `gaiter_height` | Knee-height | HIGH if product type is clear; structural fact |

Hard facts: never infer without stating confidence. If a product says "UPF 50+" that is HIGH confidence. If a product description says "great sun protection" without a number, that is LOW confidence and should be stored as `upf_rating: null, upf_inferred: "likely_high", upf_confidence: "low"`.

### Soft Facets (inferred, context-dependent, require LLM reasoning)

| Facet | Why soft | Confidence approach |
|---|---|---|
| `warmth_level` | No universal standard; depends on wearer metabolism | LLM infers from material + construction; MEDIUM confidence; requires source cite |
| `conditions_temperature_range` | Subjective; overlapping ranges by brand | LLM infers from activity marketing + material; LOW-MEDIUM |
| `activity_compatibility` | Manufacturer may not disclose intended use | LLM reads product positioning; MEDIUM |
| `packability` | No standard; relative to alternatives | LLM infers from weight + structure description; LOW-MEDIUM |
| `wind_protection_level` | Rarely stated; inferred from face fabric type | LLM infers from weave + material mentions; LOW-MEDIUM |
| `dexterity_level` | Never manufacturer-stated; inferred from glove thickness/type | LLM infers; MEDIUM for obvious cases, LOW for edge cases |

All soft facets must carry `confidence: "high" | "medium" | "low" | "unknown"` and `source: "manufacturer_spec" | "llm_inference" | "user_stated" | "unknown"`.

---

## 4. Material Linkage

Accessories share the same material vocabulary as apparel. The key behaviors relevant to this domain:

**Merino wool:** Warm when wet, odor-resistant, soft against skin (critical for face/neck items), natural UPF contribution (moderate, ~15–25 UPF depending on weight). Primary choice for next-to-skin accessories (beanies, liner gloves, socks, buffs). Loses warmth advantage in high wind without a face fabric.

**Synthetic fleece (polyester):** Warm, fast-drying, wind-permeable unless bonded with a face fabric. Standard for mid-layer beanies and fleece glove liners. Pills with abrasion (relevant for gloves). Low UPF.

**Hardshell/waterproof membrane (Gore-Tex, eVent, H2No, others):** Waterproof and windproof. Used in shell gloves and waterproof gaiters. Adds weight and cost; reduces breathability vs. fleece alone. Incompatible with "warmth from material" — it is a barrier layer, not an insulator.

**Down:** High warmth-to-weight when dry; catastrophic when wet. Rare in accessories (some packable down beanies, down mitts). Requires DWR or waterproof shell to be useful in wet conditions.

**Nylon / synthetic shell:** Used in glove shells, gaiter bodies. Abrasion-resistant, wind-resistant, often DWR-treated. Low inherent warmth.

**Cotton:** Catastrophic in cold-wet conditions (loses virtually all insulation when wet). Appropriate only for sun hats (UPF cotton), casual/warm-weather items, or belts. Never recommend for cold/alpine.

**Neoprene:** Waterproof insulation for water-immersion contexts (kayaking gloves, wetsuit socks). Inappropriate for dry cold (sweat accumulation). Domain-specific.

---

## 5. Edge Cases and Hard-to-Classify Items

### The Buff — Poster Child for Facets-Not-Categories

A Buff (or equivalent tubular neck gaiter) is the single clearest argument against category-based modeling in this domain.

In a single item, a buff simultaneously:

- **body_zone_covered:** `["neck", "face", "head"]` — pulled down: neck gaiter. Pulled up over nose: full face cover. Pulled up further: beanie/hat substitute. All three at once if needed.
- **function_purpose:** `["warmth", "sun_protection", "wind_protection", "dust_filtration", "moisture_management"]` — a lightweight merino buff provides meaningful warmth in cool conditions, UPF 50+ for neck and face sun protection, wind break against cheek/chin, and wicks sweat.
- **layering_role:** `["standalone", "liner"]` — worn alone in shoulder season; under a helmet and over a beanie in deep winter.
- **conditions_temperature_range:** spans cool through moderate cold depending on configuration and material.

A category model forces a choice: "is this headwear or neckwear?" The answer is both, simultaneously, in the same item, configurable on the fly by the user. Any model that assigns it to one bucket loses half its recommendation value.

The facet model represents this correctly: `body_zone_covered = ["neck", "face", "head"]`, `function_purpose = ["warmth", "sun_protection", "wind_protection"]`. A recommendation query for "neck UV protection" finds the buff. A query for "head warmth backup" also finds the buff. A query for "face wind block" also finds the buff. Three queries, one item, correct all three times — with no category gymnastics.

**Lesson:** The buff demonstrates that body_zone_covered and function_purpose MUST be multi-label, globally, for the system to be useful.

---

### Liner Gloves — The Layering System Problem

Liner gloves (thin merino or synthetic) are typically marketed as standalone cool-weather gloves. But their primary technical role is as a liner inside a shell mitten for extreme cold — the liner provides dexterity and warmth-when-wet protection while the shell provides wind and water blocking.

A category model cannot represent "this glove is also a component in a layering system." A facet model assigns `layering_role = ["standalone", "liner"]` and `dexterity_level = "high"`, making it findable both as a standalone item and as a "liner component" in a system check.

**Implication:** The recommendation engine must be able to ask "does the user have a complete glove system for sub-20°F?" — which requires knowing liner vs. shell roles, not just "does the user have gloves?"

---

### Sun Hat vs. Sun Hoody UPF — Cross-Domain Zone Overlap

A Patagonia Terre Planing Hoody (in the seed corpus) has UPF 40 and a hood. It is apparel, not an accessory, but it provides `upf_rating = 40` for `body_zone_covered = ["torso", "arms", "head"]` when the hood is up.

A sun hat provides UPF for `body_zone_covered = ["head"]` only, but potentially with higher UPF (50+) and more facial shadow via brim coverage.

The system must not treat these as mutually exclusive or interchangeable. The sun hoody covers the torso too; the sun hat does not. The sun hat covers the face via brim shadow; the hoody hood does not (depending on cut). A trip requiring full-body UV protection might recommend BOTH — the hoody for torso/arm coverage and a hat for face shade — even though both cover head. The body_zone_covered facet, crossed with function_purpose, makes this reasoning possible. A category model ("this person has sun protection") collapses the nuance and misses the face shadow gap.

---

### Gaiters — Protective Layer or Equipment?

Gaiters are worn on the lower leg and foot, but they are not socks or shoes — they interface with footwear and leg position. They prevent snow/debris ingress and provide crampon retention loops on mountaineering versions. They resist water and abrasion.

They fit body_zone_covered = `["lower_leg", "ankles", "foot_top"]`, function_purpose = `["debris_protection", "water_resistance", "snow_exclusion", "crampon_compatibility"]`. Mountaineering gaiters add `activity_compatibility = ["mountaineering", "ice_climbing"]`.

This is NOT footwear (they don't contact the ground) and NOT legwear (they don't provide warmth to the leg beyond debris/wind). The facet model handles this without needing to invent a category.

---

### Belts — Marginal Accessory

Belts are the weakest member of this domain. Function for most outdoor belts is `["pants_retention", "gear_attachment"]`, body_zone = `["waist"]`, warmth = "none", UPF = "none". The only interesting facets are material (nylon webbing vs. leather) and gear attachment capability (MOLLE webbing, gear loops). Rarely a recommendation driver. Model them, but expect them to surface only in "gear attachment" or "pants compatibility" queries, not comfort/safety recommendations.

---

## 6. Cross-Domain Facet Overlaps

Several facets that appear above in the accessories domain also appear on apparel items in the seed corpus. This is not a collision — it is evidence that these facets belong to the GLOBAL facet schema, not to a domain-specific accessories schema.

### sun_protection / upf_rating

The Patagonia Terre Planing Hoody (apparel) has UPF 40. A sun hat (accessory) has UPF 50+. A buff (accessory) has UPF 50+. All three items should be findable by a query: "what items provide UV protection for the head/neck zone on this high-altitude trip?" This only works if `upf_rating` and `body_zone_covered` are global facets on ALL items, not domain-specific.

**Argument:** If upf_rating only exists on accessories, the Terre Planing Hoody's hood coverage disappears from UV queries. That is a meaningful gap — the user might pack redundant sun protection or miss that their hoody already covers the head zone.

### water_resistance_level

Appears on shell jackets (apparel), rain pants (apparel), gloves (accessories), gaiters (accessories), and socks (accessories). A trip query for "water resistance coverage: hands" requires the facet to exist uniformly on all items, regardless of domain.

### warmth_level

Appears on base layers, mid layers, insulation jackets (all apparel) AND beanies, gloves, buffs, socks (accessories). The warmth facet must be global and must carry body_zone_covered to be useful. "Does this user have adequate warmth coverage for hands at 10°F?" is only answerable if warmth_level and body_zone_covered coexist on gloves in the same schema as they do on jackets.

### wind_protection_level

Softshells, hardshells (apparel) AND wind-resistant gloves, tightly-woven buffs (accessories). Same argument.

### body_zone_covered — THE GLOBALLY LOAD-BEARING MULTI-LABEL FACET

**This is the single most important cross-domain argument:** body_zone_covered must be a multi-label facet on EVERY item in the system — apparel, accessories, footwear, and equipment.

Without it:
- The system cannot detect zone-coverage gaps ("user has nothing for hand warmth in sub-freezing conditions").
- The system cannot avoid redundant packing ("user has a buff AND a neck gaiter — overlap at neck zone").
- The system cannot reason about layering by zone ("user's torso warmth is covered by base layer + insulation; head warmth has only a thin beanie — potential gap in extreme cold").

With it, all of these are straightforward multi-label queries over a single facet.

### function_purpose — GLOBALLY LOAD-BEARING MULTI-LABEL FACET

Similarly, function_purpose must be global. A jacket that provides wind_protection as one of its functions AND a windproof hat that provides wind_protection should both surface in a query for "what covers head against wind?" — but only if function_purpose is multi-label and global, and crossed with body_zone_covered.

**Strong claim:** `body_zone_covered` (multi-label) and `function_purpose` (multi-label) are the two globally load-bearing facets. Every other facet is secondary — important for refinement, but these two are the structural foundation of the recommendation system's ability to detect gaps and overlaps. Any schema that omits or single-labels these facets is broken by design.

---

## 7. Unknown / Confidence Handling Notes (Accessories Domain)

The accessories domain has a particularly acute unknown problem because:

1. **Small-brand and generic items** dominate closets. A user's beanie may be an unbranded wool hat with zero publicly available specs. A "UPF 50+" buff from a no-name brand may have no independent verification.

2. **UPF is frequently omitted** from product listings even when the material (tightly woven nylon, merino) likely provides meaningful protection. Never infer "UPF = 50+" from material alone without confidence = LOW. State `upf_rating: null, upf_inferred: "likely_moderate", upf_confidence: "low"`.

3. **Glove warmth and dexterity ratings have no industry standard.** Every brand uses proprietary rating systems (e.g., "3 out of 5 warmth"). These cannot be cross-compared without normalization. Store the raw source value AND a normalized estimate WITH confidence = LOW unless the normalization methodology is documented.

4. **Lens category may not be stated** for fashion sunglasses. A UV400 sticker is verifiable; "100% UV protection" in marketing copy without a category number is LOW confidence for Category assignment (could be Category 1 or 3). Store `lens_category: null, uv_claim: "manufacturer_uv400_stated", uv_confidence: "medium"` — it blocks UV but the category/visible-light blocking is unknown.

5. **Buffs and multi-function items invite over-classification.** The LLM may confidently assign all possible function_purpose values to a buff. Resist this: only assign facet values supported by product description, material specs, or known item class behavior. Assign confidence = "medium" for class-level inferences (all tubular neck gaiters of tight-woven nylon typically provide wind protection), LOW for item-level speculation.

6. **Socks are systematically under-described.** Cushion zone, fiber content, height (no-show vs. ankle vs. crew vs. knee), and activity suitability are often poorly documented in secondhand or older gear. Unknown is better than guessed. A sock with unknown cushion zone should surface in queries with an explicit "spec unknown — verify before alpine trip" flag, not silently with a best-guess value.

**Protocol summary for this domain:**
- Manufacturer spec present → HIGH confidence, source = "manufacturer_spec"
- Clear product class inference (all softshell gloves are wind-resistant) → MEDIUM confidence, source = "llm_class_inference"
- Material-based inference (merino likely provides some UPF) → LOW confidence, source = "llm_material_inference"
- No basis for inference → null, confidence = "unknown", source = "unknown"

The `confidence` and `source` fields are not optional metadata — they are query targets. The recommendation engine must be able to filter out low-confidence specs when safety is the context (e.g., glacier UV protection), or surface them with an explicit warning, rather than treating a LOW confidence UPF inference as equivalent to a manufacturer-verified rating.
