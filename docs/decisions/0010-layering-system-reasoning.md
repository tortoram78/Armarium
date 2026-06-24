# ADR-0010 — Layering-system reasoning: combination-aware capability evaluation

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 2 (shipped commit `bf116b4`; 77 tests green)

---

## Context

`src/core/recommend/index.ts` evaluated each closet item **independently** against each derived
capability requirement. That is correct for a single garment: a Gore-Tex shell either satisfies
`rain_protection` on its own or it does not. But real outdoor layering is systemic — a wicking
base layer, an insulating mid, and a waterproof shell worn **together** handle conditions that no
single piece can handle alone. Evaluating items independently therefore produces advice that is
technically accurate but thin: a user who owns a Patagonia R1 base, a fleece mid, and a shell
would be told they satisfy `wicking_base` but not `sustained_cold`, even though the trio clearly
constitutes a working system.

The existing design already contained the raw material for combination-aware reasoning:

- The `layering_role` facet (`capabilityGate: true`, stored hot as a Postgres array) captures
  each item's structural position in a system: `next_to_skin`, `base`, `active_insulation`,
  `static_insulation`, `mid`, `wind_shell`, `weather_shell`, etc.
- The `warmth`, `waterproofness`, and `wind_resistance` facets are already hot (`capabilityGate: true`)
  and reasoned over by per-item capabilities.
- The `satisfiedBy: ItemRef[]` field in `CapabilityOutcome` was already a list — it just always
  held at most one item.

No new storage, no new facets, and no registry changes were required. The question was how to
compose the existing facet data into a combination predicate **without introducing outfit templates
or category routing** — both of which are the anti-pattern this project exists to avoid.

---

## Decision

Add **combination-aware capability evaluation** as a new module `src/core/recommend/combine.ts`,
activated only when no single item already satisfies a requirement, composing over two orthogonal
extensions:

### A — Structural layering slots (from `layering_role`)

The `layering_role` multi-label set is partitioned into four **structural slots**:

| Slot | Index | Roles included |
|------|-------|----------------|
| next-to-skin / base | 0 | `next_to_skin`, `base` |
| active insulation / mid | 1 | `active_insulation`, `mid` |
| static insulation | 2 | `static_insulation` |
| wind / weather shell | 3 | `wind_shell`, `weather_shell` |

`sleep_system` and `accessory` are intentionally excluded: sleeping bags are not worn layers;
accessories (`buff`, hat, gloves) satisfy their own zone-coverage capabilities but do not
participate in the torso layering system.

For a combination to count as a **system**, every participating item must occupy a **distinct slot**.
This is the mechanical definition of "worn together as separate layers" — an R1 Air (slots 0, 1) and
a shell (slot 3) form a two-layer system; two shells (both slot 3) do not.

### B — Per-capability combination strategy metadata

Each capability that supports combination evaluation declares a `CAPABILITY_COMBINATION` metadata
block in `src/core/capabilities/index.ts` alongside its existing per-item predicate. The metadata
declares one of two strategies:

**`additive_warmth`** — the capability is a warmth threshold that can be met by summing the
individual warmth contributions of items in distinct slots. Each item's `warmth` ordinal is mapped
to a rank (e.g. `minimal=1, light=2, moderate=3, high=4, very_high=5`); the ranks of all
distinct-slot participants are summed and compared against a thermal target derived from the trip's
`temp_min_c`. This is used for requirements like `adequate_warmth` under cold conditions.

**`shell_over_warmth`** — the capability is conjunctive: one member must satisfy a protective
sub-capability (e.g. `rain_protection` or `wind_protection`) and a **distinct** other member must
meet a warmth-base floor. Both arms are required; neither alone is sufficient. This is used for
requirements like `waterproof_insulated_system` in cold-wet conditions.

Both strategies are emergent: they compose over the same `layering_role` and warmth/protection
facets that the per-item predicates already read. Adding a new `layering_role` value or a new
combinable capability extends the logic by declaring it — zero new branches.

### C — Unknown stays first-class

If a combination evaluation would depend on a facet that is `null` or `confidence: unknown` on
any participating item, the system outcome is `blocked_unknown` ("verify"), not `satisfied`.
A system that appears to close a gap only because an unknown value was treated as satisfying is
worse than a surfaced "verify." The unknown-blocks contract (ADR-0004) applies to combinations
exactly as it applies to single items.

### D — Output contract (backward-compatible, additive)

`CapabilityOutcome` retains its existing `satisfiedBy: ItemRef[]` field (single-item satisfaction,
unchanged) and adds:

```ts
satisfiedBySystem?: ItemSystem[];

type ItemSystem = { items: ItemRef[] };
```

`status` is `"satisfied"` when `satisfiedBy.length > 0 || (satisfiedBySystem?.length ?? 0) > 0`.
Existing consumers (e.g. `src/app/trips/[id]/page.tsx`) continue to compile and render correctly
because `satisfiedBy` is unchanged; the UI does not yet display system groupings (tracked below).

### E — No registry changes

Every facet read by the combination evaluator (`warmth`, `layering_role`, `waterproofness`,
`wind_resistance`) is already `capabilityGate: true` and stored hot (column or group field). The
`CAPABILITY_COMBINATION` strategy metadata lives beside the capability predicates in `src/core/capabilities/`,
not in the facet registry — it is reasoning metadata, not a new facet. The registry-gates-hot
invariant (verified by the cross-reference test) is untouched.

---

## Alternatives considered

**Outfit templates / layering presets.** A curated set of outfit templates (e.g. "3-layer alpine
system = base + mid + shell") would answer the Marcy case but hardcodes trip archetypes — exactly
the anti-pattern this project exists to avoid. Rejected by architecture rule #1 ("no hardcoded
buckets or hardcoded trips").

**Category routing.** Routing combination logic through a category enum (`BaseLayer`, `MidLayer`,
`Shell`) would reduce the layering slot logic to a lookup but re-introduces the authoritative category
that `layering_role` (a multi-label facet) was designed to replace. Rejected by architecture rule #1.

**Combination by capability predicate alone (no slot constraint).** Allowing any two items to jointly
satisfy a capability without requiring distinct structural slots risks over-counting: two base layers
worn together do not constitute a meaningful system. The slot constraint is the mechanical definition
of "genuine layering" and prevents the evaluator from satisfying requirements with redundant pieces.

**Materialized capability systems (pre-computed item-set combinations).** Pre-computing all possible
combinations and caching them would require exponential storage for large closets and would need
both `facet_hash` and `capability_version` invalidation (the same risk documented in §5 of DESIGN.md
for the single-item capability cache). For a personal closet (small-N), on-read combination is fast
enough and always correct.

**Separate combinability facet on items.** A `combinable: boolean` facet could opt items into or
out of combination evaluation. Rejected: `layering_role` already encodes structural position, and
the slot partition already provides the necessary boundary. An additional boolean would duplicate
information and require registry and schema changes.

---

## Consequences

### What is better

- Recommendations are now **system-aware**: a user who owns a working layering system will see it
  surface as a joint satisfier rather than receiving a misleading gap for each individual capability.
- The engine remains strictly emergent: no trip, outfit, or category is hardcoded; all combination
  logic flows from `layering_role` facets and declared capability strategies.
- Unknown-blocks is preserved end-to-end: an unknown `warmth` or `waterproofness` value on any
  participating item demotes the system outcome to `blocked_unknown`.

### Open follow-up: UI wiring of `satisfiedBySystem`

The `satisfiedBySystem` field is present in the `CapabilityOutcome` returned by `planTrip` and
persisted in `trips.result_snapshot`, but `src/app/trips/[id]/page.tsx` does not yet render system
groupings. Until the UI is wired, system satisfaction is invisible to the user even though the
underlying computation is correct. This is a tracked near-term task.

### Future work: weight/volume budgets and quantity/duration reasoning

The combination evaluator does not reason over weight, volume budgets, or quantity/duration
(e.g. enough dry layers for a multi-day trip). These require reliable `weight_grams` and
`capacity_liters` values (already modeled as hard facts), and a budget-vs-actual breakdown in the
recommendation output. They remain designed-for, not built — see `docs/roadmap.md`.

### Generality evidence

Three cross-archetype tests in `test/recommend.layering.test.ts` confirm the engine cannot be
secretly hardcoded to one trip:

1. **Cold-dry alpine** — additive-warmth combination surfaces when no single item is warm enough.
2. **Cold-wet conjunctive** — `shell_over_warmth` combination surfaces; removing either arm drops
   the system (asserted explicitly).
3. **Mild trip** — combination does not over-trigger when single items already suffice.
4. **Unknown demotion** — an unknown `warmth` value on a participating item demotes the system to
   `blocked_unknown`, never to `satisfied`.

Per the engineering lesson: "a passing canonical test is not proof of generality." The
cross-archetype suite (≥3 distinct cases) is the minimum bar for any reasoning feature.

### Registry and test invariants

The capability-gates-hot invariant and the registry↔classification cross-reference tests continue
to pass without modification. No facet is newly gated through JSONB; no capability predicate
changes its `capabilityGate` status.
