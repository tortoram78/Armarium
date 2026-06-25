// Tests for src/core/domains.ts and the unclassified bucket in groupCloset.
// Covers: isGearClassified true/false paths, hasAnyKnownFacet, and groupCloset unclassified bucket
// for every grouping dimension + no double-counting for classified items.

import { describe, it, expect } from "vitest";
import { isGearClassified, hasAnyKnownFacet } from "@/core/domains";
import { groupCloset, GROUPINGS } from "@/core/closet";
import { mkResolved, s, h } from "./helpers";
import { DEFAULT_INVENTORY } from "@/core/inventory";
import type { ResolvedItem } from "@/core/resolved";

// ----------------------------------------------------------------------------------------------------
// Helpers — classified and record-only items
// ----------------------------------------------------------------------------------------------------

/** A classified item with a known warmth facet (mimics a real classified gear item). */
const classifiedByFacet = mkResolved("c1", "Classified Shell", {
  warmth: s("moderate", "medium", "inferred", "mid-weight"),
});

/** A classified item via domains marker only (mimics a post-ADR-0022 item with domains: ['gear']). */
const classifiedByDomain: ResolvedItem = {
  ...mkResolved("c2", "Domain-Marked Item"),
  inventory: { ...DEFAULT_INVENTORY, domains: ["gear"] },
};

/** A classified item with a non-empty multilabel array (no universal facets set). */
const classifiedByMultilabel = mkResolved("c3", "Role-Only Item", {}, {
  layering_role: ["base"],
});

/** A record-only item: all-unknown facets, empty multilabels, domains: []. */
const recordOnly = mkResolved("r1", "My Random Possession");
// mkResolved already uses DEFAULT_INVENTORY (domains: []) and all-unknown facets.

/** A second record-only item to validate bucket aggregation. */
const recordOnly2 = mkResolved("r2", "Another Unclassified Item");

// ----------------------------------------------------------------------------------------------------
// hasAnyKnownFacet
// ----------------------------------------------------------------------------------------------------

describe("hasAnyKnownFacet", () => {
  it("returns true when any universal soft facet has a non-null value", () => {
    expect(hasAnyKnownFacet(classifiedByFacet)).toBe(true);
  });

  it("returns true when any multilabel array is non-empty (no universal facet set)", () => {
    expect(hasAnyKnownFacet(classifiedByMultilabel)).toBe(true);
  });

  it("returns true for a UPF hard fact (non-null hard facet counts)", () => {
    const withUpf = mkResolved("u1", "UPF Shirt", { upf: h(40, "manufacturer", "UPF 40 label") });
    expect(hasAnyKnownFacet(withUpf)).toBe(true);
  });

  it("returns false for a record-only all-unknown item with empty multilabels", () => {
    expect(hasAnyKnownFacet(recordOnly)).toBe(false);
  });

  it("returns false when only domains is set (domains is inventory, not a facet signal)", () => {
    // classifiedByDomain has all-unknown facets and empty multilabels — hasAnyKnownFacet looks at
    // facets only, not the inventory envelope.
    expect(hasAnyKnownFacet(classifiedByDomain)).toBe(false);
  });
});

// ----------------------------------------------------------------------------------------------------
// isGearClassified
// ----------------------------------------------------------------------------------------------------

describe("isGearClassified", () => {
  it("returns true for an item with a known universal facet (pre-marker classified item)", () => {
    expect(isGearClassified(classifiedByFacet)).toBe(true);
  });

  it("returns true for an item with domains: ['gear'] even if all facets are unknown", () => {
    expect(isGearClassified(classifiedByDomain)).toBe(true);
  });

  it("returns true for an item with a non-empty multilabel array (no universal facets, no domains marker)", () => {
    expect(isGearClassified(classifiedByMultilabel)).toBe(true);
  });

  it("returns false for a record-only item (all-unknown facets, empty multilabels, domains: [])", () => {
    expect(isGearClassified(recordOnly)).toBe(false);
  });

  it("cross-archetype: second record-only item also returns false", () => {
    expect(isGearClassified(recordOnly2)).toBe(false);
  });

  it("cross-archetype: item with function_purpose set is gear-classified", () => {
    const withPurpose = mkResolved("x1", "Sun Hat", {}, { function_purpose: ["sun_protection"] });
    expect(isGearClassified(withPurpose)).toBe(true);
  });

  it("cross-archetype: item with conditions_fit set is gear-classified", () => {
    const withConditions = mkResolved("x2", "Rain Pants", {}, { conditions_fit: ["rain"] });
    expect(isGearClassified(withConditions)).toBe(true);
  });

  it("cross-archetype: item with body_zone_covered set is gear-classified", () => {
    const withZone = mkResolved("x3", "Gaiters", {}, { body_zone_covered: ["legs"] });
    expect(isGearClassified(withZone)).toBe(true);
  });
});

// ----------------------------------------------------------------------------------------------------
// groupCloset — unclassified bucket
// ----------------------------------------------------------------------------------------------------

describe("groupCloset: unclassified bucket", () => {
  const allItems = [classifiedByFacet, classifiedByDomain, classifiedByMultilabel, recordOnly, recordOnly2];

  for (const dimension of GROUPINGS) {
    it(`dimension="${dimension}": unclassified bucket appears and contains only record-only items`, () => {
      const groups = groupCloset(allItems, dimension);
      const unclassifiedGroup = groups.find((g) => g.key === "unclassified");

      // Bucket must exist when there are record-only items in the list.
      expect(unclassifiedGroup).toBeDefined();

      // Bucket must contain exactly the two record-only items.
      expect(unclassifiedGroup!.itemIds.sort()).toEqual(["r1", "r2"]);

      // Bucket label is correct.
      expect(unclassifiedGroup!.label).toBe("Unclassified — add details");
    });

    it(`dimension="${dimension}": unclassified bucket is the LAST group`, () => {
      const groups = groupCloset(allItems, dimension);
      const last = groups[groups.length - 1]!;
      expect(last.key).toBe("unclassified");
    });

    it(`dimension="${dimension}": classified items do NOT appear in the unclassified bucket`, () => {
      const groups = groupCloset(allItems, dimension);
      const unclassifiedGroup = groups.find((g) => g.key === "unclassified");
      expect(unclassifiedGroup!.itemIds).not.toContain("c1");
      expect(unclassifiedGroup!.itemIds).not.toContain("c2");
      expect(unclassifiedGroup!.itemIds).not.toContain("c3");
    });
  }

  it("unclassified bucket is absent when all items are gear-classified (no double-counting)", () => {
    const classifiedOnly = [classifiedByFacet, classifiedByDomain, classifiedByMultilabel];
    for (const dimension of GROUPINGS) {
      const groups = groupCloset(classifiedOnly, dimension);
      const unclassifiedGroup = groups.find((g) => g.key === "unclassified");
      expect(unclassifiedGroup).toBeUndefined();
    }
  });

  it("a domains-marked item (all-unknown facets, domains: ['gear']) does NOT land in unclassified", () => {
    const groups = groupCloset([classifiedByDomain, recordOnly], "warmth");
    const unclassifiedGroup = groups.find((g) => g.key === "unclassified");
    // recordOnly should be in unclassified; classifiedByDomain should NOT
    expect(unclassifiedGroup).toBeDefined();
    expect(unclassifiedGroup!.itemIds).toEqual(["r1"]);
    expect(unclassifiedGroup!.itemIds).not.toContain("c2");
  });
});
