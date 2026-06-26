// ADR-0028 — name-based web-search enrichment. The "Auto-fill from name" path (enrichItem) must overlay
// authoritative manufacturer/retailer identity + composition specs (citation-gated web search) ON TOP of
// the classifier's behavioral inference, so a quick-added item stops coming back all-unknown. Hermetic:
// the classifier AND the web-search enricher are injected, so no API key / network is touched.

import { describe, it, expect } from "vitest";
import { recordOwnership, enrichItem } from "@/server/app-service";
import { unknownBehavioralClassification, type WebSearchResult } from "@/core/enrich";
import type { ExtractedProduct } from "@/core/enrich";

const USER = "00000000-0000-0000-0000-0000000a0028";

// An injected OFFLINE classifier handle that yields an all-unknown behavioral classification — i.e. the
// realistic "quick-added, nothing inferred yet" state we want enrichment to improve.
const unknownClassifier = (name: string) =>
  ({ kind: "resolved" as const, mode: "offline" as const, classify: async () => unknownBehavioralClassification(name) });

// A web-search result CITED to an allowlisted retailer/manufacturer URL (sourceUrl != null is the gate
// app-service checks before overlaying), stating brand + weight.
function citedResult(over: Partial<ExtractedProduct>, sourceUrl: string): WebSearchResult {
  const extracted: ExtractedProduct = {
    name: null, brand: null, sku: null, mpn: null, price_cents: null, price_currency: null,
    weight_grams: null, material_raw: null, fiber_components: [], specs: [], source: "web-search",
    ...over,
  };
  return { extracted, sourceUrl };
}

describe("enrich-by-name (ADR-0028): web-search overlay on the by-name path", () => {
  it("overlays authoritative identity (brand/weight) on top of unknown inference", async () => {
    const name = "ZZ Test Atmos AG 65 Pack 9f3a";
    const item = await recordOwnership(name, USER);

    const updated = await enrichItem(item.id, USER, {
      classifier: unknownClassifier(name),
      webSearch: async () =>
        citedResult({ brand: "Osprey", weight_grams: 2040 }, "https://www.osprey.com/atmos-ag-65"),
    });

    const id = updated!.classification.identity;
    // The web-search facts win over the (unknown) inference — and carry the authoritative source.
    expect(id.brand.value).toBe("Osprey");
    expect(id.brand.source).toBe("manufacturer");
    expect(id.weight_grams.value).toBe(2040);
  });

  it("degrades cleanly when the search has no allowlisted citation (no overlay, no throw)", async () => {
    const name = "ZZ Unknown Obscure Widget 7c12";
    const item = await recordOwnership(name, USER);

    const updated = await enrichItem(item.id, USER, {
      classifier: unknownClassifier(name),
      webSearch: async () => citedResult({ brand: "Whatever" }, null as unknown as string), // sourceUrl null → gate fails
    });

    // No citation → identity stays the honest unknown; the inference-only classification is untouched.
    expect(updated!.classification.identity.brand.value).toBeNull();
  });
});
