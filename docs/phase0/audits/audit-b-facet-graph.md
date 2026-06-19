# Audit B — Facet-Graph / Ontology-Driven EAV Design

> **Auditor role:** Adversarial, hard-but-fair stress test of Architecture B only. Does NOT read or cross-reference any competing architecture. Wave-1 investigation artifacts used as domain ground truth. Written for the synthesis lead.

---

## 1. Verdict

**SOUND-WITH-FIXES**

Architecture B correctly solves the hard structural problem — no fixed categories, multi-label membership, emergent grouping — and its treatment of missing data is among the most rigorous of any EAV approach. However, two serious vulnerabilities must be resolved before synthesis: (a) the type-safety recovery is more aspirational than mechanical in its current form, because the mapped TypeScript type is described but not concretely specified, and `v_item_scalar` is a hand-maintained pivot that can silently drift from the registry; and (b) the "drop unknown keys at ingest" rule, while correct for spam prevention, will silently discard legitimately novel LLM-extracted facets that simply have not yet been added to the registry — violating the "a missing spec is bad but tolerable, a wrong spec is worse" principle when the right response is "queue for review" rather than "discard forever." These are fixable. The core thesis is sound enough to harvest.

---

## 2. Findings

| # | Severity | Test / Probe | Description | Recommended Fix |
|---|---|---|---|---|
| 1 | **Critical** | Type-safety reality check | The `FacetValue<K>` mapped TypeScript type is described ("generated … at codegen time") but never specified. The proposal shows `z.unknown()` on `FacetAssignment.value` and notes that it is "refined by the per-facet schema selected from the registry by facetKey." This refinement is a **runtime union dispatch**, not a compile-time discriminated union. TypeScript sees `unknown` everywhere that a facet value is read. A capability view author comparing `waterproofness` to `'windprof'` (typo) gets no compiler error. The proposal's own self-assessment calls this out but frames the codegen mapped type as a real mitigation — it is not real in the current proposal text; it is a design intention without a concrete specification. | Provide a concrete `FacetValue<K>` specification: a discriminated union keyed on `facet_key` where each key maps to a branded type matching its `value_kind`. Codegen that emits this type from `facet_definitions` rows is the only way to close the gap. Until then, treat this as runtime-only safety. |
| 2 | **Critical** | Ontology governance / drift — silent discard | `ingest.ts` line 466: `if (!def || def.deprecated) continue;` — an unknown or deprecated `facetKey` is silently dropped. This is the right policy for LLM hallucinations (`"superWaterproof"`) but the **wrong policy for legitimately novel facets** the LLM extracted that simply have not been registered yet. If an LLM correctly identifies that an item has a `crampon_compat` property but that facet has not yet been seeded into `facet_definitions`, the entire assignment is silently lost. There is no audit trail, no queue, no user notification. The proposal states "adding a facet = INSERT into facet_definitions" but never describes who triggers that INSERT or how a legitimate extraction survives until the INSERT happens. This risks violating "a missing spec matters" in practice. | Replace silent drop with a `pending_facets` staging table: unrecognized `facetKey` rows are parked there (with full provenance) and surfaced in a review UI or developer queue. A human (or CI gate) promotes them to `facet_definitions` or discards them. Never discard silently at ingest. |
| 3 | **Major** | Migration-free claim — facet value-space change | `facet_version` is the proposed mitigation for changing a facet's value-space. But the proposal does not specify what happens to existing `item_facets` rows that carry the old version's values when a new version is activated. Example: `breathability` currently has five ordinal levels; the decision is made to split `high` into `high_active` and `high_static`. Existing rows carry `value_json: "high"` at `facet_version: 1`. A new row is inserted at `facet_version: 2` with the new enum. Now two versions coexist. The capability view `cap_breathable_shell` must handle both, or it silently excludes all version-1 items from recommendations. The proposal notes versioning exists but does not specify the migration strategy for existing data. "No migration" has become "hidden migration" deferred to view logic. | For any enum-level change, require an explicit backfill script (even a one-liner UPDATE) that re-validates or re-maps old rows to the new version, OR specify that capability views must always union-match across all known versions. Document this as a formal policy, not an afterthought. The "no migration" claim should be narrowed to "no schema-column migrations" — data migrations on `item_facets` are still required for value-space changes. |
| 4 | **Major** | Query ergonomics — `v_item_scalar` pivot is hand-maintained and schema-coupled | The proposal correctly identifies `v_item_scalar` as the ergonomics recovery layer, but this view explicitly enumerates hot facets by string literal (`FILTER (WHERE f.facet_key='waterproofness')`). Adding a new "hot" scalar facet requires editing the view definition — which is exactly the kind of manual maintenance the architecture claimed to eliminate. Worse, there is no compiler or CI enforcement ensuring that every facet referenced in a capability view actually exists in `facet_definitions`. A typo in a `facet_key` string literal in a view silently returns NULL for every item, not an error. The proposed CI lint ("asserts every `zod_schema_ref` resolves and every capability view references only live facet keys") is the right mitigation, but it is described as a future measure, not a present specification. | Make the CI lint a first-class specification, not an aspiration. Define the lint rule precisely: a CI step that parses all SQL view definitions, extracts string literals matching `facet_key='...'`, and asserts each one appears in the seeded `facet_definitions`. Fail the build on any miss. This closes the silent-NULL footgun without changing the architecture. |
| 5 | **Major** | LLM-classification ergonomics — closed registry + prompt-sync discipline | The proposal correctly identifies that "the LLM must be prompted with the current facet vocabulary." At ~60+ facet keys with enum levels, this is a substantial prompt payload. More importantly, the proposal does not specify how prompt and registry stay synchronized. If a new facet is added to `facet_definitions` (an INSERT) but the classification prompt is not rebuilt and deployed, the LLM will continue emitting old vocabulary, and new facets will appear only as `isUnknown=true` rows (if at all). Because the prompt is not derived from the registry at runtime (it is presumably a static string or template), this is a real and recurring operational risk. | Specify that the classification prompt is **generated at call-time from `facet_definitions`** rows (filtered to non-deprecated, in-scope facets), not maintained as a static string. The registry is already the single source of truth for schemas; it must also be the source of truth for the prompt. This is not a large engineering lift — it is a design constraint that must be stated explicitly. |
| 6 | **Minor** | `is_unknown` / absent row semantics — cognitive footgun | The distinction between `isUnknown=true` row and no-row-at-all is correct and necessary, but the proposal acknowledges it is "easy to misuse." Every consumer of `item_facets` — every view, every application query, every derived-facet computation — must handle three states: known-positive, known-unknown (row + `isUnknown=true`), and never-assessed (no row). The `v_item_scalar` pivot partially hides this by surfacing `waterproofness_unknown`, but only for facets explicitly listed in the view. A capability view author writing a new query directly against `item_facets` has no guardrail. | Add a query-layer convention: a helper `facet_state(item_id, facet_key) → 'known' | 'unknown' | 'absent'` function or Drizzle helper that encapsulates the three-way check. Document the convention in the codebase and enforce it via code review. Never write raw `WHERE facet_key = X AND value_json ...` without going through this helper. |
| 7 | **Minor** | `item_materials` construction role is a hardcoded Postgres enum | `constructionRole` is a `pgEnum` with fixed values (`shell`, `membrane`, `insulation`, `lining`, `fill`, `footbox`, `reinforcement`). This contradicts the claim that adding a new role is "an ontology addition, not a column." Adding `cuff` or `footbox_synthetic` requires a Postgres enum migration — which is exactly the migration the architecture claims to eliminate. This is a small inconsistency but undermines the "no migration" thesis for construction roles. | Either (a) make `role` a `text` column validated by a `construction_roles` reference table (consistent with the rest of the EAV approach), or (b) accept that `constructionRole` is a stable, slow-changing vocabulary and document the deliberate exception to the no-migration claim. |
| 8 | **Minor** | `seam_sealing` capability gap in `cap_rain_protection` | The proposal's `cap_rain_protection` view requires only `waterproofness IN ('wp_breathable','wp_nonbreathable')`. But `decision-drivers.md §4` defines rain protection as requiring `waterproofness = waterproof-breathable` AND (`seam_sealing = taped` OR query duration < 1hr). The capability view omits `seam_sealing` entirely. A shell with `waterproofness=wp_breathable` but `seam_sealing=none` would pass `cap_rain_protection` and be recommended for sustained rain — where it will leak at every needle hole. This is a correctness bug in the example view. | Add a seam-sealing gate to `cap_rain_protection`: `AND (seam_sealing IN ('critical_seams','fully_sealed') OR seam_sealing IS NULL /* carry unknown-seam warning */)`. For trip durations > 1hr, a `seam_sealing_unknown=true` flag should demote the item to "partial" rather than full satisfaction. |
| 9 | **Minor** | `packable = 'true'::jsonb` in view logic is brittle | In `cap_packable_insulation`, the predicate `packable = 'true'::jsonb` compares a boolean JSONB value using string cast. This works in Postgres but is fragile: if `packable` is stored as a JSON boolean `true` it matches; if stored as a string `"true"` it does not; if `isUnknown=true` the row may still match because the predicate only checks `valueJson`, not `isUnknown`. The same issue applies to `waterproofness_unknown = false` in `cap_rain_protection` — it only works because `bool_or` returns NULL (not false) when no rows exist, which the `= false` test does not catch. | Normalize the pattern: capability views should always join against both `valueJson` AND `isUnknown = false`. Write a documented convention for the three-part check: `(facet_key = X AND value_json = Y AND is_unknown = false)`. |

