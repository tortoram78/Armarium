# Domain Investigation: Sleeping Bags / Sleep Insulation

> Phase 0 — Domain-Dimension Investigation
> Scope: sleeping bags, quilts, sleep insulation systems; pad R-value as a paired companion facet.
> Seed corpus reference: Kelty Galactic 30 (key item), Patagonia R1 Air, Terre Planing, Synchilla Snap-T, Marsupial, Hemp/cotton Henley (apparel neighbors for insulation facet sharing).

---

## 1. Domain Scope

Sleep insulation is the gear that keeps a person alive and comfortable during stationary, horizontal, nighttime sleep — the highest-consequence thermal scenario in outdoor use because the body generates minimal heat and cannot course-correct by moving. It is categorically different from insulated apparel: a sleeping bag must compensate for the full thermal deficit between ambient air temperature and a person's metabolic output while sleeping, with no ability to layer further once sealed inside.

**What belongs here:**
- Mummy-shaped sleeping bags (full-length zipper, hood, draft collar)
- Semi-rectangular and rectangular "car camping" bags (Kelty Galactic 30 is here)
- Ultralight quilts (open-back or partially enclosed, footbox or no footbox)
- Double sleeping bags
- Sleeping bag liners (as a companion/modifier, not primary insulation)

**What is adjacent but distinct:**
- Sleeping pads (different domain, but pad R-value is a **companion facet** — a sleeping bag rated to 20°F paired with a 1.0 R-value pad will fail badly; the two must be co-reasoned)
- Insulated jackets, hoodies, vests (shared insulation sub-model, different use-mode)
- Base layers (different domain, but layering-inside-a-bag is a real consideration for extending warmth)

**What a real selection decision hinges on:**
1. Will this bag keep me at the required temperature for the coldest night I'll encounter?
2. What rating standard does the stated temperature number refer to — and do I trust it?
3. How much does it weigh and how small does it pack? (backpacking vs. car camping)
4. Will it still insulate if wet, or does it fail catastrophically?
5. Does it match my sleep style (hot/cold sleeper, side sleeper needs width, quilt preference)?
6. Does the shell repel moisture (dew, condensation, tent moisture)?

---

## 2. Decision-Driving FACETS

Each facet entry covers: name, what it captures, value-space shape, decision relevance, and whether it is load-bearing or vanity.

---

### 2.1 `temp_rating_stated` — Stated Temperature Rating

**What it captures:** The number the manufacturer prints on the tag/marketing copy. It is the single most-consulted spec and also the most abused.

**Value-space:** `number | null` (in °F or °C, stored with a unit tag). Never conflate different scales.

**Why it drives decisions:** It is the first filter any buyer applies. Without it, no recommendation can even start.

**Load-bearing:** YES — but it must be paired with `temp_rating_standard` (see 2.2). In isolation it is nearly meaningless.

**Kelty Galactic 30 note:** The "30" is a marketing number. EN 13537 / ISO 23537 requires a calibrated manikin test. Most non-CE-market bags from the early-to-mid 2010s (including many Kelty products of that era) do NOT carry an EN-certified rating. The "30" is a manufacturer claim, not an independently verified EN comfort or limit rating. This must be stored as `temp_rating_stated: 30, temp_rating_unit: "F", temp_rating_standard: null, temp_rating_standard_confidence: "low"`.

---

### 2.2 `temp_rating_standard` — Rating Standard / Protocol

**What it captures:** WHICH protocol produced the stated temperature number. Values:
- `"EN13537_comfort"` — EN 13537 comfort rating (what a standard adult woman can sleep comfortably at)
- `"EN13537_lower_limit"` — EN 13537 lower limit (standard adult man, curled position, just warm enough)
- `"EN13537_extreme"` — EN 13537 extreme / survival threshold (not a comfort rating)
- `"ISO23537_comfort"` / `"ISO23537_lower_limit"` / `"ISO23537_extreme"` — ISO 23537 (same methodology, 2016 update, treated as compatible with EN 13537)
- `"marketing"` — manufacturer-stated without declared test protocol; effectively unverified
- `"season"` — a marketing "season rating" (3-season, 4-season) collapsed to a temperature; inherently vague
- `null` — unknown

