import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { resolveBehavioralFacets } from "@/core/resolve";
import { deriveFromComposition } from "@/core/materials";
import { parseClassification, type ItemClassification, type UniversalFacets } from "@/core/classification";
import { enrichFromUrlToDraft, getItem } from "@/server/app-service";
import { unknownBehavioralClassification } from "@/core/enrich";
import type { Classifier } from "@/server/services";

// ----------------------------------------------------------------------------------------------------
// Builders: a full, schema-VALID LLM classification with controllable universal facets + materials.
// We round-trip through parseClassification so every fixture is exactly what the pipeline would persist.
// ----------------------------------------------------------------------------------------------------
type Materials = ItemClassification["materials"];
type Conf = "low" | "medium" | "high";
type SoftSrc = "manufacturer" | "user" | "inferred" | "derived_from_material";

const us = { value: null, confidence: "unknown", source: "unknown" } as const;
const uh = { value: null, source: "unknown" } as const;
const s = <T>(value: T, confidence: Conf, source: SoftSrc, evidence: string) => ({ value, confidence, source, evidence });

const material = (fibers: { fiber: string; pct: number | null }[], source: "manufacturer" | "unknown" = "unknown"): Materials => [
  {
    role: "shell",
    name: null,
    fiber_components: fibers.map((f) => ({ fiber: f.fiber, pct: f.pct })),
    construction_type: null,
    source,
    evidence: "test composition",
  },
];

function llmClassification(opts: {
  name: string;
  universal: Partial<UniversalFacets>;
  materials: Materials;
}): ItemClassification {
  return parseClassification({
    name: opts.name,
    identity: { brand: uh, model: uh, price_cents: uh, weight_grams: uh },
    materials: opts.materials,
    treatments: [],
    universal: {
      waterproofness: us, wind_resistance: us, breathability: us, moisture_management: us,
      dry_speed: us, warmth_when_wet: us, warmth: us, packability: us, technical_vs_lifestyle: us,
      upf: uh,
      ...opts.universal,
    },
    multilabel: { layering_role: [], function_purpose: [], body_zone_covered: [], activity_fit: [], conditions_fit: [] },
    groups: {},
    applicable_groups: [],
  });
}

/** The pipeline's derive→resolve step, exactly as app-service applies it. */
const resolved = (c: ItemClassification) => resolveBehavioralFacets(c, deriveFromComposition(c.materials));

// ====================================================================================================
// 1. HEADLINE WIN: cotton the LLM guessed as wicks/fast → derivation corrects to absorbs_holds/slow.
// ====================================================================================================
describe("derivation corrects an LLM guess for a hydrophilic fiber (the headline win)", () => {
  it("100% cotton: LLM guessed wicks/fast → resolved absorbs_holds/slow, source=derived_from_material", () => {
    const before = llmClassification({
      name: "Some Cotton Tee",
      materials: material([{ fiber: "cotton", pct: 100 }]),
      universal: {
        // The LLM got it WRONG — it thought a cotton tee wicks and dries fast.
        moisture_management: s("wicks", "medium", "inferred", "looks like an athletic tee"),
        dry_speed: s("fast", "medium", "inferred", "assumed synthetic"),
        warmth_when_wet: s("neutral", "low", "inferred", "guess"),
      },
    });

    // BEFORE: the LLM's inference.
    expect(before.universal.moisture_management).toMatchObject({ value: "wicks", source: "inferred" });
    expect(before.universal.dry_speed).toMatchObject({ value: "fast", source: "inferred" });

    const after = resolved(before);

    // AFTER: chemistry corrects it — cotton absorbs/holds and dries slowly, now derived-sourced.
    expect(after.universal.moisture_management).toMatchObject({ value: "absorbs_holds", source: "derived_from_material" });
    expect(after.universal.dry_speed).toMatchObject({ value: "slow", source: "derived_from_material" });
    expect(after.universal.warmth_when_wet).toMatchObject({ value: "collapses", source: "derived_from_material" });

    // Auditable: the winner's evidence retains the overridden LLM guess.
    expect(after.universal.moisture_management.evidence).toContain("won over");
    expect(after.universal.moisture_management.evidence).toContain("wicks");

    // The result is still a schema-valid classification (the persisted shape is unchanged).
    expect(() => parseClassification(after)).not.toThrow();
  });
});

