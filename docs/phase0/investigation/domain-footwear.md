# Domain Investigation: Footwear

> Phase 0 design artifact. No code. Scope: trail runners, hiking boots, mountaineering boots,
> approach shoes, sandals, camp shoes, and socks as a paired facet. Audience: the integration
> agent producing DESIGN.md and the classification-prompt author.

---

## 1. Domain Scope

Footwear covers anything worn on the foot in an outdoor context: performance athletic footwear
(trail runners, approach shoes), protective and supportive footwear (day-hiking boots, backpacking
boots, mountaineering boots), casual or transitional footwear (lifestyle hiking shoes, camp shoes,
sandals), and socks as a coupled selection that substantially changes the functional profile of any
shoe.

### What a real selection decision hinges on

A packing or purchase recommendation for footwear requires resolving at least five dimensions
simultaneously, because they interact and sometimes conflict:

1. **Terrain and underfoot conditions.** Talus, trail, slab, soft snow, mud, sand, urban
   approach — each rewards a different outsole compound, lug depth, and midsole stiffness.
2. **Load carried.** A gram-weenie ultralight setup allows a supple trail runner; a 60 L multi-day
   pack demands lateral rigidity and ankle support that a runner cannot provide safely.
3. **Environmental conditions.** Rain, stream crossings, snow, heat, cold, and extended wetness all
   shift the waterproof-vs-breathable calculus. Waterproofing traps heat and moisture in summer; a
   fast-draining mesh is miserable in extended rain.
4. **Distance and duration.** A 5-mile day hike and a 12-day traverse share very little in
   optimal footwear even if terrain looks similar on a map.
5. **Technical objectives.** Crampon compatibility, rand-reinforcement for vertical rock, and toe
   box stiffness for technical moves each demand specific constructions that have real costs in
   comfort and weight on non-technical terrain.

A model that assigns a single category label ("hiking boot") to an item discards nearly all of this
signal. A faceted model preserves it.

---

## 2. Decision-Driving Facets

Each facet is listed with: what it captures, its value-space shape (continuous, ordinal scale,
boolean, or multi-select tag set), and the specific decision it unlocks.

---

### 2.1 Support / Shank Stiffness (LOAD-BEARING)

**What it captures.** The longitudinal stiffness of the midsole/shank assembly. A stiff shank
transfers load across the foot (good for heavy packs and talus), reduces toe-flex fatigue on long
descents, and is a prerequisite for C1/C2 crampon compatibility. A flexible midsole is lighter,
more ground-feel-forward, and faster on smooth singletrack.

**Value space.** Ordinal 5-point scale:
- 1 — Fully flexible (road runner, knit lifestyle shoe)
- 2 — Minimal structure (ultralight trail runner, approach shoe on easy terrain)
- 3 — Moderate stiffness (light hiking shoe, day-hiker)
- 4 — Stiff (backpacking boot, C1-compatible mountaineering shoe)
- 5 — Full shank / semi-rigid (mountaineering boot, C2/C3 compatible)

**Why it drives decisions.** Load threshold above which a given stiffness is inadequate is
knowable. A 40 lb pack + talus + a scale-3 shoe is a genuine safety gap, not a preference.

**Load-bearing?** Yes — interacts directly with crampon-compatibility (section 2.9) and terrain-fit.

---

### 2.2 Ankle Support Height (LOAD-BEARING)

**What it captures.** The collar height relative to the ankle joint: low (below ankle), mid (at
ankle), high (above ankle, wrapping the malleolus).

**Value space.** Ordinal enum: `low` | `mid` | `high`

**Why it drives decisions.** High ankle support reduces lateral-sprain risk on loose talus with
load; it also adds weight, reduces proprioception, and restricts the natural ankle motion that
trail runners rely on. On groomed trail at low pack weight, high-cut adds cost with no benefit.
This facet interacts with load, terrain-fit, and support/stiffness; they are correlated but not
synonymous (an approach shoe can have a stiff shank and a low cut).

