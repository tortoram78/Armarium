# Domain Investigation: Shells / Wind / Weather Protection

**Domain:** Hardshells, softshells, windshirts, rain jackets, DWR-treated layers, rain pants  
**Investigation phase:** Phase 0 — Design / Discovery  
**Status:** Seed corpus analyzed; facet model proposed

---

## 1. Domain Scope

Weather protection is the capability that converts "I might get rained on" or "the ridge is exposed and windy" into "what do I actually need to stay functional." This domain owns the outer-layer side of that question.

**What weather protection covers:**

- Stopping wind from penetrating the layer stack (wind resistance / air permeability)
- Shedding liquid water, ranging from brief spray to sustained driving rain (waterproofness spectrum)
- Managing the consequence of moisture contact — how fast does the layer get wet, how fast does it dry
- Maintaining breathability so the wearer's own moisture vapor escapes during effort
- Storm features: hood construction, cuff sealing, hem length, packability under load
- Protection ceiling: the worst conditions the item credibly handles before it fails its weather-protection job

**What a real selection decision hinges on:**

1. Will the item actually stop rain in the conditions expected? (The binary that has safety consequences — getting this wrong soaks an insulation layer or causes hypothermia.)
2. How long can the wearer sustain aerobic effort in it? (Breathability vs. waterproof trade-off.)
3. Can it go in the pack and stay there until needed, or does it take too much space/weight? (Packability as a decision variable on longer trips.)
4. Is DWR the protection mechanism, or is there a membrane? (DWR alone is NOT waterproof — this distinction is load-bearing for recommendations.)
5. What is the aerobic activity level? A static belay stance in rain needs different gear than a high-output trail run in intermittent drizzle.

**What is explicitly NOT in scope for this domain:**

- Items whose weather resistance is incidental to a different primary function (e.g., a wool base layer that is "somewhat wind-resistant" — that is a base-layer concern, cross-referenced here)
- Pure insulation layers with no weather-protection membrane or DWR (they belong to insulation domain, though layering role facets overlap)

---

## 2. Decision-Driving Facets

### 2.1 Waterproof Rating (LOAD-BEARING — safety-critical)

**Name:** `waterproof_rating`  
**What it captures:** The actual mechanism and degree of liquid-water exclusion.  
**Value-space shape:** Ordered enum with null case:

```
null / unknown
none            — no water resistance claimed or present
dwr_only        — DWR surface treatment; sheds light spray; saturates over time; NOT waterproof
water_resistant — DWR + tightly woven face fabric; resists moderate rain for limited duration
wp_breathable   — waterproof-breathable membrane (ePTFE/PU laminate, 2L/2.5L/3L); seam sealing matters
wp_nonbreathable — fully waterproof (coated nylon/PVC), no meaningful MVTR
```

**Why it drives a decision:** This is the most safety-critical facet in the entire system. A recommendation that presents a DWR-only item as rain protection in sustained rain can result in the user being soaked through, losing insulation performance, and entering a hypothermia-risk scenario. The Terre Planing is the canonical example: it has DWR and dries fast, but under any rain lasting more than 20–30 minutes it will wet through. A multi-day-rain plan that relies on it as a "rain layer" is a dangerous recommendation.

**Confidence required:** Must be sourced from manufacturer spec or confirmed material knowledge. If unknown, value MUST be `null` — it must NOT default to any positive waterproof value. A `null` waterproof rating on an outer layer triggers a "gap: rain protection unknown" flag in trip planning.

**Load-bearing status:** LOAD-BEARING. Do not compress or omit.

---

### 2.2 Wind Resistance / Air Permeability (LOAD-BEARING)

**Name:** `wind_resistance`  
**What it captures:** Whether the fabric blocks or passes moving air.  
**Value-space shape:**

```
null / unknown
air_permeable   — softshells, grid fleece; wind passes through; minimal wind protection
wind_resistant  — tightly woven face fabric blocks most wind; no membrane needed
windproof       — confirmed 0 CFM / membrane-blocked; no air passes
```

**Why it drives a decision:** A windy ridge (e.g., Mount Marcy summit) with an air-permeable mid-layer and no wind shell is a classic cold-injury scenario. Wind resistance is a separate axis from waterproofness: a windshirt can be windproof and non-waterproof; a softshell can be water-resistant and air-permeable. These must be independently queryable.

