// Merge policy: overlay authoritative manufacturer facts onto an LLM classification (Phase 3 step 2).
//
// PURE: no next/*, no React, no DB, no networking. Given the LLM's full `ItemClassification` and a
// validated `ManufacturerEnrichment` overlay, produce a new classification where the MANUFACTURER's
// stated hard facts OUT-RANK the model's inference (load-bearing rule #2 — authoritative beats inferred,
// a wrong spec is worse than a missing one).
//
// What this merges, and what it deliberately does NOT:
//   - identity hard facts (brand/model/price/weight): each manufacturer-sourced field (value non-null)
//     replaces the LLM's field WHOLESALE — value AND source — so provenance reads "manufacturer", never
//     a manufacturer value laundered under an "inferred" marker.
//   - materials (composition): if the manufacturer stated any composition, its materials array REPLACES
//     the LLM's; if it stated none, the LLM's materials stand. We never interleave the two — a partial
//     merge of fiber lists would invent a composition neither source asserted.
//   - universal / multilabel / groups / treatments / applicable_groups: LEFT AS THE LLM'S. The
//     manufacturer extractor reads identity + composition only; it does NOT state behavioral facets
//     (warmth, waterproofness, layering role, …). Stamping those as "manufacturer" would fabricate an
//     authoritative claim the source never made — exactly what rule #2 forbids.
//
// `mfr.hasSignal === false` (junk/empty page) → return the LLM classification UNCHANGED.
//
// The output is a value the caller is expected to re-validate through the classification schema before
// persistence; every field copied here already originated from a validated source, so the merge cannot
// introduce a shape violation, but re-validation keeps the boundary honest.

import type { ItemClassification } from "../classification";
import { UNKNOWN_SOFT, UNKNOWN_HARD } from "../evidence";
import type { ManufacturerEnrichment } from "./to-evidence";

type Identity = ItemClassification["identity"];

/**
 * Overlay manufacturer-stated identity hard facts + composition onto the LLM's classification.
 *
 * Manufacturer values WIN over the LLM's for the fields the manufacturer actually stated; everything the
 * manufacturer did not state is taken from the LLM unchanged. Behavioral/soft facets are always the
 * LLM's — the manufacturer overlay never asserts them.
 */
export function applyManufacturerOverlay(
  llm: ItemClassification,
  mfr: ManufacturerEnrichment,
): ItemClassification {
  // No usable signal (no identity hard fact and no composition survived validation) → nothing to overlay.
  if (!mfr.hasSignal) return llm;

  return {
    ...llm,
    identity: mergeIdentity(llm.identity, mfr.identity),
    // Composition: manufacturer wins WHOLESALE when present; otherwise keep the LLM's materials.
    materials: mfr.materials.length > 0 ? mfr.materials : llm.materials,
    // Behavioral facets are the LLM's — the manufacturer overlay states none of these. Never fabricate
    // them as manufacturer-sourced.
    universal: llm.universal,
    multilabel: llm.multilabel,
    groups: llm.groups,
    treatments: llm.treatments,
    applicable_groups: llm.applicable_groups,
  };
}

/**
 * For each identity hard fact, prefer the manufacturer's when it carries a value (which — given the
 * to-evidence mapper — is always `source:"manufacturer"`). A manufacturer field that is the
 * known-unknown literal (`value:null`) leaves the LLM's field in place; we never overwrite a known LLM
 * value with "unknown". The whole field object is replaced, so value and source move together — there is
 * no path for a manufacturer value to appear under a non-authoritative source marker.
 */
function mergeIdentity(llm: Identity, mfr: Identity): Identity {
  return {
    brand: mfr.brand.value !== null ? mfr.brand : llm.brand,
    model: mfr.model.value !== null ? mfr.model : llm.model,
    price_cents: mfr.price_cents.value !== null ? mfr.price_cents : llm.price_cents,
    weight_grams: mfr.weight_grams.value !== null ? mfr.weight_grams : llm.weight_grams,
  };
}

/**
 * A classification whose IDENTITY + MATERIALS are blank but whose every BEHAVIORAL facet is the honest
 * known-unknown literal. Used by the degraded enrichment path: when no classifier is available (offline,
 * no API key, item not in the prototype corpus), we still want the authoritative manufacturer facts —
 * composition, brand, price, weight — to survive into a draft. We overlay them onto THIS scaffold rather
 * than dropping the whole request. The result honestly says "behavioral facets: unknown — verify" instead
 * of inventing warmth/waterproofness/etc., which is the correct, never-fabricate behavior.
 */
export function unknownBehavioralClassification(name: string): ItemClassification {
  return {
    name,
    identity: {
      brand: UNKNOWN_HARD,
      model: UNKNOWN_HARD,
      price_cents: UNKNOWN_HARD,
      weight_grams: UNKNOWN_HARD,
    },
    materials: [],
    treatments: [],
    universal: {
      waterproofness: UNKNOWN_SOFT,
      wind_resistance: UNKNOWN_SOFT,
      breathability: UNKNOWN_SOFT,
      moisture_management: UNKNOWN_SOFT,
      dry_speed: UNKNOWN_SOFT,
      warmth_when_wet: UNKNOWN_SOFT,
      warmth: UNKNOWN_SOFT,
      packability: UNKNOWN_SOFT,
      technical_vs_lifestyle: UNKNOWN_SOFT,
      upf: UNKNOWN_HARD,
    },
    multilabel: {
      layering_role: [],
      function_purpose: [],
      body_zone_covered: [],
      activity_fit: [],
      conditions_fit: [],
    },
    groups: {},
    applicable_groups: [],
  };
}