---

## 3. Stress-Test Walkthroughs

### Test 1a — Terre Planing: DWR / water-resistant cannot count as rain protection

**Pass.** The proposal assigns `waterproofness = dwr_only` and defines `cap_rain_protection` to require `waterproofness IN ('wp_breathable','wp_nonbreathable')`. `dwr_only` is structurally excluded. There is no code path that promotes DWR-only to rain protection. The `protection_ceiling = light_spray` derived facet correctly caps effective protection. The design-out is at the predicate level, not as a special-case conditional.

One genuine tension: `protection_ceiling` is a soft/derived facet whose derivation is described in prose but not shown as a concrete derive-pass rule. If the derive pass is never implemented and `protection_ceiling` is never written, the capability system still works correctly (because `cap_rain_protection` reads `waterproofness` directly), but the UI loses the human-readable ceiling label. This is a documentation gap, not a logic flaw.

### Test 1b — Buff: one item, multiple body zones and functions, three queries

**Pass.** The proposal is explicit: `body_zone_covered=["neck","face","head"]`, `function_purpose=["warmth","sun_protection","wind_protection","debris_filtration"]`, `layering_role=["standalone","liner"]`. Three query predicates — `body_zone_covered ? 'neck' AND function_purpose ? 'sun_protection'`; `body_zone_covered ? 'head' AND function_purpose ? 'warmth'`; `body_zone_covered ? 'face' AND function_purpose ? 'wind_protection'` — all return the same item from the same rows. The GIN index on `value_json` makes these containment queries efficient.

