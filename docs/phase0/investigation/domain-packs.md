# Domain Investigation: Packs / Carry

**Armarium Phase 0 — Domain-Dimension Investigation**
**Domain agent:** PACKS / CARRY
**Date:** 2026-06-19

---

## Preamble: Packs are not in the seed corpus

The seed corpus (Kelty Galactic 30 sleeping bag, Patagonia R1 Air, Terre Planing jacket, Synchilla Snap-T, Marsupial hoodie, Hemp/cotton Henley) contains **zero true packs**. This is architecturally significant: the facet model must generalize to packs from apparel-derived examples alone. The Marsupial's kangaroo pocket is the only carry-adjacent feature in the seed — it is apparel with a carry affordance, not a pack. These are different kinds of things. The model must handle that boundary cleanly.

---

## 1. Domain Scope

### What "packs / carry" covers

The carry domain spans every item whose primary structural purpose is transporting gear on a person's body during a trip. This includes:

- **Daypacks** (15–35 L) for single-day outings: hiking, commuting, travel day bags
- **Summit packs / alpine packs** (15–28 L) — cut for movement, minimal suspension, often for mountaineering pushes from a base camp
- **Multi-day backpacks** (40–80 L+) for overnight to multi-week expeditions, with structured suspension
- **Hydration packs / vests** (1–12 L) — running, cycling, trail running; bladder-primary, gear-secondary
- **Running vests** (2–15 L) — fastpacking, ultrarunning; front-load pockets, minimal back body
- **Framesheet-style travel bags / duffel-to-pack hybrids** (40–60 L) — carry-on-legal, suspension optional
- **Technical glacier / alpine packs** (35–55 L) — ice axe loops, crampon patches, ski carry, helmet straps
- **Fanny packs / hip packs** (1–5 L) — ultra-light carry, supplemental to a larger system

### What a real selection decision hinges on

A person choosing a pack makes a decision across at least four axes simultaneously:

1. **Trip duration** — how many days dictates raw volume requirement. One day = 20–35 L. Weekend = 40–55 L. Week+ = 65 L+. But this is fuzzy at the margins.
2. **Load weight** — expected total weight determines suspension need. Under 15 lb = minimal suspension fine. 25 lb+ = frame + hipbelt load transfer mandatory for comfort.
3. **Activity type** — what the person is doing with the pack on their back. Running demands low profile and body-hug. Alpine demands ice axe loops. Travel demands lock ports and clamshell access. These are incompatible in one pack.
4. **Environment / conditions** — rain demands waterproofing or a rain cover. Scrambling demands snag-free profile. Heat demands back ventilation.

A "recommended pack" is the pack that best scores across all four axes for a given trip. No single axis alone is sufficient.

---

## 2. Decision-Driving Facets

Each facet is rated as **load-bearing** (drives recommendations meaningfully) or **vanity** (nice metadata, rarely decision-relevant).

---

### 2.1 Capacity (Liters)

- **What it captures:** Total internal volume in liters, as spec'd by manufacturer. May include a top-lid or hip-belt pocket volume in the total (inconsistent across brands — note this).
- **Value space:** Continuous numeric, typically 1–85 L for the consumer domain. Null if unknown.
- **Why it drives decisions:** Primary filter for trip duration and gear load. A 20 L pack cannot carry a 4-day kit; an 80 L pack is a burden on a day hike. Capacity is the first cut on every recommendation.
- **Hard or soft:** HARD. It is a manufacturer spec. Confidence: high when sourced from spec sheet; medium if inferred from product description; low if inferred from category name alone.
- **Load-bearing:** YES — first-order filter.

---

### 2.2 Pack Weight (grams or oz)

- **What it captures:** Weight of the empty pack itself, as spec'd. Distinct from load capacity.
- **Value space:** Continuous numeric (grams preferred for precision). Null if unknown.
- **Why it drives decisions:** For weight-sensitive activities (ultralight backpacking, trail running, fastpacking) pack weight directly reduces available load budget. A 2.2 kg pack on a 10 kg base-weight build is 22% of the total; a 400 g vest is 4%. On a casual day hike it barely matters.
- **Hard or soft:** HARD. Manufacturer spec. Confidence: high from spec sheet; medium from reviews with scales.
- **Load-bearing:** YES — critical for ultralight / fastpacking contexts; secondary for casual.

---

