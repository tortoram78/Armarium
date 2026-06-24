// Map raw extracted product facts onto the validated classification shapes, with source:"manufacturer".
//
// This is the boundary where extracted data becomes EVIDENCE. Every emitted value is run through the
// existing Zod validators (incl. the hardFact demotion preprocess), so nothing invalid or fabricated
// can escape. Manufacturer enrichment asserts ONLY facts the source literally stated: we emit a field
// solely when the extractor actually read it, and leave everything else as the known-unknown literal.
// We do NOT invent soft behavioral facets here — those are inference, not manufacturer assertion.
//
// Output is a PARTIAL OVERLAY (`ManufacturerEnrichment`), not a full ItemClassification: a caller merges
// these stated hard facts + materials onto an existing/new classification (the merge policy lives in the
// caller — manufacturer data should win over inference, per rule #2).

import { z } from "zod";
import { ItemClassificationSchema } from "../classification";
import { HARD_SOURCE } from "../evidence";
import type { ExtractedProduct, ExtractedFiber } from "./parse-html";

// Reuse the exact field shapes from the classification contract so the overlay can never drift from it.
const identitySchema = ItemClassificationSchema.shape.identity;
const materialsSchema = ItemClassificationSchema.shape.materials;

type Identity = z.infer<typeof identitySchema>;
type Materials = z.infer<typeof materialsSchema>;

/**
 * The manufacturer-enrichment overlay: stated identity hard facts + composition materials, validated.
 * `weight_grams`/`upf` etc. that the source did not state are the known-unknown literal. The optional
 * `provenance` records the source URL + extraction origin for audit (not part of the classification).
 */
export interface ManufacturerEnrichment {
  /** Stated brand/model/price/weight as validated hardFacts (null+unknown where not stated). */
  identity: Identity;
  /** Composition materials with source:"manufacturer", validated. Empty when no composition was stated. */
  materials: Materials;
  /** Audit trail: where this came from. Not a classification field. */
  provenance: {
    source: "manufacturer";
    extractedFrom: ExtractedProduct["source"];
  };
  /** True iff at least one identity hard fact OR one material survived validation (i.e. usable signal). */
  hasSignal: boolean;
}

const UNKNOWN_HARD = { value: null as null, source: "unknown" as const };

/** Build one validated hard fact when stated, else the known-unknown literal. */
function statedHard<T>(value: T | null, evidence: string): { value: T; source: "manufacturer"; evidence: string } | typeof UNKNOWN_HARD {
  if (value === null || value === undefined) return UNKNOWN_HARD;
  return { value, source: "manufacturer" as const, evidence };
}

/**
 * Decide a material's role from the stated material text. Defaults to "shell" (the worn outer face) — the
 * single most common and most decision-relevant layer. When the text names BOTH a shell and a lining
 * (a typical full composition string), the shell wins: it is the role most other facets key off. Only a
 * lining-only or membrane-only string resolves to those roles. We never split one stated string into
 * multiple material rows here — that fidelity is left to a fuller parser if ever needed.
 */
function inferRole(materialRaw: string): Materials[number]["role"] {
  const t = materialRaw.toLowerCase();
  const mentionsShell = /\bshell\b|\bface\b|\bouter\b|\bexterior\b|\bbody\b/.test(t);
  if (/\bmembrane\b|gore[- ]?tex|\blaminate\b/.test(t)) return "membrane";
  if (mentionsShell) return "shell";
  if (/\b(down|insulation|primaloft|coreloft|\bfill\b)\b/.test(t)) return "insulation";
  if (/\blining\b|\blined\b|\bliner\b/.test(t)) return "lining";
  return "shell";
}

/** Map extracted fibers to the classification fiber_components shape (drop the recycled:false noise). */
function toFiberComponents(fibers: ExtractedFiber[]): Materials[number]["fiber_components"] {
  return fibers.map((f) => {
    const comp: { fiber: string; pct: number | null; recycled?: boolean } = { fiber: f.fiber, pct: f.pct };
    if (f.recycled) comp.recycled = true;
    return comp;
  });
}

/**
 * Map raw extracted product facts onto the manufacturer-enrichment overlay, validating everything.
 *
 * Composition (fiber name + %) is the highest-value output and is mapped precisely into
 * `materials[].fiber_components`. A material is emitted ONLY when the source stated either a parsed
 * composition or a raw material string — never fabricated. If the parsed composition is empty but a raw
 * material string exists, we still emit the material with `fiber_components: []` and the raw name, so the
 * stated fact is preserved without inventing percentages.
 *
 * NEVER throws: validation failures (e.g. a non-positive price that slips through) collapse to unknown.
 */
export function toManufacturerEvidence(extracted: ExtractedProduct): ManufacturerEnrichment {
  const identityRaw = {
    brand: statedHard(extracted.brand, extracted.brand ? `manufacturer page: brand "${extracted.brand}"` : ""),
    model: statedHard(extracted.name, extracted.name ? `manufacturer page: product name "${extracted.name}"` : ""),
    price_cents: statedHard(
      extracted.price_cents,
      extracted.price_cents != null
        ? `manufacturer page: price ${(extracted.price_cents / 100).toFixed(2)} ${extracted.price_currency ?? ""}`.trim()
        : "",
    ),
    weight_grams: statedHard(
      extracted.weight_grams,
      extracted.weight_grams != null ? `manufacturer page: weight ${extracted.weight_grams} g` : "",
    ),
  };

  // Validate identity through the real schema (hardFact preprocess + non-negative-int guards run here).
  const identityParsed = identitySchema.safeParse(identityRaw);
  const identity: Identity = identityParsed.success
    ? identityParsed.data
    : {
        brand: UNKNOWN_HARD,
        model: UNKNOWN_HARD,
        price_cents: UNKNOWN_HARD,
        weight_grams: UNKNOWN_HARD,
      };

  // Build at most one material from the stated composition / material string.
  const materialsRaw: unknown[] = [];
  const fiberComponents = toFiberComponents(extracted.fiber_components);
  if (extracted.material_raw || fiberComponents.length > 0) {
    const raw = extracted.material_raw ?? "";
    materialsRaw.push({
      role: inferRole(raw),
      name: extracted.material_raw,
      fiber_components: fiberComponents,
      // construction_type is a closed enum we cannot reliably read from text — leave null (not fabricated).
      construction_type: null,
      source: "manufacturer" as (typeof HARD_SOURCE)[number],
      evidence: extracted.material_raw
        ? `manufacturer page: composition "${extracted.material_raw}"`
        : "manufacturer page: composition",
    });
  }

  const materialsParsed = materialsSchema.safeParse(materialsRaw);
  const materials: Materials = materialsParsed.success ? materialsParsed.data : [];

  const hasIdentitySignal =
    identity.brand.value !== null ||
    identity.model.value !== null ||
    identity.price_cents.value !== null ||
    identity.weight_grams.value !== null;
  const hasSignal = hasIdentitySignal || materials.length > 0;

  return {
    identity,
    materials,
    provenance: { source: "manufacturer", extractedFrom: extracted.source },
    hasSignal,
  };
}