**Load-bearing status:** LOAD-BEARING. Drives "will this stop wind" in plan reasoning.

---

### 2.3 Breathability / MVTR (DECISION-DRIVING)

**Name:** `breathability`  
**What it captures:** How effectively moisture vapor from sweat exits through the layer.  
**Value-space shape:**

```
null / unknown
high            — softshells, windshirts, DWR-only items; vapor passes freely
moderate        — 3L ePTFE laminates, high-end WP breathable; usable under sustained effort
low             — 2L PU laminates, entry-level WP breathable; manageable in aerobic bursts
very_low        — fully coated/PVC items; vapor barely exits; unsuitable for any sustained effort
```

**Why it drives a decision:** Breathability determines whether the item is viable for active use (hiking, running) vs. static use (belaying, camp tasks). A low-breathability waterproof shell during a 10-mile aerobic hike can soak the wearer from the inside. This facet pairs with `activity_intensity` on the trip to pick the right shell.

**Confidence note:** MVTR values from manufacturers are measured under lab conditions and are marketing numbers; treat them as ordinal-rank guidance, not absolute values. Confidence on specific MVTR numbers should be `low` unless directly sourced.

---

### 2.4 Waterproof Seam Sealing

**Name:** `seam_sealing`  
**What it captures:** Whether seams are taped/welded to block water entry at needle holes.  
**Value-space shape:**

```
null / unknown
none            — no seam sealing
critical_seams  — shoulder/chest seams sealed; side seams open
fully_sealed    — all seams taped or welded
```

**Why it drives a decision:** A waterproof membrane shell without seam sealing leaks at every needle hole. Full seam sealing is required for claims of "waterproof" in sustained rain. This facet is a tie-breaker: if `waterproof_rating = wp_breathable` but `seam_sealing = none`, the effective protection ceiling drops.

**Load-bearing status:** Tie-breaker for waterproof claims; important but secondary.

---

### 2.5 DWR Presence and Durability

**Name:** `dwr_presence`  
**What it captures:** Whether a durable water repellent surface treatment is applied, and if so, its expected durability.  
**Value-space shape:**

```
null / unknown
none
present_standard    — factory DWR; degrades with washing and use; re-treateable
present_c6          — PFC-free C6 chemistry; slightly less initial performance, similar durability trajectory
present_c8          — legacy PFC chemistry; high initial performance; being phased out
```

**Why it drives a decision:** DWR is the mechanism that causes water to bead off a face fabric rather than saturate it. On waterproof shells, DWR keeps the face fabric from wetting out (which would kill breathability even if the membrane is intact). On non-waterproof items like the Terre Planing, DWR is the PRIMARY water-shedding mechanism — and it is temporary and limited. DWR alone never equals waterproof. This facet must coexist with `waterproof_rating = dwr_only` to make the distinction explicit.

---

### 2.6 Hood and Storm Features

**Name:** `hood_features`  
**What it captures:** Whether the item has a hood and how storm-worthy it is.  
**Value-space shape:** Set of flags (an item can have multiple):

```
none
fixed_hood          — hood present, not removable
helmet_compatible   — hood sized for a climbing or ski helmet
wire_brim           — stiffened brim to shed water
adjustment_points   — one-hand or drawcord adjustment while wearing
draft_collar        — internal collar to seal neck gap
```

**Why it drives a decision:** A hood is required for rain or cold wind protection. The quality of that hood matters: a loose, unadjustable hood in driving rain is nearly useless; a helmet-compatible helmet-compatible hood matters in alpine terrain. "Has a hood" alone is not enough — hood quality drives the effective protection ceiling in bad weather.

---

### 2.7 Packability

**Name:** `packability`  
**What it captures:** Whether the item compresses small enough to carry "just in case."  
**Value-space shape:**

```
null / unknown
packs_to_pocket     — stuffs into own pocket or stuff sack < 0.5L (windshirts, ultralight shells)
packs_compact       — compressible to 0.5–1.5L (most hardshells)
bulky               — does not pack small; intended as worn or strapped (some 3L softshells)
```

**Why it drives a decision:** On a shoulder-season alpine day hike, a user who owns both a windshirt that packs to a pocket and a hardshell that takes 1.5L must decide which to carry. Packability is a gating variable when pack volume is constrained. It also drives "which shell should be the emergency/just-in-case layer."

---

### 2.8 Weather Protection Ceiling