### 2.3 Load-Carry Comfort / Suspension System

- **What it captures:** The structural system that transfers load from shoulders to hips. Ranges from: no frame (stuff sack packs, ultralight), to a thin framesheet, to an aluminum stay + molded hipbelt, to full adjustable torso systems with load lifters.
- **Value space:** Structured enum-ish but better as a graduated scale:
  - `none` — frameless, no hipbelt
  - `minimal` — thin framesheet, padded shoulder straps, no meaningful hip transfer
  - `framesheet` — rigid or semi-rigid framesheet, padded hipbelt that takes some load
  - `aluminum-stay` — one or two aluminum stays, structured hipbelt with load transfer
  - `full-suspension` — adjustable torso, full load-lift, floating hipbelt
- **Why it drives decisions:** A 15 kg load in a frameless pack is punishing; the same load in a full-suspension pack is manageable. Suspension system determines the **maximum comfortable load** (see 2.4), which determines whether a pack is viable for a given trip weight.
- **Hard or soft:** SOFT/inferred. Manufacturers describe this inconsistently; the agent must infer from description. Confidence marker required.
- **Load-bearing:** YES — critical for multi-day builds. Secondary for light day use.

---

### 2.4 Maximum Comfortable Load (kg or lb)

- **What it captures:** The upper bound of load this pack can carry comfortably over extended time. Not a hard spec — an inferred ceiling from suspension system + torso length + hipbelt. Some manufacturers list a max recommended load.
- **Value space:** Numeric (kg), nullable, always inferred unless manufacturer states it. Confidence: low-medium.
- **Why it drives decisions:** If the recommended kit exceeds the pack's comfortable load ceiling, the recommendation should flag this mismatch. A summit pack recommended for a 3-day kit that will weigh 18 kg is a gap.
- **Hard or soft:** SOFT/inferred. Even when manufacturers state it, it varies by user body size. Always include confidence = low.
- **Load-bearing:** YES — but only surfaced when total kit weight is known.

---

### 2.5 Trip Duration Suitability

- **What it captures:** The range of trip lengths this pack is optimally suited for, inferred from capacity and suspension.
- **Value space:** Multi-value tagging: `day`, `overnight`, `weekend`, `multi-day` (3–5 days), `expedition` (7+ days). A 35 L pack may credibly span `day` + `weekend` depending on the user's packing style.
- **Why it drives decisions:** Primary semantic shortcut for recommendation. User says "4-day trip" → filter packs with `multi-day` in this facet.
- **Hard or soft:** SOFT/inferred, derived from capacity + suspension. Confidence: medium when capacity is known; low when capacity is unknown.
- **Load-bearing:** YES — but redundant with capacity if capacity is known. Useful as a shortcut for reasoning and gap-flagging.

---

### 2.6 Activity Fit

- **What it captures:** The activity contexts this pack is designed and optimized for.
- **Value space:** Multi-tag: `trail-running`, `fastpacking`, `hiking`, `alpine-mountaineering`, `ski-touring`, `travel`, `commute`, `climbing`, `cycling`, `general-outdoor`. Not mutually exclusive.
- **Why it drives decisions:** A travel bag and a trail running vest both have carry purpose, but are incompatible for each other's use. Activity fit determines whether a pack is even in the candidate set for a given trip.
- **Hard or soft:** SOFT/inferred from product description, intended use, and design features. Confidence: medium-high when category is clear; medium for versatile lifestyle packs.
- **Load-bearing:** YES — filters the candidate set before any other facet is evaluated.

---

### 2.7 Frame Type

- **What it captures:** The structural skeleton (or lack thereof) of the pack.
- **Value space:** `frameless`, `framesheet`, `semi-rigid`, `external-frame`, `internal-aluminum`, `internal-carbon`. Null if unknown.
- **Why it drives decisions:** Frame type is a primary driver of both suspension capability and pack weight. It also determines whether the pack can carry a hydration bladder upright and whether it can be rolled for travel. Frame type is a more granular sub-component of 2.3 (Suspension System) — the two should be co-inferred.
- **Hard or soft:** HARD when stated by manufacturer; SOFT when inferred from product family.
- **Load-bearing:** YES — but mostly as an input to 2.3/2.4 rather than a direct query facet.

---

### 2.8 Water Resistance / Weatherproofing

