// Tests for the apparel domain — facet vocabulary, Zod round-trips, registry integrity,
// domain predicates, assembler routing, and cross-archetype coverage (≥3 examples).
//
// INVARIANTS verified:
//   - All apparel facets are tier:"jsonb" and capabilityGate:false (none gate a capability)
//   - Apparel classification fixtures validate through ItemClassificationSchema
//   - isApparelClassified: true when apparel signal present, false for record-only/gear-only
//   - modeledDomainsOf: gear→['gear'], apparel→['apparel'], fleece→['gear','apparel']
//   - assembleClassification routes groups.apparel.* claims into the apparel group correctly

import { describe, it, expect } from "vitest";
import { FACETS, FACET_KEYS, capabilityGateFacets } from "@/core/facets/registry";
import {
  GARMENT_ROLE, FORMALITY, FIT, PATTERN, CARE, OCCASION,
} from "@/core/facets/levels";
import { parseClassification, safeParseClassification, type ItemClassification } from "@/core/classification";
import { isApparelClassified, isGearClassified, modeledDomainsOf } from "@/core/domains";
import { assembleClassification } from "@/core/resolve/assemble";
import { mkResolved, s } from "./helpers";
import { DEFAULT_INVENTORY } from "@/core/inventory";
import type { ResolvedItem } from "@/core/resolved";
import type { EvidenceClaim } from "@/core/ports";

// ----------------------------------------------------------------------------------------------------
// Shared fixtures — the all-unknown scaffold (seed corpus item 0) as a base
// ----------------------------------------------------------------------------------------------------

