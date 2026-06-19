# Domain Investigation: Base Layers / Next-to-Skin Layers

**Domain:** BASE LAYERS — synthetic, merino, blends; tops and bottoms; underwear; sun hoodies worn next-to-skin.
**Investigator role:** Domain-Dimension agent for Armarium gear recommendation system.
**Date:** 2026-06-19

---

## 1. Domain Scope

Base layers are any garment worn directly against skin whose primary job is **body-climate management**: moving sweat away from skin, regulating temperature, and protecting skin from sun, abrasion, or insect exposure. They are not insulation and they are not weather protection — though individual items may carry secondary functions in those directions.

**What belongs here:**

- Lightweight and midweight synthetic wicking tops and bottoms (polyester, nylon blends)
- Merino wool tops and bottoms, all weights (150–260 gsm and beyond)
- Merino/synthetic blends
- Cotton and cotton-blend underwear and shirts (included as anti-recommendation candidates — present in real collections)
- Hemp/organic cotton blend shirts (same: present, sometimes mislabeled as "trail-ready")
- Long-sleeve sun hoodies (UPF-rated) worn next-to-skin as a primary layer
- Thermal/grid base layers that live at the skin interface (e.g., Patagonia R1 Air when worn next-to-skin)
- Sports bras and base-layer underwear/boxers

**What is at the domain boundary (edge cases handled in §5):**

- Grid fleece pieces like the Patagonia R1 Air — these can be a base OR a light mid; role depends on conditions and stack
- Sun hoodies like the Stretch Terre Planing Hoody — worn next-to-skin in hot/water contexts; ambiguously base or standalone
- Lightweight softshells worn against skin in cold-dry conditions

**What a real selection decision actually hinges on:**

When a trip planner (human or system) considers a base layer, the true decision drivers are:

1. Will the fiber stay functional when wet from sweat or rain?
2. How fast will it dry — relative to the pace and weather of the activity?
3. Will it retain warmth when wet, or collapse to a wet cold rag?
4. Will the person be moving hard (generating high sweat load) or standing around (losing heat fast)?
5. How many days before laundry? (odor resistance becomes critical)
6. Is sun protection a skin-exposure concern?
7. Does the item fit under a mid-layer or shell without restriction?
8. Is skin sensitivity or itch-factor a real constraint?

These eight questions map almost exactly onto the facets in §2.

---

## 2. Decision-Driving Facets

Facets are the axes of the item's attribute space. A base layer item occupies a position on ALL of these simultaneously. Recommendations are queries across this space; no fixed "category" enum is required.

---

### FACET 1: Moisture Management Mode
**What it captures:** How the fiber handles liquid sweat at the skin interface — does it wick away, spread, absorb and hold, or repel?

**Value space:** Categorical-as-facet (multi-label), because multiple mechanisms can coexist:
- `wicking_spread` — synthetic (polyester, nylon): pulls moisture away, spreads across fabric face for evaporation
- `absorb_release` — merino: absorbs into fiber core (up to ~35% fiber weight), releases slowly; feels drier than cotton despite absorption
- `absorb_hold` — cotton, hemp/cotton: absorbs and holds; minimal wicking; stays wet
- `DWR_face` — some sun hoodies; water beads on outer face; can trap sweat if used next-to-skin in wrong conditions

**Why it's load-bearing:** This is the single most consequential attribute for cold/wet safety. A fiber that holds moisture accelerates convective heat loss. This facet is the mechanical basis of "cotton kills."

**Load-bearing: YES — globally load-bearing across all textile domains.**

---

### FACET 2: Dry Rate (relative)
**What it captures:** Time-to-dry after saturation, under moderate airflow and temperature. Distinct from moisture management mode — a fabric can wick well but dry slowly (merino) or wick and dry very fast (thin polyester).