- **What it captures:** How well the pack resists rain penetration: fabric DWR treatment, fabric denier coating, seam treatment, integrated rain cover inclusion.
- **Value space:** Graduated: `none`, `DWR-treated` (splash resistant, not submersion), `taped-seams`, `waterproof-fabric` (e.g. Dyneema/X-Pac), `roll-top-closure` (waterproof by design), `rain-cover-included`. Can be multi-tagged.
- **Why it drives decisions:** In wet alpine or Pacific Northwest environments, an unprotected pack ruins gear inside it. Water resistance directly determines whether a pack is viable for a given environmental condition.
- **Hard or soft:** SEMI-hard — fabric coatings are spec'd; DWR effectiveness degrades and is inferred. Confidence: high for fabric type; medium for practical effectiveness.
- **Load-bearing:** YES — in wet-condition trip planning.

---

### 2.9 Pack Fabric / Denier

- **What it captures:** The primary fabric used in the pack body — ripstop nylon, Dyneema composite, X-Pac, UHMWPE, Cordura 210D/500D/1000D, etc. Denier (D) is the primary spec for abrasion resistance and weight tradeoff.
- **Value space:** String (fabric name) + numeric denier where applicable. Null if unknown.
- **Why it drives decisions:** Lighter fabrics (100D ripstop) save weight but sacrifice durability. Heavier fabrics (1000D Cordura) survive abuse at weight cost. Dyneema composites are both light and strong but expensive. This facet interacts with activity fit (trail running = light OK; expedition = durability matters).
- **Hard or soft:** HARD if spec'd by manufacturer; SOFT if inferred from product tier.
- **Load-bearing:** SECONDARY — important for durability-sensitive trips and long-term item health, less often a primary recommendation filter.

---

### 2.10 Access / Organization Style

- **What it captures:** How the pack opens and how gear is organized inside. Top-loading, panel-loading, clamshell, roll-top, plus hip-belt pockets, front pockets, internal dividers, laptop sleeve.
- **Value space:** Multi-tag primary access: `top-load`, `panel-load`, `clamshell`, `roll-top`, `drawstring-bag`; secondary: `hip-pockets`, `front-stretch-pocket`, `internal-divider`, `laptop-sleeve`, `hydration-sleeve`, `tool-loops`.
- **Why it drives decisions:** Travel bags need clamshell or panel access for TSA. Alpine packs need tool loops for ice axe. Running vests need front-accessible hand pockets. Access style is a technical requirement, not just preference.
- **Hard or soft:** SOFT/inferred from description and features list. Confidence: medium-high for primary access style; medium for secondary features.
- **Load-bearing:** YES — for specific use-case filtering (travel, technical alpine, running).

---

### 2.11 Hydration Compatibility

- **What it captures:** Whether the pack has a dedicated bladder sleeve and a hose port for a hydration system (e.g. CamelBak, Platypus).
- **Value space:** Boolean with detail: `none`, `sleeve-only`, `sleeve-plus-port`, `bladder-included`.
- **Why it drives decisions:** Running, hiking in heat, and fastpacking trips often require hands-free hydration. A pack without a hydration sleeve is a gap for those use cases.
- **Hard or soft:** HARD — this is a discrete design feature, present or absent.
- **Load-bearing:** SECONDARY — relevant when hydration method is a trip requirement.

---

### 2.12 Packability / Packed Size

- **What it captures:** Whether the pack compresses into its own pocket or a stuff sack for stowing inside a larger bag, and how compactly it packs.
- **Value space:** `non-packable`, `compressible`, `packs-into-pocket`, `packs-into-stuff-sack`. Approximate packed volume if known.
- **Why it drives decisions:** A travel daypack must pack away into checked luggage or inside a larger pack. This is a binary deal-breaker in that context.
- **Hard or soft:** SOFT/inferred for most packs. Some specify "stuff-sack included." Confidence: medium.
- **Load-bearing:** SECONDARY — only relevant for travel or multi-bag setups.

---

### 2.13 Technical Features (alpine/ski-specific)

- **What it captures:** Domain-specific features: ice axe loops, crampon patch, ski carry straps, helmet carry, rope strap, avalanche probe pocket, A-frame ski carry.
- **Value space:** Multi-tag present/absent features. All null unless confirmed.
- **Why it drives decisions:** These are binary requirements. A ski touring trip requires ski-carry capability; a mountaineering day requires an ice axe loop. Missing = hard gap.
- **Hard or soft:** HARD — discrete design features. Present or absent.
- **Load-bearing:** YES — for alpine/ski activity-fit filtering. Irrelevant for non-technical uses.

