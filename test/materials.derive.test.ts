import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  deriveFromComposition,
  type DerivedFacets,
} from "@/core/materials/derive";
import {
  MATERIAL_LIBRARY,
  libraryFiberKeys,
  lookupFiber,
  canonFiberKey,
} from "@/core/materials/library";
import * as L from "@/core/facets/levels";
import type { ItemClassification } from "@/core/classification";

// ----------------------------------------------------------------------------------------------------
// Helpers: build a minimal validated materials array (the engine's only input).
// ----------------------------------------------------------------------------------------------------
type Materials = ItemClassification["materials"];
const mat = (
  fibers: { fiber: string; pct: number | null; recycled?: boolean }[],
  role: Materials[number]["role"] = "shell",
): Materials => [
  {
    role,
    name: null,
    fiber_components: fibers.map((f) => ({ fiber: f.fiber, pct: f.pct, ...(f.recycled ? { recycled: true } : {}) })),
    construction_type: null,
    source: "manufacturer",
    evidence: "test composition",
  },
];

// ====================================================================================================
// 1. The library cannot drift from the ontology: every value is a member of its canonical vocabulary,
//    every entry carries a rationale, and the per-property confidence is a real confidence level.
// ====================================================================================================
describe("material library is valid against the canonical vocabulary", () => {
  const VOCAB: Record<string, readonly string[]> = {
    moisture_management: L.MOISTURE_MANAGEMENT,
    dry_speed: L.DRY_SPEED,
    warmth_when_wet: L.WARMTH_WHEN_WET,
    breathability: L.BREATHABILITY,
    warmth: L.WARMTH,
  };
  const CONF = ["low", "medium", "high"];

  it("every behavioral value in every entry is a valid vocabulary member with a confidence + rationale", () => {
    expect(MATERIAL_LIBRARY.length).toBeGreaterThanOrEqual(20);
    for (const entry of MATERIAL_LIBRARY) {
      for (const prop of Object.keys(VOCAB)) {
        const p = (entry as Record<string, unknown>)[prop] as
          | { value: string; confidence: string; rationale: string }
          | undefined;
        if (!p) continue; // a fiber maps only the properties it determines — absence is allowed
        expect(VOCAB[prop], `${entry.fiber}.${prop} value`).toContain(p.value);
        expect(CONF, `${entry.fiber}.${prop} confidence`).toContain(p.confidence);
        expect(p.rationale.length, `${entry.fiber}.${prop} rationale`).toBeGreaterThan(0);
      }
    }
  });

  it("has unique canonical fiber keys (no silent shadowing)", () => {
    const keys = libraryFiberKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the decision-relevant fiber set (naturals, synthetics, insulation, membranes)", () => {
    const keys = new Set(libraryFiberKeys());
    for (const required of [
      "merino", "wool", "cotton", "hemp", "linen", "silk", "down",
      "polyester", "nylon", "polypropylene", "elastane", "acrylic", "rayon", "lyocell",
      "primaloft", "eptfe",
    ]) {
      expect(keys, `library should cover ${required}`).toContain(required);
    }
  });

  it("aligns canonicalization with the enrichment parser's aliases", () => {
    // The SAME raw names the enrichment extractor produces must resolve here.
    expect(canonFiberKey("merino wool")).toBe("merino");
    expect(canonFiberKey("poly")).toBe("polyester");
    expect(canonFiberKey("polyamide")).toBe("nylon");
    expect(canonFiberKey("spandex")).toBe("elastane");
    expect(canonFiberKey("organic cotton")).toBe("cotton");
    // Descriptor words are stripped just like the parser ("polyester shell" → polyester).
    expect(canonFiberKey("polyester shell")).toBe("polyester");
    expect(canonFiberKey("nylon lining")).toBe("nylon");
  });
});