**Value space:** Ordinal scale:
- `very_fast` (thin polyester ripstop, nylon)
- `fast` (standard synthetic wicking knit)
- `moderate` (merino wool, merino/synthetic blend)
- `slow` (cotton-blend, heavy hemp/cotton)
- `very_slow` (dense cotton, raw hemp)

**Confidence note:** Rarely stated precisely by manufacturers; LLM infers from fiber type, fabric weight (gsm), and weave/knit structure. Confidence is soft unless a brand publishes a specific dry time (e.g., "dries in 30 minutes"). Treat as inferred unless source is manufacturer.

**Why it's load-bearing:** In multi-day backcountry travel, a slow-drying base layer is a liability every single night. In a desert day hike, dry rate matters less than UPF.

**Load-bearing: YES — conditionally load-bearing depending on trip wetness/duration.**

---

### FACET 3: Warmth-When-Wet
**What it captures:** Does the fiber retain meaningful insulation value after full saturation? This is distinct from insulation warmth (which is a mid/insulation domain concern) — here it means: does this base layer become a cold conductor when wet?

**Value space:** Ordinal scale:
- `retains_warmth` — merino wool (fiber crimp traps air even when wet; lanolin reduces water uptake in outer scales)
- `neutral` — synthetic (no insulation value dry OR wet; does not actively cool)
- `collapses` — cotton, cotton blends, hemp/cotton (fiber swells, loses loft, becomes a cold conductor)

**Why it's load-bearing:** Direct safety signal. In cold-and-wet alpine or shoulder-season conditions, a collapsing base layer is a hypothermia risk. A trip to Glacier in September with a hemp henley in the pack is a hazard flag.

**Load-bearing: YES — safety-critical in cold/wet trip profiles.**

---

### FACET 4: Odor Resistance
**What it captures:** How many days of wear before odor becomes socially or practically problematic? Driven by fiber's anti-microbial properties, not by chemical treatments (which fade).

**Value space:** Ordinal scale:
- `high` — merino wool (lanolin + fiber structure resists bacterial colonization intrinsically)
- `medium_treated` — synthetic with Polygiene, HeiQ, or similar antimicrobial treatment (effective but treatment degrades with washing)
- `medium` — merino/synthetic blends
- `low` — untreated synthetic (polyester especially; bacteria colonize fiber rapidly)
- `very_low` — cotton, hemp/cotton (absorb sweat, retain bacteria, odor evident within one hard day)

**Confidence note:** Treatment-based ratings decay over garment lifetime. "Medium_treated" should be marked as a confidence-degrading attribute unless purchase date is known.

**Why it's load-bearing:** Multi-day backcountry and international travel pack-light scenarios pivot heavily on this. A 7-day trip with 1 base layer requires high odor resistance. If unknown, system should surface this uncertainty.

**Load-bearing: YES — load-bearing for multi-day/ultralight trip profiles.**

---

### FACET 5: Next-to-Skin Comfort / Itch Factor
**What it captures:** Subjective comfort of the fabric directly against skin, driven primarily by fiber diameter (merino micron count) and surface texture.

**Value space:** Ordinal scale:
- `soft_non-itch` — fine merino (≤18.5 micron); most synthetics with fine knit
- `neutral` — medium merino (18.5–21 micron); standard polyester knit
- `may_itch` — coarser merino (>21 micron); rough weaves; grid textures worn direct-to-skin

**Confidence note:** Micron count is a hard fact if manufacturer states it; otherwise LLM must infer from product tier and marketing language (soft/inferred). Sensory response is inherently personal — system should represent this as population-typical, not individual.

**Why it's load-bearing:** Items worn next-to-skin for 10+ hours per day on a backpacking trip must be comfortable. An itchy base layer is not a functional base layer.

**Load-bearing: MODERATE — blocking constraint for sensitive individuals; less critical for non-sensitive.**

---

### FACET 6: Sun Protection (UPF Rating)
**What it captures:** UV protection factor when worn next-to-skin in exposed conditions. Relevant when the item IS the outermost layer (sun hoody in desert/water contexts).

