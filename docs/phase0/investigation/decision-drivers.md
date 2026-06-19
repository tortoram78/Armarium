# Decision-Driver Investigation: Load-Bearing Facets for Armarium

**Purpose:** Work backward from real planning queries to determine which gear facets ACTUALLY change a recommendation versus which are metadata noise. This document is the canonical input to keeping the facet model lean and decision-relevant.

**Guiding principle:** The app has no fixed category buckets. Gear facets are raw properties; capabilities are derived predicates over those facets; recommendations are emergent queries over the capability space. This document establishes which facets the engine MUST read and which it can safely ignore.

---

## Section 1: Per-Query Analysis (A–D)

### Query A — Cold Alpine Day Hike
**Example:** "Mount Marcy, mid-June, alpine summit, cold and windy, long day hike"

**Condition envelope:**
- Sustained cold (summit temps 30–45°F possible), wind (gusts 30+ mph above treeline)
- High exertion on approach (sweating heavily), then cold exposed stop at summit
- Precipitation possible (afternoon convective storms, orographic cloud)
- Long day (8–12 hrs), no resupply or shelter
- No overnight stay — packability matters for day-pack volume, not camping weight

**Required capabilities and the facets they read:**

| Capability required | Facet(s) read | Decision rule |
|---|---|---|
| Real waterproof outer shell | `waterproofness` | must ∈ {waterproof, waterproof-breathable}; resistant = FAIL |
| Wind protection | `wind-resistance` | must ∈ {windproof}; or derived from waterproofness if fully sealed |
| Breathability under exertion | `breathability` | must ∈ {high, very-high}; otherwise shell is a sweat trap on ascent |
| Packable insulation (summit stop) | `insulation-type`, `fill-power`, `packable` | must be packable static insulation for cold summit halts |
| Wicking base layer | `moisture-management` | must ∈ {wicking, fast-dry}; cotton/hemp = FAIL |
| Layering role awareness | `layering-role` | engine must know base / mid / shell roles to build a complete system |
| Thermal regulation on approach | `thermal-rating` + `activity-range` | base + mid layer's thermal range must cover cold AND not overheat during high exertion |

**What a GAP looks like:**
- No item with `waterproofness ∈ {waterproof, waterproof-breathable}` → engine flags "no waterproof shell — exposed summit risk"
- No item with `layering-role = shell` AND `wind-resistance = windproof` → same gap
- No item with `layering-role = mid` AND `insulation-type ∈ {down, synthetic}` AND `packable = true` → gap "no packable insulation for cold summit stop"
- No item with `moisture-management ∈ {wicking, fast-dry}` AND `layering-role = base` → gap "no adequate wicking base"

---

### Query B — Hot Exposed Desert Hike
**Example:** "Arches in July, all-day sun, 100°F, dry, long trail"

**Condition envelope:**
- Extreme solar radiation, UV index 10+
- High temperature, low humidity — sweat evaporates rapidly (helpful)
- No precipitation concern
- Risk: sunburn, dehydration, overheating, eye/skin exposure

**Required capabilities and the facets they read:**

| Capability required | Facet(s) read | Decision rule |
|---|---|---|
| UV / sun protection | `upf-rating` | must ∈ {30+, 40+, 50+}; unlabeled = situational at best |
| Coverage geometry | `coverage` (e.g., collar, hood, arm) | hooded long-sleeve preferred for neck/arm coverage; facet read: `has-hood`, `sleeve-length` |
| Moisture / sweat management | `moisture-management` | must ∈ {wicking, fast-dry}; soaking cotton dangerous in heat |
| Breathability | `breathability` | must ∈ {high, very-high}; shell layers contraindicated unless windproof required |
| Weight / bulk on body | `weight` | lighter is better when thermal load is the primary risk |

**Key difference from Query A:** insulation and waterproofness are irrelevant; `upf-rating`, coverage geometry, and breathability are critical. No layering system needed — a single capable sun shirt can satisfy the query.

