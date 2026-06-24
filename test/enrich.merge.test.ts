import { describe, it, expect } from "vitest";
import {
  applyManufacturerOverlay,
  unknownBehavioralClassification,
  type ManufacturerEnrichment,
} from "@/core/enrich";
import { ItemClassificationSchema, type ItemClassification } from "@/core/classification";

// ---- builders -------------------------------------------------------------------------------------

/** A full, schema-valid LLM classification with INFERRED behavioral facets + an inferred-then-demoted
 *  identity (brand/model present from the LLM but price/weight unknown), and an LLM-stated material. */
function llmClassification(): ItemClassification {
  const raw = {
    name: "Generic Puffy Jacket",
    identity: {
      brand: { value: "LLM-Guessed-Brand", source: "user", evidence: "from the name" },
      model: { value: "LLM-Guessed-Model", source: "user", evidence: "from the name" },
      price_cents: { value: null, source: "unknown" },
      weight_grams: { value: null, source: "unknown" },
    },
    materials: [
      {
        role: "shell",
        name: "nylon (inferred)",
        fiber_components: [{ fiber: "nylon", pct: 100 }],
        construction_type: "woven",
        source: "unknown",
        evidence: "inferred from a puffy jacket",
      },
    ],
    treatments: [{ kind: "dwr", condition: "factory_fresh", source: "inferred", evidence: "typical of shells" }],
    universal: {
      waterproofness: { value: "dwr", confidence: "medium", source: "inferred", evidence: "shell" },
      wind_resistance: { value: "windproof", confidence: "medium", source: "inferred", evidence: "tight weave" },
      breathability: { value: "low", confidence: "low", source: "inferred", evidence: "insulated" },
      moisture_management: { value: null, confidence: "unknown", source: "unknown" },
      dry_speed: { value: null, confidence: "unknown", source: "unknown" },
      warmth_when_wet: { value: null, confidence: "unknown", source: "unknown" },
      warmth: { value: "high", confidence: "high", source: "inferred", evidence: "synthetic puffy" },
      packability: { value: "packable", confidence: "medium", source: "inferred", evidence: "synthetic" },
      technical_vs_lifestyle: { value: "technical", confidence: "low", source: "inferred", evidence: "puffy" },
      upf: { value: null, source: "unknown" },
    },
    multilabel: {
      layering_role: ["mid"],
      function_purpose: ["insulation"],
      body_zone_covered: ["torso"],
      activity_fit: ["hiking"],
      conditions_fit: ["cold"],
    },
    groups: {
      insulation: {
        fill_type: { value: "synthetic", source: "user", evidence: "stated" },
        fill_power: { value: null, source: "unknown" },
        fill_species: { value: null, source: "unknown" },
        fill_weight_g: { value: null, source: "unknown" },
        hydrophobic_treatment: { value: null, source: "unknown" },
        wet_performance: { value: "retains_some", confidence: "medium", source: "inferred", evidence: "synthetic" },
        warmth_for_weight: { value: null, confidence: "unknown", source: "unknown" },
      },
    },
    applicable_groups: ["insulation"],
  };
  return ItemClassificationSchema.parse(raw);
}

/** A manufacturer overlay with stated identity (all four) + a stated composition, all source:manufacturer. */
function mfrEnrichment(): ManufacturerEnrichment {
  return {
    identity: {
      brand: { value: "Patagonia", source: "manufacturer", evidence: "page brand" },
      model: { value: "Nano Puff Jacket", source: "manufacturer", evidence: "page name" },
      price_cents: { value: 23900, source: "manufacturer", evidence: "page price" },
      weight_grams: { value: 337, source: "manufacturer", evidence: "page weight" },
    },
    materials: [
      {
        role: "shell",
        name: "100% recycled polyester",
        fiber_components: [{ fiber: "polyester", pct: 100, recycled: true }],
        construction_type: null,
        source: "manufacturer",
        evidence: "page composition",
      },
    ],
    provenance: { source: "manufacturer", extractedFrom: "json-ld" },
    hasSignal: true,
  };
}

// ---- tests ----------------------------------------------------------------------------------------

describe("applyManufacturerOverlay — manufacturer identity OUT-RANKS the LLM", () => {
  const merged = applyManufacturerOverlay(llmClassification(), mfrEnrichment());

  it("manufacturer brand/model REPLACE the LLM's, source reads manufacturer", () => {
    expect(merged.identity.brand.value).toBe("Patagonia");
    expect(merged.identity.brand.source).toBe("manufacturer");
    expect(merged.identity.model.value).toBe("Nano Puff Jacket");
    expect(merged.identity.model.source).toBe("manufacturer");
  });

  it("manufacturer fills price/weight the LLM left unknown (value + manufacturer source together)", () => {
    expect(merged.identity.price_cents.value).toBe(23900);
    expect(merged.identity.price_cents.source).toBe("manufacturer");
    expect(merged.identity.weight_grams.value).toBe(337);
    expect(merged.identity.weight_grams.source).toBe("manufacturer");
  });

  it("the merged classification still validates against the canonical schema", () => {
    expect(ItemClassificationSchema.safeParse(merged).success).toBe(true);
  });
});

