# Classification Rubric & Prompt (Layer 1)

> The contract for mapping any garment/gear item onto the facet ontology ([DESIGN.md §3](../../DESIGN.md)).
> This is the **proposed** prompt + rubric used by `src/core/` in Phase 1. The model is referenced via
> one constant: `MODEL_ID = "claude-sonnet-4-6"`. Output is validated by registry-derived Zod **before
> any use** — unvalidated text never persists.

## Design rules the prompt must enforce

1. **Unknown = `null`, never guessed.** If a property is not stated and cannot be inferred with
   genuine confidence, return `null` with `confidence: "unknown"`. A wrong spec is worse than a missing
   one.
2. **Hard facts need a real source.** Composition %, fill power, fill weight, UPF, EN/ISO temperature
   ratings, denier, crampon compatibility, mm waterproof ratings — these may be returned with a value
   **only** if `source` is `"manufacturer"` or `"user"`. If you are inferring, return `null`. (The
   validator mechanically demotes any inferred hard fact to `null`.)
3. **Soft facets are inferable** from composition, construction, and product description, but must
   carry calibrated `confidence` and a one-line `evidence` string citing the basis.
4. **Multi-label facets** return an array drawn **only** from the allowed members; an item legitimately
   holds several at once. Do not force a single value.
5. **No categories.** Do not emit a "type"/"category". Place the item on facets; the system derives
   grouping. (A coarse `applicable_groups` hint may be returned to indicate which domain group tables
   apply — e.g. `["insulation","sleep"]` — but it is advisory for storage routing only and is never
   used for recommendations.)

## Output shape (validated)

```jsonc
{
  "name": "Patagonia Stretch Terre Planing Hoody",
  "identity": {
    "brand": { "value": "Patagonia", "source": "manufacturer", "evidence": "product name" },
    "model": { "value": "Stretch Terre Planing Hoody", "source": "manufacturer", "evidence": "product name" },
    "price_cents": { "value": null, "source": "unknown" },
    "weight_grams": { "value": null, "source": "unknown" }
  },
  "materials": [
    { "role": "shell",
      "fiber_components": [{ "fiber": "polyester", "pct": 100, "recycled": true }],
      "construction_type": "woven",
      "source": "manufacturer", "evidence": "100% recycled polyester" }
  ],
  "treatments": [ { "kind": "dwr", "condition": "factory_fresh", "source": "manufacturer", "evidence": "DWR finish" } ],
  "facets": [
    { "key": "waterproofness",     "value": "dwr",          "confidence": "high",   "source": "manufacturer", "evidence": "DWR finish, explicitly NOT waterproof" },
    { "key": "wind_resistance",    "value": "wind_resistant","confidence": "medium", "source": "inferred",     "evidence": "woven poly sheds light wind, no membrane" },
    { "key": "breathability",      "value": "high",         "confidence": "high",   "source": "inferred",     "evidence": "lightweight woven sun hoody" },
    { "key": "moisture_management","value": "wicks",        "confidence": "medium", "source": "inferred",     "evidence": "polyester, watersports origin" },
    { "key": "dry_speed",          "value": "fast",         "confidence": "high",   "source": "manufacturer", "evidence": "marketed fast-drying" },
    { "key": "warmth_when_wet",    "value": "neutral",      "confidence": "medium", "source": "inferred",     "evidence": "synthetic, thin" },
    { "key": "warmth",             "value": "minimal",      "confidence": "high",   "source": "inferred",     "evidence": "single-layer sun hoody" },
    { "key": "packability",        "value": "packable",     "confidence": "medium", "source": "inferred",     "evidence": "thin woven" },
    { "key": "upf",                "value": 40,             "confidence": "high",   "source": "manufacturer", "evidence": "40 UPF stated" },
    { "key": "technical_vs_lifestyle", "value": "versatile","confidence": "medium","source": "inferred",     "evidence": "technical fabric, casual styling" }
  ],
  "multilabel": {
    "layering_role":     ["next_to_skin", "standalone"],
    "function_purpose":  ["sun_protection", "water_resistance", "cooling"],
    "body_zone_covered": ["torso", "arms", "head"],
    "activity_fit":      ["hiking", "watersports", "travel"],
    "conditions_fit":    ["warm", "hot", "high_sun"]
  },
  "applicable_groups": []
}
```

> Note the deliberate omission of `rain_protection` from `function_purpose` and the `dwr` (not
> `wp_breathable`) waterproofness — this is what makes the Terre Planing structurally ineligible as
> rain protection.

## Per-facet rubric (anchors prevent inter-run drift)

### Universal
- **`waterproofness`** `none < dwr < water_resistant < wp_breathable < wp_nonbreathable`.
  `dwr` = factory durable water repellent on a face fabric (sheds light spray, wets out under
  sustained rain). `water_resistant` = tightly woven/coated, more resistant, still **no membrane**.
  `wp_breathable` = membrane/laminate (Gore-Tex, H2No, eVent). `wp_nonbreathable` = coated/rubber.
  **Unknown ⇒ `null`.** Never label something waterproof without a membrane/rating.
