import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseProductHtml, toManufacturerEvidence } from "@/core/enrich";
import { ItemClassificationSchema } from "@/core/classification";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/enrich/${name}`, import.meta.url)), "utf8");

describe("toManufacturerEvidence — JSON-LD product → validated overlay", () => {
  const enrichment = toManufacturerEvidence(parseProductHtml(fixture("product-jsonld.html")));

  it("emits brand/model/price/weight as manufacturer-sourced hard facts", () => {
    expect(enrichment.identity.brand.value).toBe("Patagonia");
    expect(enrichment.identity.brand.source).toBe("manufacturer");
    expect(enrichment.identity.model.value).toBe("Nano Puff® Jacket");
    expect(enrichment.identity.price_cents.value).toBe(23900);
    expect(enrichment.identity.price_cents.source).toBe("manufacturer");
    expect(enrichment.identity.weight_grams.value).toBe(337);
  });

  it("maps composition into materials[].fiber_components with source:manufacturer", () => {
    expect(enrichment.materials.length).toBe(1);
    const mat = enrichment.materials[0]!;
    expect(mat.source).toBe("manufacturer");
    expect(mat.role).toBe("shell");
    const poly = mat.fiber_components.find((f) => f.fiber === "polyester");
    expect(poly?.pct).toBe(100);
    expect(poly?.recycled).toBe(true);
  });

  it("validates cleanly against the real classification field shapes", () => {
    // The overlay's identity + materials must satisfy the canonical schema when dropped into a full item.
    const full = {
      name: enrichment.identity.model.value ?? "x",
      identity: enrichment.identity,
      materials: enrichment.materials,
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
      multilabel: { layering_role: [], function_purpose: [], body_zone_covered: [], activity_fit: [], conditions_fit: [] },
      groups: {},
      applicable_groups: [],
    };
    expect(ItemClassificationSchema.safeParse(full).success).toBe(true);
  });

  it("reports signal and provenance", () => {
    expect(enrichment.hasSignal).toBe(true);
    expect(enrichment.provenance.source).toBe("manufacturer");
    expect(enrichment.provenance.extractedFrom).toBe("json-ld");
  });
});

describe("toManufacturerEvidence — OG-only product", () => {
  const enrichment = toManufacturerEvidence(parseProductHtml(fixture("product-og-only.html")));

  it("emits stated brand/model/price, leaves weight + materials unknown/empty", () => {
    expect(enrichment.identity.brand.value).toBe("Arc'teryx");
    expect(enrichment.identity.model.value).toBe("Beta AR Jacket");
    expect(enrichment.identity.price_cents.value).toBe(52500);
    expect(enrichment.identity.weight_grams.value).toBeNull();
    expect(enrichment.identity.weight_grams.source).toBe("unknown");
    expect(enrichment.materials).toEqual([]);
  });
});

describe("toManufacturerEvidence — junk page never fabricates", () => {
  const enrichment = toManufacturerEvidence(parseProductHtml(fixture("no-product.html")));

  it("yields all-unknown identity, no materials, no signal", () => {
    expect(enrichment.identity.brand.value).toBeNull();
    expect(enrichment.identity.model.value).toBeNull();
    expect(enrichment.identity.price_cents.value).toBeNull();
    expect(enrichment.identity.weight_grams.value).toBeNull();
    expect(enrichment.materials).toEqual([]);
    expect(enrichment.hasSignal).toBe(false);
  });
});

describe("toManufacturerEvidence — malicious page produces nothing fabricated, never throws", () => {
  it("does not throw and emits no fabricated price/weight/composition", () => {
    let enrichment!: ReturnType<typeof toManufacturerEvidence>;
    expect(() => {
      enrichment = toManufacturerEvidence(parseProductHtml(fixture("malicious-malformed.html")));
    }).not.toThrow();
    expect(enrichment.identity.price_cents.value).toBeNull();
    expect(enrichment.identity.weight_grams.value).toBeNull();
    expect(enrichment.materials).toEqual([]);
  });
});

describe("toManufacturerEvidence — demotion is mechanical", () => {
  it("a raw extracted brand still lands as manufacturer-sourced (source is set by the mapper, not the model)", () => {
    // Sanity: the mapper itself stamps source:"manufacturer"; there is no path for an inferred source
    // to mint a hard fact here. Feed a hand-built extracted object to confirm the boundary.
    const enrichment = toManufacturerEvidence({
      name: "Test Model",
      brand: "Test Brand",
      sku: null,
      mpn: null,
      price_cents: 1000,
      price_currency: "USD",
      weight_grams: 200,
      material_raw: "80% wool, 20% nylon",
      fiber_components: [
        { fiber: "wool", pct: 80, recycled: false },
        { fiber: "nylon", pct: 20, recycled: false },
      ],
      specs: [],
      source: "json-ld",
    });
    expect(enrichment.identity.brand.source).toBe("manufacturer");
    expect(enrichment.materials[0]!.fiber_components.map((f) => f.fiber)).toEqual(["wool", "nylon"]);
  });
});