**Name:** `protection_ceiling`  
**What it captures:** The worst conditions the item credibly handles before its weather-protection function degrades below acceptable.  
**Value-space shape:** Ordered enum:

```
null / unknown
light_spray         — light mist, brief splashing; DWR only; Terre Planing example
intermittent_rain   — moderate rain for 30–60 min; DWR + tight weave; no membrane
sustained_rain_low  — sustained moderate rain, several hours; entry-level WP breathable
sustained_rain_high — heavy sustained rain, all-day; fully sealed WP breathable shell
any_precipitation   — alpine storm, driving rain + wind; 3L fully seamed shell
```

**Why it drives a decision:** This facet is the synthetic roll-up of waterproof rating + seam sealing + hood quality into a single "what conditions can this actually handle" answer. It is a soft/inferred facet — it is derived from hard facets by LLM analysis at ingest, and its confidence must reflect the uncertainty of that inference. It is the facet that trip-planning logic queries first when matching gear to predicted conditions.

**Confidence:** Soft facet, inferred. Must carry `confidence` and `reasoning` fields. Low confidence if upstream hard facets are `null`.

**Load-bearing status:** LOAD-BEARING for recommendation queries. This is the primary facet that the "will this protect me" query runs on.

---

### 2.9 Layer Role (cross-domain)

**Name:** `layer_role`  
**What it captures:** Where this item sits in a layering system.  
**Value-space shape:** Set (items can fill multiple roles):

```
outer_shell         — wind and/or rain stop layer; always outermost
softshell_midouter  — softshells that straddle mid and outer layer role
active_insulation   — items with some weather protection AND insulation
standalone          — item functions as sole layer in mild conditions
```

**Why it drives a decision:** Trip planning needs to assemble a layer stack, not just pick individual items. Layer role encodes where the item lives in that stack and whether it is compatible with other items in the user's closet.

---

### 2.10 Activity Intensity Fit

**Name:** `activity_fit`  
**What it captures:** Whether the item is designed for high-aerobic-output activity, low-output/static, or both.  
**Value-space shape:**

```
null / unknown
static_only         — belaying, camp tasks, travel; not suitable for sustained aerobic effort
active_high_output  — running, fast hiking; breathability prioritized; may sacrifice waterproofness
versatile           — moderate effort; balanced breathability and protection
```

**Why it drives a decision:** Breathability, weight, and packability trade off against waterproofness. This facet names the design intent so the recommendation engine can match it to the trip's activity level without reasoning from scratch each time.

---

### 2.11 Construction Type

**Name:** `construction_type`  
**What it captures:** Whether the item is a hardshell (membrane), softshell (mechanical stretch + DWR), windshirt (no membrane, tight weave), or other.  
**Value-space shape:**

```
null / unknown
hardshell_2l        — 2-layer membrane; separate lining; heavier; less packable
hardshell_2_5l      — 2.5-layer membrane; printed internal backer; lighter
hardshell_3l        — 3-layer laminate; most durable; packable
softshell           — stretch woven; DWR; no membrane; breathable; limited weather protection
windshirt           — ultralight; no membrane; tight weave; windproof or resistant; minimal waterproofness
dwr_activity_layer  — primary function not shell; DWR treated; incidental weather resistance (Terre Planing)
```

**Why it drives a decision:** Construction type correlates strongly with protection ceiling, breathability, and packability. It is a useful grouping lens but must NOT be used as a fixed category bucket — it is one facet among many.

---

### Vanity Facets (acknowledged, deprioritized)

The following facets are representable but do not drive high-stakes decisions:

- `colorway` — no functional impact on weather protection
- `gender_fit` — cut preference, not protection function; may affect layering room
- `price_at_purchase` — financial tracking; not a recommendation variable
- `brand` — no functional role in recommendation logic; brand is evidence for spec inference, not a facet itself

---

## 3. Hard Facts vs. Soft Facets

### Hard (confirmable from spec or material science)

| Fact | Source type | Confidence when present |
|---|---|---|
| Membrane present / absent | Manufacturer spec | High |
| Membrane type (ePTFE vs. PU) | Manufacturer spec or material analysis | Medium-High |
| Layer construction (2L / 2.5L / 3L) | Manufacturer spec | High |
| DWR present / absent | Manufacturer spec | High |
| Waterproof rating (mm) | Manufacturer spec | Medium — lab value, not field value |
| Seam sealing type | Manufacturer spec | High |
| Weight | Manufacturer spec | High |
| Hood present | Inspection / spec | High |