**Value-space:** `enum | null`. This is a controlled vocabulary, not free text.

**Why it drives decisions:** A bag marketed as "30°F" under `"marketing"` standard may be comfortable only at 40°F or even 45°F for a cold sleeper. An EN comfort rating of 30°F is a materially stronger guarantee. Confusing them is dangerous, not just inaccurate.

**Confidence field:** `temp_rating_standard_confidence: "high" | "medium" | "low" | null`. Populated by LLM analysis at ingest based on product documentation, certifications visible in spec sheets, and known brand practices.

**Load-bearing:** YES. This is the most critical soft facet in the entire domain.

---

### 2.3 `fill_type` — Fill Material Type

**What it captures:** The insulation category. Controls wet-performance, packability ceiling, durability, and weight efficiency.

**Value-space:** `"down" | "synthetic" | "hybrid" | null`

- `"down"` — best warmth-for-weight and packability; fails dramatically when wet; recovers poorly unless treated
- `"synthetic"` — retains ~70–80% insulating ability when saturated; heavier and bulkier per unit warmth; degrades faster per wash cycle
- `"hybrid"` — uncommon; down body panels + synthetic footbox or shoulder zone; a real product decision worth storing

**Why it drives decisions:** Down vs. synthetic is the single highest-impact material choice. Wet environments, high humidity, multi-night trips without drying opportunity → synthetic wins. Weight-critical backpacking in dry conditions → down wins.

**Load-bearing:** YES.

**Kelty Galactic 30 note:** Kelty specifies "duck down" at 550 FP. This is confirmed `fill_type: "down"`.

---

### 2.4 `fill_power` — Fill Power (FP)

**What it captures:** The loft quality of down fill, measured in cubic inches per ounce (ASTM or DIN standard). Higher FP = more loft per weight = warmer and/or lighter bag possible.

**Value-space:** `integer | null`. Meaningful range: 450–900+. Values below 400 are rare/low-grade; values above 900 are premium.

**Why it drives decisions:** 550 FP (Kelty) vs 800 FP bags at the same temperature rating will differ significantly in packed volume and weight. FP is a direct predictor of packability for down bags.

**Load-bearing:** YES for down bags. Not applicable to synthetic (store as `null` for synthetic; do not fabricate a synthetic "FP equivalent").

**Source marker:** `fill_power_source: "manufacturer_stated" | "inferred" | null`. The Kelty spec is manufacturer-stated.

---

### 2.5 `fill_species` — Down Species

**What it captures:** Duck vs. goose down. Goose down of the same FP has marginally larger clusters and is considered premium; duck down is cheaper and adequate at the same FP number. Relevant for buyers with ethical or allergen concerns.

**Value-space:** `"duck" | "goose" | null`

**Why it drives decisions:** Mostly secondary — a 800 FP duck down and 800 FP goose down perform nearly identically in field use. However, it matters for purchasing ethics (live-pluck concern), and it is a stated fact (not inferred) for the Kelty.

**Load-bearing:** LOW (vanity for most decisions; load-bearing only for ethical filters).

**Kelty Galactic 30 note:** Explicitly "duck down." Store `fill_species: "duck"`.

---

### 2.6 `hydrophobic_treatment` — Hydrophobic Down Treatment

**What it captures:** Whether the down fill has been treated to resist moisture absorption. Trade names: DWR-treated down, DownTek, Nikwax Hydrophobic Down, etc.

**Value-space:** `boolean | null`. If known-true, optionally store `hydrophobic_treatment_brand: string | null`.

**Why it drives decisions:** Treated down absorbs water ~30–50% more slowly and retains significantly more loft when damp. In shoulder-season or humid conditions, it materially closes the gap with synthetic.

**Load-bearing:** MEDIUM. High-impact for wet/humid trip planning.

**Kelty Galactic 30 note:** Not specified in seed corpus. Store `hydrophobic_treatment: null, hydrophobic_treatment_confidence: "low"`.

