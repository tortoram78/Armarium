# ADR-0027 — Packing engine rebuild: trip → quantified, gear-aware checklist

**Status:** Proposed (architecture + product decisions greenlit by the owner 2026-06-26; build of
each phase still gated on the Phase 0 `DESIGN.md` update below)
**Date:** 2026-06-26
**Phase:** Reasoning rebuild — folds in the approved Phase 3 weather (step 3) and catalog gap-fill
(step 4) rather than running them as separate tracks.

---

## Context

The closet side of Armarium was rebuilt and is in good shape (inventory model, browse-at-scale,
batch capture, collections/tags/export, self-building catalog, gear + apparel domains). The
**recommendation engine was not**, and the owner's assessment is that it is "still not user-friendly
or really effective." This ADR records why, and the decided rebuild.

### What the engine does today

`deriveRequirements(conditions)` (`src/core/recommend/derive.ts`) maps a `TripConditions` envelope
to requirements over exactly **nine capabilities** (`src/core/capabilities/index.ts`):
`weather_shell, rain_protection, wind_protection, breathable_shell, wicking_base,
packable_insulation, sun_protection, cooling, sleep_warmth`. Each is evaluated 3-state
(`satisfies | fails | blocked_unknown`) across the closet, with layering-system combination
(ADR-0010). The output (`RecommendationResult`) is a set of per-capability **outcomes** rendered as
an editorial "gear report" (`src/components/TripResultView.tsx`).

### Why it underdelivers (the diagnosis)

1. **It answers the wrong question.** The user asks "what do I pack?"; the engine answers "which of
   nine abstract capabilities does my closet satisfy?" The result is an *audit*, not a list you pack
   from. The "Full capability outcomes" table and `blocked_unknown → verify` are engineer-facing.
2. **Coverage is ~10% of a real list, by construction.** All nine capabilities are worn-clothing /
   thermal concerns plus a sleeping bag. The model **cannot represent** the backpack itself, tent,
   sleeping pad, stove/fuel, water/filter, food, headlamp, first-aid, navigation, repair kit,
   toiletries, electronics, permits/docs, or any activity-specific gear (poles, bear canister,
   microspikes, climbing rack). The "10 Essentials" and the "big 3" are absent.
3. **No quantities.** `duration` is in the envelope but only flips `sleep_warmth` on
   (`derive.ts:59`); there is no per-day math (e.g. socks ×N for an N-day trip).
4. **No weight/volume budget.** `weight_grams` and `capacity_liters` are modeled as hard facts in
   `src/core/facets/registry.ts` but the planner never reads them.
5. **Gaps are not actionable.** A "gap" names a missing capability with no "here's what fills it"
   (catalog gap-fill is approved but unbuilt — Phase 3 step 4).