**Load-bearing?** Yes.

---

### 2.3 Water Management — Membrane vs. Fast-Drain (LOAD-BEARING; CROSS-DOMAIN TENSION)

**What it captures.** The primary strategy for managing water contact: sealed waterproof membrane
(Gore-Tex, eVent, proprietary), or open breathable mesh designed to drain and dry quickly with no
membrane barrier.

**Value space.** Nominal with two poles and a midpoint:
- `waterproof-membrane` — GTX, GORE-TEX Surround, eVent, proprietary (e.g., Salomon Contagrip XT)
- `water-resistant-dwr` — DWR-treated leather or synthetic upper; resists light splash but wets
  out in extended exposure; no membrane
- `fast-drain-breathable` — open mesh or drain ports, zero waterproofing, designed to wet through
  and dry fast
- `unknown`

**The tension.** A waterproof-membrane shoe eliminates cold-wet feet in intermittent rain and
stream crossings but creates a vapor trap: sweat cannot escape, which causes maceration (skin
breakdown) on long days and overheating on warm days. A fast-drain mesh is miserable in sustained
cold rain but actively liberating in heat, in desert canyon wading, and for any trip where the
feet will get wet anyway. This is not a quality gradient — it is a genuine tradeoff that a
recommendation engine must surface rather than resolve unilaterally. Parallel to the
waterproof-vs-breathable distinction in shells.

**Confidence note.** GTX presence is usually verifiable (manufacturer-stated). "Breathable" claims
for non-membrane uppers are marketing, not a membrane guarantee. DWR durability varies with age
and laundering; stored items should carry a freshness-unknown marker.

**Why it drives decisions.** The single largest footwear-selection mistake in consumer packing
guidance is defaulting to GTX for all wet conditions. In summer, sustained heat, and through-water
objectives, non-membrane is often the correct answer. The model must not have a waterproof-always
prior.

**Load-bearing?** Yes — the most consequential per-item boolean.

---

### 2.4 Outsole Traction Profile

**What it captures.** Lug depth, pattern geometry, rubber compound, and heel brake presence.

**Value space.** Multi-select tag set (compound + geometry):
- Compound: `vibram-megagrip`, `vibram-xg`, `vibram-montagna`, `continental`, `proprietary-soft`,
  `proprietary-hard`, `unknown`
- Geometry tags: `deep-lug` (>4 mm), `shallow-lug` (1–4 mm), `low-profile` (<1 mm / slab-oriented),
  `multidirectional`, `heel-brake`

**Why it drives decisions.** Deep lugs shed mud and grip loose dirt; they're slow and loud on rock
slab. Low-profile sticky rubber (e.g., Vibram Megagrip on approach shoes) is exceptional on clean
rock; it hydroplanes on mud. Heel brake matters on sustained steep descent. The model should
emit both compound (hard fact, verifiable) and geometry (inferred from photos/descriptions, lower
confidence) with separate markers.

**Load-bearing?** Yes for terrain matching; soft for exact rubber name (often unknown on older items).

---

### 2.5 Terrain-Fit Envelope

**What it captures.** The range of terrain types the item performs acceptably on.

**Value space.** Multi-select from a tag vocabulary:
`road` | `groomed-trail` | `singletrack` | `rocky-trail` | `talus` | `off-trail-scrub` |
`soft-snow` | `firm-snow` | `desert-slickrock` | `canyon-wet` | `technical-rock` | `glacier`

**Why it drives decisions.** This is the core matching facet for trip-to-item pairing. It is
soft/inferred (LLM + user knowledge), not a manufacturer-stated hard fact. Confidence is
inherently lower than membrane presence. The LLM should emit a short reasoned justification for
each tag so that the recommendation engine can surface it.

**Load-bearing?** Yes, but soft — requires inference, not lookup.

---