### Soft (inferred, LLM-derived, confidence-marked)

| Fact | Derivation | Confidence range |
|---|---|---|
| `protection_ceiling` | Synthesized from waterproof_rating + seam_sealing + hood_features | Low–High depending on upstream |
| `breathability` bucket | Inferred from construction type + membrane type | Medium |
| `activity_fit` | Inferred from design intent signals (watersports origin, activity marketing) | Medium |
| `weather_resistance_vs_waterproof_distinction` | LLM must explicitly reason whether DWR-only = water resistant, not waterproof | Medium |

**Critical note on confidence propagation:** If `waterproof_rating` is `null`, then `protection_ceiling` must also be `null` or explicitly downgraded — it cannot synthesize a confident ceiling from a missing input. The system must propagate null conservatively through derived facets.

---

## 4. Material Linkage

### Membranes

**ePTFE (expanded polytetrafluoroethylene):** The Gore-Tex family and equivalents (eVent, Polartec NeoShell). Microporous structure: pores smaller than water droplets but large enough for vapor molecules. High-performance waterproof-breathable. ePTFE membranes are the standard for serious alpine hardshells.

**Polyurethane (PU) laminate:** Hydrophilic (moisture-absorbing) rather than microporous. Less expensive. Breathability is lower than ePTFE, especially in cold conditions. Common in entry-level and mid-range waterproof shells. PU membranes can delaminate over time.

### Layer Constructions

**2-layer (2L):** Membrane laminated to face fabric only; separate floating liner inside the shell. Heavier, less packable, but face fabric can be more varied. Liner traps moisture between membrane and body.

**2.5-layer (2.5L):** Membrane laminated to face fabric; internal surface has a printed or embossed backer (not a full liner). Lighter and more packable than 2L. Common in ultralight and packable shells.

**3-layer (3L):** Membrane sandwiched and laminated between face fabric and a thin interior textile. Most durable, most packable for a given protection level, lightest-feeling against skin. Premium shells.

### DWR Coatings

Applied to the face fabric of shells and also to non-shell garments (like the Terre Planing). Causes water to bead off rather than saturate the face fabric. On waterproof shells, DWR failure causes "wetting out" — the face fabric saturates, which dramatically reduces breathability even though the membrane is still intact. On non-waterproof garments, DWR is the primary and only water-shedding mechanism.

DWR degrades with washing, UV exposure, and abrasion. Re-treatment with aftermarket DWR spray restores function on used garments.

**C8 vs. C6 vs. PFC-free:** C8 chemistry (8-carbon chain PFC) offered excellent initial performance but persists in the environment and is being phased out. C6 is shorter-chain, somewhat less initial performance, similar durability trajectory. PFC-free DWR (non-fluorinated, typically silicone-based) is the direction the industry is moving; initial performance is currently somewhat lower, durability varies.

### Softshell Face Fabrics

Softshells use mechanically stretch-woven fabrics (nylon, polyester, sometimes with spandex) with a DWR treatment. They have no membrane. Breathability is high because vapor passes through the weave. Weather resistance is limited to DWR performance — once DWR wets out or the rain is sustained, softshells soak through. Softshells sacrifice protection ceiling for comfort and breathability.

### The Terre Planing's Material Profile

The Patagonia Stretch Terre Planing Hoody is 100% recycled polyester with a DWR treatment and a UPF 40 rating. Its design origin is watersports (paddling, surfing-adjacent): it is designed to dry fast after water contact, not to prevent water from entering. The DWR causes brief spray to bead off. Under sustained rain, the polyester face fabric absorbs water; the garment wets through. It will then dry faster than cotton or wool — but "dries fast when wet" is categorically different from "stays dry." The facet model must capture both: `dwr_presence = present_standard`, `waterproof_rating = dwr_only`, `protection_ceiling = light_spray`.

---

## 5. Edge Cases and Hard-to-Classify Items

### The Terre Planing: The Canonical Water-Resistant ≠ Waterproof Case

**Patagonia Stretch Terre Planing Hoody** is the item this section is built around. It occupies a genuinely ambiguous space that naive models collapse wrongly.

**What it IS:**
- DWR treated (water beads off in brief exposure)
- Fast-drying (watersports-origin fabric behavior)
- Wind-resistant (tight polyester weave)
- Breathable
- Active-fit (designed for movement)

