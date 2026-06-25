import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { enrichFromUrlToDraft, getItem } from "@/server/app-service";
import { unknownBehavioralClassification } from "@/core/enrich";
import type { Classifier } from "@/server/services";
import type { ItemClassification } from "@/core/classification";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/enrich/${name}`, import.meta.url)), "utf8");

/** A fetcher stub that returns fixture HTML — never touches the network (sandbox has none). */
const okFetcher = (html: string) => async () => ({ ok: true as const, html, finalUrl: "https://x/y" });
const failFetcher = (reason: string) => async () => ({ ok: false as const, reason });

/**
 * A mock classifier that echoes the requested name as an all-unknown-behavioral classification. The
 * overlay then layers the manufacturer facts on top. This lets us assert the merged result without an
 * API key — the live classify path is covered separately in classify.test.ts.
 */
const echoClassifier: Classifier = async ({ name }): Promise<ItemClassification> =>
  unknownBehavioralClassification(name);

/** A classifier that throws like the offline classifier does on an item outside the prototype corpus. */
const throwingClassifier: Classifier = async ({ name }) => {
  throw new Error(`Offline classifier only knows the prototype corpus. Set ANTHROPIC_API_KEY to classify "${name}".`);
};

describe("enrichFromUrlToDraft — real Product page → draft with manufacturer identity + composition", () => {
  it("creates a draft carrying manufacturer brand/model/price/weight + composition", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/nano-puff", {
      fetchHtml: okFetcher(fixture("product-jsonld.html")),
      classify: echoClassifier,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const item = await getItem(result.draftId, userId);
    expect(item).not.toBeNull();
    expect(item!.draft).toBe(true);

    const c = item!.classification;
    expect(c.identity.brand.value).toBe("Patagonia");
    expect(c.identity.brand.source).toBe("manufacturer");
    expect(c.identity.model.value).toBe("Nano Puff® Jacket");
    expect(c.identity.price_cents.value).toBe(23900);
    expect(c.identity.price_cents.source).toBe("manufacturer");
    expect(c.identity.weight_grams.value).toBe(337);

    // Authoritative composition present and manufacturer-sourced.
    expect(c.materials.length).toBe(1);
    expect(c.materials[0]!.source).toBe("manufacturer");
    const poly = c.materials[0]!.fiber_components.find((f) => f.fiber === "polyester");
    expect(poly?.pct).toBe(100);
    expect(poly?.recycled).toBe(true);

    // The draft name is brand + model.
    expect(item!.name).toContain("Patagonia");
    expect(item!.name).toContain("Nano Puff");
  });
});

describe("enrichFromUrlToDraft — fetch failure surfaces the reason and creates NO draft", () => {
  it("returns { ok:false, reason } from the fetcher and persists nothing", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "http://internal/", {
      fetchHtml: failFetcher("url-shape: host not in allowlist"),
      classify: echoClassifier,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("url-shape: host not in allowlist");
  });
});

describe("enrichFromUrlToDraft — DEGRADED classify path never loses authoritative facts", () => {
  it("classifier throws (offline, unknown item) → draft still carries manufacturer identity + composition", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/nano-puff", {
      fetchHtml: okFetcher(fixture("product-jsonld.html")),
      classify: throwingClassifier,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const item = await getItem(result.draftId, userId);
    const c = item!.classification;
    // Manufacturer facts survived the classifier failure.
    expect(c.identity.brand.value).toBe("Patagonia");
    expect(c.identity.price_cents.value).toBe(23900);
    expect(c.materials[0]!.source).toBe("manufacturer");
    // Behavioral facets are honestly unknown — never fabricated by the degraded path.
    expect(c.universal.warmth.value).toBeNull();
    expect(c.universal.warmth.source).toBe("unknown");
  });
});

describe("enrichFromUrlToDraft — page with NO product signal fails honestly, creates NO draft", () => {
  it("no manufacturer signal → { ok:false, reason:'no-signal…' }, no junk 'Item from host' draft", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/x", {
      fetchHtml: okFetcher(fixture("no-product.html")),
      classify: throwingClassifier,
    });
    // The "returned zero fields" symptom: a page with nothing machine-readable must NOT silently produce
    // an all-unknown draft. It fails honestly (ok:false, no draftId) so the action shows an add-by-name
    // hint instead of redirecting the user to a zero-field review page — never reaching addItem.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/^no-signal:/);
  });
});

describe("enrichFromUrlToDraft — residential fallback (ADR-0019: Scrapfly for bot-walled brands)", () => {
  it("direct no-signal (bot wall) → Scrapfly rescue builds a draft from the residential-fetched product", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.rei.com/product/1/x", {
      fetchHtml: okFetcher(fixture("no-product.html")), // direct = a 200 bot-challenge page (no signal)
      fetchScrapfly: okFetcher(fixture("product-jsonld.html")), // residential = the real product page
      classify: throwingClassifier,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = await getItem(result.draftId, userId);
    // The manufacturer identity came from the Scrapfly-fetched page, not the direct bot wall.
    expect(item!.classification.identity.brand.value).toBe("Patagonia");
    expect(item!.classification.identity.price_cents.value).toBe(23900);
  });

  it("does NOT call Scrapfly when the direct fetch already has signal (no wasted credit)", async () => {
    const userId = randomUUID();
    let scrapflyCalled = false;
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/nano-puff", {
      fetchHtml: okFetcher(fixture("product-jsonld.html")), // direct already yields product data
      fetchScrapfly: async () => {
        scrapflyCalled = true;
        return { ok: false as const, reason: "should-not-be-called" };
      },
      classify: echoClassifier,
    });
    expect(result.ok).toBe(true);
    expect(scrapflyCalled).toBe(false);
  });

  it("direct no-signal + Scrapfly ALSO no-signal (the Patagonia case) → honest no-signal, no draft", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/x", {
      fetchHtml: okFetcher(fixture("no-product.html")),
      fetchScrapfly: okFetcher(fixture("no-product.html")), // residential still walled → no signal
      classify: throwingClassifier,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/^no-signal:/);
  });
});

describe("enrichFromUrlToDraft — web-search fallback (ADR-0020: universal, citation-gated)", () => {
  // A web-search hit: the core extractor's already-citation-gated output (source:"web-search", a validated
  // allowlisted sourceUrl). Fed through toManufacturerEvidence in the tier → authoritative manufacturer facts.
  const webSearchHit = (sourceUrl: string) => async () => ({
    extracted: {
      name: "Nano Puff Jacket",
      brand: "Patagonia",
      sku: null,
      mpn: null,
      price_cents: 23900,
      price_currency: "USD",
      weight_grams: 337,
      material_raw: "100% recycled polyester",
      fiber_components: [{ fiber: "polyester", pct: 100, recycled: true }],
      specs: [],
      source: "web-search" as const,
    },
    sourceUrl,
  });
  // A web-search miss: no allowlisted citation qualified (the core citation gate returned null).
  const webSearchMiss = async () => ({
    extracted: {
      name: null, brand: null, sku: null, mpn: null, price_cents: null, price_currency: null,
      weight_grams: null, material_raw: null, fiber_components: [], specs: [], source: "none" as const,
    },
    sourceUrl: null,
  });

  it("direct no-signal → web search rescues with citation-backed manufacturer specs", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/x", {
      fetchHtml: okFetcher(fixture("no-product.html")), // direct = bot wall (no signal)
      webSearch: webSearchHit("https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html"),
      classify: throwingClassifier, // degraded classify — manufacturer facts must still survive
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = await getItem(result.draftId, userId);
    expect(item!.classification.identity.brand.value).toBe("Patagonia");
    expect(item!.classification.identity.brand.source).toBe("manufacturer"); // citation-gated authority
    expect(item!.classification.identity.weight_grams.value).toBe(337);
    expect(item!.classification.materials[0]?.source).toBe("manufacturer");
  });

  it("rescues even when the DIRECT fetch FAILED (403/walled) — the Patagonia case", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/x", {
      fetchHtml: failFetcher("http: 403"), // Akamai 403 — direct fetch never returns HTML
      webSearch: webSearchHit("https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html"),
      classify: throwingClassifier,
    });
    expect(result.ok).toBe(true); // web search rescued a failed fetch
    if (!result.ok) return;
    const item = await getItem(result.draftId, userId);
    expect(item!.classification.identity.price_cents.value).toBe(23900);
  });

  it("direct no-signal + web-search finds no allowlisted citation → honest no-signal, no draft", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/x", {
      fetchHtml: okFetcher(fixture("no-product.html")),
      webSearch: webSearchMiss,
      classify: throwingClassifier,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/^no-signal:/);
  });

  it("does NOT call web search when the direct fetch already has signal (no wasted API cost)", async () => {
    const userId = randomUUID();
    let searched = false;
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/nano-puff", {
      fetchHtml: okFetcher(fixture("product-jsonld.html")), // direct already yields product data
      webSearch: async () => {
        searched = true;
        return { extracted: (await webSearchMiss()).extracted, sourceUrl: null };
      },
      classify: echoClassifier,
    });
    expect(result.ok).toBe(true);
    expect(searched).toBe(false);
  });

  it("does NOT web-search a url-shape rejection (out-of-scope host) — surfaces the shape reason", async () => {
    const userId = randomUUID();
    let searched = false;
    const result = await enrichFromUrlToDraft(userId, "https://evil.example.com/x", {
      fetchHtml: failFetcher("url-shape: host not on manufacturer allowlist: evil.example.com"),
      webSearch: async () => {
        searched = true;
        return webSearchHit("https://www.patagonia.com/x")();
      },
      classify: throwingClassifier,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/^url-shape:/);
    expect(searched).toBe(false);
  });
});
