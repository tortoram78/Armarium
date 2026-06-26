// Unit tests for src/core/dedupe.ts
// Covers: normalizeItemName, isLikelyDuplicate, findDuplicateIn — all cross-archetype.

import { describe, it, expect } from "vitest";
import { normalizeItemName, isLikelyDuplicate, findDuplicateIn, type DedupeFields } from "@/core/dedupe";

// ----------------------------------------------------------------------------------------------------
// normalizeItemName
// ----------------------------------------------------------------------------------------------------

describe("normalizeItemName", () => {
  it("lowercases and trims", () => {
    expect(normalizeItemName("  Hello World  ")).toBe("hello world");
  });

  it("collapses whitespace", () => {
    expect(normalizeItemName("Nano  Puff   Jacket")).toBe("nano puff jacket");
  });

  it("strips punctuation (apostrophes, hyphens, dots)", () => {
    expect(normalizeItemName("Arc'teryx")).toBe("arcteryx");
    expect(normalizeItemName("Gore-Tex")).toBe("goretex");
    expect(normalizeItemName("U.S. Army")).toBe("us army");
  });

  it("collapses whitespace gaps left after stripping punctuation", () => {
    // "Blue - Jacket" → "blue  jacket" after strip → "blue jacket" after collapse
    expect(normalizeItemName("Blue - Jacket")).toBe("blue jacket");
  });

  it("leaves plain alphanumeric strings unchanged (besides lowercasing)", () => {
    expect(normalizeItemName("Patagonia Nano Puff")).toBe("patagonia nano puff");
  });
});

// ----------------------------------------------------------------------------------------------------
// isLikelyDuplicate — clause 1: identical normalized names
// ----------------------------------------------------------------------------------------------------

