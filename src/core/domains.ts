// Domain-membership predicates — pure helpers used by closet grouping and the item-detail UI.
//
// "Is this item gear-classified?" is deliberately BACKFILL-SAFE: existing seed/classified items
// that predate the `domains` marker (their domains may be []) still read as gear because the OR
// also checks for any known gear signal on the facets themselves. A record-only / possession item
// (all-unknown facets, empty multilabel arrays, domains []) returns false from both arms.
//
// Apparel domain: isApparelClassified checks for the domains marker OR any known apparel-group
// facet signal (garment_role/formality/fit/pattern/care/occasion). modeledDomainsOf returns the
// subset of known domains the item shows signal in — authoritative for domain marking.
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

/**
 * True iff the item shows any known apparel-domain signal.
 *
 * Backfill-safe OR:
 *   • `it.inventory.domains.includes('apparel')` — set by the classify/persist path, OR
 *   • any apparel-group facet has a non-null/non-empty value: garment_role (array), formality,
 *     fit, pattern (Evidence), care (array), occasion (array).
 */
export function isApparelClassified(it: ResolvedItem): boolean {
  if (it.inventory.domains.includes("apparel")) return true;
  const a = it.groups?.apparel;
  if (!a) return false;
  return (
    (Array.isArray(a.garment_role) && a.garment_role.length > 0) ||
    (a.formality?.value != null) ||
    (a.fit?.value != null) ||
    (a.pattern?.value != null) ||
    (Array.isArray(a.care) && a.care.length > 0) ||
    (Array.isArray(a.occasion) && a.occasion.length > 0)
  );
}

/**
 * Returns the subset of `['gear', 'apparel']` that the item shows signal in.
 * Authoritative for domain marking: the web-ui and nexus use this to decide which facet
 * sections to render and which domain markers to write on classify/persist.
 *
 * Note: `it.groups` is `FacetGroups` from classification.ts, which now includes `apparel?`.
 */
export function modeledDomainsOf(it: ResolvedItem): string[] {
  const domains: string[] = [];
  if (isGearClassified(it)) domains.push("gear");
  if (isApparelClassified(it)) domains.push("apparel");
  return domains;
}