// ====================================================================================================
// 2. The output envelope is the standard evidence shape, always source:"derived_from_material", and
//    every emitted value validates against the universal-facet Zod schema (so a wire-in can't drift).
// ====================================================================================================
describe("derived output is a valid, source-marked evidence overlay", () => {
  const derivedEnvelope = <T extends z.ZodTypeAny>(value: T) =>
    z.object({
      value,
      confidence: z.enum(["low", "medium", "high"]),
      source: z.literal("derived_from_material"),
      evidence: z.string().min(1),
    });

  it("every present facet carries source:derived_from_material and validates", () => {
    const d = deriveFromComposition(mat([{ fiber: "polyester", pct: 100 }]));
    for (const [, env] of Object.entries(d)) {
      expect(env?.source).toBe("derived_from_material");
    }
    expect(derivedEnvelope(z.enum(L.MOISTURE_MANAGEMENT)).safeParse(d.moisture_management).success).toBe(true);
    expect(derivedEnvelope(z.enum(L.DRY_SPEED)).safeParse(d.dry_speed).success).toBe(true);
    expect(derivedEnvelope(z.enum(L.WARMTH_WHEN_WET)).safeParse(d.warmth_when_wet).success).toBe(true);
  });

  it("never throws on empty / malformed materials and returns {} (nothing fabricated)", () => {
    expect(deriveFromComposition([])).toEqual({});
    expect(deriveFromComposition(mat([]))).toEqual({});
    expect(deriveFromComposition(mat([{ fiber: "   ", pct: 100 }]))).toEqual({});
  });
});