---

### 2.14 Torso Fit / Adjustability

- **What it captures:** Whether the pack fits a range of torso lengths and whether the torso is adjustable.
- **Value space:** `fixed-one-size`, `fixed-sized` (S/M/L), `adjustable-back-panel`, `fully-adjustable-suspension`.
- **Why it drives decisions:** A pack that doesn't fit a user's torso will be uncomfortable regardless of suspension quality. This interacts with 2.3 and 2.4.
- **Hard or soft:** HARD when sized; SOFT when fit quality is inferred.
- **Load-bearing:** SECONDARY — important for long-haul comfort but only surfaces at recommendation-review stage, not primary filter.

---

### 2.15 Technical-vs-Lifestyle Positioning

- **What it captures:** Where the item sits on the spectrum from purpose-built technical performance gear to lifestyle/fashion-adjacent outdoor gear.
- **Value space:** `technical` / `performance` / `lifestyle` / `fashion-outdoor`. Can be nuanced (e.g. "lifestyle-leaning but functional").
- **Why it drives decisions:** A lifestyle daypack may not have the durability or load features for a real alpine trip. Surfacing technical-vs-lifestyle positioning helps recommendation reasoning distinguish "this will work" from "this is a fashion item that will technically do the job."
- **Hard or soft:** SOFT/inferred from brand positioning, materials, features, price point.
- **Load-bearing:** SECONDARY — useful signal but rarely the primary decision axis.

---

## 3. Hard Facts vs Soft Facets

| Facet | Type | Confidence when unknown |
|---|---|---|
| Capacity (liters) | HARD — manufacturer spec | null; source = "inferred from product category" with confidence = low |
| Pack weight | HARD — manufacturer spec | null; source = "estimated from product tier" with confidence = low |
| Frame type | HARD when stated; SOFT when inferred | null with confidence = medium if inferred from suspension description |
| Hydration compatibility | HARD — binary feature | null; confidence = medium if standard for product category |
| Technical features (ice axe loops, etc.) | HARD — binary features | null; confidence = high (assume absent unless confirmed) |
| Fabric / denier | HARD if spec'd | null; confidence = medium if inferred from product tier |
| Water resistance (fabric) | SEMI-HARD — stated fabric type is hard; effective field performance is inferred | null with source = "inferred from fabric description" |
| Suspension system | SOFT/inferred | null; confidence = medium from description parsing |
| Max comfortable load | SOFT — always inferred unless stated | null; confidence = low always |
| Trip duration suitability | SOFT — derived from capacity + suspension | null; confidence = medium if capacity is known |
| Activity fit | SOFT — inferred from description + design features | medium-high; most packs have clear intended use |
| Access/organization | SOFT — inferred from description | medium; primary access style usually clear |
| Technical-vs-lifestyle | SOFT — inferred | medium; often clear from brand + materials |
| Packability | SOFT — inferred | low; rarely spec'd explicitly |
| Torso adjustability | HARD when stated; SOFT if inferred | null with confidence = medium |

**Key principle for this domain:** Hard specs (capacity, weight) are reliably available for mainstream products; suspension and load-comfort inferences are inherently uncertain and must always carry low-medium confidence. The agent should never upgrade an inferred load ceiling to "confirmed" without an explicit manufacturer statement.

---

## 4. Material Linkage

### Pack fabrics

Pack materials are simpler than apparel fabrics — there is no thermal, moisture-wicking, or stretch dimension. The relevant axes are:

- **Denier (D):** Weight of fiber per unit length. Higher = heavier and more abrasion-resistant. 100D–210D = lightweight trail; 420D–630D = all-around; 1000D = bulletproof/expedition.
- **Weave type:** Plain ripstop (grid reinforcement for tear resistance), ballistic nylon, Cordura (high-tenacity nylon with tight weave).
- **Specialty fabrics:**
  - **Dyneema Composite Fabric (DCF, formerly Cuben Fiber):** UHMWPE + polyester laminate. Extremely light, waterproof by nature, low stretch, not very abrasion-resistant on edges. Premium/ultralight.
  - **X-Pac:** Woven nylon face + waterproof membrane + Dyneema scrim + laminate back. Water-resistant, structured, heavier than DCF.
  - **ECOPAK, Robic, etc.:** Specialty ultralight fabrics with varying abrasion/waterproof tradeoffs.
