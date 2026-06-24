import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseProductHtml, parseComposition } from "@/core/enrich";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/enrich/${name}`, import.meta.url)), "utf8");

describe("parseProductHtml — schema.org Product JSON-LD", () => {
  const extracted = parseProductHtml(fixture("product-jsonld.html"));

  it("extracts name, brand, sku/mpn from a @graph Product", () => {
    expect(extracted.source).toBe("json-ld");
    expect(extracted.name).toBe("Nano Puff® Jacket");
    expect(extracted.brand).toBe("Patagonia");
    expect(extracted.sku).toBe("84212");
    expect(extracted.mpn).toBe("84212-BLK");
  });

  it("extracts price (cents) + currency from offers", () => {
    expect(extracted.price_cents).toBe(23900);
    expect(extracted.price_currency).toBe("USD");
  });

  it("converts a QuantitativeValue weight (337 g via unitCode GRM) to grams", () => {
    expect(extracted.weight_grams).toBe(337);
  });

  it("parses composition into fiber components (the highest-value output)", () => {
    expect(extracted.material_raw).toMatch(/recycled polyester/i);
    const fibers = extracted.fiber_components;
    expect(fibers.length).toBeGreaterThanOrEqual(1);
    const poly = fibers.find((f) => f.fiber === "polyester" && f.pct === 100);
    expect(poly).toBeDefined();
    expect(poly?.recycled).toBe(true);
  });

  it("keeps additionalProperty specs verbatim", () => {
    expect(extracted.specs.some((s) => /insulation/i.test(s.name))).toBe(true);
  });
});

describe("parseProductHtml — OpenGraph-only page", () => {
  const extracted = parseProductHtml(fixture("product-og-only.html"));

  it("falls back to OG/meta when no JSON-LD Product is present", () => {
    expect(extracted.source).toBe("opengraph");
    expect(extracted.name).toBe("Beta AR Jacket");
    expect(extracted.brand).toBe("Arc'teryx");
    expect(extracted.price_cents).toBe(52500);
    expect(extracted.price_currency).toBe("USD");
  });

  it("leaves un-stated fields null (no composition on an OG page)", () => {
    expect(extracted.weight_grams).toBeNull();
    expect(extracted.material_raw).toBeNull();
    expect(extracted.fiber_components).toEqual([]);
  });
});

describe("parseProductHtml — junk / no Product page", () => {
  const extracted = parseProductHtml(fixture("no-product.html"));

  it("returns all-null and never fabricates", () => {
    expect(extracted.source).toBe("none");
    expect(extracted.name).toBeNull();
    expect(extracted.brand).toBeNull();
    expect(extracted.price_cents).toBeNull();
    expect(extracted.weight_grams).toBeNull();
    expect(extracted.material_raw).toBeNull();
    expect(extracted.fiber_components).toEqual([]);
  });
});

describe("parseProductHtml — malicious / malformed page", () => {
  it("NEVER throws on broken JSON, nested scripts, bad entities, junk", () => {
    expect(() => parseProductHtml(fixture("malicious-malformed.html"))).not.toThrow();
  });

  it("does not fabricate a price/weight from un-numeric junk", () => {
    const e = parseProductHtml(fixture("malicious-malformed.html"));
    expect(e.price_cents).toBeNull(); // "not-a-number" / "<><><>" never become a price
    expect(e.weight_grams).toBeNull(); // "heavy" is not a weight
    expect(e.fiber_components).toEqual([]); // "999% unobtanium" is out-of-range, dropped
  });

  it("never throws on arbitrary junk / huge / empty input", () => {
    expect(() => parseProductHtml("")).not.toThrow();
    expect(() => parseProductHtml("<<<<>>>><script type='application/ld+json'>{{{</script>")).not.toThrow();
    expect(() => parseProductHtml("x".repeat(5_000_000))).not.toThrow();
    const big = "<script type=\"application/ld+json\">" + "{".repeat(100000) + "</script>";
    expect(() => parseProductHtml(big)).not.toThrow();
  });
});

describe("parseComposition", () => {
  it("parses a single 100% recycled fiber", () => {
    expect(parseComposition("100% recycled polyester")).toEqual([
      { fiber: "polyester", pct: 100, recycled: true },
    ]);
  });

  it("parses a multi-fiber blend with mixed separators", () => {
    expect(parseComposition("55% hemp, 45% organic cotton")).toEqual([
      { fiber: "hemp", pct: 55, recycled: false },
      { fiber: "cotton", pct: 45, recycled: false },
    ]);
  });

  it("parses a slash-separated blend and canonicalizes aliases", () => {
    expect(parseComposition("60% nylon / 40% spandex")).toEqual([
      { fiber: "nylon", pct: 60, recycled: false },
      { fiber: "elastane", pct: 40, recycled: false },
    ]);
  });

  it("returns [] (does not guess) when no percentage is stated", () => {
    expect(parseComposition("merino wool")).toEqual([]);
  });

  it("drops out-of-range percentages", () => {
    expect(parseComposition("999% unobtanium")).toEqual([]);
  });
});
