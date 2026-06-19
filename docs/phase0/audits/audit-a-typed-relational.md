# Audit: Architecture A — Typed Relational Core + Domain Extensions

> **Auditor role:** Adversarial auditor — stress-test only this proposal.
> **Ground truth:** Wave-1 investigation artifacts in `docs/phase0/investigation/`.
> **Date:** 2026-06-19

---

## 1. Verdict

**SOUND-WITH-FIXES**

Architecture A correctly solves the three hardest problems Armarium poses — the Kelty rating-standard anti-pattern, the Terre Planing DWR/rain-protection confusion, and the multi-body-zone buff — through a combination of ordered enums, null-first unknown handling, and globally shared multi-label facets. However, it contains one latent Critical flaw (the `itemDomain` discriminated-union forces multi-domain items into a single extension table, making genuinely cross-domain items like an insulated waterproof boot or an insulated softshell awkward or incomplete) and two Major flaws (ordered-enum comparisons silently break on any future value insertion or reordering; the `activityFit` and `functionPurpose` Zod schemas accept `z.array(z.string())` with no enum enforcement, which defeats the type-safety contract the thesis promises). These are fixable without abandoning the core architecture.

---

## 2. Findings

| # | Severity | Stress Test | Description | Recommended Fix |
|---|---|---|---|---|
| F1 | **Critical** | ST4 — Extensibility | Single-domain routing via `itemDomain` enum forces every item into exactly one extension table. An insulated waterproof boot needs both `item_shell_facets` (waterproofness, seam sealing) and `item_footwear_facets` (crampon compat, ankle height, water_management). An insulated softshell needs both `item_shell_facets` and `item_insulation_facets`. The schema provides no mechanism for one item to join two extension tables simultaneously. The proposal's "mitigation" (lean on universal layer + JSONB) is hand-waving: it silently loses the typed crampon_compat column and the protection_ceiling derived facet for insulated boots. | Replace `itemDomain` single-select with a **`itemDomains` multi-label enum array** (same enum, stored as array). At query time, join all extension tables whose domain is in the item's domain set. A footwear+shell item carries `itemDomains = {footwear, apparel_shell}` and has rows in both `item_footwear_facets` and `item_shell_facets`. The discriminated-union Zod shape becomes `z.array(z.discriminatedUnion(...))` of domain blocks. |
| F2 | **Major** | ST5 — Type-safety | `activityFit` and `functionPurpose` Zod fields in `ItemClassification` (§4.2) are typed as `z.array(z.string())` — not `z.array(z.enum([...]))`. This means an LLM can emit `"rain_protection"` instead of `"water_resistance"` or `"waterproof"` in `functionPurpose`, pass Zod validation, and persist a string that no GIN index query will match. The thesis's central type-safety claim fails at this exact seam. `conditionFit` has the same defect. | Replace all three loose `z.array(z.string())` occurrences with the same closed enum arrays used in the `items` table DDL. The Zod enum members must be copy-of-record from the corresponding `pgEnum` definition, or better, generated from a shared const array that feeds both Drizzle and Zod. |
| F3 | **Major** | ST5 — Type-safety | Ordered-enum comparisons for `waterproofness` and `protection_ceiling` depend on Postgres enum declaration order for `>=` semantics (noted in §8 self-assessment). In Postgres, enum comparison `>=` is ordinal by declaration position — so `"wp_breathable" >= "dwr_only"` works today. But `ALTER TYPE … ADD VALUE` in Postgres inserts values at the end of the internal sort order unless `BEFORE`/`AFTER` is specified, and `BEFORE`/`AFTER` is only available since Postgres 14. More critically: no CHECK constraint enforces the ordering contract; unit tests are promised but not demonstrated. If a developer runs `ALTER TYPE waterproofness ADD VALUE 'wp_breathable_3l' AFTER 'dwr_only'`, the order silently corrupts every `>=` capability predicate. | Eliminate the implicit reliance on Postgres enum sort order for capability logic. Move the ordering into `src/core` as an explicit ordered array (`const WATERPROOFNESS_ORDER = ["none","dwr_only",...]`) and compute `>=` as `indexOf(a) >= indexOf(b)`. Use the DB enum only for storage validation, not for ordering semantics. Add a CI test that asserts the DB enum values match the core array in the declared order. |
| F4 | **Major** | ST6 — LLM ergonomics | The `MaterialRef` object in the `construction` block is referenced in §4.2 but its Zod schema is never shown — it appears to include fiber components, B-facets as `Evidence<Ordinal>`, fill power, recycled content, and more. This is the most complex sub-object in the classification shape. An LLM must reliably emit a fully-formed `MaterialRef` for potentially four named roles (shell, membrane, insulation, lining) per item, each with 10+ behavioral Evidence fields, simultaneously with the universal facets and a domain block. The total token count for a single-item classification request will be very large, and the deeply nested shape (universal → construction[shell → Evidence<Ordinal5>×10] → domain[...]) will produce high hallucination rates on the B-facet Evidence fields. | Decouple material classification from item classification. Classify item facets (universal + domain) in one LLM call; resolve material slugs and classify B-facets in a separate per-material call. The item call only emits `{ shell_slug, membrane_slug, insulation_slug, lining_slug }` string references; the material call handles the full `MaterialRef` shape. This also avoids re-classifying an identical material multiple times. |
| F5 | **Minor** | ST2 — Missing data | The `Evidence` wrapper enforces `if value === null then confidence === "unknown"` via a Zod `.refine()`. This is correct. However, the inverse is not enforced: `{ value: "wp_breathable", confidence: "unknown" }` passes validation. An item could have a seemingly concrete facet value paired with `confidence = unknown`, which is semantically contradictory (you know the value but have unknown confidence?). The capability predicates check `confidence !== "unknown"` before accepting a value, so a false positive is prevented — but the Zod schema should reject this impossible state rather than rely on downstream logic. | Add a second Zod refinement: `if confidence === "unknown" then value must be null`. This mirrors the two-way invariant and catches upstream LLM output where the model emits a guess alongside `confidence = unknown`. |
| F6 | **Minor** | ST4 — Extensibility | The `softEvidence` JSONB escape hatch (`SoftEvidenceBag` type in §3.2) is referenced but its structure is never defined in the proposal. It is described as absorbing "experimental/rare facets without a migration." Without a defined schema, this bag will accumulate arbitrary keys over time, defeating the type-safety contract for cold facets and creating a maintenance hazard. | Define `SoftEvidenceBag` as a Zod schema with known keys in the same `evidence.ts` file. Mark unknown keys as forbidden (`z.object({...}).strict()`). Any new facet candidate must be proposed as a named key in this type before it can be written; the type gate replaces an informal convention. |
| F7 | **Minor** | ST1d — Carry affordance | The kangaroo-pocket / Marsupial Snap-T carry affordance is cited in §7 (via `function_purpose = {carry}`) as correctly handled. This is technically true — `carry` is in the `functionPurpose` enum. However, there is no facet capturing carry *capacity* or *type* on apparel (as opposed to packs). A query for "items that can carry a packable mid-layer in a pocket" cannot distinguish a chest pocket from a kangaroo pocket from a stuff-sack-compatible back pocket. The model correctly avoids misclassifying the Snap-T as a pack, but the carry affordance it surfaces is coarse. | Add a `carry_capacity` ordinal sub-facet (e.g., `phone_only < small_items < mid_layer_stuff < full_daypack_layer`) to either `softEvidence` or as a typed column. The Snap-T resolves to `carry_capacity = small_items`; packs to `carry_capacity = full_daypack_layer`. This prevents the `carry` function from being a boolean that equates a kangaroo pocket to a 30L pack. |
| F8 | **Minor** | ST3 — Marcy trace | The Marcy trace (§6.2) is excellent and traces all three gaps correctly. However, the proposed `windProtection` capability function in §6.1 is `windResistance === "windproof" || rainProtection(i)`. This means a `wp_breathable` shell with `waterproofness_confidence = "medium"` satisfies `windProtection` via the `rainProtection` path — but `rainProtection` requires `confidence !== "unknown"`, not `confidence ∈ {high}`. A medium-confidence waterproof-breathable item will be recommended as windproof. For an alpine summit query this may be acceptable (medium confidence of a WP shell still implies windproofness), but the confidence floor should be explicit and configurable per query context, not implicit in the predicate. | Add a `confidenceFloor` parameter to each capability function (default `"medium"`) and propagate it through the predicate chain. High-stakes trip queries can pass `confidenceFloor = "high"` and tighten the recommendation logic without changing the predicates themselves. |

