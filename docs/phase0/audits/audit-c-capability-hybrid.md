# Adversarial Audit — Architecture C: Capability-First Hybrid

**Auditor role:** Adversarial, hard but fair. This document stress-tests Architecture C on its own merits against the non-negotiable principles in CLAUDE.md and the domain ground truth in the Wave-1 investigation artifacts. The synthesis agent may use these findings; no other architecture files were consulted.

---

## 1. Verdict

**SOUND-WITH-FIXES**

The capability-first design is conceptually sound and technically sophisticated: it correctly identifies the `item_capabilities` materialization layer as the centerpiece, structurally encodes unknown-as-blockage via the three-state status, and makes the `null + confidence + source` discipline physically unbypassable in both the column and JSONB layers. However, it carries one genuinely dangerous flaw — staleness in the capability cache can produce wrong recommendations (not merely slow ones) when the capability-definition logic changes without invalidating existing cache rows — and two Major structural risks: `seam_sealing` is classified as a cold JSONB facet despite being load-bearing for `rain_protection` in the Marcy scenario, creating a capability predicate that straddles two query paths; and `item_kind` is the thinnest of guardrails against category leakage in real engineering conditions. These are fixable without abandoning the architecture.

---

## 2. Findings

| # | Severity | Test / Probe | Finding | Recommended Fix |
|---|---|---|---|---|
| F1 | **Critical** | Capability materialization staleness | `facet_hash` guards against item-facet drift but has NO mechanism to invalidate cache rows when a **capability predicate definition changes** (logic update in `src/core`). A `rain_protection` predicate that is tightened (e.g., `seam_sealing` added as a required gate) will leave all existing `satisfies` rows stale — producing wrong recommendations silently, not slow ones. "Cache is optional ⇒ staleness degrades to slow not wrong" is false when the capability logic itself evolves. | Add a `capability_version` string (hash or semver of the predicate definition) to `item_capabilities` alongside `facet_hash`. On predicate change, bump the version; any cached row whose `capability_version` mismatches is treated as missing and recomputed live. Make both guards required columns. |
| F2 | **Major** | Typed/JSONB promotion boundary; `rain_protection` predicate coherence | `seam_sealing` is classified as a cold JSONB facet (§2.B) but is a required gate in the `rain_protection` predicate (§6.2: "`seam_sealing = fully_sealed` OR trip-duration < 1h"). The capability predicate therefore reads across BOTH query paths. The `facet_hash` for `rain_protection` must include a JSONB-extracted value, but the schema sketch does not specify how `seam_sealing` enters the hash — creating a gap where `seam_sealing` can be updated in the JSONB bag without invalidating the rain capability cache. This is an internal consistency failure of the design's own staleness guard. | Either promote `seam_sealing` to a hot column (it is ranked Situational LB rank-12 for sustained-rain queries, but architecturally it gates a Core capability), or make explicit in the `facet_hash` specification that all JSONB facets read by any capability predicate are hashed into the capability's `facet_hash`. Given that `seam_sealing` is a capability gate, promotion is cleaner and more honest. |
| F3 | **Major** | `item_kind` category leakage | `item_kind` is "quarantined to ingest routing" by convention only. The JSONB cold facets are explicitly grouped by `item_kind` (§2.B: "Domain groups — validated only when `item_kind` matches"). This means the discriminated-union Zod schema requires `item_kind` to select which JSONB shape to validate. Any future contributor writing a grouping or recommendation query who wants "only wearable items" will find `item_kind` the most accessible filter. The domain-JSONB coupling means `item_kind` bleeds into read-path logic even if recommendation SQL never names it — the Zod union effectively makes `item_kind` a schema-level category. There is no structural enforcement of the "never read in recommendation queries" rule beyond documentation. | Replace `item_kind` with a derived `validation_profile` selected from `layering_role` ∪ `function_purpose` at ingest time. Concretely: if the ingest evidence has `layering_role=[sleep]` and no worn-layer roles, choose `sleep` validation profile; if `body_zones` is populated but no layering role, choose `accessory` profile; etc. This makes classification emergent from facets, eliminating the category-at-the-root problem. The proposal acknowledges this alternative in §8 W4 but rejects it as chicken-and-egg; the mitigation is weak given how easily conventions erode. |
| F4 | **Major** | Denormalized material-derived hot-facet copy — consistency on material correction | When a shared `materials` row is corrected (e.g., the `breathability` derived behavior for a fleece is revised after new product data arrives), the dependent items' typed columns (`breathability`, `warmth_when_wet`, etc.) are stale until a "recompute of dependents" job runs. The proposal says this is "handled by the same invalidation hash as capabilities" (§3.6), but the `facet_hash` on `item_capabilities` hashes the item column values, not the underlying material IDs. So correcting a material does not directly invalidate the `item_capabilities` cache; it only invalidates the item column copy after the background job runs. There is thus a window where: (a) a material is corrected, (b) item columns are stale, (c) the capability cache's `facet_hash` matches the stale item columns — so the cache passes validation while containing wrong values. | Extend `facet_hash` to include a hash of the `material_behavior` JSON for each material referenced in the item's construction. Alternatively, on any `materials.behavior` update, trigger (explicitly, not via DB trigger) a batch job that marks all dependent `items` rows and their `item_capabilities` rows as needing recomputation. Document the exact sequence so no "window of wrong" exists. |
| F5 | **Minor** | LLM-classification ergonomics — two-shape target | The evidence object requires the LLM to simultaneously populate `hot` (14 typed fields each with `{value, confidence, source}`), `construction` (4 material roles + treatments array), and a `facets` discriminated-union group. This is a large, structured two-shape target (hot + cold). The proposal's mitigation — "composition-first pipeline does most soft facets deterministically before the LLM" — is sound in theory but depends on fiber composition being available, which is not guaranteed (many items in real collections lack composition data). When composition is absent, the LLM faces the full 14-column + JSONB target. A mis-picked `item_kind` (wrong facets group) causes Zod to reject the entire object, rather than accepting valid hot facets and rejecting only the malformed domain group. | Split the Zod schema into two independent parse steps: (1) parse and persist `hot` facets + identity + construction; (2) parse `facets` discriminated union separately, keyed off the `item_kind` inferred from step 1. Failures in step 2 do not discard the hot facets already validated in step 1. This also enables partial enrichment: a new item gets its hot facets immediately even if domain JSONB classification fails or is deferred. |
| F6 | **Minor** | `body_zones` confidence granularity | `body_zones` is promoted as a multi-label column (C14) with a single `body_zones_conf` and `body_zones_src` for the entire array. A Buff correctly gets `body_zones = [neck, face, head]`, but the confidence/source triple applies to the array as a whole. If `neck` is manufacturer-stated (high confidence) but `head` is inferred (medium confidence), the single confidence field is forced to the minimum — which is correct for capability blocking but means the UI cannot distinguish "verified neck coverage" from "inferred head coverage." The accessories domain investigation (§7) explicitly flags this kind of over-classification risk for accessories. | Either store body_zones as a JSONB array of `{zone, confidence, source}` objects (moving it to the cold path), or accept the single-minimum-confidence field and document it as a known loss of granularity for display. For v0 this is acceptable but should be flagged as a known limitation. |
| F7 | **Minor** | `protection_ceiling` facet is absent | The shells-wind domain investigation (§2.8) identifies `protection_ceiling` as the primary facet for "will this protect me" recommendation queries, calling it "LOAD-BEARING for recommendation queries." Architecture C has no equivalent facet — it relies entirely on the `rain_protection` capability predicate plus `seam_sealing` in JSONB. This is mostly fine (the capability predicate subsumes `protection_ceiling`), but trip-duration-gated logic (`seam_sealing = fully_sealed OR trip-duration < 1h`) is embedded in the capability predicate rather than in a facet, making it harder to surface partial-protection nuance (e.g., "adequate for 1h rain but not all-day") in UI copy without recomputing. | Store `protection_ceiling` as a soft cold JSONB facet (it is explicitly soft/derived per the domain artifact) alongside `seam_sealing`, with value and confidence. The capability predicate can continue to gate on `waterproofness` + `seam_sealing` as now; `protection_ceiling` is the display-layer human-readable roll-up. This is additive, not a redesign. |
| F8 | **Minor** | `warmth_when_wet` value-space mismatch with domain artifact | The proposal defines `warmth_when_wet` as an ordinal enum `{collapses, neutral, partial, largely_retained, unaffected}` (C4). The mid-insulation domain artifact (§2.5) uses `{collapses_when_wet, partially_retained, largely_retained, unaffected}` and the base-layers artifact uses `{retains_warmth, neutral, collapses}`. These three vocabularies conflict. The proposal's enum is the most complete but `neutral` (used for synthetic in the base-layers artifact) does not appear in the mid-insulation artifact, and `partial` is a new level not in either artifact. Cross-domain derivation logic (material-behavior §6.4) must use one canonical scale. | Adopt the proposal's 5-level scale (`collapses < neutral < partial < largely_retained < unaffected`) as the canonical, and update the composition-→-behavior mapping rules to use it consistently. Document the mapping: base-layers `neutral` → `neutral`; mid-insulation `partially_retained` → `partial`. This is a terminology unification task, not an architecture change. |