// ====================================================================================================
// 2. AGREEMENT: a polyester item where LLM + derivation agree → value stable, derived source wins.
// ====================================================================================================
describe("LLM + derivation agree (polyester) → value stable, provenance reflects the win", () => {
  it("100% polyester: agreed value 'wicks' stays; source becomes derived_from_material (stronger)", () => {
    const before = llmClassification({
      name: "Polyester Base Layer",
      materials: material([{ fiber: "polyester", pct: 100 }]),
      universal: {
        moisture_management: s("wicks", "high", "inferred", "synthetic base layer"),
        dry_speed: s("fast", "high", "inferred", "synthetic"),
        warmth_when_wet: s("neutral", "medium", "inferred", "thin synthetic"),
      },
    });
    const after = resolved(before);

    // Value unchanged (both agree); precedence promotes the provenance from inferred → derived.
    expect(after.universal.moisture_management).toMatchObject({ value: "wicks", source: "derived_from_material" });
    expect(after.universal.dry_speed).toMatchObject({ value: "fast", source: "derived_from_material" });
    expect(after.universal.warmth_when_wet).toMatchObject({ value: "neutral", source: "derived_from_material" });
  });
});

// ====================================================================================================
// 3. MANUFACTURER-STATED COMPOSITION → behavioral facets derive from it (compose with the overlay).
// ====================================================================================================
describe("manufacturer-stated composition drives the derivation", () => {
  it("manufacturer 100% merino composition: wet-warmth derived as 'retains' (high) over an LLM miss", () => {
    const before = llmClassification({
      name: "Merino Hoody",
      // Composition is authoritative (source:manufacturer) — exactly what applyManufacturerOverlay sets.
      materials: material([{ fiber: "merino wool", pct: 100 }], "manufacturer"),
      universal: {
        // The LLM wrongly thought a wool hoody loses warmth when wet.
        warmth_when_wet: s("collapses", "medium", "inferred", "assumed it behaves like cotton"),
        moisture_management: s("absorbs_holds", "low", "inferred", "wrong guess"),
      },
    });
    const after = resolved(before);

    // Merino's defining property is corrected in: retains warmth when wet, high confidence, derived.
    expect(after.universal.warmth_when_wet).toMatchObject({ value: "retains", confidence: "high", source: "derived_from_material" });
    expect(after.universal.moisture_management).toMatchObject({ value: "wicks", source: "derived_from_material" });
  });
});

// ====================================================================================================
// 4. UNKNOWN FIBER: derivation has no opinion → the LLM inference is untouched.
// ====================================================================================================
describe("unknown fiber → derivation defers entirely; the LLM's facets stand", () => {
  it("100% qiviut (uncurated): every behavioral facet keeps the LLM's value AND inferred source", () => {
    const before = llmClassification({
      name: "Qiviut Sweater",
      materials: material([{ fiber: "qiviut", pct: 100 }]),
      universal: {
        moisture_management: s("wicks", "medium", "inferred", "guess"),
        dry_speed: s("moderate", "low", "inferred", "guess"),
        warmth: s("high", "high", "inferred", "luxury warmth fiber"),
      },
    });
    const after = resolved(before);

    // No derivation happened → identical facets, identical provenance (still inferred).
    expect(after.universal.moisture_management).toMatchObject({ value: "wicks", source: "inferred" });
    expect(after.universal.dry_speed).toMatchObject({ value: "moderate", source: "inferred" });
    expect(after.universal.warmth).toMatchObject({ value: "high", source: "inferred" });
    // resolveBehavioralFacets returns the SAME object when nothing is derivable.
    expect(after).toBe(before);
  });
});