**Value space:** Continuous range with ordinal thresholds:
- UPF <15: minimal
- UPF 15–24: good
- UPF 25–39: very good
- UPF 40–50: excellent
- UPF 50+: maximum

**Confidence note:** Hard fact IF manufacturer states UPF rating. If absent, can be roughly inferred from fabric weight and weave density (tightly woven, dark fabrics generally higher) but must be marked `inferred_low_confidence`. Do NOT assume UPF 50+ without a stated value.

**Why it's load-bearing:** In desert backpacking, kayaking, alpine snowfields, or any high-UV trip, the UPF of the skin layer is a health signal — not a comfort signal. The Stretch Terre Planing Hoody's UPF 40 is a hard, decision-driving spec.

**Load-bearing: YES — load-bearing in high-UV trip profiles (desert, water, alpine).**

---

### FACET 7: Breathability / Vapor Transmission
**What it captures:** How readily does the fabric allow body heat and vapor to escape? Distinct from moisture wicking (which handles liquid sweat) — breathability governs heat offload before sweat is produced.

**Value space:** Ordinal scale (or g/m²/24hr if hard data available):
- `very_high` — open knits, grid structures (R1 Air), thin single-layer weaves
- `high` — standard wicking synthetics; lightweight merino
- `moderate` — midweight merino; denser weaves
- `low` — tight face-fabric weaves; DWR-treated fabrics
- `very_low` — laminated or coated fabrics (not usually base layers, but edge cases exist)

**Confidence note:** Rarely stated as a test value (MVTR) for base layers. Usually inferred from fabric construction description.

**Why it's load-bearing:** High aerobic activity + low breathability = premature saturation and overheating. Critical for trail running, ski touring, high-output alpine. Less critical for static/low-output scenarios.

**Load-bearing: YES — conditionally, for high-output active profiles.**

---

### FACET 8: Thermal Regulation Active vs. Static
**What it captures:** Whether the item's thermal profile is tuned for high-output movement (where cooling is needed) vs. low-output or rest (where warmth retention is needed). This is a derived facet synthesized from weight + breathability + moisture management.

**Value space:** Categorical-as-facet (position on a spectrum; multi-label possible):
- `active_oriented` — prioritizes vapor offload and cooling; light, open, wicking
- `static_oriented` — prioritizes warmth retention; heavier, denser
- `balanced` — midweight merino is the canonical example

**Why it's load-bearing:** A base layer that is excellent while hiking may be inadequate at camp. This facet allows the system to recommend an "active base layer + camp insulation" stack versus a "balanced single layer" recommendation depending on trip type.

**Load-bearing: YES — drives stack recommendations for variable-output trips.**

---

### FACET 9: Fabric Weight / gsm
**What it captures:** Grams per square meter; a structural anchor from which many other properties flow.

**Value space:** Continuous range with conventional ordinal groupings:
- Ultralight: <120 gsm
- Lightweight: 120–170 gsm
- Midweight: 170–230 gsm
- Heavyweight: >230 gsm

**Confidence note:** Hard fact if manufacturer states it. Frequently missing from marketing copy; often must be inferred from product name ("lightweight", "midweight") — mark as inferred with low confidence if so. Item weight (oz/g) is more often stated and can partially substitute.

**Why it's a facet:** Drives warmth, dry rate, packability, and suitability for season/conditions. The hemp henley at ~7 oz total garment weight (not gsm) is a midweight; combined with cotton-dominant fiber, it's a slow-drying, warm-ish, odor-prone item.

**Load-bearing: MODERATE — anchor facet; primarily useful when combined with other facets.**

---

### FACET 10: Stretch / Mobility Profile
**What it captures:** Does the item accommodate full range of athletic motion without restriction or binding?