describe("applyManufacturerOverlay — composition", () => {
  it("manufacturer composition WINS wholesale when present (replaces the LLM materials)", () => {
    const merged = applyManufacturerOverlay(llmClassification(), mfrEnrichment());
    expect(merged.materials.length).toBe(1);
    expect(merged.materials[0]!.source).toBe("manufacturer");
    expect(merged.materials[0]!.name).toBe("100% recycled polyester");
    const poly = merged.materials[0]!.fiber_components.find((f) => f.fiber === "polyester");
    expect(poly?.recycled).toBe(true);
  });

  it("keeps the LLM's materials when the manufacturer stated NO composition", () => {
    const mfr = mfrEnrichment();
    mfr.materials = []; // identity signal still present, but no composition stated
    const merged = applyManufacturerOverlay(llmClassification(), mfr);
    expect(merged.materials.length).toBe(1);
    expect(merged.materials[0]!.name).toBe("nylon (inferred)");
    expect(merged.materials[0]!.source).toBe("unknown");
  });
});

describe("applyManufacturerOverlay — behavioral facets are NEVER fabricated as manufacturer", () => {
  const merged = applyManufacturerOverlay(llmClassification(), mfrEnrichment());

  it("universal soft facets are taken verbatim from the LLM (manufacturer states none)", () => {
    const llm = llmClassification();
    expect(merged.universal).toEqual(llm.universal);
    // Specifically: nothing in universal was re-stamped manufacturer.
    expect(merged.universal.warmth.source).toBe("inferred");
    expect(merged.universal.waterproofness.source).toBe("inferred");
  });

  it("multilabel + groups + treatments + applicable_groups are the LLM's, untouched", () => {
    const llm = llmClassification();
    expect(merged.multilabel).toEqual(llm.multilabel);
    expect(merged.groups).toEqual(llm.groups);
    expect(merged.treatments).toEqual(llm.treatments);
    expect(merged.applicable_groups).toEqual(llm.applicable_groups);
  });

  it("no behavioral facet anywhere carries source:manufacturer after the overlay", () => {
    expect(merged.universal.warmth.source).not.toBe("manufacturer");
    expect(merged.groups.insulation?.wet_performance.source).not.toBe("manufacturer");
  });
});

describe("applyManufacturerOverlay — partial identity does not clobber known LLM values", () => {
  it("a manufacturer field left unknown leaves the LLM's value in place", () => {
    const mfr = mfrEnrichment();
    // Manufacturer states only price; brand/model/weight unknown.
    mfr.identity.brand = { value: null, source: "unknown" };
    mfr.identity.model = { value: null, source: "unknown" };
    mfr.identity.weight_grams = { value: null, source: "unknown" };
    const merged = applyManufacturerOverlay(llmClassification(), mfr);
    // Brand/model fall back to the LLM's (still present); price is the manufacturer's.
    expect(merged.identity.brand.value).toBe("LLM-Guessed-Brand");
    expect(merged.identity.model.value).toBe("LLM-Guessed-Model");
    expect(merged.identity.price_cents.value).toBe(23900);
    expect(merged.identity.price_cents.source).toBe("manufacturer");
  });
});

describe("applyManufacturerOverlay — hasSignal:false returns the LLM unchanged", () => {
  it("returns the exact LLM classification when there is no usable manufacturer signal", () => {
    const llm = llmClassification();
    const noSignal: ManufacturerEnrichment = {
      identity: {
        brand: { value: null, source: "unknown" },
        model: { value: null, source: "unknown" },
        price_cents: { value: null, source: "unknown" },
        weight_grams: { value: null, source: "unknown" },
      },
      materials: [],
      provenance: { source: "manufacturer", extractedFrom: "none" },
      hasSignal: false,
    };
    const merged = applyManufacturerOverlay(llm, noSignal);
    expect(merged).toBe(llm); // same reference — untouched
  });
});

describe("unknownBehavioralClassification — honest all-unknown scaffold for the degraded path", () => {
  it("validates, and every behavioral facet is the known-unknown literal", () => {
    const scaffold = unknownBehavioralClassification("Mystery Item");
    expect(ItemClassificationSchema.safeParse(scaffold).success).toBe(true);
    expect(scaffold.name).toBe("Mystery Item");
    expect(scaffold.universal.warmth.value).toBeNull();
    expect(scaffold.universal.warmth.source).toBe("unknown");
    expect(scaffold.materials).toEqual([]);
    expect(scaffold.applicable_groups).toEqual([]);
  });

  it("the degraded overlay preserves authoritative composition + identity over the blank scaffold", () => {
    const merged = applyManufacturerOverlay(unknownBehavioralClassification("Patagonia Nano Puff Jacket"), mfrEnrichment());
    expect(merged.identity.brand.value).toBe("Patagonia");
    expect(merged.identity.price_cents.value).toBe(23900);
    expect(merged.materials[0]!.source).toBe("manufacturer");
    // Behavioral facets stay honestly unknown — never fabricated.
    expect(merged.universal.warmth.value).toBeNull();
    expect(ItemClassificationSchema.safeParse(merged).success).toBe(true);
  });
});