// ====================================================================================================
// 5. THE WARMTH CASE: a LOW-confidence derived warmth must NOT override a higher-confidence inferred
//    warmth — it defers. And it FILLS warmth when the LLM had none.
// ====================================================================================================
describe("low-confidence derived warmth defers to a stronger inference (per the policy)", () => {
  it("merino: derived warmth (moderate, LOW) does NOT clobber an inferred warmth (high)", () => {
    const before = llmClassification({
      name: "Heavy Merino Expedition Top",
      materials: material([{ fiber: "merino wool", pct: 100 }]),
      universal: {
        // A heavyweight expedition top: the LLM (seeing the weight) is HIGH-confidence it's warm.
        warmth: s("high", "high", "inferred", "320 g/m^2 expedition weight"),
      },
    });

    // Sanity: merino's derived warmth is exactly the low-confidence 'moderate' the policy must defer to.
    const d = deriveFromComposition(before.materials);
    expect(d.warmth).toMatchObject({ value: "moderate", confidence: "low" });

    const after = resolved(before);

    // The stronger inference WINS — derived warmth defers (does not downgrade a confident 'high' to 'moderate').
    expect(after.universal.warmth).toMatchObject({ value: "high", confidence: "high", source: "inferred" });
  });

  it("merino: derived warmth FILLS an unknown warmth (no competing inference)", () => {
    const before = llmClassification({
      name: "Merino Top (warmth unstated)",
      materials: material([{ fiber: "merino wool", pct: 100 }]),
      universal: {}, // warmth left unknown by the LLM
    });
    expect(before.universal.warmth).toMatchObject({ value: null, source: "unknown" });

    const after = resolved(before);
    // Nothing competed → the low-confidence derived warmth fills the gap (better than unknown).
    expect(after.universal.warmth).toMatchObject({ value: "moderate", confidence: "low", source: "derived_from_material" });
  });

  it("merino: derived warmth DOES correct an equally-low inferred warmth (precedence breaks the tie)", () => {
    const before = llmClassification({
      name: "Merino Top (low-conf warmth guess)",
      materials: material([{ fiber: "merino wool", pct: 100 }]),
      universal: { warmth: s("minimal", "low", "inferred", "thin-looking") },
    });
    const after = resolved(before);
    // Equal confidence (low vs low) → higher-precedence derived wins.
    expect(after.universal.warmth).toMatchObject({ value: "moderate", source: "derived_from_material" });
  });
});

// ====================================================================================================
// 6. NON-DERIVED facets are never touched (waterproofness/wind/packability/tech are construction/design).
// ====================================================================================================
describe("facets the derivation never asserts are left exactly as the LLM had them", () => {
  it("cotton item: waterproofness / wind_resistance / packability / technical_vs_lifestyle untouched", () => {
    const before = llmClassification({
      name: "Cotton Shirt",
      materials: material([{ fiber: "cotton", pct: 100 }]),
      universal: {
        waterproofness: s("none", "high", "inferred", "untreated knit"),
        wind_resistance: s("none", "medium", "inferred", "open knit"),
        packability: s("moderate", "low", "inferred", "midweight"),
        technical_vs_lifestyle: s("lifestyle", "high", "inferred", "casual cotton"),
        moisture_management: s("wicks", "medium", "inferred", "wrong"),
      },
    });
    const after = resolved(before);

    // Behavioral facets the library covers were resolved (moisture corrected)…
    expect(after.universal.moisture_management.value).toBe("absorbs_holds");
    // …but construction/design facets are byte-identical to the LLM's.
    expect(after.universal.waterproofness).toEqual(before.universal.waterproofness);
    expect(after.universal.wind_resistance).toEqual(before.universal.wind_resistance);
    expect(after.universal.packability).toEqual(before.universal.packability);
    expect(after.universal.technical_vs_lifestyle).toEqual(before.universal.technical_vs_lifestyle);
  });
});