- **Coatings:** PU (polyurethane) coating on the fabric back for water resistance. Degrades over time (delamination is a known failure mode).
- **DWR:** Durable Water Repellent treatment on the outer face — sheds water initially, degrades with use and washing.

### Frame materials

- **HDPE framesheet:** Inexpensive, light, semi-rigid. Provides structure, minimal load transfer.
- **Aluminum stays (7075 or similar):** Rigid, moderate weight, excellent load transfer. Standard for loads over 15 kg.
- **Carbon fiber stays:** Lightest, stiffest, expensive. Used in ultralight expedition packs.
- **No frame:** Frameless packs rely on the gear load itself for structure — a filled sleeping bag or foam pad against the back panel.

### Material linkage to recommendations

The material model for packs is **thinner than for apparel** but not zero. Relevant cross-links:
- Fabric DWR/waterproofing directly feeds the water-resistance facet.
- Frame material feeds the suspension system facet and the max comfortable load inference.
- Denier feeds durability inference for activity-fit suitability.

The global materials model should represent pack fabrics but the properties table needs fewer rows than for apparel — no thermal resistance, no moisture transport, no stretch. A shared `material` entity with a flexible property bag is the right architecture here.

---

## 5. Edge Cases and Hard-to-Classify Items

### Running vest vs daypack

A running vest (2–10 L, body-hugging, front pockets, soft flasks) and a daypack (20–35 L, shoulder straps, top-load) both carry gear on one day out. They are NOT substitutes. The activity-fit facet (`trail-running` vs `hiking`) cleanly separates them, but capacity alone would not — a 10 L daypack and a 10 L running vest are incompatible for each other's purpose. This reinforces that **activity fit must be evaluated before capacity in recommendation logic**.

### Capacity-to-trip-duration mapping is inherently fuzzy

30 L: some people do overnights in a 30 L pack (ultralight sleepers); some need 50 L for a day hike (group gear, camera equipment). The `trip-duration-suitability` facet should be multi-valued and carry a confidence note. It should NOT be a crisp threshold. Recommendation logic should use capacity as the primary signal and duration-suitability as a soft prior.

### Hydration packs as a sub-category

A "hydration pack" (e.g. 2 L bladder + 3 L gear volume) sits at the low end of capacity but is purpose-built for cycling or running. Its `activity-fit` distinguishes it from other small packs. Capacity alone misclassifies it as a fanny pack. The facet model handles this correctly if activity-fit is always included.

### The Marsupial kangaroo pocket: NOT a pack

The Marsupial hoodie has a kangaroo pocket that functions as carry. This is a **carry affordance** on an apparel item — it is NOT a pack. The facet model resolves this cleanly: the Marsupial's primary domain is `apparel/mid-layer`; its carry affordance is an apparel facet (`carry-pocket: kangaroo`) not a pack-capacity facet. A future "carry capability" facet on apparel items (e.g. `integrated-carry: yes`, `estimated-carry-volume: 1–2 L`) would let the recommendation layer factor in "the jacket has a chest pocket for a phone and snacks" without classifying it as a pack. These two entity types must NOT share the same `capacity-liters` facet.

### Travel bags and duffel-to-pack hybrids

A convertible travel bag (e.g. Osprey Farpoint 40) is simultaneously: a pack (shoulder harness, lid pocket) and a duffel/bag (clamshell, carry handles, compressible harness). Activity-fit: `travel`. The facet model handles this fine — tag it as `travel` in activity-fit, `clamshell` in access-style, `packable-harness` as a feature. It should NOT be classified as a backpacking pack even though capacity is similar.

### "Carry capability" as a general concept

The facet model should eventually support a lightweight `carry_affordance` facet on ANY item — even apparel — to capture things like: "this jacket has a chest pocket for a phone," "these pants have a hip pocket," "this vest has a built-in hydration sleeve." This is distinct from pack-capacity. The recommendation layer might ask: "can the user carry X without a pack?" and the answer lives in this cross-item affordance facet.

---

## 6. Cross-Domain Facet Overlaps

### Facets that are genuinely universal across all gear

