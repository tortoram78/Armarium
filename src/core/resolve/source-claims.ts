// Claim PRODUCERS for the non-LLM sources (Phase 3 — ADR-0014 §3): turn the existing extractor outputs
// (`ManufacturerEnrichment`, `DerivedFacets`) into `EvidenceClaim[]` so they join the LLM claims in the
// item_evidence store and are adjudicated by the SAME resolver — replacing the bespoke merge paths
// (applyManufacturerOverlay / resolveBehavioralFacets) with the general claims pipeline where they overlap.
//
// Provenance is preserved exactly: manufacturer claims carry source:"manufacturer" (authoritative for the
// identity hard facts + composition it states); derived claims carry source:"derived_from_material". The
// resolver's precedence policy (user > manufacturer > derived > inferred) then lets a manufacturer spec
// out-rank the LLM's inference, and a low-confidence derived warmth defer to a stronger inference — the
// exact behavior the old overlays produced, now as ordinary competitors.
//
// PURE: no next/*, no React, no DB, no networking.

import type { EvidenceClaim } from "../ports";
import type { ManufacturerEnrichment } from "../enrich/to-evidence";
import type { DerivedFacets } from "../materials/derive";
import { MATERIALS_FACET_KEY } from "./assemble";

export const MANUFACTURER_EXTRACTOR_VERSION = "manufacturer-url-v1";
export const MATERIAL_DERIVE_EXTRACTOR_VERSION = "material-derive-v1";

/** The universal-facet keys a composition derivation can assert — exactly the keys of `DerivedFacets`. */
const DERIVED_FACET_KEYS = [
  "moisture_management",
  "dry_speed",
  "warmth_when_wet",
  "breathability",
  "warmth",
] as const;

/**
 * Manufacturer enrichment → claims: the stated identity hard facts (brand/model/price/weight) it actually
 * asserted + the stated composition. ONLY present (value !== null) identity fields and a non-empty
 * composition become claims — the extractor never fabricates a fact the page did not state.
 *
 * Behavioral/soft facets are deliberately NOT emitted: the manufacturer extractor reads identity +
 * composition only; stamping warmth/waterproofness "manufacturer" would fabricate an authoritative claim
 * the source never made (load-bearing rule #2).
 */
export function manufacturerClaims(mfr: ManufacturerEnrichment, sourceUrl?: string): EvidenceClaim[] {
  if (!mfr.hasSignal) return [];
  const out: EvidenceClaim[] = [];
  const url = sourceUrl ?? null;

  const identityKeys = ["brand", "model", "price_cents", "weight_grams"] as const;
  for (const key of identityKeys) {
    const field = mfr.identity[key];
    if (field.value === null) continue; // not stated → no claim
    out.push({
      facetKey: `identity.${key}`,
      value: field.value,
      confidence: "high", // a stated manufacturer spec is asserted with full confidence
      source: "manufacturer",
      sourceUrl: url,
      evidence: "evidence" in field && field.evidence ? field.evidence : `manufacturer page: ${key}`,
      extractorVersion: MANUFACTURER_EXTRACTOR_VERSION,
    });
  }

  // Composition: the whole materials array as one atomic manufacturer claim (when stated).
  if (mfr.materials.length > 0) {
    out.push({
      facetKey: MATERIALS_FACET_KEY,
      value: mfr.materials,
      confidence: "high",
      source: "manufacturer",
      sourceUrl: url,
      evidence: "manufacturer page: composition",
      extractorVersion: MANUFACTURER_EXTRACTOR_VERSION,
    });
  }

  return out;
}

/**
 * Material-derivation overlay → claims: each universal behavioral facet the composition determines, as a
 * `source:"derived_from_material"` claim carrying the derivation's own confidence + evidence. A sparse
 * overlay (only present keys) maps to exactly that many claims; absent keys produce none.
 */
export function derivedClaims(derived: DerivedFacets): EvidenceClaim[] {
  const out: EvidenceClaim[] = [];
  for (const key of DERIVED_FACET_KEYS) {
    const d = derived[key];
    if (!d) continue;
    out.push({
      facetKey: `universal.${key}`,
      value: d.value,
      confidence: d.confidence,
      source: "derived_from_material",
      evidence: d.evidence,
      extractorVersion: MATERIAL_DERIVE_EXTRACTOR_VERSION,
    });
  }
  return out;
}