// ====================================================================================================
// 3. CROSS-ARCHETYPE derivations (the generality lesson: >=3 distinct materials, asserting exact
//    value + source + confidence). Each result must fall out of the SAME rule — no per-item casing.
// ====================================================================================================
describe("deriveFromComposition across material archetypes", () => {
  // --- archetype A: merino base — the wet-warmth standout -------------------------------------------
  it("100% merino → wicks, retains-when-wet (HIGH), slow-to-moderate dry; warmth NOT confident", () => {
    const d = deriveFromComposition(mat([{ fiber: "merino wool", pct: 100 }]));

    expect(d.moisture_management?.value).toBe("wicks");
    expect(d.moisture_management?.source).toBe("derived_from_material");

    // The defining merino property: warm-when-wet, asserted with HIGH confidence.
    expect(d.warmth_when_wet?.value).toBe("retains");
    expect(d.warmth_when_wet?.confidence).toBe("high");

    // Dries slowly (cellulosic-like regain) — present, but only medium confidence (construction-dependent).
    expect(d.dry_speed?.value).toBe("slow");
    expect(["low", "medium"]).toContain(d.dry_speed?.confidence);

    // Absolute warmth is a weight/knit question — if asserted at all, it must NOT be confident.
    if (d.warmth) {
      expect(d.warmth.confidence).toBe("low");
      expect(d.warmth.confidence).not.toBe("high");
    }
  });

  // --- archetype B: 100% polyester — wicks, fast, neutral-when-wet ----------------------------------
  it("100% polyester → wicks (HIGH), fast-dry (HIGH), neutral-when-wet (HIGH)", () => {
    const d = deriveFromComposition(mat([{ fiber: "polyester", pct: 100 }]));

    expect(d.moisture_management).toMatchObject({ value: "wicks", confidence: "high", source: "derived_from_material" });
    expect(d.dry_speed).toMatchObject({ value: "fast", confidence: "high" });
    expect(d.warmth_when_wet).toMatchObject({ value: "neutral", confidence: "high" });

    // Polyester fiber alone determines no absolute warmth — must be absent, not guessed.
    expect(d.warmth).toBeUndefined();
  });

  // --- archetype C: hemp/cotton blend — the DESIGN.md example ("cotton kills") ----------------------
  it("55% hemp / 45% cotton → absorbs_holds + collapses-when-wet + slow dry (the DESIGN example)", () => {
    const d = deriveFromComposition(mat([{ fiber: "hemp", pct: 55 }, { fiber: "cotton", pct: 45 }]));

    expect(d.moisture_management?.value).toBe("absorbs_holds");
    expect(d.warmth_when_wet?.value).toBe("collapses");
    expect(d.dry_speed?.value).toBe("slow");
    expect(d.moisture_management?.source).toBe("derived_from_material");

    // Both fibers are cellulosic and AGREE → the blend is internally consistent, so confidence stays high
    // ("near-deterministic from composition"), not penalized for being a blend.
    expect(d.warmth_when_wet?.confidence).toBe("high");
  });

  // --- archetype D: nylon/elastane — minority elastane must NOT flip the behavior -------------------
  it("88% nylon / 12% elastane → derives nylon's behavior; elastane minority is inert", () => {
    const d = deriveFromComposition(mat([{ fiber: "nylon", pct: 88 }, { fiber: "spandex", pct: 12 }]));

    // Nylon's chemistry carries the blend: wicks, fast-dry, neutral-when-wet.
    expect(d.moisture_management?.value).toBe("wicks");
    expect(d.dry_speed?.value).toBe("fast");
    expect(d.warmth_when_wet?.value).toBe("neutral");

    // The minority elastomer is dropped, so nylon's wet-warmth keeps ITS library confidence (high), not a
    // blend-demoted one. The evidence string reflects the renormalized nylon-only basis.
    expect(d.warmth_when_wet?.confidence).toBe("high");
    expect(d.warmth_when_wet?.evidence).toMatch(/nylon 100%/);
    expect(d.warmth_when_wet?.evidence).not.toMatch(/elastane|spandex/);
  });

  // --- archetype E: polypropylene — the fastest-drying common fiber --------------------------------
  it("100% polypropylene → wicks (HIGH) + very_fast dry (HIGH) + retains-when-wet (HIGH)", () => {
    const d = deriveFromComposition(mat([{ fiber: "polypropylene", pct: 100 }]));
    expect(d.moisture_management).toMatchObject({ value: "wicks", confidence: "high" });
    expect(d.dry_speed).toMatchObject({ value: "very_fast", confidence: "high" });
    expect(d.warmth_when_wet).toMatchObject({ value: "retains", confidence: "high" });
  });

  // --- archetype F: down insulation — collapses + slow, no confident absolute warmth ---------------
  it("100% down → collapses-when-wet (HIGH) + slow dry; warmth tendency present but only LOW confidence", () => {
    const d = deriveFromComposition(mat([{ fiber: "down", pct: 100 }], "insulation"));
    expect(d.warmth_when_wet).toMatchObject({ value: "collapses", confidence: "high" });
    expect(d.dry_speed?.value).toBe("slow");
    // Down does carry a warmth TENDENCY (best warmth-for-weight) but absolute warmth is fill-driven →
    // low confidence, never high.
    if (d.warmth) expect(d.warmth.confidence).toBe("low");
    // Down determines no moisture_management on its own (it is a fill, not a wicking face) → absent.
    expect(d.moisture_management).toBeUndefined();
  });

  // --- archetype G: ePTFE membrane — the one place breathability is derivable ----------------------
  it("ePTFE / Gore-Tex membrane → moderate breathability (intrinsic to the laminate)", () => {
    const d = deriveFromComposition(mat([{ fiber: "gore-tex", pct: 100 }], "membrane"));
    expect(d.breathability).toMatchObject({ value: "moderate", source: "derived_from_material" });
    // A membrane states nothing about moisture/dry/wet-warmth as a fiber would → absent.
    expect(d.moisture_management).toBeUndefined();
    expect(d.warmth_when_wet).toBeUndefined();
  });
});