---

### 2.7 `fill_weight` — Fill Weight

**What it captures:** The actual mass of insulation material inside the bag, in grams or ounces. Not the same as total bag weight. Directly determines warmth potential independent of FP (more fill = warmer at same FP).

**Value-space:** `number | null` with unit tag (`"g"` or `"oz"`).

**Why it drives decisions:** Fill weight × fill power together determine warmth ceiling. Two bags at "30°F" may achieve that via different fill-weight/FP combinations; the heavier fill-weight one tends to be more forgiving (more insulation mass to compensate loft compression from moisture or compression spots).

**Load-bearing:** MEDIUM-HIGH. Often not published for car-camping bags.

---

### 2.8 `total_weight` — Total Weight

**What it captures:** The full weight of the sleeping bag (fill + shell + zipper + hardware), in grams or ounces.

**Value-space:** `number | null` with unit tag.

**Why it drives decisions:** Primary filter for backpacking use. Car-camping bags are weight-agnostic; backpacking bags compete intensely on weight-per-warmth.

**Load-bearing:** YES for backpacking; LOW (vanity) for car camping. The `use_mode` facet disambiguates.

---

### 2.9 `packed_volume` — Packed Volume / Compressibility

**What it captures:** Volume when stuffed into its compression sack or comparable stuff sack, in liters or cubic inches.

**Value-space:** `number | null` with unit tag.

**Why it drives decisions:** Determines whether a bag fits in a backpack. A 12L sleeping bag on a 30L pack is a serious problem. Packability is the secondary backpacking filter after weight.

**Load-bearing:** YES for backpacking; LOW for car camping.

**Note:** 550 FP duck down (Kelty) is distinctly less compressible than 700–800 FP down at equivalent fill weight. The Kelty is a car-camping bag; this is expected and appropriate.

---

### 2.10 `bag_shape` — Shape / Cut

**What it captures:** The physical geometry of the bag.

**Value-space:** `"mummy" | "semi-rectangular" | "rectangular" | "quilt" | "double" | null`

- `"mummy"` — tapered, hooded; highest warmth-per-weight; claustrophobic for some
- `"semi-rectangular"` — wider shoulders and midsection, tapered but not hooded or with a detachable hood; compromise comfort/weight
- `"rectangular"` — full rectangular cut; lowest warmth-per-weight due to air space; maximum comfort/versatility; often car-camping
- `"quilt"` — no back insulation, open design, attached to a pad with straps; ultralight, demands a pad for warmth, cold gaps possible
- `"double"` — two-person design

**Why it drives decisions:** Shape determines suitability for use mode (quilt → backpacking/UL; rectangular → car camping). Mummy-vs.-rectangular is a comfort preference that also has thermal implications (dead air space = worse temp rating per stated number).

**Load-bearing:** YES.

**Kelty Galactic 30 note:** Rectangular/semi-rectangular (Kelty Galactic is a rectangular-cut camping bag, not a mummy). This anchors several other facets: weight is irrelevant, packed volume is large, use mode is car camping.

---

### 2.11 `has_hood` — Hood Present

**What it captures:** Whether the bag includes an integrated insulated hood.

**Value-space:** `boolean | null`

**Why it drives decisions:** A hood adds 5–10°F effective warmth. A bag without a hood requires a warm hat or balaclava to approach its stated temperature. For true cold-weather use, a hood is essential. Many rectangular bags lack hoods.

**Load-bearing:** MEDIUM. Must factor into effective temperature interpretation.

---

### 2.12 `draft_collar` — Draft Collar / Neck Baffle

**What it captures:** Presence of a tubular baffle around the neck/shoulder junction that prevents convective heat loss out the top of the bag.

**Value-space:** `boolean | null`

**Why it drives decisions:** Cold drafts through the top of a bag are a major heat loss vector. Draft collars are standard on expedition and mountaineering bags; often absent in car-camping bags.

**Load-bearing:** MEDIUM.

---

### 2.13 `zipper_draft_tube` — Zipper Draft Tube / Baffle

