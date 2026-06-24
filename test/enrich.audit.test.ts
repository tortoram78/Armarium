// Regression tests for the manufacturer-enrichment security audit — Findings 2, 3, 4, 5.
// Each uses the EXACT adversarial input from the audit so the bug cannot silently recur.

import { describe, it, expect } from "vitest";
import { parseProductHtml, toManufacturerEvidence } from "@/core/enrich";
import { ItemClassificationSchema } from "@/core/classification";

/** Build a JSON-LD product page whose offer carries the given (possibly hostile) price string. */
function pageWithPrice(price: string): string {
  return `<!DOCTYPE html><html><head>
    <script type="application/ld+json">
    { "@context":"https://schema.org/","@type":"Product","name":"Test",
      "brand":{"@type":"Brand","name":"TestCo"},
      "offers":{"@type":"Offer","price":"${price}","priceCurrency":"USD"} }
    </script></head><body></body></html>`;
}

// ── Finding 3 (MEDIUM): toCents must never fabricate a price from negative/garbage input ──────────
describe("toCents — no fabricated price from negative/garbage (audit Finding 3)", () => {
  it("'-50' yields a null price (the `-` is rejected, not silently dropped to +5000 cents)", () => {
    expect(parseProductHtml(pageWithPrice("-50")).price_cents).toBeNull();
  });

  it("'1.2.3.4' (multi-dot) yields a null price (not 120)", () => {
    expect(parseProductHtml(pageWithPrice("1.2.3.4")).price_cents).toBeNull();
  });

  it("'99999999999999999999' (20-digit, precision-lost) yields a null price", () => {
    expect(parseProductHtml(pageWithPrice("99999999999999999999")).price_cents).toBeNull();
  });

  it("clean amounts still parse: '$189.00' / '189' / numeric 189 → 18900", () => {
    expect(parseProductHtml(pageWithPrice("$189.00")).price_cents).toBe(18_900);
    expect(parseProductHtml(pageWithPrice("189")).price_cents).toBe(18_900);
    // A numeric (non-string) price in JSON-LD also parses to cents.
    const numericPage = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">
      { "@context":"https://schema.org/","@type":"Product","name":"T",
        "offers":{"@type":"Offer","price":189,"priceCurrency":"USD"} }
      </script></head><body></body></html>`;
    expect(parseProductHtml(numericPage).price_cents).toBe(18_900);
  });
});

// ── Finding 2 (MEDIUM): toManufacturerEvidence must NEVER throw on a malformed ExtractedProduct ───
describe("toManufacturerEvidence — never throws on a malformed product (audit Finding 2)", () => {
  it("a product whose brand/name are objects with non-callable toString does not throw; identity unknown", () => {
    let enrichment!: ReturnType<typeof toManufacturerEvidence>;
    expect(() => {
      // The exact adversarial shape: `{toString:"x"}` triggers "Cannot convert object to primitive value"
      // on String() coercion / template interpolation, the bug the fix eliminates.
      enrichment = toManufacturerEvidence({ name: { toString: "x" }, brand: { toString: "y" } } as never);
    }).not.toThrow();
    expect(enrichment.identity.brand.value).toBeNull();
    expect(enrichment.identity.brand.source).toBe("unknown");
    expect(enrichment.identity.model.value).toBeNull();
    expect(enrichment.identity.model.source).toBe("unknown");
    expect(enrichment.materials).toEqual([]);
    expect(enrichment.hasSignal).toBe(false);
  });

  it("malformed numeric/material fields collapse to unknown without fabricating values", () => {
    let enrichment!: ReturnType<typeof toManufacturerEvidence>;
    expect(() => {
      enrichment = toManufacturerEvidence({
        name: { toString: "x" },
        brand: { toString: "y" },
        price_cents: { toString: "z" },
        weight_grams: { valueOf: "q" },
        material_raw: { toString: "m" },
        fiber_components: [null, { fiber: { toString: "f" }, pct: 50, recycled: false }],
        source: "json-ld",
      } as never);
    }).not.toThrow();
    expect(enrichment.identity.price_cents.value).toBeNull();
    expect(enrichment.identity.weight_grams.value).toBeNull();
    expect(enrichment.materials).toEqual([]);
  });
});

// ── Finding 4 (LOW): provenance.extractedFrom must not launder an arbitrary string into the audit ──
describe("toManufacturerEvidence — provenance.extractedFrom is validated (audit Finding 4)", () => {
  it("a forged source 'authoritative-verified-direct' is rejected → extractedFrom 'none'", () => {
    const enrichment = toManufacturerEvidence({
      name: "Some Jacket",
      brand: "SomeBrand",
      sku: null,
      mpn: null,
      price_cents: null,
      price_currency: null,
      weight_grams: null,
      material_raw: null,
      fiber_components: [],
      specs: [],
      source: "authoritative-verified-direct",
    } as never);
    expect(enrichment.provenance.extractedFrom).toBe("none");
  });

  it("a forged source 'user' is also rejected → extractedFrom 'none'", () => {
    const enrichment = toManufacturerEvidence({
      name: "X",
      brand: "Y",
      sku: null,
      mpn: null,
      price_cents: null,
      price_currency: null,
      weight_grams: null,
      material_raw: null,
      fiber_components: [],
      specs: [],
      source: "user",
    } as never);
    expect(enrichment.provenance.extractedFrom).toBe("none");
  });

  it("legitimate origins pass through unchanged", () => {
    const mk = (source: "json-ld" | "opengraph" | "none") =>
      toManufacturerEvidence({
        name: "X", brand: "Y", sku: null, mpn: null, price_cents: null,
        price_currency: null, weight_grams: null, material_raw: null,
        fiber_components: [], specs: [], source,
      }).provenance.extractedFrom;
    expect(mk("json-ld")).toBe("json-ld");
    expect(mk("opengraph")).toBe("opengraph");
    expect(mk("none")).toBe("none");
  });
});

// ── Finding 5 (LOW): identity hard facts must reject absurd magnitudes / impossible 0 g ──────────
describe("classification identity — sane magnitude bounds on price/weight (audit Finding 5)", () => {
  /** Build a full classification with the given identity price/weight as manufacturer hard facts. */
  const withIdentity = (priceCents: number | null, weightGrams: number | null) => ({
    name: "Item",
    identity: {
      brand: { value: null, source: "unknown" },
      model: { value: null, source: "unknown" },
      price_cents:
        priceCents == null
          ? { value: null, source: "unknown" }
          : { value: priceCents, source: "manufacturer", evidence: "stated" },
      weight_grams:
        weightGrams == null
          ? { value: null, source: "unknown" }
          : { value: weightGrams, source: "manufacturer", evidence: "stated" },
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
    multilabel: { layering_role: [], function_purpose: [], body_zone_covered: [], activity_fit: [], conditions_fit: [] },
    groups: {},
    applicable_groups: [],
  });

  it("a ~$1T price (1_000_000_000_000 cents) fails validation (out of range)", () => {
    expect(ItemClassificationSchema.safeParse(withIdentity(1_000_000_000_000, null)).success).toBe(false);
  });

  it("a ~100-tonne weight (100_000_000 g) fails validation (out of range)", () => {
    expect(ItemClassificationSchema.safeParse(withIdentity(null, 100_000_000)).success).toBe(false);
  });

  it("a physically-impossible 0 g weight fails validation (positive floor)", () => {
    expect(ItemClassificationSchema.safeParse(withIdentity(null, 0)).success).toBe(false);
  });

  it("normal gear magnitudes validate: $189.00 (18900¢) and 312 g", () => {
    const res = ItemClassificationSchema.safeParse(withIdentity(18_900, 312));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.identity.price_cents.value).toBe(18_900);
      expect(res.data.identity.weight_grams.value).toBe(312);
      expect(res.data.identity.weight_grams.source).toBe("manufacturer");
    }
  });

  it("an expensive-but-real $1,000 price (100000¢) and a heavy 30 kg pack still validate", () => {
    expect(ItemClassificationSchema.safeParse(withIdentity(100_000, 30_000)).success).toBe(true);
  });
});