---

## 3. Stress-Test Walkthroughs

### ST1 — Multi-Purpose / Multi-Facet Items

#### ST1a — Terre Planing: DWR vs. rain protection

The model stores `waterproofness = "dwr_only"` and the shell extension stores `protection_ceiling = "light_spray"`. The `rainProtection` capability predicate in §6.1 requires `waterproofness ∈ {wp_breathable, wp_nonbreathable}` — `dwr_only` fails immediately. The `functionPurpose` array for the Terre Planing is explicitly stated as `{sun_protection, wind_protection, moisture_mgmt}` with **no `waterproof` or `water_resistance` values**, so even a `functionPurpose && '{waterproof}'` query returns false.

**Verdict: PASSES.** The model makes it structurally impossible at both the enum level and the function_purpose level to count DWR as rain protection. The ordered enum `dwr_only < water_resistant < wp_breathable` means no `>=` comparison on `wp_breathable` can be satisfied by `dwr_only`. This is one of the proposal's genuinely strong structural resolutions.

#### ST1b — The Buff: multi-zone, multi-function

The proposal stores `body_zone_covered = {neck, face, head}` and `function_purpose = {warmth, sun_protection, wind_protection, moisture_mgmt}`, both as GIN-indexed enum arrays. Query for neck UV protection: `body_zone_covered && '{neck}' AND function_purpose && '{sun_protection}'` — hits. Query for head warmth backup: `body_zone_covered && '{head}' AND function_purpose && '{warmth}'` — hits. Query for face wind block: `body_zone_covered && '{face}' AND function_purpose && '{wind_protection}'` — hits. One item, three independently correct queries, no category needed.