### 2.6 Weight (Hard Fact)

**Value space.** Grams (per shoe, single), continuous. If only pair-weight is known, store
pair-weight with a `per-pair` flag. Unknown is `null`.

**Why it drives decisions.** Weight compounds over distance; on a week-long thru-hike, 200 g per
shoe is thousands of foot-pounds of fatigue. Weight also drives the pack-weight tradeoff (heavier
pack → stiffer boot → heavier footwear).

**Load-bearing?** Yes when known. Source: manufacturer spec (high confidence) or user-weighed
(high confidence, mark as user-measured).

---

### 2.7 Cushioning / Stack Height

**What it captures.** The combined midsole + outsole height at the heel and forefoot (drop =
heel minus forefoot).

**Value space.**
- Stack height: continuous in mm (heel / forefoot separately); unknown = `null`
- Drop: continuous in mm; unknown = `null`
- Cushioning profile: `maximal` (>30 mm stack), `moderate` (20–30 mm), `minimal` (<20 mm),
  `zero-drop` (drop = 0), `unknown`

**Why it drives decisions.** High-stack maximalist shoes (Hoka-style) reduce fatigue on high-mileage
days; they sacrifice proprioception and are destabilizing on uneven terrain. Zero-drop requires
Achilles adaptation. Drop is a known injury risk factor for runners changing footwear.

**Load-bearing?** Moderately. More relevant for multi-day and running objectives than day hiking.

---

### 2.8 Insulation / Warmth

**What it captures.** Whether the item has integrated insulation (rated or unrated), or is
designed as a bare-upper with warmth coming entirely from socks.

**Value space.**
- `insulated-rated` — synthetic or down with stated temperature or EN/ISO rating
- `insulated-unrated` — integrated lining (e.g., Thinsulate, fleece lining) without a rating
- `uninsulated` — warmth from socks + activity only
- `unknown`

**Why it drives decisions.** A non-insulated boot in camp at -10 °C requires extremely warm socks;
an insulated boot in summer makes feet dangerously hot. Most hiking footwear is uninsulated; most
mountaineering and winter boots are insulated.

**Load-bearing?** Yes for cold/alpine objectives; low-signal for 3-season use.

---

### 2.9 Crampon Compatibility (Hard Boolean + Enum)

**What it captures.** Whether the sole welt and shank support C1 (flexible crampon, strap-on),
C2 (semi-rigid, rear bail), or C3 (full rigid, front + rear bail) crampon attachment. Most
footwear is C0 (incompatible).

**Value space.** Enum: `C0-none` | `C1` | `C2` | `C3` | `unknown`

**Why it drives decisions.** A C2 crampon on a C0 shoe is a genuine safety failure, not a
preference mismatch. This is one of the few facets where the gap between correct and incorrect is
an injury event, not a comfort issue.

**Load-bearing?** Yes for any alpine/winter objective. Fully hard fact when verifiable; the
manufacturer usually states this explicitly for boots that support it.

---

### 2.10 Upper Material

**What it captures.** The primary upper construction and material.

**Value space.** Multi-select: `full-grain-leather` | `split-grain-leather` | `nubuck-leather` |
`synthetic-mesh` | `knit-upper` | `suede` | `rubber-rand` | `reinforced-toe-cap` | `unknown`

**Why it drives decisions.** Full-grain leather is naturally water-resistant, stiff, and durable
but heavy and slow-drying. Mesh is light, breathable, and fast-drying but offers zero water
resistance without a membrane. Rand reinforcement (rubber rand wrapping the lower upper) is a
climb-specific durability feature. Knit uppers are comfort-oriented and fragile in abrasive
terrain.

**Load-bearing?** Moderate — primarily drives durability, water-resistance, and break-in time
inference.

---

### 2.11 Breathability

**What it captures.** The degree to which the upper + lining allows vapor escape.