No special gymnastics required. This is the cleanest demonstration of why the multi-label `multi_label_enum` value kind earns its complexity cost. Category-based models cannot match this without a fan-out join or a denormalization.

### Test 1c — R1 Air multi-role

**Pass.** `layering_role=["system_base","mid","outer_in_calm_dry","base_adjacent"]` is multi-label. A query for "aerobic mid" (`layering_role ? 'mid' AND active_insulation_suitability='active'`) finds it. A query for "warm belay jacket" (`active_insulation_suitability='static'`) correctly excludes it. The model does not force a single-truth assignment. The only mild concern is that `base_adjacent` is a non-obvious role label whose semantics ("worn next-to-skin but functions like a mid") should be documented in `facet_definitions.meaning` with an example, or it will be applied inconsistently by future classifiers.

### Test 1d — Marsupial kangaroo pocket as carry-affordance, not a pack

**Pass.** The proposal assigns `carry_affordance=["kangaroo_pocket"]` as a `universal` multi-label facet (§2.7, `carry_affordance`). The Marsupial never receives `capacity_l`. A recommendation query for "pack with X liters" never surfaces the Marsupial because it has no `capacity_l` row and is not in any `cap_*` predicate that gates on pack capacity. The boundary between "pack" and "carry affordance on an apparel item" is clean.