**Value space:** Ordinal scale:
- `high_4way` — 4-way stretch knits; full athletic range
- `high_2way` — 2-way stretch; good mobility in primary axes
- `moderate` — standard jersey knit; functional but not athletic-cut
- `low` — woven fabrics; restricts motion at extremes

**Why it's a facet (not load-bearing most of the time):** Critical for climbing, yoga-style movement, scrambling. Less important for trail walking or skiing. Becomes load-bearing only for specific activity profiles.

**Load-bearing: CONDITIONAL — load-bearing for technical climbing / high-mobility activities.**

---

### FACET 11: Layering Role Position
**What it captures:** Whether the item is designed/functional as a standalone (exposed), under-layer (worn beneath mid/shell), or either.

**Value space:** Multi-label set:
- `standalone` — can be the only layer; has finish/aesthetics for exposure
- `under_layer` — designed to be worn beneath other garments; may lack finish
- `system_base` — explicitly designed as part of a layering system (e.g., R1 Air as base in a 3-piece stack)

**Why it's a facet:** Affects cut, hem length, cuff design, pocket placement. Directly informs whether item can sub for a sun hoody or needs something over it.

---

### FACET 12: Fiber Composition (primary fiber)
**What it captures:** What the material is made of — the root cause of most other behavioral facets.

**Value space:** Categorical-as-facet (multi-label for blends):
- `merino_wool`
- `synthetic_polyester`
- `synthetic_nylon`
- `merino_synthetic_blend`
- `cotton`
- `cotton_hemp_blend`
- `hemp`
- `other`
- blend percentages as secondary attributes when available

**Confidence note:** Hard fact from manufacturer label or hang tag. Never infer without a source.

**Load-bearing: YES — anchor for inferring most other soft facets when hard data is absent.**

---

### FACET 13: Item Total Weight (oz or grams)
**What it captures:** Actual garment weight for packability and ultralight consideration.

**Value space:** Continuous (grams or oz, must store unit).

**Confidence note:** Hard fact if stated. Varies by size; manufacturer typically states for a specific size (usually medium or large mens). Store with size caveat.

**Why it's a facet:** Load-bearing for ultralight trip profiles; less critical for car camping.

---

### Vanity Facets (present but NOT load-bearing)
These should be stored but NOT used as primary decision axes:

- **Color / colorway** — occasionally relevant (blaze orange for hunting; white for desert heat) but mostly aesthetic
- **Fit style** (slim/athletic/relaxed) — moderately useful for layering under shells; not a safety or performance driver
- **Country of manufacture** — brand-loyalty signal; not functional
- **Retail price / MSRP** — budget filter only; not a performance attribute

---

## 3. Hard Facts vs. Soft Facets

### Hard Facts (manufacturer-stated / objectively verifiable)
These must be sourced from manufacturer documentation, hang tags, or product pages. Marked `source: manufacturer` in the schema.

| Attribute | Notes |
|---|---|
| Fiber composition (%) | Label law requires accuracy; reliable |
| UPF rating | Only valid if manufacturer has tested; must state source |
| Item weight (oz/g) | Manufacturer-stated; size-dependent |
| MSRP | Point-in-time; include date |
| DWR treatment (present/absent) | Usually stated; binary |
| Specific antimicrobial treatment name | Polygiene, HeiQ, etc. — if stated |
| Fabric weight (gsm) | Often stated for technical apparel; absent for lifestyle items |

### Soft Facets (LLM-inferred or derived)
These are assigned by LLM analysis at ingest, based on fiber composition, product description, and category knowledge. Must carry `confidence` (high/medium/low) and `inference_basis` markers.

