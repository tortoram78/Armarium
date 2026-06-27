// ADR-0031 — fuzzy, ranked, multi-field closet search. searchScore is the single source of truth the
// in-memory repo ranks by and the Postgres path mirrors. These lock the behavior that matters to a user:
// typo tolerance, word-order independence, multi-field (brand/model/tags), and relevance ordering.

import { describe, it, expect } from "vitest";
import { searchScore, itemMatchesSearch, trigramSimilarity } from "@/core/inventory";
import { recordOwnership } from "@/server/app-service";
import { getMemoryRepository } from "@/server/services";

describe("searchScore (ADR-0031)", () => {
  it("is typo-tolerant (the headline win): 'patagona' still finds Patagonia", () => {
    const s = searchScore({ name: "Patagonia Nano Puff" }, "patagona");
    expect(s).toBeGreaterThan(0);
    expect(itemMatchesSearch({ name: "Patagonia Nano Puff" }, "patagona")).toBe(true);
  });

  it("ranks an exact/substring hit above a fuzzy typo hit", () => {
    const exact = searchScore({ name: "Patagonia Nano Puff" }, "nano");
    const typo = searchScore({ name: "Patagonia Nano Puff" }, "patagona");
    expect(exact).toBeGreaterThan(typo);
  });

  it("is word-order independent across tokens", () => {
    expect(searchScore({ name: "Osprey Atmos AG 65" }, "atmos osprey")).toBeGreaterThan(0);
  });

  it("matches across brand, model, and user tags — not just name", () => {
    expect(searchScore({ name: "Nano Puff", brand: "Patagonia" }, "patagonia")).toBeGreaterThan(0.5);
    expect(searchScore({ name: "Jacket", model: "Atom LT" }, "atom")).toBeGreaterThan(0.5);
    expect(searchScore({ name: "Sack", tags: ["ultralight"] }, "ultralight")).toBeGreaterThan(0.5);
  });

  it("does not match unrelated queries", () => {
    expect(searchScore({ name: "Two-Person Tent" }, "kayak")).toBe(0);
    expect(itemMatchesSearch({ name: "Two-Person Tent" }, "kayak")).toBe(false);
  });

  it("trigramSimilarity is 1 for equal, ~high for one-typo, low for unrelated", () => {
    expect(trigramSimilarity("patagonia", "patagonia")).toBe(1);
    expect(trigramSimilarity("patagonia", "patagona")).toBeGreaterThan(0.5);
    expect(trigramSimilarity("tent", "kayak")).toBeLessThan(0.3);
  });
});

describe("memory repo ranks search results by relevance", () => {
  it("returns the better match first and tolerates a typo", async () => {
    const U = "00000000-0000-0000-0000-0000000a0031";
    await recordOwnership("Patagonia Nano Puff Hoody", U);
    await recordOwnership("Generic Camp Mug", U);

    const page = await getMemoryRepository().listItemsPage(U, { search: "patagona puff" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]!.name.toLowerCase()).toContain("nano puff");
  });
});