**What it captures:** Whether the bag has an insulated tube behind the zipper to prevent cold-air infiltration along the zipper track.

**Value-space:** `boolean | null`

**Why it drives decisions:** Zippers are thermal bridges. Without a draft tube, the entire zipper line bleeds warmth. Most quality bags at 30°F and below have this; many car-camping bags do not.

**Load-bearing:** MEDIUM.

---

### 2.14 `shell_material` — Outer Shell Material

**What it captures:** The fabric used for the bag's exterior shell. Relevant for moisture resistance, durability, and weight.

**Value-space:** free text or structured `{ fabric: string | null, denier: number | null, dwr_treated: boolean | null }`. At minimum: `shell_dwr: boolean | null`.

**Why it drives decisions:** Shell DWR delays moisture absorption. Higher-denier fabrics are more durable but heavier (car-camping appropriate). Ultra-thin ripstop nylons used in UL bags are delicate.

**Load-bearing:** LOW-MEDIUM. More important in wet environments.

---

### 2.15 `use_mode` — Intended Use Mode

**What it captures:** The primary usage context. NOT a fixed category — this is an inferred facet from weight + shape + fill type + packability together.

**Value-space:** `"car_camping" | "backpacking" | "ultralight_backpacking" | "mountaineering" | "multi_use" | null`

**Why it drives decisions:** Determines which other facets are load-bearing vs. vanity. For car camping, weight and packed volume are irrelevant; comfort, shape, and temperature accuracy matter. For UL backpacking, weight and packed volume are primary.

**Load-bearing:** YES as a derived context-selector, not a primary classification bucket. It is EMERGENT from other facets, not assigned independently.

---

### 2.16 `pad_r_value_recommended` — Companion Pad R-Value (Paired Facet)

**What it captures:** The minimum sleeping pad R-value needed for the bag to perform at its stated temperature rating. Not a property of the bag itself — a system-pairing recommendation.

**Value-space:** `number | null` (R-value is unitless; higher = more insulation)

**Why it drives decisions:** Ground cold (conductive heat loss through contact) bypasses sleeping bag insulation entirely. A bag rated to 20°F paired with a 1.0 R-value closed-cell foam pad will fail by ~15–20°F in practice. The recommendation layer must co-reason bag + pad.

**Load-bearing:** YES at the system/recommendation level. Stored as a bag-side hint, not a hard constraint.

**Note:** Industry rule of thumb: every 10°F colder, add ~1.0 R-value. 30°F → suggest R ≥ 3.0–4.0; 0°F → suggest R ≥ 5.0+.

---

## 3. Hard Facts vs. Soft Facets

### Hard (directly observable or stated by manufacturer):

| Facet | Nature | Source |
|---|---|---|
| `fill_type` | Hard fact | Manufacturer spec |
| `fill_power` | Hard fact (if stated) | Manufacturer spec |
| `fill_species` | Hard fact (if stated) | Manufacturer spec |
| `temp_rating_stated` | Hard fact (the number only) | Manufacturer tag |
| `total_weight` | Hard fact | Manufacturer spec |
| `bag_shape` | Hard fact | Visual / spec |
| `has_hood` | Hard fact | Spec |

### Soft / Inferred (require analysis, may carry uncertainty):

| Facet | Nature | Risk |
|---|---|---|
| `temp_rating_standard` | Soft/inferred | CRITICAL — a marketing "30" must not be silently upgraded to an EN comfort "30" |
| Effective comfort temperature | Soft/derived | Depends on sleep style, gender, metabolic rate |
| `use_mode` | Soft/derived | Emergent from other facets |
| `hydrophobic_treatment` | Soft (often not stated) | Default null; never guess |
| `pad_r_value_recommended` | Soft/derived | Industry rule-of-thumb, not a hard spec |

### Confidence model:

Every facet that is soft or derived carries a parallel `{facet_name}_confidence: "high" | "medium" | "low" | null` field. The LLM analysis pipeline populates this at ingest. Hard facts from a manufacturer spec sheet carry `"high"` confidence. Inferred standards from product copy pattern-matching carry `"medium"` or `"low"`.