**What a GAP looks like:**
- No item with `upf-rating ≥ 30` AND `sleeve-length = long` AND `has-hood = true` → gap "no hooded sun protection"
- No item with `moisture-management = wicking` AND appropriate `coverage` → gap "no wicking sun layer"

---

### Query C — Multi-Day Rain (Backpacking in sustained wet)
**Example:** "Olympic Peninsula, 5 days, shoulder season, near-constant rain, wet camp"

**Condition envelope:**
- Sustained external wetness: rain, wet brush, stream crossings
- Camp insulation must function wet OR be protected from saturation
- Sleep system must stay warm even if moist
- Pack volume and weight are critical (multi-day carry)
- Drying opportunity is minimal

**Required capabilities and the facets they read:**

| Capability required | Facet(s) read | Decision rule |
|---|---|---|
| Real waterproof shell | `waterproofness` | must = waterproof-breathable; water-resistant = FAIL within hours |
| Seam sealing | `seam-sealing` | taped seams required; non-taped breathable shells still leak |
| Insulation wet performance | `insulation-type` | synthetic = capable when wet; down = FAIL unless treated |
| Down hydrophobicity | `treated-down` | DWR / hydrophobic down can recover; untreated 550fp duck down in sustained rain = catastrophic warmth loss |
| Sleep system adequacy | `temperature-rating` | must ≤ expected low (not just comfort, but survival range in wet conditions) |
| Packability / system volume | `packable`, `packed-size` | multi-day carry demands compressibility |
| Base layer drying speed | `moisture-management`, `material` | synthetic or merino bases dry in tent; cotton never dries |

**What a GAP looks like:**
- No waterproof-breathable shell with taped seams → "sustained rain unprotected; water-resistant fails by afternoon"
- Down sleeping bag with `treated-down = false` in sustained rain scenario → engine flags "down bag at risk of saturation; verify storage dry or consider synthetic"
- No synthetic or treated insulation mid-layer → gap "camp insulation vulnerable to wet"

---

### Query D — Casual Travel
**Example:** "Long weekend in Austin, mix of restaurants, hiking trails, city walking"