**Value space.** Ordinal: `high` (open mesh) | `moderate` (synthetic, unlined leather) |
`low` (waterproof membrane present, GTX-lined) | `unknown`

**Note.** Breathability and waterproofing are inversely correlated in nearly all constructions.
An item cannot be `waterproof-membrane` and `high-breathability` simultaneously in the footwear
domain (unlike Gore-Tex in shells, where breathability rating varies but vapor transfer still
occurs; in shoes the vapor path is further blocked by the sock and foot compression). Model this
as a derived facet, not independently assessed.

---

### 2.12 Activity-Fit Tags

**What it captures.** The activity types the item is designed for and appropriate within.

**Value space.** Multi-select: `trail-running` | `day-hiking` | `backpacking` | `mountaineering` |
`approach-climbing` | `via-ferrata` | `snowshoeing` | `winter-camping` | `camp-casual` |
`packrafting` | `canyon` | `lifestyle`

**Why it drives decisions.** Activity-fit is the highest-level matching facet for trip → item
queries. It is inferred (soft), not manufacturer-declared. The LLM should emit it with reasoning
and moderate confidence.

---

### 2.13 Packability / Profile

**What it captures.** Whether the item can be meaningfully compressed or folded for packing (camp
shoes, sandals) versus being a rigid 3D object that consumes fixed volume.

**Value space.** Boolean with sub-enum: `folds-flat` | `compressible` | `rigid` | `unknown`

**Why it drives decisions.** Camp shoes and sandals that fold flat are standard multi-day kit
additions that cost very little pack volume. A second pair of rigid boots is almost never
worthwhile.

---

### 2.14 Socks — Paired Facet

Socks modify the effective warmth, cushioning, moisture management, and fit of any shoe. They are
not optional equipment for footwear recommendations; they are a coupled dimension.

**Sock facets to track alongside footwear:**
- Material: `merino-wool` | `synthetic` | `cotton` (cotton = actively dangerous in cold-wet)
- Weight/cushion: `ultralight` | `lightweight` | `midweight` | `heavyweight` | `unknown`
- Height: `no-show` | `low` | `crew` | `knee`
- Moisture management: inferred from material (merino and synthetic wick; cotton retains)
- Waterproof-sock variant: e.g., Sealskinz, Dexshell — rare but relevant in very cold/wet contexts

**The pairing implication for recommendations.** A waterproof-membrane boot recommendation should
pair with a thinner sock (less moisture buildup headroom). A fast-drain non-membrane shoe
recommendation in cold conditions must co-recommend a merino or waterproof sock. The
recommendation engine should emit sock guidance as a paired output whenever footwear is
recommended.

---

## 3. Hard Facts vs. Soft Facets

| Facet | Type | Confidence | Source |
|---|---|---|---|
| Waterproof membrane presence (GTX / eVent) | Hard boolean | High | Manufacturer label |
| Crampon compatibility class (C0–C3) | Hard enum | High | Manufacturer spec |
| Weight (g/shoe) | Hard continuous | High if labeled; medium if recalled | Manufacturer / user-weighed |
| Stack height / drop (mm) | Hard continuous | High if labeled; null if not | Manufacturer |
| Upper material primary | Hard enum | Medium (may require photo) | Description / label |
| Outsole compound (Vibram, Continental) | Hard nominal | Medium | Logo / description |
| Shank stiffness level | Soft ordinal | Medium | Inferred from category + description |
| Ankle height | Soft ordinal | High for clear boot/low-cut | Visual / description |
| Insulation (rated) | Hard nominal | High if rated, low if lining-only | Manufacturer |
| Terrain-fit envelope | Soft multi-tag | Medium | LLM inference |
| Activity-fit tags | Soft multi-tag | Medium | LLM inference |
| Breathability (derived) | Derived | High (from membrane facet) | Derived rule |
| Lug geometry | Soft multi-tag | Low-medium (photo-dependent) | LLM inference + photo |
| DWR freshness | Soft boolean | Low (age-dependent) | Unknown without user input |