---

## 3. Stress-Test Walkthroughs

### Test 1: Multi-Purpose / Multi-Facet Items

#### (a) Terre Planing: structurally impossible to count DWR/water-resistant as rain protection?

The proposal assigns `waterproofness = dwr_only` — the lowest positive ordinal level, sitting below `water_resistant` and far below `wp_breathable`. The `rain_protection` predicate requires `waterproofness ∈ {wp_breathable, wp_nonbreathable}`. `dwr_only` does not satisfy this. The fail is definitive (`fails`, not `blocked_unknown`) because the value is known, not null. This is architecturally correct and structurally impossible to mis-recommend as rain protection.

One concern: the proposal also lists `dwr_presence = present_standard` in JSONB, which is a separate facet from `waterproofness`. The shells-wind investigation (§2.5) is emphatic that "DWR alone never equals waterproof." The architecture correctly keeps these separate: `waterproofness` on the column path and `dwr_presence` in JSONB as a modifier of reasoning, never as a capability gate. Structurally sound.

The "dries fast ≠ stays dry" distinction is encoded via separate `dry_speed = fast` (C3) and `waterproofness = dwr_only` (C1) columns. These are orthogonal axes; no conflation is possible at the schema level.

**Verdict: PASS.** The Terre Planing case is handled cleanly and the dangerous conflation is structurally impossible.