**Verdict: PASSES.** The globally-shared multi-label facets `body_zone_covered` and `function_purpose` (per `domain-accessories.md` §6's "single most important cross-domain argument") are correctly placed on the universal `items` table with GIN indexes.

#### ST1c — R1 Air: multi-role without a single bucket

`layering_role = {base_adjacent, mid, active_insulation, standalone}`. A query for "aerobically breathable mid for ski touring" uses `layering_role && '{active_insulation}' AND breathability IN ('high','very_high')` — hits. A query for "warm belay jacket" might use `layering_role && '{mid}' AND warmth_category ∈ {high, very_high}` — misses (R1 Air is `warmth_category = low`). No enum forces a single classification.

**Verdict: PASSES.** The multi-label `layering_role` array correctly handles multi-role pieces. The capability predicates disambiguate by crossing layering_role with other facets.

#### ST1d — Marsupial kangaroo pocket: carry-affordance on apparel

The model assigns `function_purpose = {carry}` to the Snap-T/Marsupial and explicitly keeps `insulation_type` separate from packs. No pack-domain extension table is created for the Snap-T. A query for "items with carry capability" correctly returns the Snap-T alongside packs, distinguished by whether `item_insulation_facets` vs `item_pack_facets` exists.

**Partial pass with a fixable gap.** The `carry` function tag is correctly assigned and does not misclassify the item as a pack. However, as noted in F7, the coarseness of a single `carry` enum value cannot distinguish a kangaroo pocket from a hip belt. This is Minor rather than Critical because the Marcy-class trip queries do not require carry-type specificity, but a future "what can I stuff a beanie into?" query would be underserved.

---

### ST2 — Missing-Data Behavior

#### ST2a — Is unknown truly first-class?

Hard facts use a nullable typed column + `*_source` enum with no confidence field (correct — a hard fact is either stated or null, never confidence-weighted). Soft facts use either three sibling columns (`facet / facet_confidence / facet_source`) or the typed JSONB `Evidence<T>`. The Zod `Evidence` wrapper enforces `if value === null then confidence === "unknown"` via `.refine()`.

**Verdict: PASSES** for null-first discipline. The schema defaults every soft facet to null/unknown rather than any positive value. The `null` path is the "cheap default" explicitly called out in §2.

However, see F5: the inverse constraint (`confidence = "unknown"` implies `value = null`) is not enforced, allowing a contradictory state where a concrete-looking value has `confidence = "unknown"`.

#### ST2b — Unknown waterproofness blocks positive rain-protection recommendation

The `rainProtection` capability (§6.1):
```ts
const rainProtection = (i) =>
  ["wp_breathable","wp_nonbreathable"].includes(i.waterproofness ?? "")
  && i.waterproofnessConfidence !== "unknown"
  && (i.shell?.seamSealing !== "none");
```

If `waterproofness = null`, the `?? ""` fallback means `"".includes(...)` returns false — the predicate fails immediately. If `waterproofness = "wp_breathable"` but `waterproofnessConfidence = "unknown"`, the second clause fails. Both cases correctly produce `satisfied = false` and the engine emits a "verify" advisory rather than a false positive (per §6.1's "unknown-propagation rule is baked in" statement).

**Verdict: PASSES.** Unknown waterproofness structurally blocks `rainProtection`. The check `confidence !== "unknown"` is present in the predicate and is the correct gate.

#### ST2c — Kelty "30": rating number stored without silent upgrade

The proposal stores `temp_rating_stated = 30` (hard, the number only) and `temp_rating_standard = null` with `confidence = "low"` and a note `"marketing/season-style; EN cert not documented"`. The schema enforces this via a Zod refinement: `temp_rating_standard = "EN13537_comfort"` requires `confidence ∈ {high, medium}`. An LLM that emits `temp_rating_standard = "EN13537_comfort"` with `confidence = "low"` will be rejected by Zod and will not persist.

The `sleepWarmthAdequate` capability returns `false` when `tempRatingStandard === null` — conservative, safe.

**Verdict: PASSES.** The Kelty case is exactly handled as the ground truth in `domain-sleeping-bags.md` §5.1 requires. The number and the standard are separate columns; the standard is null; the capability predicate conservatively rejects null standards.

---

### ST3 — Marcy-Style Gap Query

Trip: Mount Marcy, mid-June, alpine summit, cold and windy, long day hike.
Inventory: Terre Planing Hoody, Kelty Galactic 30, Hemp/Cotton Henley.

**Step 1 — Condition envelope parsed.**
- Sustained cold (30–45°F), 30+ mph gusts above treeline, precipitation possible (convective storms), 8–12 hr day hike.
- Required capability set: `{rain_protection, wind_protection, breathable_shell, wicking_base, packable_insulation}`.

**Step 2 — Item-by-item capability evaluation.**

| Item | Key stored facets | Capability result |
|---|---|---|
| Terre Planing | `waterproofness=dwr_only (conf=high)`, `windResistance=wind_resistant`, `breathability=high`, `moistureManagement={wicking_spread,dwr_face}`, `layeringRole={base,standalone,softshell_midouter}`, `protectionCeiling=light_spray` | `rainProtection` → FALSE (`dwr_only` not in `{wp_breathable,wp_nonbreathable}`). `windProtection` → FALSE (`wind_resistant` ≠ `windproof`; rainProtection also false). `breathableShell` → FALSE (layeringRole does not include `outer_shell`). `wickingBase` → PARTIAL — has `layeringRole ∋ base` and `moistureManagement ∋ wicking_spread`, so `wickingBase` = TRUE if used as a base. BUT: in alpine cold-wet conditions the engine should note `waterproofness=dwr_only` will wet through and the `dwr_face` moisture management is a misleading signal for base-layer function in prolonged rain. |
| Kelty Galactic 30 | `layeringRole={sleep_system}`, `insulationType=down`, `packability=packs_small`, `hydrophobicTreatment=null`, `wetPerformance=collapses_when_wet`, `tempRatingStated=30`, `tempRatingStandard=null (conf=low)` | `packableInsulation` → FALSE (excludes `sleep_system` role). `rainProtection/wind/breathableShell` → all FALSE. `sleepWarmthAdequate` → FALSE (null standard). Zero contribution to the hiking system. |
| Hemp/Cotton Henley | `moistureManagement={absorb_hold}`, `warmthWhenWet=collapses`, `layeringRole={base,standalone}`, `breathability=moderate`, material `drySpeed=slow`, `wetWarmthRetention=very_low` | `wickingBase` → FALSE (`absorb_hold` not in `{wicking_spread, absorb_release}`). Flagged as a hypothermia vector: cold conductor when wet. |

**Step 3 — Gap table surfaced.**

| Gap | Predicate violated | Severity |
|---|---|---|
| 1. Waterproof/windproof shell | No item: `waterproofness ∈ {wp_breathable,wp_nonbreathable}` AND `windResistance='windproof'` | CRITICAL — trip-blocking |
| 2. Packable wearable insulation | No item: `layeringRole ∋ {mid,active_insulation}` AND `insulationType ∈ {down,synthetic}` AND `packability ∈ {packs_small,packs_to_pocket}` (Kelty excluded: `sleep_system`) | HIGH — cold summit stop unsafe |
| 3. Wicking base layer | No item: `layeringRole ∋ {base}` AND `moistureManagement ∩ {wicking_spread,absorb_release} ≠ ∅` (Henley fails: `absorb_hold`) | HIGH — hypothermia risk on descent |

**Verdict: PASSES.** The Marcy trace in §6.2 is detailed, accurate, and matches the canonical expected output from `decision-drivers.md` §2 exactly. The three gaps are surfaced, no spurious recommendations are made. The engine logic is traceable through named capability predicates over typed facets — this is not hand-waving. The one nuance: the Terre Planing _could_ satisfy `wickingBase` since it has `moistureManagement ∋ wicking_spread` and `layeringRole ∋ base`. The proposal correctly notes this as a "conditional partial" with an explicit warning that it will wet through. The base-layer gap is therefore correctly labeled as unresolved because no adequate wicking base exists for cold-wet alpine use (the Terre Planing would wet out, leaving the user with a wet base layer — the gap remains).

---

## 4. Strengths to Harvest

**S1 — Ordered-enum corruption of safety-critical distinctions is structurally impossible.** The `waterproofness` enum (`none < dwr_only < water_resistant < wp_breathable < wp_nonbreathable`) makes DWR-as-rain-protection a type-level error, not a logic convention. The synthesis should carry this ordered enum design forward unchanged.

**S2 — Null-first unknown discipline with confidence + source on every soft facet.** The `Evidence<T>` wrapper's Zod-enforced `null → confidence=unknown` invariant, paired with the `HardFact<T>` shape that carries no confidence field (because hard facts are stated or null, not confidence-graded), is the cleanest implementation of the "unknown is first-class, wrong-spec-is-worse-than-missing" principle across all proposals reviewed. The synthesis should adopt these two types as the canonical evidence shapes.

**S3 — Materials normalization via named-role construction.** The `item_constructions` table with four FK role columns (shell/membrane/insulation/lining) into a shared `materials` library, combined with the deterministic B-facet projection rules, ensures identical fabrics always behave identically. This solves the "two merino garments get different odor_resistance from two LLM calls" anti-pattern identified in `material-behavior.md` §3.3. The synthesis should keep this structure intact.

**S4 — GIN-indexed enum arrays for multi-label facets.** Using Postgres enum arrays with GIN indexes for `layering_role`, `body_zone_covered`, `function_purpose`, `activity_fit`, and `condition_fit` gives both type safety (only declared enum values can be stored) and genuine SQL queryability (`&& '{neck}'` hits the GIN index). This is architecturally superior to JSONB arrays or CSV strings for facets that are small-closed and frequently queried.

**S5 — Domain extension tables eliminate null noise.** The 1:1 per-domain extension table pattern means `capacity_l` never sits as a perpetual null on a fleece jacket. Combined with the shared `item_insulation_facets` table used by both sleeping bags and insulated jackets, this is a clean expression of the "down is down" shared insulation sub-model (`domain-sleeping-bags.md` §4, §6).

**S6 — Capabilities as pure functions in framework-agnostic `src/core/`.** Never storing derived capabilities, computing them at query time from typed facets, and keeping the functions in `src/core/` with no Next.js imports is exactly the right architecture for eventual MCP-server backing. The synthesis should enforce this boundary.

**S7 — Discriminated-union domain blocks in Zod.** The `z.discriminatedUnion("kind", [...])` pattern for domain-specific classification blocks is the correct Zod primitive for this problem. Even if the single-domain constraint is relaxed (see F1 fix), the discriminated union shapes per domain should be preserved and composed into an array.

---

## 5. If I Had to Fix ONE Thing

**Fix F1: allow multi-domain items by replacing single `itemDomain` with a `itemDomains` array.**

This is the highest-leverage change because it is the only constraint that makes the schema *structurally fight* real gear rather than model it. The insulated waterproof boot, the insulated softshell, the sun hoody that is simultaneously a base layer and a DWR-activity shell — all of these are real items in real collections. The current schema forces a developer to either (a) pick one domain and lose the safety-critical facets of the other (e.g., lose `crampon_compat` on an insulated mountaineering boot), or (b) dump those facets into `softEvidence` JSONB where they lose type safety and indexing.

The fix is minimal: change `itemDomain: itemDomainEnum(...)` to `itemDomains: itemDomainEnum(...).array()` on the `items` table. The Zod classification shape changes from `z.discriminatedUnion("kind", [...])` to `z.array(z.discriminatedUnion("kind", [...]))`. The mapper inserts into all extension tables whose `kind` appears in the array. Query-time joins include all relevant extension tables. The migration is a column type change plus a mapper update — no extension table DDL changes required.

Everything else about the architecture — the ordered enums, the null-first discipline, the GIN indexes, the materials library, the `src/core/` capability functions — survives this change intact.