**Condition envelope:**
- Moderate temps, mild conditions
- Social/lifestyle acceptability matters (gear shouldn't look overtly technical)
- Low bulk for packing in a carry-on or bag
- Versatile across contexts (restaurant + trail)
- No extreme condition coverage required

**Required capabilities and the facets they read:**

| Capability required | Facet(s) read | Decision rule |
|---|---|---|
| Versatility | `activity-range`, `use-context` | items that span "casual" + "light trail" rated higher |
| Aesthetics / lifestyle acceptance | `style` | technical-looking gear with external branding may not satisfy; facet: `style` ∈ {casual, lifestyle, versatile} |
| Packability for travel | `packable`, `packed-size` | fits in personal item / carry-on |
| Weight on body | `weight` | comfort-preference in non-technical use |
| Mild weather coverage | `waterproofness` ∈ {water-resistant} is sufficient | full waterproof shell is overkill; water-resistant or DWR finish adequate |

**Key insight for Query D:** Most facets that are load-bearing in A–C are IRRELEVANT here. What matters is `style`, `versatility`, and `packability`. This is the query that makes `style` and `use-context` load-bearing rather than vanity.

**What a GAP looks like:**
- All items in inventory are highly technical (no-lifestyle `use-context`) → gap "no casual-acceptable outerwear for restaurant/social settings"

---

## Section 2: Canonical Walkthrough — Mount Marcy Against the 3-Item Inventory

**Inventory:**
1. **Patagonia Stretch Terre Planing Hoody** — `waterproofness = water-resistant`, `moisture-management = fast-dry`, `upf-rating = 40`, `layering-role = shell/sun-hoody`, `wind-resistance = moderate`, `breathability = high`, `has-hood = true`, `sleeve-length = long`
2. **Kelty Galactic 30 Sleeping Bag** — `temperature-rating = 30°F`, `insulation-type = down`, `fill-power = 550`, `treated-down = false`, `layering-role = sleep-system`, `packable = true` (for a bag, not a worn layer)
3. **Hemp/Cotton Henley** — `material = hemp-cotton-blend`, `moisture-management = absorbing`, `layering-role = base`, `breathability = moderate`, `thermal-rating = light`

**Query conditions for Marcy:**
- Required capabilities: waterproof shell, windproof outer, packable wearable insulation (mid-layer), wicking base layer, thermal adequacy for 30–45°F windy summit exposure during a stop

---

### Item-by-item facet contribution

**Patagonia Stretch Terre Planing Hoody**
- `waterproofness = water-resistant` → **FAILS** waterproof shell requirement. Will wet out in sustained rain or heavy mist at elevation. Not acceptable as the primary rain/wind shell for an exposed alpine summit.
- `wind-resistance = moderate` → **PARTIAL** at best. Water-resistant fabrics block light wind, but not windproof. At 30+ mph gusts above treeline, this is insufficient for summit exposure.
- `breathability = high`, `moisture-management = fast-dry` → **CONTRIBUTES** positively on exertion approach. It will not trap sweat aggressively.
- `upf-rating = 40` → relevant for sun component, not alpine cold.
- **Net verdict:** Can be used as a second layer on the approach for breathable wind resistance, but it is NOT the waterproof shell this query demands. Do not recommend as primary outerwear for this trip.

**Kelty Galactic 30 Sleeping Bag**
- `layering-role = sleep-system` → **NOT a worn layering piece.** The engine must not recommend a sleeping bag as a summit insulation mid-layer.
- `insulation-type = down`, `fill-power = 550`, `treated-down = false` → irrelevant to wearable insulation needs; if the user were camping, the untreated down in wet alpine conditions is a risk flag, but for a day hike the bag stays in the car.
- **Net verdict:** Zero contribution to the Query A packing list. Contributes no capability.

**Hemp/Cotton Henley**
- `moisture-management = absorbing` → **FAILS** base layer wicking requirement. Cotton/hemp absorbs sweat and holds it against skin. On a cold alpine day with high exertion, this is a hypothermia vector — wet fabric next to skin in cold wind is dangerous.
- `layering-role = base` → the role is right, but the facet performance is wrong.
- **Net verdict:** Do NOT recommend. Flag as dangerous in this condition envelope.

---

### Expected engine output — recommendations and gaps

**Recommended from inventory:** NONE that fully satisfy the query.

**Conditional partial use:**
- Patagonia Hoody: engine MAY suggest as mid-layer (over a wicking base) for the approach if no shell is available, with explicit warning that it does not provide waterproof protection and will fail at the summit in precipitation.

**Gaps surfaced (priority order):**

| Gap # | Capability missing | Facet predicate violated | Severity |
|---|---|---|---|
| 1 | Waterproof / windproof shell | No item: `waterproofness = waterproof-breathable` AND `wind-resistance = windproof` | CRITICAL — trip-blocking |
| 2 | Packable wearable insulation (mid-layer) | No item: `layering-role ∈ {mid}` AND `insulation-type ∈ {down, synthetic}` AND `packable = true` | HIGH — summit stop unsafe without it |
| 3 | Wicking base layer | No item: `layering-role = base` AND `moisture-management ∈ {wicking, fast-dry}` | HIGH — hypothermia risk on descent |

**Engine advisory output (human-readable surface):**
- "You have no waterproof shell for an exposed alpine summit. Your Patagonia hoody is water-resistant and will not protect you in rain or sustained mist. Consider: hardshell or waterproof-breathable rain jacket."
- "You have no packable insulation layer (down jacket, synthetic puffy) for the cold, exposed summit stop. Standing still at altitude without insulation is a hypothermia risk."
- "Your only base layer is a hemp/cotton henley. Cotton holds moisture and chills dangerously in cold wind when wet with sweat. Consider: merino wool or synthetic wicking base layer."

This walkthrough is the canonical end-to-end test. A correct facet model and recommendation engine produces exactly these three gaps and no spurious recommendations.

---

## Section 3: Ranked Facet Load-Bearing-ness

**Scoring method:** A facet is load-bearing if it drives a pick (selects one item over another) or surfaces a gap (no item meets threshold) in 2+ queries. Situational if it matters in 1 query. Vanity if it never changes a recommendation.

| Rank | Facet | Load-bearing-ness | Queries where decisive | Notes |
|---|---|---|---|---|
| 1 | `waterproofness` | **LOAD-BEARING** | A, C | Most decisive binary split; determines whether a shell is usable at all in wet/cold alpine/rain |
| 2 | `moisture-management` | **LOAD-BEARING** | A, B, C | Drives base layer selection in every active-use query; cotton fail is trip-blocking |
| 3 | `layering-role` | **LOAD-BEARING** | A, C | Without this facet the engine cannot build a layering system; it's structural |
| 4 | `insulation-type` + `treated-down` | **LOAD-BEARING** | A, C | Determines whether insulation survives wet conditions; pure down without treatment is a risk flag |
| 5 | `packable` | **LOAD-BEARING** | A, C, D | Determines whether an item is usable in day-pack context and travel context; unlabeled = assume false |
| 6 | `breathability` | **LOAD-BEARING** | A, B | High-exertion queries fail if shell has low breathability; a breathable shell is non-negotiable on steep approaches |
| 7 | `wind-resistance` | **LOAD-BEARING** | A | Exposed ridge/summit queries; correlated with waterproofness but not equivalent |
| 8 | `upf-rating` | **LOAD-BEARING** | B | Sun-exposed queries; binary (sufficient / not); makes a specific item required or excluded |
| 9 | `temperature-rating` | **LOAD-BEARING** | A, C | Sleep system and insulation suitability; essential for trip safety threshold checks |
| 10 | `fill-power` | **SITUATIONAL** | C | Affects warmth-to-weight; matters for multi-day weight budgeting, less for day hikes |
| 11 | `weight` | **SITUATIONAL** | C, D | Load-bearing for multi-day backpacking and travel; less decisive for day hike |
| 12 | `seam-sealing` | **SITUATIONAL** | C | Critical in sustained rain; irrelevant in most other queries |
| 13 | `activity-range` / `use-context` | **SITUATIONAL** | D | Load-bearing for versatility/travel queries; vanity for technical queries |
| 14 | `style` | **SITUATIONAL** | D | The only query where aesthetics change the pick; matters for lifestyle queries |
| 15 | `sleeve-length` / `has-hood` | **SITUATIONAL** | B | Coverage geometry for sun protection; decisive for hooded sun shirts |
| 16 | `material` (specific fabric) | **SITUATIONAL** | A, B, C | Mostly derived — moisture management and durability are downstream of material, but material itself is rarely queried directly |
| 17 | `color` | **VANITY** | None | Never changes a recommendation for any of these query types |
| 18 | `brand` | **VANITY** | None | Useful for display/inventory; never a decision predicate |
| 19 | `purchase-price` | **VANITY** | None | Useful for insurance/replacement; never a recommendation driver |
| 20 | `year-purchased` | **VANITY** | None | Could inform condition/age heuristics but is not a direct facet predicate |

---

## Section 4: Capability Layer Recommendation

**Recommendation: YES — the system MUST reason in terms of capabilities, not raw facets, for recommendations and gap analysis.**

### Rationale

Raw facets are observations about an item. Capabilities are predicates the planning engine evaluates. The indirection is necessary because:

1. Multiple facets combine to produce a single capability (e.g., "rain protection" requires both `waterproofness = waterproof-breathable` AND `seam-sealing = taped`).
2. A single facet can contribute to multiple capabilities (e.g., `moisture-management = wicking` contributes to both "wicking base layer" and "sweat management under exertion").
3. Capabilities can have degree (e.g., "wind protection: partial vs. full") whereas raw facets are just labels.
4. Gap analysis is cleaner when expressed as "no item satisfies capability X" rather than "no item with this facet combination."

### Canonical capability definitions

| Capability | Facet predicate | Notes |
|---|---|---|
| `rain-protection` | `waterproofness ∈ {waterproof, waterproof-breathable}` AND (`seam-sealing = taped` OR query duration < 1hr) | Seam sealing matters for sustained rain |
| `wind-protection` | `wind-resistance = windproof` OR `waterproofness = waterproof-breathable` (fully sealed shell implies wind stop) | Correlated but not identical to rain protection |
| `breathable-shell` | `layering-role ∈ {shell}` AND `breathability ∈ {high, very-high}` | Required for high-exertion queries; non-breathable shell = sweat trap |
| `wicking-base` | `layering-role = base` AND `moisture-management ∈ {wicking, fast-dry}` | Cotton/hemp fail this; merino/synthetic pass |
| `packable-insulation` | `layering-role ∈ {mid, insulation}` AND `insulation-type ∈ {down, synthetic}` AND `packable = true` | "Wearable" is implicit — sleeping bags excluded even if packable |
| `wet-safe-insulation` | `insulation-type = synthetic` OR (`insulation-type = down` AND `treated-down = true`) | For sustained-wet or rain-likely conditions |
| `sun-protection` | `upf-rating ≥ 30` AND `sleeve-length = long` AND `has-hood = true` | All three required for full desert sun protection |
| `sleep-warmth-adequate` | `temperature-rating ≤ expected-low-temp` | Sleep bag/quilt suitability; simple threshold check |
| `travel-versatile` | `use-context` includes `casual` AND `packable = true` AND `weight ≤ threshold` | Lifestyle travel suitability |

### How the engine uses capabilities

The planning engine should:
1. Parse the trip query into a **condition envelope** (temp range, precipitation probability, activity intensity, duration, social context).
2. Map the condition envelope to a **required capability set** (e.g., Query A → {rain-protection, wind-protection, breathable-shell, wicking-base, packable-insulation}).
3. For each capability, scan inventory for items satisfying the facet predicate.
4. Report picks (items that satisfy), gaps (capabilities with zero satisfying items), and partial matches (items that partially satisfy, with explanation of what's missing).

This architecture means the facet model remains factual (what the item IS), and the capability layer remains interpretive (what the item CAN DO for a specific query).

---

## Section 5: Confidence and Unknown Facets in Recommendations

**Core rule: An item with an UNKNOWN value on a safety-relevant facet MUST NOT be recommended for the capability that depends on it. Surface as "uncertain — verify before trip."**

### Confidence levels

Each facet value should carry a confidence level:
- `confirmed` — user entered from tag/spec sheet, or engine parsed from known product data
- `inferred` — engine inferred from product name/description heuristics (e.g., "hardshell" in the name → likely waterproof)
- `unknown` — facet has never been populated for this item

### Effects by facet

| Facet | If confidence = unknown or inferred | Engine behavior |
|---|---|---|
| `waterproofness` | UNKNOWN | Do NOT satisfy `rain-protection` capability. Flag: "Waterproofness unverified — do not rely on for rain protection." |
| `treated-down` | UNKNOWN on a down item for a wet trip | Flag as risk: "Cannot confirm hydrophobic down — bag may lose warmth if wet. Verify or pack dry." |
| `temperature-rating` | INFERRED from product name "30" | Accept with low confidence warning: "Rating is nominal — verify test standard (EN/ISO comfort vs. limit)." |
| `moisture-management` | UNKNOWN | Do not recommend as wicking base for cold-wet queries. |
| `upf-rating` | UNKNOWN | Do not satisfy `sun-protection` capability. Unlabeled fabric may have incidental UPF but cannot be relied upon. |
| `seam-sealing` | UNKNOWN | Assume NOT taped. Do not satisfy `rain-protection` at full confidence even if waterproofness is confirmed. |

### Inferred values — when to accept

- `INFERRED` values MAY be used to satisfy capabilities at reduced confidence, but recommendations must surface the uncertainty:
  - "Your Patagonia Hoody is inferred to be water-resistant based on product description. This is below the waterproof threshold for rain protection."
- The engine should distinguish between "inferred correctly above threshold" and "inferred but at threshold boundary" — the latter requires user confirmation before trip.

### Unknown propagation rule

If a trip query requires a capability and the only candidate item has `unknown` on the relevant facet: the engine should NOT recommend that item for that capability. Instead:
1. Surface the gap as if no item existed.
2. Separately note: "You have one item ([name]) whose [facet] is unverified. If it meets the threshold, this gap may be resolved — please verify."

This prevents dangerous false positives (e.g., recommending an unmarked jacket as rain protection because the user forgot to fill in `waterproofness = water-resistant`).

---

## Section 6: Layering and System-Building Logic

**The recommendation engine must build layering systems, not just recommend individual items.**

### The three-layer model

For cold/wet/active conditions, the engine reasons over a system:

```
[Base Layer] → [Mid Layer] → [Shell Layer]
wicking       insulating     protecting
```

Each slot has a required capability set:
- **Base:** `wicking-base` (wicks sweat away from skin)
- **Mid:** `packable-insulation` (retains heat during stops; may be omitted in mild conditions or high-exertion-only trips)
- **Shell:** `rain-protection` AND `wind-protection` AND `breathable-shell` (outer barrier; breathability prevents mid layer from saturating with sweat vapor)

### Slot-filling logic

The engine should:
1. Determine which slots are required for the condition envelope (e.g., Query B — desert sun — needs only base; no mid or shell).
2. For each required slot, query inventory for items satisfying that slot's capability set.
3. If multiple items qualify for a slot, rank by best fit (e.g., highest breathability for shell in high-exertion queries).
4. Report the complete system (filled slots) and any unfilled slots as gaps.

### Layering-role facet is structural

The `layering-role` facet is not just descriptive — it is the mechanism by which the engine knows which slot an item can fill. Without it, the engine cannot distinguish a base layer from a shell, and cannot build systems. This makes `layering-role` a mandatory facet for all wearable items.

### Activity-state transitions within a trip

Query A (alpine day hike) has TWO activity states: high-exertion ascent and cold static summit stop. The engine must reason about transitions:

- **Ascent state:** Need breathable base (fast-dry/wicking) + breathable shell. Mid layer may be stowed.
- **Summit stop state:** Need base + mid (insulation) + shell. All three layers must be in the pack.

The engine should distinguish "wear now" from "carry for when conditions change." This means:
- A packable mid-layer satisfies "summit stop" even if not worn during ascent — but only if `packable = true` makes it feasible to carry.
- A non-packable mid layer (e.g., a heavy fleece) may satisfy the thermal need but fail the "carryable on a day hike" constraint.

### Combining facets for system-level gaps

A system gap occurs when the combination of items fails to build a complete system — even if each individual item is fine:

- Three excellent base layers + no shell = system gap (no outer protection)
- Great shell + great mid + cotton base = system gap (base layer failure undermines the whole system's thermal regulation)

**The engine must evaluate system completeness, not just individual item suitability.** A complete, coherent layering system for the condition envelope is the unit of recommendation — not a list of individual items.

### Condition-appropriate system assembly rules

| Condition envelope | Required slots | Key facets checked per slot |
|---|---|---|
| Cold alpine, wet, active | Base + Mid + Shell | base: `moisture-management`; mid: `insulation-type`, `packable`; shell: `waterproofness`, `breathability`, `wind-resistance` |
| Hot desert, sunny, active | Base only | base: `upf-rating`, `moisture-management`, `has-hood`, `sleeve-length` |
| Sustained rain, camp | Base + Mid + Shell + Sleep | all above + `treated-down` / `insulation-type` for mid and sleep system |
| Casual travel, mild | Base or Base+Light-outer | `use-context`, `style`, `packable`; waterproofness ∈ {water-resistant} sufficient |

---

*This document is a phase-0 decision-driver investigation artifact. It establishes which facets the Armarium recommendation engine must read and why. All facet model decisions, capability definitions, and recommendation logic should trace back to the analyses in this document.*