#### (b) Buff: one item, multiple body zones AND functions, surfaced for 3 different queries?

The buff gets `body_zones = [neck, face, head]` (multi-label column C14) and `facets.function_purpose = {warmth, sun_protection, wind_protection, debris_filtration}` (multi-label JSONB). The accessories domain investigation (§5) establishes this is the "poster child for facets-not-categories."

Query 1 — "neck UV protection": requires `upf ≥ 30` (C10) AND `neck ∈ body_zones`. If the buff has a stated UPF ≥ 30, this returns it. If UPF is null (unstated), it returns `blocked_unknown` on sun_protection, which is correct (the accessories domain explicitly flags this: "never infer UPF 50+ without a stated value").

Query 2 — "head warmth backup": `head ∈ body_zones` AND `warmth_level` in JSONB (accessory domain group). Returns the buff if warmth_level ≥ light.

Query 3 — "face wind block": `face ∈ body_zones` AND `wind_protection_level` in JSONB. Returns the buff.

One strain: `upf` is a promoted hard column (C10) with a single value, but `body_zones` is a multi-label array covering multiple zones simultaneously. There is no per-zone UPF value — the same `upf` applies globally to all zones. This is correct for most cases (a buff with UPF 50+ covers neck, face, and head all at UPF 50+), but for items like the Terre Planing where the hood covers the head zone and the long sleeves cover the arms, and they all share the same `upf = 40` column value, no zone-level variation is representable. The accessories domain notes this nuance but concludes the global `upf` column is sufficient for gap detection purposes.

**Verdict: PASS (with minor caveat on per-zone UPF granularity, logged as F6-adjacent).** Three queries, one item, all surfaced correctly.

#### (c) R1 Air multi-role without forcing one truth?

`layering_role = [base, mid, standalone]` (multi-label array C5). No single value is forced. The proposal explicitly addresses this in §7: "a query for 'active breathable mid for ski touring' finds it; 'warm belay layer' excludes it (low warmth, air_permeable); 'shell' excludes it (no waterproofness)."

The mid-insulation domain investigation (§5.1) confirms this: under facet thinking it is trivial — `insulation_type = fleece_grid`, `active_insulation_suitability = active`, `wind_permeability = highly_permeable`, `layering_role = [mid_under_shell, outer_in_calm_dry_warm]`. The R1 Air is a canonical case for multi-label `layering_role`.

**Verdict: PASS.** Multi-role handled cleanly via multi-label array.

#### (d) Marsupial kangaroo pocket as carry-affordance, not a pack?

The proposal models this via `carry_affordance: { has_pocket: bool, est_volume_l }` as a JSONB cold facet (§2.B). This is distinct from `capacity_l` in the pack domain group. The packs domain JSONB group has its own `capacity_l` hard facet; `carry_affordance` on the Marsupial is an accessory-type JSONB entry in the mid-insulation domain group or universal-but-situational section.

No pack-domain facet is incorrectly applied to the Marsupial. The proposal explicitly notes this distinction in §2.B: "Packs artifact: the Marsupial's pocket modeled here, **not** as pack capacity."

A minor concern: the Marsupial also gets `layering_role = [mid, standalone]` (from the mid-insulation domain characterization), which is correct. But `carry_affordance` is listed in §2.B under "Universal-but-situational" cold facets, not under the mid-insulation domain JSONB group — meaning it is available on any item kind including apparel and accessories. This is correct; the Terre Planing also has a chest pocket, which could carry the same facet. The design does not over-specialize this.