---

## 4. Material Linkage: Shared Insulation Behavior Model

### The core insight

Down insulation in a sleeping bag and down insulation in a Patagonia puffer jacket share identical physics. Fill power, fill weight, loft, wet-performance, hydrophobic treatment — these are properties of the **insulation material itself**, not of the outer product. Modeling them twice (once for bags, once for jackets) introduces drift and contradiction.

### Proposed unified `InsulationBehavior` facet sub-model

This sub-model is a reusable embedded type, applicable to any product that has an insulation layer:

```
InsulationBehavior {
  fill_type:                "down" | "synthetic" | "hybrid" | null
  fill_power:               integer | null          // only meaningful for down
  fill_species:             "duck" | "goose" | null // only meaningful for down
  fill_weight_g:            number | null
  hydrophobic_treatment:    boolean | null
  hydrophobic_brand:        string | null           // e.g. "DownTek", "Nikwax"
  wet_performance:          "excellent" | "good" | "poor" | null
                            // derived: down untreated → "poor"; synthetic → "good";
                            //          hydrophobic down → "good"
  warmth_for_weight:        "very_high" | "high" | "medium" | "low" | null
                            // derived from fill_power + fill_weight + product weight
  packability:              "very_high" | "high" | "medium" | "low" | null
                            // derived from fill_power + fill_weight + shell
  loft_recovery:            "excellent" | "good" | "poor" | null
                            // down = excellent; synthetic degrades with washes
}
```

### Application across domains:

- **Sleeping bags:** embed `InsulationBehavior` as a required sub-model. Bags gain all insulation analysis for free.
- **Insulated mid-layers (jackets, vests, hoodies):** embed the same `InsulationBehavior`. Patagonia Marsupial (down), Patagonia R1 Air (synthetic fleece — fill_type not applicable; model differently) all use it.
- **The R1 Air caveat:** The Patagonia R1 Air is a stretch-fleece mid-layer, not a fill insulator. It has no discrete fill material. It should NOT use `InsulationBehavior` with a fill_type; instead it uses a `material_behavior` facet covering loft, breathability, and surface structure. The shared model should be opt-in, not forced on all mid-layers.

### What to share vs. keep domain-specific:

| Facet | Shared (bags + jackets) | Bag-only |
|---|---|---|
| `fill_type` | YES | — |
| `fill_power` | YES | — |
| `fill_species` | YES | — |
| `fill_weight_g` | YES | — |
| `hydrophobic_treatment` | YES | — |
| `wet_performance` (derived) | YES | — |
| `warmth_for_weight` (derived) | YES | — |
| `packability` (derived) | YES | — |
| `temp_rating_stated` | NO | YES |
| `temp_rating_standard` | NO | YES |
| `bag_shape` | NO | YES |
| `draft_collar` | NO | YES |
| `has_hood` | Partially (hoods on jackets too) | bag-specific hood type |
| `pad_r_value_recommended` | NO | YES (system-level) |

---

## 5. Edge Cases and Hard-to-Classify Items

### 5.1 The Kelty Galactic 30 Rating Ambiguity

The Kelty Galactic 30 is the canonical example of why `temp_rating_standard` is a first-class required field, not an afterthought.

- The "30" is printed in large type. It implies "30°F."
- Kelty does not, as of the period relevant to this bag, publish EN 13537 manikin test results for this product line. It is a value-oriented, car-camping bag sold through mass retail.
- The actual EN comfort equivalent may be 40–45°F. A cold sleeper may find 45°F the practical comfort floor.
- **Correct representation:**
  ```
  temp_rating_stated: 30
  temp_rating_unit: "F"
  temp_rating_standard: null
  temp_rating_standard_confidence: "low"
  temp_rating_standard_note: "marketing/season-style claim; EN 13537 certification not documented"
  ```
- **Incorrect representation (the anti-pattern to prevent):**
  ```
  temp_rating_stated: 30
  temp_rating_standard: "EN13537_comfort"  // FABRICATED — never do this
  ```

