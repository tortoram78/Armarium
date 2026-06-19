# 0005 — Conditions → capabilities recommendation engine (general, not per-trip)

**Status:** Accepted
**Date:** 2026-06-19
**Full design:** [`DESIGN.md` §5](../../DESIGN.md) · `src/core/conditions.ts`, `src/core/recommend/derive.ts`

## Context
Armarium is a **general-purpose** product: it must recommend for any user, any gear, and any trip
(alpine, desert, multi-day rain, casual travel). An early prototype risked baking one trip ("Mount
Marcy") into the recommender as a fixed required-capability set. That would make the canonical test
pass while leaving the product unable to plan anything else — the same anti-pattern as hardcoded
category buckets, one layer up.

## Decision
Recommendations are derived from a **structured `TripConditions` envelope** (temperature range,
precipitation, wind, sun, exertion, duration, exposure, activities). A pure function
`deriveRequirements(conditions)` maps conditions → a list of required capabilities with severities and
human-readable reasons, using explicit, tunable thresholds. `planTrip(items, name, conditions)` then
evaluates those capabilities across the inventory into picks / gaps / "verify". A trip is just an
input; no trip is special-cased. NL trip descriptions are parsed into `TripConditions` (Zod-validated)
at the edge; a structured form is the always-available fallback.

## Alternatives considered
- **Hardcoded per-trip envelopes.** Rejected: doesn't generalize; re-introduces the hardcoding the
  project exists to avoid.
- **One monolithic "recommend" function with inline condition logic.** Rejected: not testable in
  isolation; conditions→requirements is the load-bearing, reusable mapping and deserves to be a pure,
  unit-tested function.

## Consequences
- The same engine handles every archetype; tests assert different requirement sets per archetype
  (desert ≠ rain ≠ alpine ≠ casual).
- Thresholds live in one place and are tunable as the model learns.
- Envelope-dependent capabilities (e.g. `sleep_warmth` vs the trip's expected low) receive the
  conditions as context; unknown/uncertain inputs surface as "verify", never a silent pass.