// ====================================================================================================
// 7. PIPELINE INTEGRATION: the enrich→draft path applies derive→resolve end to end, offline.
//    (A manufacturer composition + the degraded classifier still yields chemistry-derived behavior.)
// ====================================================================================================
describe("enrichFromUrlToDraft wires derive→resolve into the persisted draft", () => {
  // A fetcher returning a hand-built page is unnecessary here: we inject a classifier + a fixture via
  // the enrichment path's seams. We use a fetch stub that yields a JSON-LD page with a cotton composition.
  const cottonPage = `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Field Tee",
      brand: { name: "TestCo" },
      material: "100% cotton",
      offers: { price: "45.00", priceCurrency: "USD" },
    })}</script></head><body>Field Tee</body></html>`;

  const okFetcher = (html: string) => async () => ({ ok: true as const, html, finalUrl: "https://x/y" });

  // The LLM guesses a cotton tee wicks + dries fast (a realistic miss the derivation must correct).
  const wrongGuessClassifier: Classifier = async ({ name }): Promise<ItemClassification> => {
    const base = unknownBehavioralClassification(name);
    return {
      ...base,
      universal: {
        ...base.universal,
        moisture_management: s("wicks", "medium", "inferred", "assumed performance tee"),
        dry_speed: s("fast", "medium", "inferred", "assumed synthetic"),
      },
    };
  };

  it("manufacturer cotton composition + an LLM miss → the persisted draft is CORRECTED by derivation", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/field-tee", {
      fetchHtml: okFetcher(cottonPage),
      classify: wrongGuessClassifier,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const item = await getItem(result.draftId, userId);
    expect(item).not.toBeNull();
    const c = item!.classification;

    // The manufacturer composition survived (cotton, source:manufacturer)…
    expect(c.materials[0]!.source).toBe("manufacturer");
    expect(c.materials[0]!.fiber_components.some((f) => f.fiber === "cotton")).toBe(true);

    // …and the behavioral facets were DERIVED from it, overriding the LLM's wrong guess.
    expect(c.universal.moisture_management).toMatchObject({ value: "absorbs_holds", source: "derived_from_material" });
    expect(c.universal.dry_speed).toMatchObject({ value: "slow", source: "derived_from_material" });
    expect(c.universal.warmth_when_wet).toMatchObject({ value: "collapses", source: "derived_from_material" });
  });

  it("DEGRADED path: manufacturer cotton + throwing classifier → behavior still derived from composition", async () => {
    const userId = randomUUID();
    const throwingClassifier: Classifier = async ({ name }) => {
      throw new Error(`offline, no key for "${name}"`);
    };
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/field-tee", {
      fetchHtml: okFetcher(cottonPage),
      classify: throwingClassifier,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const c = (await getItem(result.draftId, userId))!.classification;
    // Even with NO classifier, the all-unknown scaffold + manufacturer cotton → chemistry-derived behavior.
    expect(c.universal.moisture_management).toMatchObject({ value: "absorbs_holds", source: "derived_from_material" });
    expect(c.universal.dry_speed).toMatchObject({ value: "slow", source: "derived_from_material" });
    // A non-derivable facet stays honestly unknown (never fabricated).
    expect(c.universal.waterproofness.value).toBeNull();
  });
});

// ====================================================================================================
// 8. A future manufacturer/user BEHAVIORAL claim would win by precedence — the assembly is ready.
//    (We can't yet source a behavioral fact from the manufacturer overlay, but the resolver path that
//    the behavioral resolver uses already honors it: an authoritative facet is never overridden.)
// ====================================================================================================
describe("an authoritative behavioral facet is never overridden by derivation", () => {
  it("a user-sourced moisture_management beats the derived value (authoritative wins)", () => {
    const before = llmClassification({
      name: "User-corrected cotton tee",
      materials: material([{ fiber: "cotton", pct: 100 }]),
      universal: {
        // Simulate a prior user correction already stored on the facet.
        moisture_management: s("neutral", "high", "user", "owner washed + measured"),
      },
    });
    const after = resolved(before);
    // Derivation would say absorbs_holds, but the user's stated fact is authoritative → it stands.
    expect(after.universal.moisture_management).toMatchObject({ value: "neutral", source: "user" });
  });
});