**Verdict: PASS.** Kangaroo pocket modeled as carry-affordance in universal cold facets, correctly separated from pack domain.

---

### Test 2: Missing-Data Behavior

#### (a) Is unknown truly first-class (null + confidence + source)?

The schema mandates `_conf` and `_src` as `NOT NULL` with `.default("unknown")` on every promoted soft column. For JSONB, the Zod schema wraps every soft entry as `{ value: v.nullable(), confidence: Confidence, source: Source, reasoning?: string }` with `confidence` and `source` required (not optional). A model output that omits confidence from a soft field will be rejected by `ItemEvidence.parse()`.

For hard facts (e.g., `upf`, `treatedDown`, `tempRatingF`), the schema uses a `hard()` wrapper that has `value: v.nullable()` and `source: Source` — no inference slot. The value is `null` when unstated; no mechanism exists to populate it from inference.

This is CLAUDE.md rule 2 ("never fabricate specs: unknown = null WITH confidence/source") made physical. Unknown is truly first-class.

One gap: `body_zones` (C14) has no `body_zones_conf` or `body_zones_src` column in the schema sketch (§3.3). The schema shows `bodyZones: text("body_zones").array()` but no companion confidence/source columns, unlike every other soft promoted facet. This may be an oversight in the sketch (it is a soft/derived facet per §2.A). Minor but should be explicit.

**Verdict: PASS with one gap** (body_zones missing confidence/source companions in the schema sketch — logged as F6).

#### (b) Unknown waterproofness BLOCKS positive rain-protection — is `blocked_unknown` coherent?

The `rain_protection` predicate (§6.2) states: "if any *required* facet is `null` or below a confidence floor, return `blocked_unknown` naming that facet." `waterproofness` is a required facet for `rain_protection`. If `waterproofness = null` (unknown), the predicate returns `blocked_unknown`, not `satisfies`. This appears in the three-state `item_capabilities.status` enum as a distinct, queryable state.

Is it impossible to silently pass? The predicate is a pure function in `src/core` that explicitly checks for null before evaluating the satisfaction condition. The schema cannot insert a `satisfies` status for `rain_protection` without going through this function (assuming the write path is always through `src/core` and never via direct DB insert). The capability table PK is `(itemId, capability)`, not `(itemId, capability, status)` — so only one row per item-capability pair exists, and it must carry one of the three statuses. A re-run always overwrites. There is no schema-level prevention of a direct DB write that bypasses the predicate, but this is an application-layer concern, not an architecture flaw.