| Attribute | Typical Confidence | Inference Basis |
|---|---|---|
| Moisture management mode | High | Fiber type is deterministic for this |
| Dry rate (ordinal) | Medium | Fiber type + fabric weight; weight sometimes unknown |
| Warmth-when-wet | High | Fiber type is deterministic |
| Odor resistance | Medium–High | Fiber type (high confidence) + treatment (medium, degrades over time) |
| Breathability | Medium | Fabric construction description; rarely hard data |
| Thermal profile (active vs static) | Medium | Derived from multiple facets |
| Itch/comfort | Medium | Micron count if stated (hard); otherwise inferred from tier |
| Stretch profile | Medium | Fabric description ("4-way stretch" is hard when stated; otherwise inferred) |

### Confidence Schema Requirements
Every soft facet value must carry:
- `confidence`: `high` / `medium` / `low` / `unknown`
- `inference_basis`: string explaining why (e.g., "polyester fiber type implies wicking_spread")
- `source`: `manufacturer` / `llm_inferred` / `llm_derived_multi_facet` / `unknown`
- Unknown values must be stored as `null` with `confidence: unknown` — NOT omitted and NOT guessed.

**A wrong spec is worse than a null.** If fiber composition is unknown, moisture management mode CANNOT be confidently inferred — cascade the uncertainty.

---

## 4. Material Linkage

The fiber is the root of nearly all behavioral properties. For base layers, material linkage is more deterministic than in any other domain.

### Merino Wool
- Absorbs moisture into fiber core (hydrophilic by design) but manages subjective wetness better than cotton because it holds moisture away from skin surface
- Retains meaningful warmth when wet (fiber crimp and structure)
- Intrinsically antimicrobial (lanolin + physical fiber structure): multi-day odor resistance
- Fine micron counts (<18.5µ) are genuinely non-itchy next-to-skin
- Dry rate: moderate — slower than synthetic; this is its primary limitation for high-sweat aerobic activities
- Durability: lower abrasion resistance than synthetic; pilling is common; blends with nylon or polyester to address this
- Weight range: 150–200 gsm typical base layer range

### Synthetic (Polyester / Nylon)
- Hydrophobic fiber: does NOT absorb moisture; instead wicks via capillary action through fabric structure (spread-and-evaporate)
- Very fast dry rate; the best choice for high-sweat aerobic output
- Zero warmth-when-wet value (but also does not become a cold conductor in the way cotton does)
- Without antimicrobial treatment: colonized by bacteria rapidly; odor after 1 hard day is typical
- Itch-factor: generally low for fine knits; grid structures worn direct-to-skin can be rough
- Durable; resists pilling better than merino

### Cotton and Hemp/Cotton Blends
- Hydrophilic to an extreme: absorbs and HOLDS moisture; no effective wicking mechanism
- Dry rate: very slow
- Warmth-when-wet: collapses; becomes a cold conductor
- "Cotton kills" is not hyperbole — it is a direct consequence of these three properties in cold/wet/wind conditions
- Odor resistance: poor
- **Hemp/cotton blend (55% hemp / 45% cotton):** Hemp fiber is more durable and has marginally better moisture properties than cotton, but at 45% cotton the blend inherits most of cotton's worst behaviors. A 7 oz hemp/cotton henley is NOT a cold/wet hiking base layer — it is a car camping or warm-dry-day lifestyle shirt that should be flagged as such.
- The appropriate system response: do not recommend this as a base layer for cold/wet/high-output scenarios. Surface it as a liability with an explanation.

### Merino/Synthetic Blends
- Attempt to get odor resistance (merino) + durability and fast dry rate (synthetic)
- Typically 60–80% merino, 20–40% nylon or polyester
- Moisture management mode: intermediate; wick better than pure merino, retain some warmth-when-wet
- Good balance for moderate-output multi-day trips
- Dry rate: medium-fast

---

## 5. Edge Cases and Hard-to-Classify Items

The facet model resolves ALL of these WITHOUT needing a fixed category assignment.

### Hemp/Cotton Henley (55% hemp / 45% cotton, ~7 oz midweight)
**Why it's hard:** Appears in a gear closet as a "shirt." User may not realize it is a poor base layer for trail use.