- **`wind_resistance`** `none < wind_resistant < windproof`. Membrane shells and tightly woven
  windshirts → `windproof`; most fleece → `none`–`wind_resistant`.
- **`breathability`** `low < moderate < high < very_high`. Grid fleece/sun hoody → `high`/`very_high`;
  pile fleece → `low`–`moderate`; membrane hardshell → `moderate`.
- **`moisture_management`** `wicks | neutral | absorbs_holds`. Merino/poly next-to-skin → `wicks`;
  **cotton/hemp/linen → `absorbs_holds`** (cellulosic, hydrophilic).
- **`dry_speed`** `slow < moderate < fast < very_fast`. Poly/nylon → `fast`/`very_fast`;
  cotton/hemp/down → `slow`.
- **`warmth_when_wet`** `collapses < neutral < retains`. **down (untreated) → `collapses`**; synthetic
  fill/fleece → `neutral`/`retains`; **cotton/hemp → `collapses`**; merino → `retains`.
- **`warmth`** `minimal < light < moderate < high < very_high`. **Anchors:** sun hoody → `minimal`;
  R1 Air grid → `light`; Synchilla Snap-T → `moderate`; 800FP belay parka → `very_high`.
- **`packability`** `bulky < moderate < packable < ultra_packable`. Down → `ultra_packable`; pile
  fleece → `moderate`/`bulky`.
- **`technical_vs_lifestyle`** `lifestyle < mostly_lifestyle < versatile < mostly_technical < technical`.
  **Anchors:** Snap-T/Marsupial → `mostly_lifestyle`; Terre Planing → `versatile`; alpine hardshell →
  `technical`.
- **`upf`** (hard) integer if stated, else `null`.

### Multi-label
- **`layering_role`** ⊂ `{next_to_skin, base, active_insulation, static_insulation, mid, wind_shell,
  weather_shell, sleep_system, standalone, accessory}`. R1 Air → `[next_to_skin, active_insulation,
  standalone]`. A sleeping bag → `[sleep_system]` (excluded from worn-layer capabilities).
- **`function_purpose`** ⊂ `{warmth, insulation, wind_protection, rain_protection, water_resistance,
  sun_protection, moisture_wicking, cooling, abrasion_protection, carry, sleep, lifestyle}`.
  **`water_resistance` ≠ `rain_protection`** — only emit `rain_protection` for membrane/waterproof items.
- **`body_zone_covered`** ⊂ `{head, face, neck, torso, arms, hands, legs, feet, eyes}`. A buff →
  `[head, neck, face]`.
- **`activity_fit`**, **`conditions_fit`** — see DESIGN.md §3.2.

### Group facets (emit only when applicable; set `applicable_groups`)
- **insulation:** `fill_type` (hard), `fill_power` (hard, down only), `fill_species` (hard),
  `fill_weight_g` (hard, usually `null`), `hydrophobic_treatment` (hard bool|null — **`null` ≠ false**),
  + derived `wet_performance`, `warmth_for_weight`.
- **sleep:** `temp_rating_value` + `temp_rating_unit` (hard); **`temp_rating_standard`** — set `null`
  with `confidence: low` **unless an EN/ISO certification is explicitly stated** (never upgrade a
  marketing number like "30" to a comfort rating); `shape`; `pad_r_value_recommended`.
- **shell:** `protection_ceiling` (derived), `seam_sealing` (hard, gate), `hood`, `pit_zips`.
- **carry:** `capacity_liters` (hard), `suspension`, `max_comfortable_load_kg` (soft), `access_style`.
- **footwear:** `support_stiffness`, `ankle_height`, **`crampon_compat`** (hard, **NEVER inferred** —
  `null` unless manufacturer-stated), `water_management`.

## Worked anchors (expected key outputs)

| Item | Must produce | Must NOT produce |
|------|--------------|------------------|
| Terre Planing | `waterproofness=dwr`, `function ∌ rain_protection`, `upf=40` | `waterproofness=wp_*`, `rain_protection` |
| hemp Henley | `moisture_management=absorbs_holds`, `warmth_when_wet=collapses`, materials `[{hemp,55},{cotton,45}]` | `wicks`; any guessed weight |
| Kelty Galactic 30 | `item_sleep.temp_rating={value:30,unit:F,standard:null,confidence:low}`, `item_insulation={down,550,duck}` | `temp_rating_standard=en_iso_comfort` |
| R1 Air | `layering_role=[next_to_skin,active_insulation,standalone]`, `waterproofness=none` | a single category |

## Confidence calibration

- **high** — stated by manufacturer, or a near-deterministic inference (cotton → `absorbs_holds`).
- **medium** — a sound inference from composition/construction with some ambiguity.
- **low** — a weak inference; flag for user review.
- **unknown** — not stated and not reliably inferable ⇒ `value: null`.
