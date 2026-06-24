// Resolve the universal BEHAVIORAL facets of a classification against the material-derivation overlay.
//
// This is the first real consumer of the resolver. For each universal behavioral facet the composition
// has an opinion on, it assembles the competing CLAIMS — the LLM's current value (as-stored: usually
// `inferred`, sometimes already authoritative) and the `derived_from_material` value — runs `resolveFacet`,
// and writes the winner back into the classification. Facets the derivation does not touch keep the LLM's.
//
// COMPOSES WITH, DOES NOT DUPLICATE, the manufacturer overlay (enrich/merge.ts):
//   manufacturer overlay sets authoritative IDENTITY + COMPOSITION  →  derive from that composition  →
//   THIS resolves the behavioral facets. Identity/materials are never touched here (that is the overlay's
//   domain). The claim assembly is shaped so a FUTURE manufacturer/user behavioral claim slots in as just
//   another higher-precedence claim — no caller changes.
//
// PURE: no next/*, no React, no DB, no networking.

import type { ItemClassification, UniversalFacets } from "../classification";
import type { DerivedFacets, DerivedValue } from "../materials/derive";
import { resolveFacet, type Claim } from "./resolve-facet";

/**
 * The universal behavioral facets a composition can determine — exactly the keys of `DerivedFacets`.
 * (Deliberately a subset of `UniversalFacets`: waterproofness/wind_resistance/packability/
 * technical_vs_lifestyle are construction/design properties material chemistry does not pin down, so the
 * derivation never asserts them and the resolver never touches them.)
 */
const BEHAVIORAL_KEYS = [
  "moisture_management",
  "dry_speed",
  "warmth_when_wet",
  "breathability",
  "warmth",
] as const satisfies ReadonlyArray<keyof DerivedFacets & keyof UniversalFacets>;

type BehavioralKey = (typeof BEHAVIORAL_KEYS)[number];

/** The stored value type behind a universal facet `K` (the V in its `Evidence<V>` envelope). */
type FacetValue<K extends BehavioralKey> = NonNullable<UniversalFacets[K]["value"]>;

/**
 * An LLM facet envelope → a `Claim`. The two shapes are aligned (value/confidence/source/evidence), so
 * this is a faithful, lossless lift: an asserted facet becomes an asserting claim; the known-unknown
 * literal becomes a non-asserting (value:null) claim that competes as an absence.
 */
function facetToClaim<K extends BehavioralKey>(facet: UniversalFacets[K]): Claim<FacetValue<K>> {
  return {
    value: facet.value as FacetValue<K> | null,
    confidence: facet.confidence,
    source: facet.source,
    // The unknown branch may omit evidence; normalize to a string for a uniform claim.
    evidence: facet.evidence ?? "",
  };
}

/** A derived overlay value → a `Claim` (always `source:"derived_from_material"`). */
function derivedToClaim<K extends BehavioralKey>(d: DerivedValue<FacetValue<K>>): Claim<FacetValue<K>> {
  return { value: d.value, confidence: d.confidence, source: d.source, evidence: d.evidence };
}

/**
 * A resolved `Claim` → the stored `Evidence<V>` envelope. A null-valued winner serializes to the
 * canonical known-unknown literal (so the persisted shape stays exactly what the schema expects); an
 * asserted winner carries its value/confidence/source/evidence. `resolveFacet` only ever yields a graded
 * confidence on an asserted winner (the `"unknown"` confidence belongs to the null branch), so the cast
 * is sound.
 */
function claimToFacet<K extends BehavioralKey>(c: Claim<FacetValue<K>>): UniversalFacets[K] {
  // Indexing `UniversalFacets[K]` over the whole BehavioralKey union collapses to an intersection, so we
  // build the runtime-valid envelope and assert through `unknown`. The runtime shape is exactly one
  // member of the evidence union (validated by the classification schema downstream).
  const envelope =
    c.value === null
      ? { value: null, confidence: "unknown" as const, source: "unknown" as const }
      : { value: c.value, confidence: c.confidence as "low" | "medium" | "high", source: c.source, evidence: c.evidence };
  return envelope as unknown as UniversalFacets[K];
}

/**
 * Resolve every universal behavioral facet the derivation has an opinion on, returning a NEW
 * classification with those facets replaced by the resolver's winner. Facets the derivation does not
 * touch are left exactly as the LLM had them.
 *
 * Per-facet: claims = [ the LLM's current facet (as-stored), the derived value ] → `resolveFacet` →
 * write back. By the policy in resolve-facet.ts:
 *   - a high/medium `derived_from_material` value (moisture_management, dry_speed, warmth_when_wet)
 *     OVERRIDES a weaker-or-equal LLM `inferred` guess — the headline correction;
 *   - a LOW-confidence derived `warmth` does NOT clobber a higher-confidence inferred warmth — it defers
 *     (fills only when the LLM had nothing or was itself low);
 *   - a manufacturer/user behavioral fact (when one ever exists) wins by precedence regardless.
 *
 * Pure; never throws on a validated classification + a well-formed derived overlay.
 */
export function resolveBehavioralFacets(
  llm: ItemClassification,
  derived: DerivedFacets,
): ItemClassification {
  // Resolve each derivable facet in isolation; collect into a partial overlay we spread onto the LLM's
  // universal block. (Per-key resolution keeps the generic V tied to ONE facet, so types stay precise;
  // assigning into a union-keyed object directly would force the intersection of all facet shapes.)
  const overlay: Partial<UniversalFacets> = {};
  let touched = false;

  for (const key of BEHAVIORAL_KEYS) {
    if (!derived[key]) continue; // derivation has no opinion on this facet → keep the LLM's value untouched
    resolveOneInto(overlay, llm.universal, derived, key);
    touched = true;
  }

  if (!touched) return llm;
  return { ...llm, universal: { ...llm.universal, ...overlay } };
}

/**
 * Resolve a SINGLE behavioral facet `key` and write the winner into `overlay[key]`. Generic over the one
 * key, so the claim values and the written envelope are precisely typed (V is a single facet's value).
 */
function resolveOneInto<K extends BehavioralKey>(
  overlay: Partial<UniversalFacets>,
  llmUniversal: UniversalFacets,
  derived: DerivedFacets,
  key: K,
): void {
  const d = derived[key];
  if (!d) return;

  const claims: Claim<FacetValue<K>>[] = [
    // Order is irrelevant to the result (resolveFacet is order-independent), but we list the LLM's
    // current value first and the stronger-provenance derived claim second for readable evidence trails.
    facetToClaim<K>(llmUniversal[key]),
    derivedToClaim<K>(d as DerivedValue<FacetValue<K>>),
  ];

  overlay[key] = claimToFacet<K>(resolveFacet(claims));
}

/** Re-exported for callers that want the key set (e.g. assertions/tests). */
export { BEHAVIORAL_KEYS };