**Facet profile:**
- moisture_management_mode: `absorb_hold` (cotton-dominant blend)
- dry_rate: `slow`
- warmth_when_wet: `collapses`
- odor_resistance: `low`
- itch_comfort: `soft_non-itch` (cotton/hemp are smooth)
- UPF: likely low (open weave, natural fiber, no stated rating → `null, confidence: unknown`)
- thermal_active_vs_static: `static_oriented` (retains some warmth dry; becomes liability wet)

**Recommendation behavior:** System should surface this item for warm-dry-weather casual use, NOT recommend it for cold/wet/multi-day scenarios. The facet query "moisture_management_mode != absorb_hold AND warmth_when_wet != collapses" will correctly exclude it for those trip profiles.

**No special-case code needed.** The facets do the work.

---

### Patagonia Stretch Terre Planing Hoody (100% recycled polyester, DWR, UPF 40)
**Why it's hard:** Originally a watersports shell/sun layer. Has DWR (water-repellent face), UPF 40, and is worn next-to-skin in hot/water contexts. Is it a base layer? A shell? A sun layer?

**Facet profile:**
- layering_role: [`standalone`, `system_base`] — both valid; depends on conditions
- moisture_management_mode: `wicking_spread` with DWR face modulation (the DWR on the face may slow vapor exit slightly — flag this)
- dry_rate: `fast` (polyester, lightweight)
- warmth_when_wet: `neutral` (synthetic; not a warmth garment)
- UPF: `40` (manufacturer-stated; hard fact)
- breathability: `moderate` (DWR face reduces vapor transmission vs. untreated equivalent)
- sun_protection_layer: `yes` — this is its designed primary role when worn exposed

**Resolution:** The facet model assigns `layering_role: [standalone, system_base]` and `UPF: 40`. A desert kayaking trip recommendation query looking for "standalone + UPF 40+" would match this correctly. A cold/wet alpine trip query looking for "warmth_when_wet: retains" would exclude it correctly. No category label is needed at any point.

---

### Patagonia R1 Air Full-Zip Hoody (grid fleece, ~11 oz, no DWR)
**Why it's hard:** This is the canonical boundary case. The R1 Air is a grid fleece — it is more breathable than any standard base layer, designed to be worn as part of a system. It is a base layer when worn under a shell. It is a light mid-layer when worn over a lighter base. At ~11 oz it is heavy for a base layer.

**Facet profile:**
- layering_role: [`system_base`, `standalone_mild_weather`, `light_mid`] — multi-label; all are valid
- moisture_management_mode: `wicking_spread` (polyester fiber)
- dry_rate: `very_fast` (open grid construction)
- warmth_when_wet: `neutral` (synthetic)
- breathability: `very_high` (grid construction is explicitly designed for vapor offload)
- itch_comfort: `may_itch` (grid texture worn directly against skin; non-trivial complaint)
- thermal_active_vs_static: `active_oriented` (extreme breathability optimized for high output)
- fabric_weight_gsm: unknown (not typically stated; `null, confidence: unknown`)

**Resolution:** The system does not need to decide "is this a base layer or a mid?" It assigns all valid layering role labels. A recommendation query for "high-output alpine touring + system_base role" would surface the R1 Air. A query for "desert summer hike + standalone" would NOT surface it (wrong weight/warmth profile). The role is emergent from the trip context query, not from a preset category.

---

### Sun Hoody as Primary Base Layer in Desert Context
Sun hoodies (Terre Planing Hoody, Outdoor Research Echo, etc.) are routinely worn as the only layer in desert sun exposure. They are base layers in function even if not in typical classification.

**Resolution:** The facet `layering_role: [standalone, system_base]` combined with `UPF: 40+` allows the system to surface them in the correct context without needing a "sun hoody" category enum. The UPF facet is the operative axis.

---

## 6. Cross-Domain Facet Overlaps

These facets are defined in the base layer domain but should be considered GLOBALLY across all textile domains in Armarium. They are candidates for the shared facet schema rather than domain-specific schema.