// ====================================================================================================
// 4. PROOF it is library-driven, not hardcoded: an unknown/exotic fiber yields NO derivation.
// ====================================================================================================
describe("unknown fibers stay unknown (library-driven, never hardcoded)", () => {
  it("100% qiviut (real but uncurated) → no derivation at all", () => {
    expect(deriveFromComposition(mat([{ fiber: "qiviut", pct: 100 }]))).toEqual({});
    expect(lookupFiber("qiviut")).toBeNull();
  });

  it("a made-up fiber → no derivation (proves the table, not the test, drives it)", () => {
    expect(deriveFromComposition(mat([{ fiber: "unobtanium", pct: 100 }]))).toEqual({});
    expect(deriveFromComposition(mat([{ fiber: "flarbex 9000", pct: 100 }]))).toEqual({});
  });

  it("a blend of one known + one unknown derives ONLY from the known share when it dominates", () => {
    // 70% polyester (known) / 30% qiviut (unknown): the known fiber commands the determined behavior.
    const d = deriveFromComposition(mat([{ fiber: "polyester", pct: 70 }, { fiber: "qiviut", pct: 30 }]));
    expect(d.dry_speed?.value).toBe("fast");
    expect(d.moisture_management?.value).toBe("wicks");
  });

  it("an unknown-DOMINATED blend does not let a small known minority over-assert", () => {
    // 80% qiviut (unknown) / 20% cotton (known): only 20% of the composition has any opinion, which is
    // below the 'at least half must be determined' floor → no derivation (we don't extrapolate a whole
    // garment's behavior from a fifth of it).
    const d: DerivedFacets = deriveFromComposition(mat([{ fiber: "qiviut", pct: 80 }, { fiber: "cotton", pct: 20 }]));
    expect(d).toEqual({});
  });
});

// ====================================================================================================
// 5. Blend mechanics: % genuinely drives the result, and absolute warmth is never confidently asserted
//    from fiber alone for ANY entry in the library (the load-bearing 'don't fabricate specs' guard).
// ====================================================================================================
describe("composition share drives derivation; absolute warmth is never confident from fiber alone", () => {
  it("flipping the dominant fiber flips the moisture behavior", () => {
    const cottonMajor = deriveFromComposition(mat([{ fiber: "cotton", pct: 70 }, { fiber: "polyester", pct: 30 }]));
    const polyMajor = deriveFromComposition(mat([{ fiber: "polyester", pct: 70 }, { fiber: "cotton", pct: 30 }]));
    expect(cottonMajor.moisture_management?.value).toBe("absorbs_holds");
    expect(polyMajor.moisture_management?.value).toBe("wicks");
  });

  it("a dominant fiber (>=80%) keeps higher confidence than a near-even blend", () => {
    const dominant = deriveFromComposition(mat([{ fiber: "cotton", pct: 85 }, { fiber: "polyester", pct: 15 }]));
    const even = deriveFromComposition(mat([{ fiber: "cotton", pct: 60 }, { fiber: "polyester", pct: 40 }]));
    // cotton's library moisture confidence is 'high'; dominant keeps it, the conflicted blend is demoted.
    expect(dominant.moisture_management?.confidence).toBe("high");
    expect(even.moisture_management?.confidence).toBe("medium");
  });

  it("NO library entry asserts absolute warmth above 'low' confidence (construction, not fiber, sets it)", () => {
    for (const entry of MATERIAL_LIBRARY) {
      if (entry.warmth) {
        expect(entry.warmth.confidence, `${entry.fiber}.warmth`).toBe("low");
      }
    }
  });

  it("no derived absolute warmth is ever emitted above 'low' confidence", () => {
    const cases: Materials[] = [
      mat([{ fiber: "merino wool", pct: 100 }]),
      mat([{ fiber: "down", pct: 100 }], "insulation"),
      mat([{ fiber: "fleece", pct: 100 }]),
      mat([{ fiber: "primaloft", pct: 100 }], "insulation"),
      mat([{ fiber: "wool", pct: 80 }, { fiber: "nylon", pct: 20 }]),
    ];
    for (const c of cases) {
      const d = deriveFromComposition(c);
      if (d.warmth) expect(d.warmth.confidence).toBe("low");
    }
  });
});
