// Domain-membership predicates — pure helpers used by closet grouping and the item-detail UI.
//
// "Is this item gear-classified?" is deliberately BACKFILL-SAFE: existing seed/classified items
// that predate the `domains` marker (their domains may be []) still read as gear because the OR
// also checks for any known gear signal on the facets themselves. A record-only / possession item
// (all-unknown facets, empty multilabel arrays, domains []) returns false from both arms.
//
// PURE: no next/*, no React, no DB singletons.

import type { ResolvedItem } from "./resolved";

/**
 * True iff the item has any known gear signal: at least one universal facet carries a non-null
 * value, OR at least one multilabel array is non-empty.
 *
 * This is the SECOND arm of the `isGearClassified` OR-predicate. Exported separately so the
 * item-detail UI (or other callers) can render a "facet data available" hint without re-computing
 * the full gear-classified check.
 */
export function hasAnyKnownFacet(it: ResolvedItem): boolean {
  const u = it.universal;
  if (
    u.waterproofness.value !== null ||
    u.wind_resistance.value !== null ||
    u.breathability.value !== null ||
    u.moisture_management.value !== null ||
    u.dry_speed.value !== null ||
    u.warmth_when_wet.value !== null ||
    u.warmth.value !== null ||
    u.packability.value !== null ||
    u.technical_vs_lifestyle.value !== null ||
    u.upf.value !== null
  ) {
    return true;
  }
  const m = it.multilabel;
  return (
    m.layering_role.length > 0 ||
    m.function_purpose.length > 0 ||
    m.body_zone_covered.length > 0 ||
    m.activity_fit.length > 0 ||
    m.conditions_fit.length > 0
  );
}

/**
 * True iff the item has been gear-classified (i.e. behavioral facets are known).
 *
 * Backfill-safe OR:
 *   • `it.inventory.domains.includes('gear')` — set by the classify/persist path on new items, OR
 *   • `hasAnyKnownFacet(it)` — catches pre-marker seed/classified items whose domains may be [].
 *
 * A record-only item (all-unknown facets, empty multilabels, domains []) returns false, causing
 * it to appear in the "Unclassified" bucket of every grouped closet view.
 */
export function isGearClassified(it: ResolvedItem): boolean {
  return it.inventory.domains.includes("gear") || hasAnyKnownFacet(it);
}