Per the packs investigation (§5): "These two entity types must NOT share the same `capacity-liters` facet" — the proposal honors this exactly.

### Test 2a — `is_unknown` vs. no-row distinction

**Coherent but with a footgun.** An `isUnknown=true` row with `valueJson: null` is a first-class, auditable "we don't know" signal. A missing row means "never assessed." The distinction is meaningful: the first is queryable (`WHERE facet_key='waterproofness' AND is_unknown=true`) and can trigger a "verify before trip" UI state; the second is invisible without a LEFT JOIN against `facet_definitions`.

The footgun: any capability query written as `EXISTS (SELECT 1 FROM item_facets WHERE item_id=X AND facet_key='waterproofness' AND value_json='wp_breathable' AND is_unknown=false)` correctly handles both cases. But a query written as `WHERE waterproofness='wp_breathable'` against `v_item_scalar` will return NULL for both the `isUnknown` row and the absent row — both correctly fail the equality test — **unless** someone adds `AND waterproofness IS NOT NULL` which excludes only the present-but-unknown row, not the absent case, producing different treatment for two semantically equivalent "we don't know" states.

The `v_item_scalar` approach partially papers over this by surfacing `waterproofness_unknown` as a separate boolean column. But this is only safe for the few facets explicitly listed in the pivot; ad-hoc queries against raw `item_facets` have no such protection.

### Test 2b — Unknown waterproofness blocks positive rain protection

**Pass.** `cap_rain_protection` requires `waterproofness_unknown = false`. An item with `isUnknown=true` on its waterproofness row will have `bool_or(is_unknown) FILTER (WHERE facet_key='waterproofness') = true`, so `waterproofness_unknown = false` fails, and the item is excluded from the capability. The proposal is explicit: "unknown never satisfies a safety capability." The "verify" surface is not shown in the SQL but is described at the recommendation-layer level (§6.1: "partials — items that would satisfy but for an unknown or below-threshold facet"). This is correct in design; the partial-surfacing logic needs to be a concrete query, not just prose.

### Test 2c — Kelty "30" rating stored without EN/ISO standard upgrade

**Pass.** `temp_rating = {value:30, unit:"F"}` is stored as a hard fact (the number is confirmed). `temp_rating_standard = null` with `isUnknown=true, confidence:low, evidence="marketing/season-style; EN 13537 cert not documented"`. The proposal explicitly flags this in §7: "NEVER silently upgrade marketing→EN." The capability `cap_sleep_warmth_adequate` (not shown in the SQL but described) would need to gate on `temp_rating_standard NOT IN ('marketing', NULL)` or carry an explicit `unknown-standard` warning. The number is stored; the claim that it meets EN-comfort-30 is refused.

Cross-referencing `domain-sleeping-bags.md §5.1`: the correct representation is exactly what the proposal models. No fabrication.

### Test 3 — Marcy gap query (3-item inventory)

**Convincing, with one gap in the walkthrough.**

The proposal's §6.2 traces the Marcy query against the three-item inventory correctly. Reproducing the logic here confirms it:

**Terre Planing:** `waterproofness=dwr_only` → excluded from `cap_rain_protection`. `wind_resistance=wind_resistant` (not `windproof`) → excluded from `cap_wind_protection` (which presumably requires `windproof`). `breathability=high` + `layering_role ∋ shell` → satisfies `cap_breathable_shell` (a conditional positive). **Result: does not satisfy the trip's critical capabilities; partial credit on breathable shell for the approach.**

**Kelty Galactic 30:** `layering_role=["sleep_system"]` → `cap_packable_insulation` explicitly excludes `layering_role ∋ sleep_system`. **Result: zero contribution.**

**Hemp Henley:** `moisture_management=["absorb_hold"]` → excluded from `cap_wicking_base` (requires `wicking_spread` or `absorb_release`). **Result: flagged as hypothermia vector.**

**Three gaps surface cleanly:**
1. `cap_rain_protection` — no item satisfies
2. `cap_packable_insulation` — no item satisfies (bag excluded by role, TP excluded by wrong layering role for insulation)
3. `cap_wicking_base` — no item satisfies

The walkthrough in §6.2 is substantively correct and matches `decision-drivers.md §2` exactly. The three gaps, their predicates, and their severity ratings align with the canonical expected output.