describe("isLikelyDuplicate — exact name match", () => {
  it("returns true for identical names (case-insensitive)", () => {
    const a: DedupeFields = { name: "Patagonia Nano Puff Jacket" };
    const b: DedupeFields = { name: "Patagonia Nano Puff Jacket" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns true when names differ only by case", () => {
    const a: DedupeFields = { name: "BLACK DIAMOND CAMELOT 0.5" };
    const b: DedupeFields = { name: "black diamond camelot 0.5" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns true when names differ only by punctuation (Arc'teryx vs Arcteryx)", () => {
    const a: DedupeFields = { name: "Arc'teryx Beta AR" };
    const b: DedupeFields = { name: "Arcteryx Beta AR" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });
});

// ----------------------------------------------------------------------------------------------------
// isLikelyDuplicate — clause 2: brand + model match
// ----------------------------------------------------------------------------------------------------

describe("isLikelyDuplicate — brand + model match", () => {
  it("returns true when brand+model are equal even if stored names differ", () => {
    // One stored with full name, one abbreviated — brand+model still match
    const a: DedupeFields = { name: "Nano Puff Hoody", brand: "Patagonia", model: "Nano Puff" };
    const b: DedupeFields = { name: "Patagonia Nano Puff Jacket", brand: "Patagonia", model: "Nano Puff" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns true for backpack brand+model match regardless of name variation", () => {
    const a: DedupeFields = { name: "Osprey Atmos 65 Pack", brand: "Osprey", model: "Atmos 65" };
    const b: DedupeFields = { name: "Atmos 65", brand: "Osprey", model: "Atmos 65" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns true for boot brand+model match", () => {
    const a: DedupeFields = { name: "Speedgoat 5 Trail Running Shoe", brand: "Hoka", model: "Speedgoat 5" };
    const b: DedupeFields = { name: "Hoka Speedgoat 5", brand: "Hoka", model: "Speedgoat 5" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns false when brand matches but model differs", () => {
    const a: DedupeFields = { name: "Patagonia Nano Puff", brand: "Patagonia", model: "Nano Puff" };
    const b: DedupeFields = { name: "Patagonia Down Sweater", brand: "Patagonia", model: "Down Sweater" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("returns false when model matches but brand differs", () => {
    const a: DedupeFields = { name: "Nano Puff", brand: "Patagonia", model: "Nano Puff" };
    const b: DedupeFields = { name: "Nano Puff", brand: "Rab", model: "Nano Puff" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("does not fire clause 2 when either side has no model", () => {
    // Only brand, no model — should not falsely trigger clause 2
    const a: DedupeFields = { name: "Patagonia Jacket", brand: "Patagonia" };
    const b: DedupeFields = { name: "Patagonia Down Sweater", brand: "Patagonia", model: "Down Sweater" };
    // Names differ, brands same but a has no model — clause 2 should NOT fire
    // Clause 3 would fire only if one name contains the other; they don't here.
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------
// isLikelyDuplicate — clause 3: name-contains + shared brand
// ----------------------------------------------------------------------------------------------------

describe("isLikelyDuplicate — name contains + shared brand", () => {
  it("returns true: 'Patagonia Nano Puff Jacket' vs 'Nano Puff Jacket' with same brand", () => {
    const a: DedupeFields = { name: "Patagonia Nano Puff Jacket", brand: "Patagonia" };
    const b: DedupeFields = { name: "Nano Puff Jacket", brand: "Patagonia" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns true: abbreviated name is contained in full name, same brand (sleeping bag)", () => {
    const a: DedupeFields = { name: "Sea to Summit Spark I Sleeping Bag", brand: "Sea to Summit" };
    const b: DedupeFields = { name: "Spark I Sleeping Bag", brand: "Sea to Summit" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns true: pack full name vs short name, same brand (backpack archetype)", () => {
    const a: DedupeFields = { name: "Osprey Atmos AG 65 Backpack", brand: "Osprey" };
    const b: DedupeFields = { name: "Atmos AG 65", brand: "Osprey" };
    expect(isLikelyDuplicate(a, b)).toBe(true);
  });

  it("returns false when names partially overlap but brands differ", () => {
    // "Nano Puff" appears in both but brands differ — must NOT match
    const a: DedupeFields = { name: "Patagonia Nano Puff Jacket", brand: "Patagonia" };
    const b: DedupeFields = { name: "Nano Puff Jacket", brand: "Rab" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------
// isLikelyDuplicate — NON-matches: different items sharing only a generic word
// ----------------------------------------------------------------------------------------------------

describe("isLikelyDuplicate — non-matches", () => {
  it("returns false for 'blue jacket' vs 'red jacket' (same generic word, different items)", () => {
    const a: DedupeFields = { name: "blue jacket" };
    const b: DedupeFields = { name: "red jacket" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("returns false for completely different items from different brands", () => {
    const a: DedupeFields = { name: "Patagonia Nano Puff Jacket", brand: "Patagonia", model: "Nano Puff" };
    const b: DedupeFields = { name: "Arc'teryx Beta AR Jacket", brand: "Arc'teryx", model: "Beta AR" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("returns false for different archetypes with same brand", () => {
    // Shell jacket vs sleeping bag — same brand but clearly different items
    const a: DedupeFields = { name: "Patagonia Torrentshell 3L Jacket", brand: "Patagonia", model: "Torrentshell 3L" };
    const b: DedupeFields = { name: "Patagonia Micro Puff Sleeping Bag", brand: "Patagonia", model: "Micro Puff Sleeping Bag" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("returns false when name contains a short word that appears in both (e.g. 'jacket')", () => {
    // Both contain 'jacket' but are clearly different items; brands differ too
    const a: DedupeFields = { name: "Rain Jacket", brand: "Columbia" };
    const b: DedupeFields = { name: "Insulated Jacket", brand: "The North Face" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("returns false when both brand and model are null/undefined (no evidence to match)", () => {
    const a: DedupeFields = { name: "Jacket", brand: null, model: null };
    const b: DedupeFields = { name: "Pants", brand: null, model: null };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("returns false when name contains the other but brands are BOTH empty/null (no shared brand evidence)", () => {
    // Clause 3 requires a shared non-empty brand; without it, containment alone is not enough
    const a: DedupeFields = { name: "Nano Puff Jacket" };
    const b: DedupeFields = { name: "Nano Puff" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------
// isLikelyDuplicate — unknown/empty brand+model never forces a match
// ----------------------------------------------------------------------------------------------------

describe("isLikelyDuplicate — unknown brand/model never force a match", () => {
  it("null brand on both sides: no clause 2 or 3 match even if models look the same", () => {
    const a: DedupeFields = { name: "Shell Jacket", brand: null, model: "Beta AR" };
    const b: DedupeFields = { name: "Rain Jacket", brand: null, model: "Beta AR" };
    // Names differ; brands are both null → clause 2 cannot fire (brand empty); clause 3 cannot fire (no shared brand)
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("null model on both sides: clause 2 does not fire", () => {
    const a: DedupeFields = { name: "Patagonia Jacket", brand: "Patagonia", model: null };
    const b: DedupeFields = { name: "Patagonia Pants", brand: "Patagonia", model: null };
    // Names differ; both have brand but no model → clause 2 does NOT fire; clause 3: "jacket" does not contain "pants"
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });

  it("empty string model: treated as absent, clause 2 does not fire", () => {
    const a: DedupeFields = { name: "Boot A", brand: "Salomon", model: "" };
    const b: DedupeFields = { name: "Boot B", brand: "Salomon", model: "" };
    expect(isLikelyDuplicate(a, b)).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------
// findDuplicateIn
// ----------------------------------------------------------------------------------------------------

describe("findDuplicateIn", () => {
  const existingCloset: (DedupeFields & { id: string })[] = [
    { id: "1", name: "Patagonia Nano Puff Jacket", brand: "Patagonia", model: "Nano Puff" },
    { id: "2", name: "Arc'teryx Beta AR", brand: "Arc'teryx", model: "Beta AR" },
    { id: "3", name: "Osprey Atmos 65", brand: "Osprey", model: "Atmos 65" },
    { id: "4", name: "Hoka Speedgoat 5", brand: "Hoka", model: "Speedgoat 5" },
    { id: "5", name: "Sea to Summit Spark I", brand: "Sea to Summit", model: "Spark I" },
  ];

  it("returns the first matching item (exact name)", () => {
    const candidate: DedupeFields = { name: "Patagonia Nano Puff Jacket", brand: "Patagonia", model: "Nano Puff" };
    const result = findDuplicateIn(candidate, existingCloset);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("1");
  });

  it("returns null when no match exists", () => {
    const candidate: DedupeFields = { name: "Black Diamond Camelot 0.75", brand: "Black Diamond", model: "Camelot 0.75" };
    expect(findDuplicateIn(candidate, existingCloset)).toBeNull();
  });

  it("returns first hit, not all hits", () => {
    // A fictitious closet with two items that both match the candidate
    const twoMatches: (DedupeFields & { id: string })[] = [
      { id: "A", name: "Nano Puff Jacket", brand: "Patagonia", model: "Nano Puff" },
      { id: "B", name: "Nano Puff Hoody", brand: "Patagonia", model: "Nano Puff" },
    ];
    const candidate: DedupeFields = { name: "Patagonia Nano Puff", brand: "Patagonia", model: "Nano Puff" };
    const result = findDuplicateIn(candidate, twoMatches);
    expect(result?.id).toBe("A"); // first hit
  });

  it("returns null for empty existing list", () => {
    const candidate: DedupeFields = { name: "Any Item" };
    expect(findDuplicateIn(candidate, [])).toBeNull();
  });

  it("matches via brand+model across archetype variants (backpack)", () => {
    const candidate: DedupeFields = { name: "Atmos 65 AG", brand: "Osprey", model: "Atmos 65" };
    const result = findDuplicateIn(candidate, existingCloset);
    expect(result?.id).toBe("3");
  });

  it("matches via brand+model across archetype variants (sleeping bag)", () => {
    const candidate: DedupeFields = { name: "Spark I Ultralight", brand: "Sea to Summit", model: "Spark I" };
    const result = findDuplicateIn(candidate, existingCloset);
    expect(result?.id).toBe("5");
  });

  it("does not match a different item from the same brand", () => {
    const candidate: DedupeFields = { name: "Patagonia Down Sweater", brand: "Patagonia", model: "Down Sweater" };
    expect(findDuplicateIn(candidate, existingCloset)).toBeNull();
  });
});