**Principle:** Hard facts get `confidence: high, source: "manufacturer"`. Soft inferences get
`confidence: medium` with a `reasoning` field. Unknowns are `null` with `confidence: null,
source: "unknown"`. Do not guess.

---

## 4. Material Linkage

### Upper materials

- **Full-grain leather** — naturally hydrophobic, durability-forward, heavy, stiff, long break-in.
  Pairs with waterproof-membrane less often (leather can stand alone for water resistance in
  moderate rain). A mink-oil or wax treatment is a user-applied DWR equivalent.
- **Nubuck/split-grain leather** — lighter, softer, less water-resistant than full-grain. Usually
  paired with a membrane or DWR treatment.
- **Synthetic mesh** — very light, highly breathable, fast-drying, zero inherent water resistance.
  Either paired with a waterproof membrane (creating a hot/trapped-vapor shoe) or left open
  (fast-drain design). The combination of mesh upper + GTX liner is common but inherently
  contradictory: the mesh wets through to the membrane instantly, making the breathability of the
  mesh irrelevant while the membrane still limits vapor escape.
- **Knit upper** — comfort and weight-optimized, poor abrasion and lateral support, inappropriate
  for off-trail or technical terrain.
- **Rubber rand** — not a primary upper but a reinforcement. Indicates climbing/approach use case.

### Membranes