**One gap in the walkthrough itself:** The proposal's gap table lists `cap_wind_protection` as part of gap #1 ("Waterproof / windproof shell") but the capability views shown in §3.6 do not include a `cap_wind_protection` view definition. The claim that the Terre Planing fails wind protection is correct (it is `wind_resistant`, not `windproof`) but the capability view that enforces this is absent from the SQL. The trace is hand-waved at this step. This is a documentation gap rather than a logic flaw, but it matters for the synthesis team.

---

## 4. Strengths to Harvest

**1. Multi-label value kinds are the right core primitive.** The `multi_label_enum` value kind with GIN-indexed JSONB arrays cleanly handles the buff, the R1 Air, and the Marsupial pocket — items that are provably broken by any single-value taxonomy. This primitive should survive into the final design regardless of what other architecture is chosen.

**2. `isUnknown` row as a first-class citizen.** Storing explicit "we don't know" as a real, auditable row (rather than relying on NULL absence) is the correct mechanism for the safety-unknown principle. The three-state model (known-positive, known-unknown, never-assessed) is the right abstraction. Any synthesis design should adopt this.

**3. Hard-fact-source guard at the ingest boundary.** The rule in `ingest.ts` that demotes a `hard` facet to an explicit unknown row when the source is `llm_inferred` or `unknown` is an elegant mechanical enforcement of "never fabricate specs." This guard is language-level and cannot be bypassed by prompt wording. It should be carried forward.

**4. Derivation-second pipeline split.** The explicit split between LLM emission and deterministic derivation (cotton-kills chain, wet_warmth_retention weakest-link) is architecturally clean. The LLM handles what the rule table cannot; the rule table handles what the LLM should not guess. This separation prevents confidence leakage between hard-fact derivations and probabilistic inferences.

**5. Capability views as the recommendation API.** Concentrating all safety-predicate string literals into a small set of reviewed SQL views — rather than scattering them across application code — is the right centralization pattern. A typo in `cap_rain_protection` is one bug; a typo scattered across 12 application queries is 12 bugs. This design pattern should survive into synthesis.

**6. `src/core/` framework-agnostic pipeline.** The decision to put classification, derivation, and recommendation logic in a framework-agnostic core is correct and forward-looking. The registry (`facet_definitions`) as the single source of truth for both Zod schemas and DB validation — rather than having two independent schemas that can drift — is the right architecture.

**7. Vanity facets as first-class rows, not special-cased.** Storing `color`, `brand`, `purchase_price` as ordinary `item_facets` rows (just excluded from capability predicates) means a future sustainability query or lifestyle-filter is a new view, not a new column. The extensibility claim is genuine here.

---

## 5. If I Had to Fix ONE Thing

**Make the CI lint a first-class, blocking build step — not an aspiration.**

The proposal's single greatest structural vulnerability is that the string-literal facet keys in `v_item_scalar`, capability views, and application queries are invisible to the TypeScript compiler and only discoverable at runtime. The proposed CI lint that "asserts every `zod_schema_ref` resolves and every capability view references only live facet keys" is the correct mitigation, but it is described as a future measure.

This one change has the highest leverage-per-effort ratio of any fix in the proposal:

- It converts the compile-time safety gap from a permanent weakness into a bounded, detectable risk.
- It enforces the "closed registry" discipline mechanically — a typo in any SQL view or Drizzle query string becomes a build failure, not a silent NULL.
- It is a CI pipeline addition, not a data-model change, so it does not require redesign.
- It validates ontology integrity on every commit, making the governance claim ("facet sprawl prevented by code review") actually enforceable.

Until this lint exists, the proposal's type-safety recovery is entirely trust-based. Once it exists, the architecture's most honest weakness — "a competing wide-table design wins on compile-time safety" — becomes a narrower gap: the compiler still cannot catch value typos, but the CI lint catches key-name typos, which are the more common error.

---

*Audit written 2026-06-19. Artifacts read: architecture-b-facet-graph.md, decision-drivers.md, domain-shells-wind.md, material-behavior.md, domain-sleeping-bags.md, domain-accessories.md, domain-packs.md, domain-base-layers.md.*