**What it is NOT:**
- Waterproof (no membrane, no seam sealing)
- A rain shell (it will wet through in 20–30 minutes of moderate rain)
- Capable of protecting a down insulation layer underneath in sustained precipitation

**Why a naive model fails:** A model that stores "has DWR = weather protection" will recommend the Terre Planing as a rain layer on a wet multi-day trip. This is dangerous. The facet model must require `waterproof_rating = dwr_only` and `protection_ceiling = light_spray` for this item — and trip planning logic must treat `protection_ceiling = light_spray` as NOT satisfying a "rain protection needed" requirement.

**How the facet model encodes this correctly:**
- `waterproof_rating = dwr_only` (not `water_resistant`, not `wp_breathable`)
- `protection_ceiling = light_spray`
- `construction_type = dwr_activity_layer`
- Trip plan query: "sustained rain expected" → requires `protection_ceiling >= sustained_rain_low` → Terre Planing fails this filter → gap flagged

---

### Windshirt vs. Rain Shell

A windshirt (e.g., Patagonia Houdini) has:
- Tight weave, often with a DWR treatment
- Windproof or near-windproof
- Extremely packable (packs to pocket)
- NOT waterproof or even reliably water-resistant in rain

A rain shell has:
- A waterproof membrane
- Seam sealing (critical or full)
- Windproof as a consequence
- Less breathable than a windshirt
- More bulk

They are frequently confused because both are "outer layers." The facet model distinguishes them via `waterproof_rating` (`dwr_only` vs. `wp_breathable`) and `construction_type` (`windshirt` vs. `hardshell_*`). A trip plan that reads "wind protection needed, no rain" can return a windshirt as sufficient; "rain protection needed" cannot.

---

### Softshell: Straddling Shell and Insulation