The following facets appear in both the apparel domain and the packs domain with **identical semantics** — they should live in a shared universal facet namespace:

| Facet | Why universal |
|---|---|
| **Weight** | Every piece of gear contributes to total kit weight. Same unit (grams), same decision logic (lighter = better for weight-sensitive trips), same confidence semantics. |
| **Water resistance** | Rain shelter, rain gear, packs, and footwear all have water resistance as a facet. Same graduated scale (DWR → waterproof) applies. |
| **Technical-vs-lifestyle positioning** | Every item sits somewhere on this spectrum. A fleece can be "lifestyle." A pack can be "lifestyle." A shell can be "technical." Same inferential logic. |
| **Activity fit** | Every gear item has an activity context. `trail-running` compatibility means the same thing whether it's a shoe, a jacket, or a pack. |
| **Condition fit** | Weather conditions (cold/wet/alpine/desert/humid) that the item is suited for apply equally to apparel and hardgoods. |
| **Packability / packed size** | A jacket that stuffs into its pocket and a daypack that compresses away are both "packable." Same concept, same value space. |
| **Brand / price tier** | Universal metadata, though rarely a primary decision filter. |

### Facets that are domain-specific to packs

| Facet | Why pack-specific |
|---|---|
| **Capacity (liters)** | Meaningless for apparel (the Marsupial's pocket is NOT measured in the same dimension as a backpack). Pack-only. |
| **Suspension system** | Apparel has no suspension. Alpine harnesses have a load-carry element but are not apparel. Pack-only. |
| **Max comfortable load** | Derived from suspension; apparel has no analogous facet. Pack-only. |
| **Frame type** | No frame in apparel. Pack-only. |
| **Trip duration suitability** | While every item has a trip-type suitability, the mechanism for packs (driven by capacity + suspension) is structurally different from apparel (driven by warmth + weather resistance). The VALUE SPACE overlaps but the inference logic differs. Recommend: shared facet name, domain-specific inference rules. |
| **Access / organization style** | Top-load vs clamshell vs roll-top is meaningless for apparel. Pack-only. |
| **Hydration compatibility** | Pack-specific. |
| **Ice axe loops / technical features** | Pack-specific. |

### Verdict on flat vs grouped facet space

**A flat universal facet set is insufficient.** Here is why:

1. `capacity-liters` on a fleece is null and always null. Storing it as a flat null is noise; not storing it is a schema violation if the field is required.
2. `suspension-system` has no meaning for apparel and never will. Encoding it as a flat null creates false symmetry between pack and apparel entities.
3. Inference prompts for the LLM analysis pipeline must be domain-tuned. The prompt to classify a pack needs to reason about suspension, frame, and load-carry. The apparel prompt needs to reason about thermal resistance, moisture wicking, and layering role. A single flat prompt covering all 30+ facets across all domains will produce low-quality output for every domain.

**The correct architecture is a hybrid:**

- A **universal facet namespace** for the ~7 facets above (weight, water resistance, technical-vs-lifestyle, activity-fit, condition-fit, packability, brand/tier). These live in a shared schema table and every item has them.
- **Domain-specific facet groups** for the remainder. A pack item has a `pack_facets` record with capacity, suspension, frame, access-style, etc. An apparel item has an `apparel_facets` record with thermal resistance, moisture management, layering role, etc. These are separate but co-resident in the DB, joined to the universal record.
- A **flexible extension attribute space** (JSONB or EAV) for facets that are rare, experimental, or don't yet have a validated schema — e.g. the `carry_affordance` on apparel, or future "compression stuff-sack included" details on packs. This prevents schema bloat while keeping the validated core tight.

This is NOT a fixed category bucket system. It is a facet space with a universal core + domain-specific extensions. The recommendation layer queries across both layers simultaneously. The LLM analysis pipeline receives domain-scoped prompts that target the right facet group. A pack that also has strong lifestyle positioning is represented correctly across both the universal `technical-vs-lifestyle` facet and the pack-specific `capacity`, `suspension` facets — it occupies many facets at once, as designed.

---

## 7. Unknown / Confidence Handling Notes for Packs

### Inferences that are almost always uncertain

- **Max comfortable load:** Never express high confidence. Even manufacturers' stated figures are aspirational and body-dependent. Always confidence = low. Default to null unless a manufacturer statement is confirmed.
- **Trip duration suitability:** Derived from capacity (which may itself be uncertain) and packing style (which varies per user). Confidence = medium at best. Use multi-value tagging (e.g. `["overnight", "weekend"]`) rather than forcing a single value.
- **DWR effectiveness:** The fabric coating is a hard fact at time of manufacture; field effectiveness degrades. Store the stated coating type as a hard fact; store practical water resistance as an inferred soft facet with confidence = medium, decaying over time.

### Unknown-first discipline for packs

Packs from smaller brands, older products, or items described only by a user may be missing capacity, weight, and frame specs. The system must:

1. Store confirmed specs as hard facts with `source = "manufacturer_spec"` and `confidence = high`.
2. Store LLM-inferred specs as `source = "llm_inferred_from_description"` and `confidence = medium` (for clearly-described features) or `confidence = low` (for ambiguous cases).
3. Surface null + low-confidence values to the user in the closet UI as "specs unknown — you can fill these in" rather than hiding them or guessing.
4. Recommendation logic must handle null facets gracefully: a pack with unknown capacity should produce a recommendation flagged with "capacity unknown — verify this is large enough."

### Calibration note for capacity claims

Some manufacturers inflate capacity by including expansion panels or external pockets. The stated liter figure may differ from practical usable volume. This is a known domain artifact. The model should not attempt to "correct" stated capacity — store the manufacturer figure, note that "usable volume may differ from stated capacity" as a persistent disclaimer for this facet.

### Source hierarchy for packs (most to least reliable)

1. Official product spec sheet (manufacturer website, SKU-level)
2. Gear review with actual measurements (OutdoorGearLab, etc.)
3. Product description body (marketing copy — treat with care; often imprecise)
4. Product category / product name only (e.g. "Summit Pack" implies alpine use, minimal suspension — infer with low confidence)
5. User description ("my big blue hiking pack") — near zero confidence on specs; max out at `confidence = very_low`

---

## 8. Architectural Recommendation: Domain-Specific Facet Groups vs Flat Universal Set

**Opinion: Hybrid architecture with a universal core + domain extension tables is the right call.**

Arguments:

- **Against flat universal:** Flat schemas padded with nulls for inapplicable facets are a maintenance burden and inference-quality problem. A pack has no thermal resistance; a jacket has no suspension system. A schema that requires both to carry all facets produces noisy training signal for the LLM classifier and misleading null rows in the DB.
- **Against fully siloed per-domain:** Cross-domain queries ("find everything that is lightweight, packable, and technically rated for alpine") become painful if weight and technical-vs-lifestyle live in separate domain tables with no shared column.
- **For hybrid:** Universal facets in a shared table enable cross-domain queries. Domain facets in extension tables keep the schema clean and inference prompts focused. The LLM pipeline receives a scoped prompt per domain type ("you are classifying a pack — here are the pack facets you must fill") rather than a bloated universal prompt.
- **JSONB extension for edge cases:** Rare features (crampon patch, A-frame ski carry, roll-top closure type) should live in a validated JSONB blob rather than proliferating new columns. The schema validates the blob at ingest (Zod). This keeps the core schema stable while allowing item-level richness.

**Recommended schema shape (conceptual, not code):**

- `items` — universal: `id`, `user_id`, `name`, `brand`, `item_type` (pack | apparel | footwear | hardgoods | ...)
- `item_universal_facets` — weight, water_resistance, technical_vs_lifestyle, activity_fit (array), condition_fit (array), packability, price_tier, confidence metadata
- `item_pack_facets` — capacity_l, pack_weight_g, frame_type, suspension_system, max_comfortable_load_kg, access_style, hydration_compat, trip_duration_suitability (array), extended_features (JSONB)
- `item_apparel_facets` — thermal_resistance, moisture_management, layering_role, fit_cut, stretch, etc.
- Every facet field carries a `_confidence` and `_source` companion column or a shared confidence JSON blob.

This architecture honors the guiding principle: **no fixed category buckets, facets are dimensions, grouping is emergent.** The domain extension tables are NOT category routing — they are a clean separation of inference concerns. A pack with `activity_fit: ["travel", "hiking"]` and `technical_vs_lifestyle: "lifestyle"` is correctly modeled: those universal facets live in `item_universal_facets`; its `capacity_l: 40` lives in `item_pack_facets`. A recommendation query joins both.

---

*End of domain investigation — Packs / Carry*