The distinction between `fails` (Terre Planing: `waterproofness = dwr_only` — we KNOW it is not rain capable) and `blocked_unknown` (item with `waterproofness = null` — we don't know) is coherent and maps exactly to the decision-drivers §5 "unknown propagation rule": "surface the gap as if no item existed + separately note 'one item whose [facet] is unverified.'"

**Verdict: PASS.** `blocked_unknown` is coherent, distinct from fail, and structurally enforced by the predicate function.

#### (c) Kelty "30" rating stored WITHOUT upgrading to EN/ISO standard?

The proposal assigns `tempRatingF = 30` (hard number, column) and `tempRatingStandard = null` with `tempRatingStandardConf = unknown` (soft, column, with note: "marketing/season; EN cert not documented"). The sleeping-bags domain §5.1 is the canonical anti-pattern: "Incorrect representation: `temp_rating_standard: 'EN13537_comfort'` — FABRICATED — never do this."

The `sleep_warmth_adequate` predicate (§6.2) requires `temp_rating_standard ∈ EN/ISO_*` to satisfy. With `temp_rating_standard = null` (conf: unknown), it returns `blocked_unknown` with block-message "rating is nominal — verify EN/ISO standard." This is exactly the behavior the sleeping-bags domain demands.

One nuance: the `tempRatingStandard` column allows a `marketing` enum value, which is the correct representation for the Kelty case (we know it's a marketing claim, not unknown). The proposal's walkthrough says `tempRatingStandard = null (conf unknown)`, but arguably `tempRatingStandard = marketing` with `conf = high, src = llm_inferred` is the more precise representation (we know from brand era and product class that it's a marketing number, not that the standard is simply unknown). This is a nuance: `null` = "we don't know what standard was used"; `marketing` = "we know no standard was used." The `marketing` enum value exists precisely for this case. The predicate treats both as blocked (neither is in `EN/ISO_*`), so the outcome is correct either way — but the more precise representation should be preferred.

**Verdict: PASS (with notation that `marketing` is more precise than `null` for the Kelty case — both block correctly).** The dangerous fabrication is structurally impossible.

---

### Test 3: Marcy-Style Gap Query

**Query:** "Mount Marcy, mid-June, alpine summit, cold and windy, long day hike."

**Parsed ConditionEnvelope:** `temp 30–45°F, precip_prob: moderate, wind_exposure: high, activity_intensity: high, duration: 8–12h, overnight: false`

**Required capabilities (per §6.3 + decision-drivers §6 cold-alpine-active):** `wicking_base`, `packable_insulation`, `breathable_shell`, `rain_protection`, `wind_protection`

The proposal walks through this in §6.3. I evaluate whether the trace is convincing or hand-waved.

**Terre Planing:**

- `waterproofness = dwr_only` → `rain_protection` = **FAILS** (definitively, not blocked — known bad value). Correct.
- `wind_resistance = wind_resistant` (not `windproof`) → `wind_protection` = **FAILS** (predicate requires `windproof` OR `wp_breathable/wp_nonbreathable`). Correct.
- `breathability = high`, `layering_role = [shell, standalone, base]` → `breathable_shell` is technically satisfied by the predicate (layering_role includes `shell` AND breathability is `high`). However, the Marcy walkthrough says "it is not the *rain/wind* shell." The `breathable_shell` capability predicate does not distinguish "rain shell" from "breathable non-rain shell" — the predicate purely checks `shell ∈ layering_role` AND `breathability ∈ {high, very_high}`. So the Terre Planing technically **satisfies** `breathable_shell` by the stated predicate. This is actually reasonable: a trip that requires rain_protection will see a gap there; `breathable_shell` being satisfied by the Terre Planing doesn't produce a dangerous recommendation because `rain_protection` is separately failing.

But there is a subtle issue: if the recommendation engine fills "breathable shell" slot with the Terre Planing while rain_protection has a gap, the UI needs to correctly convey that these are different requirements. The architecture does not show a system-assembly layer that prevents the Terre Planing from being considered a "partial shell" satisfying `breathable_shell` while failing `rain_protection`. The decision-drivers canonical output says the Terre Planing "MAY be suggested as a breathable approach layer ... with explicit warning." The architecture relies on the UI reasoning layer to combine these statuses correctly — which is fine if documented, but creates a risk of the item being presented as "almost good enough, just missing rain protection" rather than "not a shell at all in wet conditions."

**Kelty Galactic 30:**

- `layering_role = [sleep]` — no `mid` or `insulation` role
- `packable_insulation` predicate: `layering_role ∩ {mid, insulation} ≠ ∅` — **FAILS** (sleep is not mid/insulation). Correct.
- If camping: `wet_safe_insulation` → `insulation_type = down, treated_down = null` → **blocked_unknown** on `treated_down`. Correct.
- `sleep_warmth_adequate` → `temp_rating_standard = null` → **blocked_unknown**. Correct.

**Hemp Henley:**

- `moisture_management = [absorb_hold]` — `absorb_hold ∉ {wicking_spread, absorb_release}`
- `warmth_when_wet = collapses`
- `wicking_base` predicate: `moisture_management ∩ {wicking_spread, absorb_release} ≠ ∅` — **FAILS** (empty intersection). Additionally `warmth_when_wet = collapses` would fail the third condition. **Definitive fail, high confidence.** Correct.

**Gaps surfaced:**

| Gap | Capability | Status |
|---|---|---|
| 1 (CRITICAL) | `rain_protection` | No item `satisfies`; Terre Planing `fails` |
| 1 (CRITICAL) | `wind_protection` | No item `satisfies`; Terre Planing `fails` |
| 2 (HIGH) | `packable_insulation` | No item `satisfies`; Kelty `fails` wearable test |
| 3 (HIGH) | `wicking_base` | No item `satisfies`; Henley `fails` |

These are exactly the three gaps from decision-drivers §2 canonical output. The trace is mechanically correct and follows directly from the predicate definitions — not hand-waved.

**One genuine gap in the proposal's Marcy walkthrough:** The `breathable_shell` capability is satisfied by the Terre Planing (layering_role includes `shell`, breathability is `high`), but the walkthrough conflates this with "it can't serve the shell role" and marks it as "partial." This is not quite right — the item does satisfy the `breathable_shell` predicate as written, it just fails `rain_protection` and `wind_protection`. The architecture does NOT produce a gap for `breathable_shell`, which means the user could receive a message that their breathable shell slot is filled — potentially misleading if they don't understand the system also shows separate rain/wind gaps. This is a minor UI reasoning concern, not a predicate flaw.

**Verdict: PASS (mechanically correct on all 3 gaps; minor UI reasoning concern on `breathable_shell` interaction with Terre Planing that the architecture does not explicitly address).**

---

## 4. Target-Specific Probe Results

### Probe 1: Typed/JSONB Promotion Boundary (W2)

**Is the hot/cold split principled?**

The promotion rule (§2 preamble) is: a facet is a COLUMN iff it (a) is read by ≥1 capability predicate AND (b) is ranked LOAD-BEARING in decision-drivers §3 (decisive in ≥2 queries) OR is structurally required to block a capability on unknown. This is a clear, testable criterion anchored to an investigation artifact. C13 (`weight_g`) and C14 (`body_zones`) are flagged as the "softest promotion calls" — weight is rank-11 SITUATIONAL in decision-drivers and only promoted on the universality argument, not the LOAD-BEARING argument. This is honest.

**What concretely happens when a cold JSONB facet becomes decision-relevant?**

Take `seam_sealing` (rank-12 SITUATIONAL → now gates `rain_protection`). It lives in JSONB. To promote it:
1. Add three columns to `items`: `seam_sealing`, `seam_sealing_conf`, `seam_sealing_src`
2. Add a new Postgres enum for the `seam_sealing` ordinal
3. Backfill: migrate from `facets->>'seam_sealing'` to the new column
4. Update the Zod `hot` schema to include `seam_sealing`
5. Update the `facet_hash` computation to include `seam_sealing`
6. Remove `seam_sealing` from the JSONB Zod schema (or keep it as a tombstone field that ignores writes)
7. Repoint the `rain_protection` predicate function from the JSONB read to the column read
8. Recompute all `item_capabilities` rows for `rain_protection`

Steps 1–3 are a genuine migration. Steps 4–7 are code changes. Step 8 is a batch job. This is "non-trivial" rather than "cheap" — the proposal says "cheap, reversible migration + query-builder repoint" but does not acknowledge that the capability function code must also change, the Zod schema must change in two places (remove from cold, add to hot), and the facet_hash specification must update. The migration is **not catastrophic** but is also **not a single-step operation**.

**Does the split create two sources of truth?**

Yes, during the promotion window. The `facets` JSONB bag may still contain the pre-promotion `seam_sealing` value while the new column is being backfilled. If the query-builder abstraction is not atomic (point-cut at the same time as backfill completes), there is a brief period where reads from the column return null (not yet populated) while JSONB still has the old value. The proposal does not specify a safe promotion sequence.

The two query paths also exist permanently for cross-facet queries: query (b) in §5 ("everything that can shed wind") mixes `wind_resistance` (column) with `function_purpose` (JSONB). This is correct per design, but any query that joins a capability result (from the materialized cache, computed from column facets) with a JSONB filter creates an implicit cross-path join that the query-builder abstraction must handle. If `seam_sealing` moves from JSONB to column, all cached `rain_protection` rows must be recomputed — which the `facet_hash` mechanism handles correctly IF the hash is recomputed. But the hash was previously computed without `seam_sealing` (it was JSONB and not in the hash). Post-promotion, the hash definition changes, invalidating ALL existing `rain_protection` rows — which is correct behavior but must be anticipated explicitly.

**Assessment:** The split is principled and the promotion path is feasible. "Cheap" overstates it; "reversible and well-scoped" is accurate. The two-path divergence is real but manageable via the query-builder abstraction if it is truly comprehensive.

### Probe 2: Capability Materialization Staleness (F1)

The `facet_hash` is a hash of the exact inputs the predicates read. This prevents item-facet drift. But:

**When capability definition changes:** If the `rain_protection` predicate adds `seam_sealing` as a required gate (moving from "trip-duration < 1h is sufficient" to "seam_sealing = fully_sealed required for sustained rain regardless"), all existing `item_capabilities` rows for `rain_protection` remain `satisfies` if the old inputs were satisfied — even though the new predicate would block many of them. The `facet_hash` matches the old inputs (which haven't changed) so the staleness guard passes. The cache is wrong.

**"Cache is optional ⇒ staleness degrades to slow not wrong"** — this claim (§8 W3) is false when the capability logic changes. If recommendations read the cache (the hot path), they read wrong data. The live recomputation path only fires when the hash mismatches the inputs — but if only the logic changed, the hash still matches, and the live path is never triggered. This is a genuine Critical flaw (F1).

**When JSONB facets used in capabilities change:** As discussed in F2, `seam_sealing` is in JSONB but is read by `rain_protection`. The `facet_hash` for `rain_protection` must include the JSONB value at hash-computation time, or the hash will not change when `seam_sealing` changes in JSONB. The proposal does not specify whether JSONB values that are read by capability predicates are included in the `facet_hash`. This is an implementation gap that could silently produce stale capability rows.

### Probe 3: `item_kind` — Is It a Category Sneaking In? (F3)

**Is `item_kind` absent from recommendation/grouping queries?**

In §5 (grouping queries), none of the four example queries use `item_kind`. In §6.2 (capability predicates), none read `item_kind`. These are the designed query surfaces, and they are clean.

**Is quarantine enforceable?**

No. `item_kind` is a Postgres column on `items`. Any query can filter `WHERE item_kind = 'sleep'`. There is no DB-level constraint preventing this. The only enforcement is documentation and code review. In a project where contributors change (e.g., a new engineer unfamiliar with the design philosophy), the first time someone needs to filter "show all apparel" or "exclude sleeping bags from wearable recommendations," `item_kind` is the obvious tool.

**Does routing classification re-introduce category coupling?**

Partially, yes. The Zod discriminated union in §4 (`facets: z.discriminatedUnion("kind", [...])`) means the evidence object carries a `kind` field that IS `item_kind`. Any time this evidence is used to select the right JSONB validation shape, `item_kind` is being used as a category router. The cold facets are explicitly "validated only when `item_kind` matches." The line between "ingest routing" and "category" blurs when the same field drives both validation and (potentially) queries.

The proposal's self-assessment in §8 W4 is accurate: "a future contributor reaches for `WHERE item_kind='shell'`." The risk is real and the mitigation (documentation + audit assertion) is weak. The audit assertion is not described as being enforced at the DB or application level, only as a code-review check.

**Assessment:** `item_kind` is not currently a category in the recommendation path, but it is a category in the validation path, and there is no structural enforcement preventing its use in recommendations. This is a Major risk, not a fatal flaw — but the mitigation is weak.

### Probe 4: Denormalized Hot-Copy of Material-Derived Facets (F4)

**Consistency story when a shared material record is corrected:**

The proposal states (§3.4): "Materials are the provenance; the columns are the hot copy. Re-derivation on material edit is handled by the same invalidation hash as capabilities."

This is imprecise. The `facet_hash` on `item_capabilities` hashes the item's current column values. If a material is corrected but the item's columns haven't been updated yet, the `facet_hash` matches the stale column values — and the capability cache passes validation while containing values derived from a since-corrected material.

The actual consistency story requires:
1. Material is corrected
2. A background job re-derives affected item columns from the corrected material
3. The item columns are updated in `items`
4. On next capability computation, the new item column values produce a new `facet_hash` → capability cache is invalidated and recomputed

Step 2→3→4 is a chain with no atomic guarantee. During steps 2→3, the item columns are wrong. If recommendations run between steps 2 and 3, they read wrong values from item columns (not from the capability cache, but from the item row itself in a live recompute). If the capability cache is the hot path and it still matches the old facet hash (because the item columns are still stale), then recommendations read the capability cache, which also reflects the stale material values.

**Can item facets silently drift from their material source?**

Yes, in the window between material correction and background job completion. The proposal does not specify a maximum acceptable window or a mechanism to prevent reads during recomputation. For v0 with a single user and small inventory, this window is probably acceptable. For a multi-user or larger-inventory deployment, this could produce wrong recommendations for an indeterminate period.

**Assessment:** The consistency story has a real window of wrong, not merely slow. Logging as Major (F4).

### Probe 5: LLM-Classification Ergonomics (F5)

**Can an LLM reliably populate ~14 typed columns + a discriminated-union JSONB bag in one evidence object?**

The hot facet section has 14 fields, each requiring `{value, confidence, source}`. That's ~42 leaf fields. Plus `construction` (4 material role objects + treatments array). Plus the domain JSONB group (varies: sleep has ~9 fields, footwear has ~15). A full evidence object for a sleeping bag might have ~70 leaf fields.

This is a large prompt target. LLMs do produce structured JSON at this scale, but failure modes include:
- Confusing the `hard()` wrapper (no confidence field) with the `soft()` wrapper (confidence required), causing Zod rejection of the entire object
- Mis-picking `item_kind` (e.g., classifying the Terre Planing as `apparel` when it could be argued as `accessory`) causing Zod to validate against the wrong discriminated union branch
- Providing plausible-but-unsourced values for hard facts (e.g., inventing a UPF value for an item whose UPF is not in the product page)

The proposal's mitigation is sound in principle: composition-first pipeline derives most behavioral facets deterministically before the LLM, reducing the LLM's job to confirming/handling non-standard cases + domain JSONB facets. For items with known fiber compositions, this covers C2 (`moisture_management`), C3 (`dry_speed`), C4 (`warmth_when_wet`), C6 (`insulation_type`) — roughly 4 of 14 hot facets. The remaining 10 (waterproofness, layering_role, packable, breathability, windResistance, upf, weightG, tempRatingF, tempRatingStandard, treatedDown, bodyZones) still require LLM judgment.

**Is the two-shape target harder than a uniform one?**

Yes. The LLM must simultaneously hold the hot-facet vocabulary and the domain-specific JSONB vocabulary. The discriminated union means a wrong `item_kind` produces a Zod error in the JSONB branch, discarding all otherwise-valid hot facets. The partial-parse failure mode proposed in F5 (split into two independent parse steps) would mitigate this.

The `weightG` hard field uses `hard(z.number()).and(z.object({ sizeTag: z.string().optional() }))` — this is an `and()` intersection type in Zod, which is unusual syntax for the LLM to target correctly. It may cause consistent Zod failures on this field.

**Assessment:** Ergonomic concerns are real but manageable with a two-step parse and prompt calibration. Not a fatal flaw.

---

## 5. Strengths to Harvest

1. **Capability materialization as the primary query surface.** The `item_capabilities` table with its three-state status (`satisfies | fails | blocked_unknown`) is the single most important design contribution. Gap analysis becomes a trivial index scan. The `blocked_unknown` state is the direct encoding of "unknown ⇒ surface as verify, not as gap and not as satisfied" — which is the decision-drivers §5 requirement made queryable. This should survive unchanged into the synthesis.

2. **Structural enforcement of null + confidence + source.** Making `_conf` and `_src` columns `NOT NULL DEFAULT 'unknown'` and making the Zod soft-wrapper's `confidence` and `source` fields required (not optional) means a fabricated spec has literally nowhere to persist. This is CLAUDE.md rule 2 made physical at both the DB and application layers. No other approach in the design achieves this without explicit application logic.

3. **The promotion rule anchored to decision-drivers §3 ranking.** Using the LOAD-BEARING ranking from the decision-driver investigation as the promotion criterion gives the hot/cold split a principled, artifact-grounded basis. The hot set is genuinely the most stable part of the ontology because it is the recommendation surface — and the recommendation surface is what the product exists to answer. This is the right bet.

4. **Materials as a normalized shared library with construction roles.** The `item_constructions` table with named roles (shell/membrane/insulation/lining) plus `treatments_on_items` directly implements the material-behavior §3.3 recommendation. Behavioral derivation once per fabric and reuse across items prevents the drift problem where two items made of the same material receive inconsistent behavioral facets from independent LLM calls. This should be kept and is the correct implementation of the material-behavior investigation's "derive behavior once, reuse everywhere" principle.

5. **`src/core` as a pure, framework-agnostic capability layer.** Capability predicates as pure functions in `src/core` (no DB import, no Next.js import) makes the recommendation logic independently testable and directly portable to an MCP server. This satisfies the CLAUDE.md non-negotiable principle and is architecturally clean.

6. **Content-addressed `facet_hash` for item-facet staleness.** Even accounting for F1 (capability-version gap) and F4 (material-derivation window), the hash mechanism correctly prevents the most common staleness mode (item facets change, capability cache not recomputed). It is the right primitive — it just needs the `capability_version` extension to cover logic changes.

7. **The `fails` vs `blocked_unknown` distinction.** This two-state breakdown of "not satisfies" is essential: a definitive fail (Henley `moisture_management = absorb_hold`) should produce a gap note; an uncertain block (unknown waterproofness) should produce a "verify this item" note. Collapsing them into a single "not satisfies" state would produce wrong UX in both directions. The architecture correctly makes this a first-class schema distinction.

---

## 6. If I Had to Fix ONE Thing

**Fix F1: Add `capability_version` to `item_capabilities` and treat predicate-definition changes as cache invalidation events.**

This is the highest-leverage single fix because it is the only flaw that can produce *silently wrong recommendations* (not just slow or partially complete ones) — and wrong recommendations in the capability gap analysis are the app's core safety concern. The `facet_hash` mechanism is almost right; it only fails when capability logic changes. A `capability_version` field (a deterministic hash or semver of the predicate source code, managed in `src/core`) added to every `item_capabilities` row, checked on read alongside `facet_hash`, closes this gap with minimal schema change.

The fix is: at read time, the recommendation layer checks `facet_hash == current_input_hash AND capability_version == current_predicate_version`. Only rows passing both checks are trusted. This makes the entire cache safe against both item-data changes and capability-logic changes. Everything else in the architecture can be improved iteratively; this flaw cannot be left for later because it is silent.

---

*End of adversarial audit — Architecture C: Capability-First Hybrid.*