Any recommendation system that treats the Kelty "30" as equivalent to a manikin-tested EN comfort 30°F bag will over-recommend it for genuinely cold conditions and could produce dangerous packing advice.

### 5.2 Down-When-Wet Failure Mode

Down loses 80–90% of its insulating loft when saturated. This is not gradual — it is a cliff. A `wet_performance: "poor"` flag on non-hydrophobic down must propagate into:
- Trip condition matching: rain, high humidity, multi-night without drying → penalize or warn against down (unless hydrophobic-treated)
- Gap analysis: if a user owns only a non-hydrophobic down bag and is planning a wet coastal trip, that is a flagged gap

This is a recommendation-layer concern, but the facet (`wet_performance`, `hydrophobic_treatment`) must be stored at ingest to make it computable later.

### 5.3 Quilts vs. Bags

A sleeping quilt has no back insulation and no zipper. It attaches to a sleeping pad via straps. It is strictly a system component — it **requires** a sleeping pad with sufficient R-value to compensate for the absent back insulation (which in a bag is compressed and ineffective anyway, but a quilt exposes the pad interface explicitly).

Facet model handles this naturally:
- `bag_shape: "quilt"` — signals the open-back design
- `pad_r_value_recommended` — becomes more critical, not optional
- `temp_rating_stated` — quilt manufacturers often use different conventions; apply same rating-standard skepticism

A quilt is NOT a miscellaneous item that falls outside the model. It occupies the same facet space with different values.

### 5.4 Fill-Type "Hybrid" Bags

Some bags use down in the body and synthetic in the footbox or hood (where moisture accumulates from breath condensation). These are real products. `fill_type: "hybrid"` accommodates them. The `wet_performance` derived facet should reflect the synthetic zones as a modifier: `"medium"` rather than `"poor"`.

### 5.5 Temperature-Unit Inconsistency

North American brands state ratings in °F; European brands often use °C. The EN 13537 standard outputs in °C. All storage must be normalized to a single unit with explicit unit tag. Recommendation layer converts at query time. Never store "30" without knowing if it is °F or °C — those are 54°F apart.

---

## 6. Cross-Domain Facet Overlaps

### Strong overlaps (bags ↔ insulated jackets / mid-layers)

The following facets are **identical in semantics** across sleeping bags and insulated apparel:

| Facet | Overlap strength | Recommendation |
|---|---|---|
| `fill_type` | IDENTICAL | Shared via `InsulationBehavior` |
| `fill_power` | IDENTICAL | Shared |
| `fill_species` | IDENTICAL | Shared |
| `fill_weight_g` | IDENTICAL | Shared |
| `hydrophobic_treatment` | IDENTICAL | Shared |
| `wet_performance` (derived) | IDENTICAL logic | Shared derived rule |
| `warmth_for_weight` (derived) | IDENTICAL logic | Shared derived rule |
| `packability` (derived) | IDENTICAL logic | Shared derived rule |
| `loft_recovery` | IDENTICAL | Shared |

### Recommendation: YES, share one insulation sub-model

Bags and insulated jackets should share a single `InsulationBehavior` sub-model embedded in both product schemas. The alternative — duplicating fill facets in each domain schema — guarantees inconsistent classification (fill_power might be rated differently by different LLM calls to different schemas), makes cross-domain queries harder, and violates DRY at the data-model level.

**The shared model is not a compromise — it is more correct.** Down is down. 700 FP goose down in a Patagonia Fitz Roy Parka and 700 FP goose down in a Western Mountaineering UltraLite bag behave identically from a fill-physics standpoint. The product differences (bag vs. jacket) are captured by the outer product schema, not by duplicating the insulation model.

### Where bags diverge from apparel (do NOT share):

- `temp_rating_stated` + `temp_rating_standard` — bags have temperature ratings; apparel does not (a jacket does not have an EN manikin rating)
- `bag_shape`, `draft_collar`, `zipper_draft_tube` — bag-specific construction
- `pad_r_value_recommended` — bag-system facet, no analog in jackets
- `has_hood` — both have hoods, but the thermal role is different (sleeping bag hood is critical for rating; jacket hood is more weather-protection oriented); keep separate facets, do not conflate