- **Gore-Tex Extended Comfort** — optimized for vapor transfer at rest; used in hiking boots.
- **Gore-Tex Performance** — optimized for vapor transfer under load; used in trail runners.
- **Gore-Tex Surround** — bottom-venting design; unusual, used in casual/camp footwear.
- **eVent** — higher vapor permeability than standard GTX; used in performance applications.
- **Proprietary membranes** (OutDry Extreme, Salomon's own) — manufacturer-claimed equivalents;
  hard to independently validate; confidence = medium.

**Cross-domain note.** The membrane facets are structurally identical to those used in hardshell
jackets. The same `waterproof_membrane` field shape (type + rating + confidence) should be reused
or referenced from a shared material vocabulary — this is a strong argument for a cross-domain
membrane-material entity rather than a per-domain string field.

### Outsole rubber

- **Vibram** — the canonical performance brand; sub-grades (Megagrip, XG, Montagna, Litebase)
  have meaningfully different performance profiles.
- **Continental** — licensing arrangement (same Continental automotive rubber technology); used by
  Adidas Terrex line.
- **Proprietary** — Salomon Contagrip, Asics AHAR+, etc. Performance less independently
  verifiable.

---

## 5. Edge Cases and Hard-to-Classify Items

### 5.1 The trail-runner–hiker–boot spectrum

This is the most common classification trap. "Trail runner," "hiking shoe," and "hiking boot" are
not discrete categories — they are marketing labels that collapse a continuous spectrum across at
least three independent dimensions (stiffness, ankle height, weight). A heavy-duty trail runner
(e.g., Salomon XA Pro) has more lateral support than many marketed "day hikers." A light hiking
boot (e.g., Merrell Moab Speed) is closer to a trail runner in flexibility than to a
mountaineering boot.

**Facet model resolution.** Do not assign a `category` field. Assign `support_stiffness: 2`,
`ankle_height: low`, `weight_g: 340`, `activity_fit: [trail-running, light-hiking]` — the
emergent query for "lightweight day-hiking footwear" retrieves this correctly alongside items that
carry "hiking" in their product name, and filters out items with `support_stiffness >= 4` that are
too heavy for the trip.

### 5.2 The waterproof-vs-breathable tradeoff in practice

A GTX trail runner (e.g., Salomon Sense Ride 5 GTX) will be recommended for cold/wet conditions
by any naive system. On a 20-mile summer day in the Pacific Northwest with stream crossings, a
non-GTX mesh runner may be the correct recommendation because: (a) the feet will get wet anyway at
crossings, (b) the drying time for a non-GTX mesh is 20 minutes vs. never-fully-dry for a soaked
GTX, and (c) heat management on a long climb matters more than initial splash protection.

**Facet model resolution.** The model stores `water_management: "waterproof-membrane"` for the
GTX variant and `water_management: "fast-drain-breathable"` for the mesh variant. The
recommendation engine emits both options with a conflict-surface note when conditions are
ambiguous: *"You own both GTX and non-GTX trail runners. For sustained rain without crossings,
prefer GTX. For high heat or repeated crossings, prefer the mesh variant."* A category-based model
collapses both to "trail runner" and picks arbitrarily.

### 5.3 Approach shoes straddling climbing and hiking

An approach shoe (e.g., La Sportiva TX4, Scarpa Crux) has: low cut (hiking facet), stiff shank
(climbing/alpine facet), sticky low-profile rubber (technical-rock facet), rubber rand
(climbing-durability facet), and moderate terrain-fit extending from trail to Class 4 scrambling.
It is completely misrepresented by any single-category label.

**Facet model resolution.** `activity_fit: [approach-climbing, day-hiking, via-ferrata, scrambling]`,
`support_stiffness: 3`, `outsole_compound: vibram-megagrip`, `outsole_geometry: [low-profile,
multidirectional]`, `rubber_rand: true`, `ankle_height: low`. A recommendation for a technical
trail with moderate scrambling retrieves this correctly; a recommendation for a soft-surface
trail-run does not.

### 5.4 Camp shoes and sandals

Sandals (Chacos, Tevas, Birkenstocks) and dedicated camp shoes (Crocs, Keen Newport) are low
support, packability-forward, non-waterproof, and belong in every multi-day recommendation as a
camp-rest item. The fact that a sandal shares the word "footwear" with a mountaineering boot
should not put them in the same retrieval pool for a technical objective — and the facet model
ensures they do not appear there, because `activity_fit` will be `[camp-casual, water-crossing,
light-trail]` and `support_stiffness: 1`.

### 5.5 Insulated vs. uninsulated mountaineering boots

An insulated double boot (e.g., La Sportiva Baruntse) and an uninsulated single boot (e.g., La
Sportiva Nepal Cube) both have `crampon_compatibility: C2-C3` and `support_stiffness: 5`. They
diverge entirely on `insulation` and `waterproof_membrane`. For an objective above -15 °C in
winter, both can be correct; below -30 °C, the insulated double boot is a safety requirement, not
a preference. The facet model captures this; a "mountaineering boots" category cannot.

---

## 6. Cross-Domain Facet Overlaps

### 6.1 Waterproof / breathable membrane facets (SHARED WITH SHELLS)

The `water_management` facet in footwear is structurally isomorphic to the waterproof-membrane
vs. water-resistant distinction in hardshell jackets. Both:
- Have a membrane-present boolean
- Have a membrane type (GTX variant, eVent, proprietary)
- Have a breathability-vs-protection tradeoff that is a TENSION, not a quality gradient
- Have a DWR-durability consideration that decays over time

**Argument for a universal membrane entity.** The membrane properties (type, MVTR rating,
durability, GTX variant) should be modeled in a shared `WaterManagementProfile` structure
referenced by both footwear and apparel items. This prevents schema duplication and enables
cross-domain queries: *"What gear do I own with active waterproof membranes?"* returning both
shells and boots.

### 6.2 Weight and packability

Weight in grams is a universal facet. Packability (folds-flat, compressible, rigid) is universal
across footwear, apparel, and shelter. These should share field names and value-space shapes
across domains.

### 6.3 Technical-vs-lifestyle continuum

Every domain has a spectrum from technical-performance to casual-lifestyle. In footwear this is
trail runner–to–mountaineering-boot; in apparel it is baselayer-to-streetwear fleece. The facet
`technical_level` (or `intended_use_context: technical | performance | casual | lifestyle`) should
be universal and carry the same semantics.

### 6.4 Conditions-fit (temperature/precipitation envelope)

The `conditions_fit` facet — minimum/maximum operating temperature, precipitation tolerance, wind
tolerance — is universal. For footwear, temperature operationalizes through insulation + membrane;
for shells through insulation + waterproof rating. Same field shape.

### 6.5 Activity-fit

`activity_fit` as a multi-select tag set is universal across all gear domains. The tag vocabulary
differs (footwear: trail-running, backpacking; apparel: skiing, climbing) but the structure is
identical. A recommendation query of the form "show me all gear appropriate for winter alpine
climbing" should filter across ALL domains using the same `activity_fit` tags.

### 6.6 Which facets are globally load-bearing

These facets are load-bearing across ALL domains (not just footwear):

| Facet | Why globally load-bearing |
|---|---|
| `water_management` / membrane presence | Drives all wet-conditions recommendations across apparel and footwear |
| `weight_g` | Universal gear-selection signal; compounds across all items in a kit |
| `activity_fit` (multi-tag) | Primary trip-to-item matching query across all domains |
| `conditions_fit` envelope | Drives all temperature-range and weather recommendations |
| `technical_vs_lifestyle` | Prevents recommending lifestyle gear for technical objectives |
| `packability` | Universal for overnight and travel contexts |

---

## 7. Unknown / Confidence Handling Notes (Footwear-Specific)

### GTX presence: reliable but over-attributed

Gore-Tex licensing requires clear labeling. If an item is described as "GTX" or carries a
Gore-Tex hang-tag, `waterproof_membrane: true, membrane_type: gore-tex, confidence: high` is
appropriate. If a product is described as "waterproof" without naming the membrane, emit
`waterproof_membrane: true, membrane_type: unknown, confidence: medium`. Never infer GTX from
"waterproof" alone.

### DWR freshness: always unknown at ingest

DWR performance degrades with washing and use. At ingest time, unless the user explicitly states
the item has been re-proofed recently, DWR effectiveness should be `dwr_active: unknown,
confidence: null`. The recommendation engine should surface this uncertainty for older items:
*"Water resistance may have degraded — consider re-proofing before wet conditions."*

### Weight from memory: mark as user-recalled

If weight is entered by the user rather than pulled from a spec sheet, mark `weight_source:
user-recalled, confidence: medium`. User-recalled weights for footwear are typically ±50 g;
treat as ballpark only.

### Crampon compatibility: never infer from boot type

"Mountaineering boot" does not reliably imply C2 compatibility; some mountaineering-branded boots
are C1-only. If the manufacturer spec does not explicitly state crampon compatibility, emit
`crampon_compat: unknown, confidence: null`. A wrong C-rating inference could result in crampon
detachment on a slope; this is the highest-stakes null in the footwear domain.

### Outsole compound: low confidence without logo confirmation

Many shoes describe rubber as "proprietary high-traction compound" without naming the
manufacturer. Do not infer Vibram from feel or appearance descriptions. Emit `outsole_compound:
proprietary, confidence: low` or `outsole_compound: unknown` as appropriate. If the Vibram logo
is explicitly mentioned in a product description, `confidence: high`.

### Terrain-fit inference: inherently medium confidence

The LLM-assigned terrain-fit tags are inferences, not manufacturer claims. They should always
carry `confidence: medium` and a `reasoning` field. Users should be able to correct or extend
terrain-fit tags; user corrections should upgrade confidence to `high, source: user-confirmed`.

### Socks: the invisible coupling

If a user enters footwear without specifying which socks they pair it with, the recommendation
engine must not assume the pairing. Emit a prompt-to-user: *"What socks do you typically use with
this footwear? This affects warmth and moisture recommendations."* Treat sock pairing as
unknown until confirmed.