A softshell (e.g., Arc'teryx Gamma) has weather resistance (DWR, sometimes wind-resistant weave) and is often worn as an outer layer in non-precipitation conditions. But it lacks a membrane and fails in sustained rain. It may also have a fleece or brushed interior, giving mild insulative value.

The facet model handles this by not forcing a category choice. A softshell gets:
- `layer_role = [outer_shell, softshell_midouter]` (set, not single value)
- `waterproof_rating = dwr_only` or `water_resistant` (never `wp_breathable`)
- `protection_ceiling = intermittent_rain` at best

A user who owns a softshell and asks for a "rainy ridge day" recommendation will receive a gap flag: "no confirmed rain shell; softshell protection ceiling is intermittent rain only."

---

### Partial Protection: How Facets Encode "Somewhat"

The facet model must resist the temptation to collapse partial protection into either "waterproof" or "no protection." The `protection_ceiling` enum is specifically designed to have intermediate values (`light_spray`, `intermittent_rain`, `sustained_rain_low`) that represent partial protection honestly. An item at `protection_ceiling = intermittent_rain` is correctly recommended for a trip with "brief afternoon showers likely" and correctly rejected for a trip with "all-day rain on exposed ridge."

**The rule:** Partial protection is a first-class value, not a workaround. The model must be able to say "this item handles X conditions but not Y conditions" without rounding to either extreme.

---

## 6. Cross-Domain Facet Overlaps

### DWR and Water Resistance on Non-Shell Layers

DWR is not exclusive to shells. Several items in this catalog family carry DWR:

- **Terre Planing** (primary domain: shells-wind; DWR is its primary water-resistance mechanism)
- **Patagonia Synchilla Snap-T / Outdoor Everyday Marsupial** — pile fleece items may have DWR; if present, it provides incidental wind and spray resistance, but these items are NOT shells and should not be recommended as weather protection
- **Patagonia R1 Air Full-Zip** — explicitly no DWR; no weather protection at all; purely a breathable mid-layer

The `dwr_presence` facet exists across multiple domains. The shell/wind domain does not own DWR as a facet — it co-owns it with base-layer and mid-layer domains. The distinction is: DWR on a shell item signals that it contributes to weather protection; DWR on a mid-layer item signals incidental moisture management, not weather protection. The `layer_role` facet plus `construction_type` carry this distinction.

### Wind Permeability Across Layers

Wind resistance matters even in mid-layers. A tight-woven mid-layer (e.g., a power-stretch fleece) reduces wind penetration even without a shell over it. This means the recommendation engine cannot treat wind protection as solely a shell concern — it must reason about the full stack. However, for the shell/wind domain, `wind_resistance` on the outer layer is the primary variable; mid-layer wind resistance is a soft bonus.

### Breathability as a Stack Property

MVTR (breathability) is relevant in every layer but is most constraining at the outer shell, because moisture vapor must pass through all layers to exit. A highly breathable base layer under a low-MVTR shell still results in a sweaty user. The `breathability` facet on the outer shell is the binding constraint for the full stack. This is a cross-domain concern that the recommendation layer must handle by reasoning about the complete layer assembly, not just each item in isolation.

---

## 7. Unknown / Confidence Handling Notes

### The Core Rule

If `waterproof_rating` is unknown for an item, it MUST be stored as `null`. It must NOT be assumed to be any positive protection value. Reason: a user who asks "what should I bring for a rainy summit day" will have the recommendation engine query `waterproof_rating >= wp_breathable`. A `null` item will correctly fail that filter and surface as a gap. A falsely-assumed `waterproof` item will be recommended — producing a dangerous kit.

### Propagation of Null Confidence

- If `waterproof_rating = null`, then `protection_ceiling` must be `null` or `unknown` — it cannot be derived without the upstream fact.
- If `seam_sealing = null` and `waterproof_rating = wp_breathable`, then `protection_ceiling` should be downgraded: a waterproof membrane without known seam sealing cannot be claimed to handle `sustained_rain_high`.
- If `hood_features = none`, then `protection_ceiling` should be capped at the "body protection only" variant of whatever the membrane provides — a headless waterproof shell does not protect in driving rain.

### DWR-Specific Null Handling

If `dwr_presence = null`, the system must not assume DWR is absent (which would underrate the item) or present (which would overrate it). The ingest pipeline should flag this for manual review on any item with `construction_type = dwr_activity_layer` or `softshell`, because DWR presence/absence is a key decision variable for these construction types.

### Confidence Fields

Every soft/inferred facet should carry:
- `value`: the inferred value
- `confidence`: `high | medium | low | unknown`
- `source`: `manufacturer_spec | llm_inference | user_provided | unknown`
- `reasoning`: brief LLM-generated justification (for soft facets, stored for auditability)

Hard facets from confirmed manufacturer specs can carry `confidence = high` and `source = manufacturer_spec` with no reasoning required. Unknown specs must not be promoted to `confidence = medium` without a traceable inference chain.

### The Danger of "Reasonable Assumption"

The LLM classification pipeline must be instructed that "this looks like a waterproof shell" is not sufficient evidence for `waterproof_rating = wp_breathable`. Only a confirmed membrane type (Gore-Tex, eVent, H2No with seam sealing, etc.) or explicit manufacturer claim ("fully waterproof, seam sealed") justifies a positive waterproof rating. Absence of this evidence means `null`.

---

## Appendix: Seed Corpus Facet Assignments (Weather Protection Domain)

| Item | `waterproof_rating` | `protection_ceiling` | `wind_resistance` | `dwr_presence` | `construction_type` | Notes |
|---|---|---|---|---|---|---|
| Patagonia Stretch Terre Planing Hoody | `dwr_only` | `light_spray` | `wind_resistant` (inferred) | `present_standard` | `dwr_activity_layer` | THE critical case. Fast-drying watersports origin. NOT a rain shell. |
| Patagonia R1 Air Full-Zip Hoody | `none` | `null` (no weather protection) | `air_permeable` | `none` | `null` (not a shell) | Out of scope for this domain; contrast case only. |
| Patagonia Lightweight Synchilla Snap-T | `null` | `null` | `air_permeable` (pile fleece) | `null` | `null` (not a shell) | Out of scope; no weather protection role. |
| Patagonia Outdoor Everyday Marsupial | `null` | `null` | `air_permeable` | `null` | `null` (not a shell) | Out of scope. |
| Kelty Galactic 30 | N/A | N/A | N/A | N/A | N/A | Sleeping bag; not in domain. |
| Hemp/Cotton Henley | `none` | `null` | `air_permeable` | `none` | N/A | Cotton; actively dangerous when wet. |

**Gap flagged by seed corpus analysis:** No item in the current seed corpus meets `protection_ceiling >= sustained_rain_low`. The user has NO confirmed rain shell. Any trip plan with "rain expected" or "alpine/summit" conditions must flag this as a critical gap.