/** Minimal valid all-unknown classification for a name. */
function minClassification(name: string): unknown {
  return {
    name,
    identity: {
      brand: { value: null, source: "unknown" },
      model: { value: null, source: "unknown" },
      price_cents: { value: null, source: "unknown" },
      weight_grams: { value: null, source: "unknown" },
    },
    materials: [],
    treatments: [],
    universal: {
      waterproofness: { value: null, confidence: "unknown", source: "unknown" },
      wind_resistance: { value: null, confidence: "unknown", source: "unknown" },
      breathability: { value: null, confidence: "unknown", source: "unknown" },
      moisture_management: { value: null, confidence: "unknown", source: "unknown" },
      dry_speed: { value: null, confidence: "unknown", source: "unknown" },
      warmth_when_wet: { value: null, confidence: "unknown", source: "unknown" },
      warmth: { value: null, confidence: "unknown", source: "unknown" },
      packability: { value: null, confidence: "unknown", source: "unknown" },
      technical_vs_lifestyle: { value: null, confidence: "unknown", source: "unknown" },
      upf: { value: null, source: "unknown" },
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

/** Build an apparel group fixture — all fields set to valid values. */
function apparelGroupFixture() {
  return {
    garment_role: ["top", "outerwear"],
    formality: { value: "smart_casual", confidence: "high", source: "inferred", evidence: "wool button-down" },
    fit: { value: "regular", confidence: "medium", source: "inferred", evidence: "standard cut" },
    pattern: { value: "solid", confidence: "high", source: "inferred", evidence: "plain fabric" },
    care: ["hand_wash", "line_dry"],
    occasion: ["work", "everyday"],
  };
}

// ----------------------------------------------------------------------------------------------------
// Registry integrity: apparel facets are all jsonb and never capability-gating
// ----------------------------------------------------------------------------------------------------

describe("registry integrity: apparel group", () => {
  const apparelKeys = FACET_KEYS.filter((k) => FACETS[k].group === "apparel");

  it("registers exactly 6 apparel facets", () => {
    expect(apparelKeys).toHaveLength(6);
    expect(apparelKeys.sort()).toEqual(
      ["care", "fit", "formality", "garment_role", "occasion", "pattern"].sort()
    );
  });

  it("all apparel facets are tier:jsonb", () => {
    for (const k of apparelKeys) {
      expect(FACETS[k].tier).toBe("jsonb");
    }
  });

  it("INVARIANT: no apparel facet gates a capability (capabilityGate:false for all)", () => {
    for (const k of apparelKeys) {
      expect(FACETS[k].capabilityGate).toBe(false);
    }
    // Cross-check: none appear in the capability-gating list
    for (const k of capabilityGateFacets) {
      expect(FACETS[k].group).not.toBe("apparel");
    }
  });

  it("capability-gating facets are still all stored hot (never jsonb) — global invariant unchanged", () => {
    for (const k of capabilityGateFacets) {
      expect(FACETS[k].tier).not.toBe("jsonb");
    }
  });

  it("multilabel apparel facets (garment_role, care, occasion) have kind:multilabel", () => {
    for (const k of ["garment_role", "care", "occasion"] as const) {
      expect(FACETS[k].kind).toBe("multilabel");
    }
  });

  it("ordinal apparel facet (formality) has kind:ordinal", () => {
    expect(FACETS.formality.kind).toBe("ordinal");
  });

  it("nominal apparel facets (fit, pattern) have kind:nominal", () => {
    for (const k of ["fit", "pattern"] as const) {
      expect(FACETS[k].kind).toBe("nominal");
    }
  });

  it("all apparel facets declare a non-empty level set", () => {
    for (const k of apparelKeys) {
      const f = FACETS[k];
      expect(f.levels && f.levels.length).toBeGreaterThan(0);
    }
  });
});

// ----------------------------------------------------------------------------------------------------
// Zod schema: apparel group round-trips through ItemClassificationSchema
// ----------------------------------------------------------------------------------------------------

describe("ItemClassificationSchema: apparel group", () => {
  it("validates an apparel-only classification (dress example)", () => {
    const fixture = {
      ...(minClassification("Silk Wrap Dress") as Record<string, unknown>),
      groups: {
        apparel: {
          garment_role: ["dress", "full_body"],
          formality: { value: "formal", confidence: "high", source: "inferred", evidence: "silk formal dress" },
          fit: { value: "regular", confidence: "medium", source: "inferred", evidence: "wrap style" },
          pattern: { value: "solid", confidence: "high", source: "inferred", evidence: "plain silk" },
          care: ["dry_clean"],
          occasion: ["formal_event", "evening"],
        },
      },
      applicable_groups: ["apparel"],
    };
    expect(() => parseClassification(fixture)).not.toThrow();
    const parsed = parseClassification(fixture);
    expect(parsed.groups.apparel?.garment_role).toEqual(["dress", "full_body"]);
    expect(parsed.groups.apparel?.formality.value).toBe("formal");
    expect(parsed.groups.apparel?.care).toEqual(["dry_clean"]);
  });

  it("validates a business-shirt classification (cross-archetype: business shirt)", () => {
    const fixture = {
      ...(minClassification("Oxford Business Shirt") as Record<string, unknown>),
      groups: {
        apparel: {
          garment_role: ["top"],
          formality: { value: "business", confidence: "high", source: "inferred", evidence: "oxford collar, button cuffs" },
          fit: { value: "tailored", confidence: "medium", source: "inferred", evidence: "slim cut" },
          pattern: { value: "striped", confidence: "high", source: "inferred", evidence: "pinstripe pattern" },
          care: ["machine_wash", "iron"],
          occasion: ["work", "formal_event"],
        },
      },
      applicable_groups: ["apparel"],
    };
    const parsed = parseClassification(fixture);
    expect(parsed.groups.apparel?.garment_role).toEqual(["top"]);
    expect(parsed.groups.apparel?.formality.value).toBe("business");
    expect(parsed.groups.apparel?.fit.value).toBe("tailored");
    expect(parsed.groups.apparel?.pattern.value).toBe("striped");
  });

  it("validates athletic shorts (cross-archetype: athletic shorts)", () => {
    const base = minClassification("Running Shorts") as Record<string, unknown>;
    const baseUniversal = base.universal as Record<string, unknown>;
    const fixture = {
      ...base,
      universal: {
        ...baseUniversal,
        breathability: { value: "high", confidence: "high", source: "inferred", evidence: "mesh fabric" },
        moisture_management: { value: "wicks", confidence: "high", source: "inferred", evidence: "polyester wicking" },
      },
      multilabel: {
        layering_role: [],
        function_purpose: ["moisture_wicking", "cooling"],
        body_zone_covered: ["legs"],
        activity_fit: ["trail_running", "hiking"],
        conditions_fit: ["warm", "high_exertion"],
      },
      groups: {
        apparel: {
          garment_role: ["bottom"],
          formality: { value: "casual", confidence: "high", source: "inferred", evidence: "athletic shorts" },
          fit: { value: "regular", confidence: "medium", source: "inferred", evidence: "standard athletic fit" },
          pattern: { value: "solid", confidence: "high", source: "inferred", evidence: "plain color" },
          care: ["machine_wash", "tumble_dry"],
          occasion: ["athletic", "everyday", "outdoor"],
        },
      },
      applicable_groups: ["apparel"],
    };
    const parsed = parseClassification(fixture);
    expect(parsed.groups.apparel?.garment_role).toEqual(["bottom"]);
    expect(parsed.groups.apparel?.formality.value).toBe("casual");
    expect(parsed.groups.apparel?.occasion).toContain("athletic");
    // Also verifies gear facets co-exist
    expect(parsed.universal.breathability.value).toBe("high");
  });

  it("accepts a classification with NO apparel group (gear-only — existing items unaffected)", () => {
    const fixture = minClassification("Rain Jacket");
    expect(() => parseClassification(fixture)).not.toThrow();
    const parsed = parseClassification(fixture);
    expect(parsed.groups.apparel).toBeUndefined();
  });

  it("rejects an out-of-vocabulary garment_role value", () => {
    const fixture = {
      ...(minClassification("Test Item") as Record<string, unknown>),
      groups: {
        apparel: {
          garment_role: ["pants"], // 'pants' is not a valid garment_role — should be 'bottom'
          formality: { value: null, confidence: "unknown", source: "unknown" },
          fit: { value: null, confidence: "unknown", source: "unknown" },
          pattern: { value: null, confidence: "unknown", source: "unknown" },
          care: [],
          occasion: [],
        },
      },
    };
    expect(safeParseClassification(fixture).success).toBe(false);
  });

  it("rejects an out-of-vocabulary formality value", () => {
    const fixture = {
      ...(minClassification("Test Item") as Record<string, unknown>),
      groups: {
        apparel: {
          garment_role: [],
          formality: { value: "ultra_formal", confidence: "high", source: "inferred", evidence: "x" },
          fit: { value: null, confidence: "unknown", source: "unknown" },
          pattern: { value: null, confidence: "unknown", source: "unknown" },
          care: [],
          occasion: [],
        },
      },
    };
    expect(safeParseClassification(fixture).success).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------
// isApparelClassified
// ----------------------------------------------------------------------------------------------------

describe("isApparelClassified", () => {
  /** A resolved item with apparel signal via garment_role. */
  const withGarmentRole: ResolvedItem = {
    ...mkResolved("a1", "Silk Dress"),
    groups: {
      apparel: {
        garment_role: ["dress"],
        formality: { value: null, confidence: "unknown", source: "unknown" },
        fit: { value: null, confidence: "unknown", source: "unknown" },
        pattern: { value: null, confidence: "unknown", source: "unknown" },
        care: [],
        occasion: [],
      },
    },
  };

  /** A resolved item with apparel signal via formality scalar. */
  const withFormality: ResolvedItem = {
    ...mkResolved("a2", "Oxford Shirt"),
    groups: {
      apparel: {
        garment_role: [],
        formality: { value: "business", confidence: "high", source: "inferred", evidence: "oxford dress shirt" },
        fit: { value: null, confidence: "unknown", source: "unknown" },
        pattern: { value: null, confidence: "unknown", source: "unknown" },
        care: [],
        occasion: [],
      },
    },
  };

  /** An item with domains: ['apparel'] marker but no apparel group (backfill-safe). */
  const byDomainMarker: ResolvedItem = {
    ...mkResolved("a3", "Domain-Marked Apparel"),
    inventory: { ...DEFAULT_INVENTORY, domains: ["apparel"] },
  };

  /** A gear-only item (no apparel facets, no apparel domain). */
  const gearOnly = mkResolved("g1", "Rain Jacket", { warmth: s("light", "medium", "inferred", "light insulation") });

  /** A record-only item (all-unknown, no domains). */
  const recordOnly = mkResolved("r1", "My Random Thing");

  it("returns true when garment_role array is non-empty", () => {
    expect(isApparelClassified(withGarmentRole)).toBe(true);
  });

  it("returns true when formality has a known value", () => {
    expect(isApparelClassified(withFormality)).toBe(true);
  });

  it("returns true for domains: ['apparel'] marker even with no apparel group", () => {
    expect(isApparelClassified(byDomainMarker)).toBe(true);
  });

  it("returns false for a gear-only item with no apparel signal", () => {
    expect(isApparelClassified(gearOnly)).toBe(false);
  });

  it("returns false for a record-only item", () => {
    expect(isApparelClassified(recordOnly)).toBe(false);
  });

  it("returns false when apparel group is absent (undefined)", () => {
    const noGroup = mkResolved("a4", "Mystery Item");
    // mkResolved doesn't set groups.apparel
    expect(isApparelClassified(noGroup)).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------
// modeledDomainsOf — cross-archetype (gear, apparel, both)
// ----------------------------------------------------------------------------------------------------

describe("modeledDomainsOf", () => {
  /** Gear-only: a rain jacket with warmth/waterproofness signal, no apparel group. */
  const rainJacket = mkResolved("g1", "Rain Jacket", {
    warmth: s("light", "medium", "inferred", "light synthetic fill"),
    waterproofness: s("wp_breathable", "high", "inferred", "membrane shell"),
  });

  /** Apparel-only: a dress with garment_role signal, no gear facets. */
  const dress: ResolvedItem = {
    ...mkResolved("a1", "Evening Dress"),
    groups: {
      apparel: {
        garment_role: ["dress"],
        formality: { value: "formal", confidence: "high", source: "inferred", evidence: "evening gown" },
        fit: { value: "regular", confidence: "medium", source: "inferred", evidence: "fitted" },
        pattern: { value: "solid", confidence: "high", source: "inferred", evidence: "plain silk" },
        care: ["dry_clean"],
        occasion: ["formal_event", "evening"],
      },
    },
  };

  /** Dual-domain: a fleece with gear signal (warmth, layering_role) AND apparel signal (garment_role). */
  const fleece: ResolvedItem = {
    ...mkResolved("f1", "Polartec Fleece Jacket", {
      warmth: s("moderate", "high", "inferred", "fleece construction"),
      breathability: s("moderate", "medium", "inferred", "fleece is breathable"),
    }, { layering_role: ["mid", "active_insulation"] }),
    groups: {
      apparel: {
        garment_role: ["top", "outerwear"],
        formality: { value: "casual", confidence: "medium", source: "inferred", evidence: "casual fleece" },
        fit: { value: "regular", confidence: "medium", source: "inferred", evidence: "standard fit" },
        pattern: { value: "solid", confidence: "high", source: "inferred", evidence: "plain color" },
        care: ["machine_wash", "line_dry"],
        occasion: ["outdoor", "everyday"],
      },
    },
  };

  /** Record-only: no gear or apparel signal. */
  const recordOnly = mkResolved("r1", "Random Item");

  it("returns ['gear'] for a gear-only item (rain jacket)", () => {
    expect(modeledDomainsOf(rainJacket)).toEqual(["gear"]);
  });

  it("returns ['apparel'] for an apparel-only item (dress)", () => {
    expect(modeledDomainsOf(dress)).toEqual(["apparel"]);
  });

  it("returns ['gear', 'apparel'] for a dual-domain item (fleece)", () => {
    expect(modeledDomainsOf(fleece)).toEqual(["gear", "apparel"]);
  });

  it("returns [] for a record-only item with no signal in any domain", () => {
    expect(modeledDomainsOf(recordOnly)).toEqual([]);
  });

  it("cross-archetype: athletic shorts → ['apparel'] (no gear facets set)", () => {
    const athleticShorts: ResolvedItem = {
      ...mkResolved("a2", "Running Shorts"),
      groups: {
        apparel: {
          garment_role: ["bottom"],
          formality: { value: "casual", confidence: "high", source: "inferred", evidence: "athletic" },
          fit: { value: "regular", confidence: "medium", source: "inferred", evidence: "athletic fit" },
          pattern: { value: "solid", confidence: "high", source: "inferred", evidence: "plain" },
          care: ["machine_wash", "tumble_dry"],
          occasion: ["athletic", "everyday"],
        },
      },
    };
    expect(modeledDomainsOf(athleticShorts)).toEqual(["apparel"]);
  });

  it("cross-archetype: hardshell jacket with apparel group → ['gear', 'apparel']", () => {
    const hardshell: ResolvedItem = {
      ...mkResolved("g2", "Gore-Tex Hardshell", {
        waterproofness: s("wp_breathable", "high", "inferred", "Gore-Tex membrane"),
        wind_resistance: s("windproof", "high", "inferred", "hardshell"),
      }, { layering_role: ["weather_shell"] }),
      groups: {
        shell: {
          protection_ceiling: { value: "storm", confidence: "high", source: "inferred", evidence: "Gore-Tex" },
          seam_sealing: { value: null, source: "unknown" },
          hood: { value: null, source: "unknown" },
          pit_zips: { value: null, source: "unknown" },
        },
        apparel: {
          garment_role: ["outerwear", "top"],
          formality: { value: "casual", confidence: "medium", source: "inferred", evidence: "technical outdoor" },
          fit: { value: "regular", confidence: "medium", source: "inferred", evidence: "standard athletic fit" },
          pattern: { value: "solid", confidence: "high", source: "inferred", evidence: "plain color" },
          care: ["machine_wash", "line_dry"],
          occasion: ["outdoor", "athletic"],
        },
      },
    };
    const domains = modeledDomainsOf(hardshell);
    expect(domains).toContain("gear");
    expect(domains).toContain("apparel");
    expect(domains).toHaveLength(2);
  });
});

// ----------------------------------------------------------------------------------------------------
// Assembler: groups.apparel.* claims route correctly
// ----------------------------------------------------------------------------------------------------

describe("assembleClassification: apparel group routing", () => {
  const makeApparelClaim = (facetKey: string, value: unknown, confidence: "low" | "medium" | "high" = "high"): EvidenceClaim => ({
    facetKey,
    value,
    confidence,
    source: "inferred",
    evidence: `test evidence for ${facetKey}`,
    extractorVersion: "test-v1",
  });

  it("routes groups.apparel.formality claim into the apparel group", () => {
    const claims = [
      makeApparelClaim("groups.apparel.formality", "casual"),
      makeApparelClaim("groups.apparel.garment_role", ["top"]),
      makeApparelClaim("groups.apparel.fit", "regular"),
      makeApparelClaim("groups.apparel.pattern", "solid"),
      makeApparelClaim("groups.apparel.care", ["machine_wash"]),
      makeApparelClaim("groups.apparel.occasion", ["everyday"]),
    ];
    const result = assembleClassification("Test Shirt", claims);
    expect(result.groups.apparel).toBeDefined();
    expect(result.groups.apparel?.formality.value).toBe("casual");
    expect(result.groups.apparel?.garment_role).toEqual(["top"]);
    expect(result.groups.apparel?.fit.value).toBe("regular");
    expect(result.groups.apparel?.pattern.value).toBe("solid");
    expect(result.groups.apparel?.care).toEqual(["machine_wash"]);
    expect(result.groups.apparel?.occasion).toEqual(["everyday"]);
  });

  it("apparel group appears in applicable_groups when claims produce a present field", () => {
    const claims = [
      makeApparelClaim("groups.apparel.garment_role", ["dress"]),
      makeApparelClaim("groups.apparel.formality", "formal"),
      makeApparelClaim("groups.apparel.fit", "regular"),
      makeApparelClaim("groups.apparel.pattern", "solid"),
      makeApparelClaim("groups.apparel.care", ["dry_clean"]),
      makeApparelClaim("groups.apparel.occasion", ["formal_event"]),
    ];
    const result = assembleClassification("Formal Dress", claims);
    expect(result.applicable_groups).toContain("apparel");
  });

  it("assembles a dual-domain fleece: both shell/gear and apparel groups present", () => {
    const claims: EvidenceClaim[] = [
      makeApparelClaim("universal.warmth", "moderate"),
      makeApparelClaim("multilabel.layering_role", ["mid", "active_insulation"]),
      makeApparelClaim("groups.apparel.garment_role", ["top", "outerwear"]),
      makeApparelClaim("groups.apparel.formality", "casual"),
      makeApparelClaim("groups.apparel.fit", "regular"),
      makeApparelClaim("groups.apparel.pattern", "solid"),
      makeApparelClaim("groups.apparel.care", ["machine_wash"]),
      makeApparelClaim("groups.apparel.occasion", ["outdoor", "everyday"]),
    ];
    const result = assembleClassification("Polartec Fleece", claims);
    expect(result.universal.warmth.value).toBe("moderate");
    expect(result.multilabel.layering_role).toContain("mid");
    expect(result.groups.apparel).toBeDefined();
    expect(result.groups.apparel?.garment_role).toContain("outerwear");
    expect(result.applicable_groups).toContain("apparel");
  });

  it("apparel group absent from applicable_groups when no claims produce any signal", () => {
    // Only a universal claim — no apparel claims at all
    const claims = [makeApparelClaim("universal.warmth", "light")];
    const result = assembleClassification("Mystery Item", claims);
    expect(result.groups.apparel).toBeUndefined();
    expect(result.applicable_groups).not.toContain("apparel");
  });
});

// ----------------------------------------------------------------------------------------------------
// Level set completeness
// ----------------------------------------------------------------------------------------------------

describe("apparel level sets", () => {
  it("GARMENT_ROLE contains all 9 structural roles", () => {
    expect(GARMENT_ROLE).toEqual(
      ["top", "bottom", "dress", "outerwear", "underlayer", "footwear", "headwear", "accessory", "full_body"]
    );
  });

  it("FORMALITY is ordered low → high (6 levels)", () => {
    expect(FORMALITY).toEqual(
      ["loungewear", "casual", "smart_casual", "business_casual", "business", "formal"]
    );
    expect(FORMALITY).toHaveLength(6);
  });

  it("FIT has 5 nominal values", () => {
    expect(FIT).toHaveLength(5);
    expect(FIT).toContain("slim");
    expect(FIT).toContain("oversized");
  });

  it("PATTERN has 8 nominal values", () => {
    expect(PATTERN).toHaveLength(8);
    expect(PATTERN).toContain("solid");
    expect(PATTERN).toContain("other");
  });

  it("CARE has 6 multilabel values", () => {
    expect(CARE).toHaveLength(6);
    expect(CARE).toContain("dry_clean");
    expect(CARE).toContain("machine_wash");
  });

  it("OCCASION has 8 multilabel values", () => {
    expect(OCCASION).toHaveLength(8);
    expect(OCCASION).toContain("work");
    expect(OCCASION).toContain("outdoor");
  });
});