6. **Cold start yields zero value.** An empty/sparse closet hits the literal empty state ("No items
   from your inventory satisfy any required capability"). The app demands a built faceted closet
   *before* it does anything useful.
7. **Input is heavy.** Eight structured dials (`src/app/plan/page.tsx`); NL parse + weather autofill
   help but the mental model is still "configure eight dials."

**Root cause:** the unit of reasoning is *capability-of-my-gear* when a packing planner needs
*need-of-this-trip → quantity → which of my things covers it → what's missing*. The faceted
capability engine is an excellent **matching substrate** but a poor **planning substrate** alone.

---

## Decision

Rebuild the engine around a **`Need` model** and a **deterministic-skeleton + LLM-breadth hybrid**.
The faceted capability engine is **kept and reused** as the "what do I already own" matcher; it is
demoted from "the engine" to a component of it.

### A — The `Need` model (generalizes `Capability`)

A `Need` is the new unit of reasoning. Shape (data, in `src/core`):

```ts
interface Need {
  key: string;                 // e.g. "rain_shell", "shelter", "water", "navigation"
  label: string;               // human, packer-facing
  category: NeedCategory;      // a DATA TAG, not control-flow — see below
  conditionRules: Rule[];      // conditions → severity (the generalized deriveRequirements)
  coveredBy?: CoveragePredicate; // reuses today's capability predicates over facets (optional)
  quantityRule?: QuantityRule; // duration × per-day rate → count (optional)
  consumable?: boolean;        // food/fuel/water vs durable
}
```

`NeedCategory` is a flat, open **data tag** spanning all packing domains —
`shelter | sleep | carry | water | nutrition | navigation | light | first_aid | sun | insulation |
protection | hygiene | power | docs | repair | activity_specific`. It is used only to **group the
output** and to scope quantity rules. It is **not** a routing enum: no code branches on it to choose
logic; need-derivation runs the same `conditionRules` evaluation for every need regardless of
category. This is the same posture `layering_role` (a multi-label facet, not a category) already
holds — see the invariant note below.

Need-derivation is the generalized form of today's `deriveRequirements`: a **data list of need
specs** the engine reasons over, each with explicit, tunable `conditionRules`. Adding a need is
adding a spec, not a branch — exactly as adding a capability is today.

### B — Two layers with a hard contract

**Layer A — deterministic skeleton (pure `src/core`, hermetic, the guarantee).**
- Derives the universal need backbone (the 10 Essentials + big 3 + consumables) from the trip via
  `conditionRules`, with quantities from `quantityRule` and a weight/volume budget that finally
  consumes `weight_grams` / `capacity_liters`.
- For each need, the **existing faceted matcher** (`src/core/capabilities` + `recommend/combine.ts`
  + the evidence/unknown contract) decides **owned / verify / gap**. This is where the rich closet
  data finally pays off.
- Runs with **zero env** → the hermetic gate stays green and there is a trustworthy safety floor.

**Layer B — LLM breadth + narration (additive, Zod-validated, never authoritative about ownership).**
- Given the trip + the skeleton, an injected Anthropic client proposes **trip / activity /
  destination-specific needs the skeleton cannot enumerate** ("bear canister — required here,"
  "blister kit," "passport," "reef-safe sunscreen") and writes **guide-like narration**, all
  Zod-validated to a closed shape and merged onto the skeleton as clearly-marked additive lines.
- **The rule that preserves evidence-first:** Layer B proposes **needs only**. It never asserts what
  the user owns or any spec value. The deterministic matcher (Layer A) is the *sole* authority on
  ownership and coverage. Generated content therefore cannot fabricate that the user owns a tent or
  that a jacket is waterproof.
- **Offline / no key →** Layer B degrades off; the skeleton list is still genuinely useful.

### C — Output: one quantified, gear-first checklist

`RecommendationResult` is replaced by a **`PackingPlan`**: sections grouped by `NeedCategory`, each
line carrying `{ label, quantity?, status: owned | verify | gap, match?: ItemRef | ItemSystem,
rationale }`. Owned gear is the **hero** of the layout (per the owner's "comprehensive, gear-first"
decision); generic consumables/hygiene/docs render as a lighter secondary tier. Gap lines route to
catalog gap-fill (Phase 3 step 4) and "add to closet." `blocked_unknown` still surfaces as "verify"
and keeps the existing verify → correct → re-plan loop (ADR-0006).

### D — Input model (the owner's "trip-type chip + free text" decision)

Collapse the eight dials into: a lightweight **trip-type / activity chip** (from the existing
`activity_fit` vocabulary — a parameter the need-derivation and Layer B reason over, **not** a
category that routes logic) **+** a one-line natural-language description. Weather auto-fills
conditions via the approved **Open-Meteo** integration (Phase 3 step 3). The structured dials become
an "adjust" affordance behind the primary path, not the front door.

### E — Cold-start is fixed for free

Skeleton + Layer-B needs do not depend on owning anything, so a brand-new user with an **empty
closet still gets a complete, quantified "here's what this trip needs" list** where every line is a
gap to check off or add. The closet only makes it personal over time. This inverts the funnel from
"build a closet, then maybe get advice" to "get a great list now; your gear makes it yours."

---

## Phasing (each phase ships user-visible value; each gated on the gauntlet)

- **Phase 0 — ADR (this) + `DESIGN.md` update.** Define the `Need` model, the Layer-A/B contract,
  and the `PackingPlan` output shape before code. Docs-only.
- **Phase 1 — Checklist + deterministic need model (M–L).** Generalize capability→need; data-driven
  need specs covering the 10 Essentials + big 3 + consumables; quantity-from-duration; new
  `PackingPlan` result UI with owned/verify/gap per line, reusing the faceted matcher. **Ships the
  core fix — a real packing list, not an audit — and runs offline.** Pure `src/core` + a new result
  view; the old `RecommendationResult` path is migrated, not left in parallel.
- **Phase 2 — Minimal input + weather + activity (M).** Trip-type chip + NL front door; wire
  Open-Meteo prefill; dials become "adjust." **Ships: low effort in → good plan out.**
- **Phase 3 — LLM breadth + narration (M).** Layer B as additive, Zod-validated, offline-degrading
  enrichment. **Ships: the plan feels expert and trip-aware.**
- **Phase 4 — Gaps → action + budget + pack-mode (M–L).** Gap → catalog gap-fill suggestions (reuse
  the self-building KB) + "add to closet"; weight/volume vs the user's pack; "mark packed" state on
  saved trips. **Ships: the loop closes end to end.**

---

## Alternatives considered

**Expanded deterministic ontology only (no LLM in the plan).** Generalize capabilities to all
domains and stop there. Rejected as the *whole* answer: trip/activity/destination breadth (bear
canister in the Sierra, microspikes in shoulder season) cannot be fully enumerated as static specs
without either gaps in coverage or a sprawling list that drifts toward hardcoded archetypes. Kept as
**Layer A** — it is the safety floor, just not the ceiling.

**LLM generates the whole plan, grounded by the closet.** Flexible and fast to feel "smart," but
(a) untrustworthy as a safety-complete floor, (b) weak offline / hermetic story, (c) high cost and
non-determinism in the hot path, and (d) the largest surface for the never-fabricate invariant.
Rejected as the *primary* engine; its strengths (breadth, narration) are captured as the strictly
additive **Layer B**, which by contract cannot assert ownership or specs.

**Keep the capability-audit output, just add more capabilities.** Rejected: it does not change the
*unit of output*. The complaint is that the result is an audit, not a list. More capabilities make a
longer audit.

**Hardcoded per-activity packing templates (day-hike list, backpacking list, …).** Rejected by
architecture rule #1. Activity is captured as a **parameter** the data-driven need-derivation and
Layer B reason over, never as a category that routes logic or selects a canned list.

---

## Consequences

### What is better
- The engine produces a **packing plan a user can act on** — comprehensive, quantified, personalized
  to their actual gear, with gaps surfaced actionably — instead of a capability audit.
- **Cold start works:** value on the first trip with an empty closet.
- The rich closet data (`weight_grams`, `capacity_liters`, all the facets) is finally consumed.
- **No new dependency or infrastructure** is introduced: Layer B reuses the existing Anthropic SDK;
  weather (Open-Meteo) and catalog gap-fill are already approved. The only "ask-first" surface is
  already cleared.

### Invariant compliance (the load-bearing argument)
- **No hardcoded categories/trips (rule #1).** Needs are data with explicit `conditionRules`;
  `NeedCategory` is a grouping/scoping tag, not a routing enum (no logic branches on it). Activity is
  a parameter, not a template selector. This mirrors the `layering_role`-not-`Category` posture that
  ADR-0010 already established and the cross-reference test already guards.
- **Evidence-first / never-fabricate (rule #2).** Layer A is the sole authority on ownership and
  coverage; Layer B proposes needs only and is Zod-validated; `blocked_unknown → verify` is
  preserved end to end. No generated content can assert an owned item or a spec value.
- **Pure core (rule #3), `user_id` (rule #4), one `MODEL_ID` (rule #5)** all unchanged.
- **Hermetic gate (engineering lesson).** Layer A runs with zero env; Layer B uses an injected
  client and degrades to skeleton-only offline, so `typecheck/lint/test/build` stay green secret-free.

### Generality evidence required (per the standing lesson)
Phase 1 must land **≥3 cross-archetype planner tests** (e.g. alpine day hike, multi-day desert,
casual travel) asserting distinct quantified plans, so the need engine cannot secretly collapse onto
one trip. "A passing canonical test is not proof of generality."

### Migration / compatibility
`RecommendationResult` and `TripResultView` are **replaced**, not run in parallel — saved trips'
`result_snapshot` shape changes, so Phase 1 includes a read-path migration/compat shim for existing
saved trips (render old snapshots or re-plan on open). The verify → correct → re-plan loop
(ADR-0006) and the layering-system surfacing (ADR-0010 open follow-up) fold into the new
`PackingPlan` view.

### Kill criteria
- If Phase 1's deterministic need specs cannot stay general without per-activity branching, stop and
  revisit the `Need` model before adding Layer B.
- If the `PackingPlan` output reads as "a longer audit" rather than "a list I'd pack from" in a real
  walkthrough, the output model — not the engine — is wrong; fix it before proceeding.

### Open product decisions (resolved 2026-06-26)
- List scope → **comprehensive, gear-first**.
- LLM role → **deterministic floor first (Phase 1), LLM breadth later (Phase 3)**.
- Trip input → **trip-type chip + free text**, weather auto-filled.