### Shared with Mid / Insulation Domain
- `moisture_management_mode` — relevant for fleece midlayers (fleece is also hydrophobic; the question applies)
- `warmth_when_wet` — central to insulation domain (down vs synthetic fill; but also applies to fleece mids)
- `dry_rate` — fleece mids and insulation layers both have dry rates
- `breathability` — soft shells, fleece, and grid fleece all have breathability profiles
- `thermal_active_vs_static` — directly relevant to fleece and light insulation recommendations
- `layering_role` — cross-cutting; every garment has a layering role position
- `item_weight_oz` — universal packability signal

### Shared with Shell / Waterproof Domain
- `DWR_present` — base layers rarely have DWR; shells usually do; shared boolean
- `breathability` — shells express this as MVTR (g/m²/24hr); base layers rarely state MVTR; same concept, different data availability

### Shared with Accessories / Sun Protection Domain
- `UPF` — face-covering sun hats, neck gaiters, sun gloves all share this facet
- `moisture_management_mode` — buffs, gaiters, etc. share this

### Facets that are BASE LAYER SPECIFIC
- `itch_comfort` / `next_to_skin_comfort` — only load-bearing for items worn against skin
- `odor_resistance` — most relevant for items worn directly; less critical for outer shells
- `fiber_composition_primary` — meaningful everywhere, but the behavioral consequences are most deterministic for base layers

---

## 7. Unknown / Confidence Handling Notes (Base Layer Specific)

### The "Cotton Kills" Inference Chain
When fiber_composition is known to include ≥30% cotton or cotton-dominant blend:
- moisture_management_mode MUST be set to `absorb_hold` (high confidence inference)
- warmth_when_wet MUST be set to `collapses` (high confidence inference)
- dry_rate MUST be set to `slow` or `very_slow` (high confidence inference)
- odor_resistance MUST be set to `low` (high confidence inference)

This is one of the few cases where the inference chain is close to deterministic. The confidence should be `high` with `inference_basis: "cotton-dominant fiber composition; established physical chemistry."` These inferences should be auto-populated at ingest.

### Merino Micron Count (Itch Factor Source)
- If manufacturer states micron count → hard fact, use it
- If manufacturer states "superfine" or "ultra-fine" → infer ≤18.5µ, confidence `medium`
- If manufacturer states only "merino" with no qualifier → infer `neutral` comfort, confidence `low`
- Never assign `soft_non-itch` without a micron count or explicit "superfine" claim

### Antimicrobial Treatments and Temporal Confidence
- Polygiene, HeiQ, or similar treatments degrade with washing
- If treatment is known to be present: `odor_resistance: medium_treated` with confidence degradation note
- If garment age or wash count is known, confidence in treatment efficacy should decrease
- This is a known limitation: system cannot accurately assess treatment efficacy without usage data

### Missing gsm (Fabric Weight)
- Very common for lifestyle-adjacent items (hemp henley, cotton tees) to lack gsm
- Use total garment weight (oz) as a proxy, but mark it as `proxy_inferred, confidence: low`
- Do NOT derive gsm from total weight without knowing garment surface area (which is unknown)

### UPF When Not Stated
- Never assign a UPF value without a manufacturer source
- For un-rated items: store `UPF: null, confidence: unknown`
- Can note in `inference_notes`: "tight weave dark polyester likely provides some UV protection but no tested rating available"
- The system should not recommend un-rated items for high-UV exposures without surfacing this uncertainty

### R1 Air Worn Next-to-Skin: Itch Flagging
- Grid fleece worn next-to-skin is a known comfort issue for sensitive individuals
- The `itch_comfort: may_itch` should be assigned with `inference_basis: "grid/waffle texture; typical complaints for this construction type"`
- This should surface a recommendation note if the item is recommended as a base layer

---

*End of base layer domain investigation.*