---

## 7. Unknown / Confidence Handling Notes

### Core principle: "Unknown" is a first-class value, not a gap to be filled

Every facet value is accompanied by a `{facet}_confidence` field and optionally a `{facet}_source` field. The LLM analysis pipeline must populate these at ingest. The schema must enforce their presence.

### Temperature rating standard: the highest-stakes unknown

The most dangerous silent failure in this domain is silently assigning a high-confidence EN comfort rating to a marketing temperature number.

**Required handling at ingest:**
1. Extract `temp_rating_stated` (the raw number) — this is almost always available.
2. Separately infer `temp_rating_standard` from product documentation, certifications, or known brand practices.
3. If the standard cannot be determined with at least `"medium"` confidence, store `temp_rating_standard: null, temp_rating_standard_confidence: "low"`.
4. The recommendation layer must surface this uncertainty rather than silently using the number as if it were EN comfort.

**Failure scenarios to prevent:**
- User owns Kelty Galactic 30. System stores `temp_rating_standard: "EN13537_comfort"` (fabricated). System recommends bag for a 32°F backpacking trip. User is severely cold. This is a safety issue, not just a UX issue.
- User owns a certified EN comfort 15°F bag. System stores `temp_rating_standard: null`. System is appropriately conservative. This is safe — uncertainty is handled correctly even if it reduces recommendation confidence.

**Hierarchy of safety:**
```
Known EN comfort rating → use directly
Marketing rating, known brand/era to under-rate → apply conservative adjustment, flag
Rating standard unknown → store as null, surface uncertainty in recommendations, never silently treat as EN comfort
```

### Other facets with high unknown rates:

| Facet | Expected unknown rate | Handling |
|---|---|---|
| `fill_weight_g` | High (often not published for car-camping bags) | `null` + note |
| `hydrophobic_treatment` | Medium (premium bags state it; budget bags often don't) | `null`, not assumed `false` |
| `packed_volume` | Medium | `null` |
| `shell_dwr` | Medium | `null` |
| `fill_species` | Low for down bags (usually stated) | `null` if not stated |

**Important note on `hydrophobic_treatment`:** The absence of a stated hydrophobic treatment does NOT mean the bag has untreated down. It means the treatment status is unknown. Store `null`, not `false`. The recommendation layer should treat `null` conservatively (as if untreated when recommending for wet conditions).

---

## Appendix: Kelty Galactic 30 — Complete Facet Snapshot

| Facet | Value | Confidence | Source/Note |
|---|---|---|---|
| `fill_type` | `"down"` | high | Manufacturer stated |
| `fill_power` | `550` | high | Manufacturer stated |
| `fill_species` | `"duck"` | high | Manufacturer stated ("duck down") |
| `fill_weight_g` | `null` | — | Not in seed corpus |
| `hydrophobic_treatment` | `null` | low | Not stated; do not assume |
| `temp_rating_stated` | `30` | high | Tag; marketing claim |
| `temp_rating_unit` | `"F"` | high | North American market product |
| `temp_rating_standard` | `null` | low | EN 13537 certification not documented |
| `temp_rating_standard_note` | `"marketing/season-style; EN cert not found"` | — | Inferred |
| `bag_shape` | `"rectangular"` | high | Product description (Galactic series) |
| `has_hood` | `null` | low | Not confirmed in seed corpus |
| `draft_collar` | `null` | low | Not confirmed; unlikely for rectangular car-camping bag |
| `total_weight` | `null` | — | Not in seed corpus |
| `packed_volume` | `null` | — | Not in seed corpus |
| `wet_performance` | `"poor"` | medium | Derived: non-hydrophobic down (assumed) |
| `use_mode` | `"car_camping"` | high | Derived from rectangular shape + 550 FP duck down |
| `pad_r_value_recommended` | `3.0` | low | Rule-of-thumb for ~30°F; not a hard spec |
