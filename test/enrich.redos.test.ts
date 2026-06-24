// Regression tests for the manufacturer-enrichment security audit — Finding 1 (HIGH, ReDoS).
//
// parseProductHtml documents a "never throws / responsive on hostile HTML" guarantee. Before the fix,
// the backtracking JSON-LD `<script ...>` regex (and the meta-tag scan) blew up to O(n²) on a flood of
// unterminated `<script `/`<meta ` opens — 400 KB hung ~18 s. The non-backtracking indexOf tokenizers
// must return FAST (we assert < 250 ms of elapsed wall-clock) and never throw, on the exact adversarial
// inputs from the audit. A per-test timeout is a hard backstop so a regression cannot hang the suite.

import { describe, it, expect } from "vitest";
import { parseProductHtml } from "@/core/enrich";

const BUDGET_MS = 250;

/** Run `fn`, returning the elapsed wall-clock ms (and logging it for audit evidence). */
function elapsed(fn: () => void, label = ""): number {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  if (label && process.env.REDOS_TRACE) {
    // eslint-disable-next-line no-console
    console.error(`[redos-timing] ${label}: ${ms.toFixed(1)} ms`);
  }
  return ms;
}

describe("parseProductHtml — ReDoS hardening (audit Finding 1)", () => {
  it("a 400 KB `<script `-flood (no closing >) returns fast and does not throw", () => {
    const payload = "<script ".repeat(50_000); // 400 KB, the confirmed-hang input
    let out!: ReturnType<typeof parseProductHtml>;
    const ms = elapsed(() => {
      expect(() => {
        out = parseProductHtml(payload);
      }).not.toThrow();
    }, "script-flood 50k (400KB)");
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(out.source).toBe("none"); // no real product in junk
  }, 5_000);

  it("the `<script\\t`-flood variant (tab after the tag name) is also fast", () => {
    const payload = "<script\t".repeat(50_000);
    let out!: ReturnType<typeof parseProductHtml>;
    const ms = elapsed(() => {
      expect(() => {
        out = parseProductHtml(payload);
      }).not.toThrow();
    }, "script-flood\\t 50k");
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(out.source).toBe("none");
  }, 5_000);

  it("a `<script `-flood EXCEEDING MAX_HTML (so the 4 MB slice removes any closing tag) is fast", () => {
    // 600k opens ≈ 4.8 MB; the parser slices to ~4 MB, which guarantees no `</script>` survives — the
    // precise scenario the audit flagged (the MAX_HTML slice can remove the closing tag and trigger the
    // old hang). Must still be fast and not throw.
    const payload = "<script ".repeat(600_000);
    let out!: ReturnType<typeof parseProductHtml>;
    const ms = elapsed(() => {
      expect(() => {
        out = parseProductHtml(payload);
      }).not.toThrow();
    }, "script-flood 600k (>MAX_HTML 4MB)");
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(out.source).toBe("none");
  }, 5_000);

  it("a 3 MB `<meta `-flood (no closing >) is fast and does not throw", () => {
    const payload = "<meta ".repeat(500_000); // ~3 MB, the audit's meta-scan flood
    let out!: ReturnType<typeof parseProductHtml>;
    const ms = elapsed(() => {
      expect(() => {
        out = parseProductHtml(payload);
      }).not.toThrow();
    }, "meta-flood 500k (3MB)");
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(out.source).toBe("none");
  }, 5_000);

  it("parseProductHtml('<<<<>>>>...') and a 5 MB junk blob stay fast and throw nothing", () => {
    const ms = elapsed(() => {
      expect(() => parseProductHtml("<<<<>>>>".repeat(100_000))).not.toThrow();
      expect(() => parseProductHtml("x".repeat(5_000_000))).not.toThrow();
    });
    expect(ms).toBeLessThan(BUDGET_MS * 4); // two large inputs back-to-back
  }, 5_000);

  it("a NORMAL JSON-LD product page still parses correctly (no regression from the rewrite)", () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">
      { "@context":"https://schema.org/","@type":"Product",
        "name":"Nano Puff Jacket","brand":{"@type":"Brand","name":"Patagonia"},
        "sku":"84212",
        "material":"100% recycled polyester",
        "weight":{"@type":"QuantitativeValue","value":337,"unitCode":"GRM"},
        "offers":{"@type":"Offer","price":"239.00","priceCurrency":"USD"} }
      </script></head><body></body></html>`;
    const out = parseProductHtml(html);
    expect(out.source).toBe("json-ld");
    expect(out.name).toBe("Nano Puff Jacket");
    expect(out.brand).toBe("Patagonia");
    expect(out.sku).toBe("84212");
    expect(out.price_cents).toBe(23900);
    expect(out.weight_grams).toBe(337);
    expect(out.fiber_components.find((f) => f.fiber === "polyester")?.pct).toBe(100);
  });

  it("a NORMAL multi-meta OpenGraph page still parses (meta tokenizer regression guard)", () => {
    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8" />
      <meta property="og:type" content="product" />
      <meta property="og:title" content="Beta AR Jacket" />
      <meta property="og:brand" content="Arc'teryx" />
      <meta property="product:price:amount" content="525.00" />
      <meta property="product:price:currency" content="USD" />
      </head><body></body></html>`;
    const out = parseProductHtml(html);
    expect(out.source).toBe("opengraph");
    expect(out.name).toBe("Beta AR Jacket");
    expect(out.brand).toBe("Arc'teryx");
    expect(out.price_cents).toBe(52_500);
  });
});
