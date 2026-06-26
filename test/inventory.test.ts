// Focused unit tests for the inventory contract (src/core/inventory.ts + src/core/record.ts).
// Covers: InventoryMetaSchema defaults + validation, DEFAULT_INVENTORY shape, recordOnlyClassification,
// itemMatchesSearch, and the degrade-not-throw behavior for non-corpus names.

import { describe, it, expect } from "vitest";
import {
  InventoryMetaSchema,
  DEFAULT_INVENTORY,
  OWNERSHIP_STATUS,
  CONDITION,
  normalizeSearch,
  itemMatchesSearch,
  normalizeTags,
  type InventoryMeta,
} from "@/core/inventory";
import { recordOnlyClassification } from "@/core/record";
import { classifyOfflineSafe } from "@/core/classify/offline";

// ----------------------------------------------------------------------------------------------------
// InventoryMetaSchema — defaults + validation
// ----------------------------------------------------------------------------------------------------

describe("InventoryMetaSchema", () => {
  it("parses an empty object with all defaults", () => {
    const result = InventoryMetaSchema.parse({});
    expect(result.ownershipStatus).toBe("owned");
    expect(result.quantity).toBe(1);
    expect(result.condition).toBeNull();
    expect(result.acquiredAt).toBeNull();
    expect(result.pricePaidCents).toBeNull();
    expect(result.acquiredFrom).toBeNull();
    expect(result.storageLocation).toBeNull();
    expect(result.size).toBeNull();
    expect(result.color).toBeNull();
    expect(result.userNotes).toBeNull();
    expect(result.domains).toEqual([]);
    expect(result.userTags).toEqual([]);
  });

  it("accepts all valid ownership statuses", () => {
    for (const status of OWNERSHIP_STATUS) {
      expect(InventoryMetaSchema.parse({ ownershipStatus: status }).ownershipStatus).toBe(status);
    }
  });

  it("rejects an invalid ownershipStatus", () => {
    expect(() => InventoryMetaSchema.parse({ ownershipStatus: "garbage" })).toThrow();
  });

  it("rejects quantity < 1", () => {
    expect(() => InventoryMetaSchema.parse({ quantity: 0 })).toThrow();
    expect(() => InventoryMetaSchema.parse({ quantity: -3 })).toThrow();
  });

  it("rejects non-integer quantity", () => {
    expect(() => InventoryMetaSchema.parse({ quantity: 1.5 })).toThrow();
  });

  it("accepts all valid condition values", () => {
    for (const cond of CONDITION) {
      expect(InventoryMetaSchema.parse({ condition: cond }).condition).toBe(cond);
    }
  });

  it("rejects an invalid condition", () => {
    expect(() => InventoryMetaSchema.parse({ condition: "pristine" })).toThrow();
  });

  it("accepts null condition explicitly", () => {
    expect(InventoryMetaSchema.parse({ condition: null }).condition).toBeNull();
  });

  it("accepts a realistic full payload", () => {
    const payload = {
      ownershipStatus: "owned",
      quantity: 2,
      condition: "good",
      acquiredAt: "2023-07-15",
      pricePaidCents: 19900,
      acquiredFrom: "REI",
      storageLocation: "garage shelf A",
      size: "M",
      color: "orange",
      userNotes: "bought on sale",
      domains: ["gear"],
      userTags: ["ultralight", "climbing"],
    };
    const result = InventoryMetaSchema.parse(payload);
    expect(result.ownershipStatus).toBe("owned");
    expect(result.quantity).toBe(2);
    expect(result.condition).toBe("good");
    expect(result.pricePaidCents).toBe(19900);
    expect(result.domains).toEqual(["gear"]);
    expect(result.userTags).toEqual(["ultralight", "climbing"]);
  });

  it("rejects negative pricePaidCents", () => {
    expect(() => InventoryMetaSchema.parse({ pricePaidCents: -1 })).toThrow();
  });
});

// ----------------------------------------------------------------------------------------------------
// DEFAULT_INVENTORY
// ----------------------------------------------------------------------------------------------------

describe("DEFAULT_INVENTORY", () => {
  it("has the expected shape and all-default values", () => {
    const d: InventoryMeta = DEFAULT_INVENTORY;
    expect(d.ownershipStatus).toBe("owned");
    expect(d.quantity).toBe(1);
    expect(d.condition).toBeNull();
    expect(d.acquiredAt).toBeNull();
    expect(d.pricePaidCents).toBeNull();
    expect(d.acquiredFrom).toBeNull();
    expect(d.storageLocation).toBeNull();
    expect(d.size).toBeNull();
    expect(d.color).toBeNull();
    expect(d.userNotes).toBeNull();
    expect(d.domains).toEqual([]);
    expect(d.userTags).toEqual([]);
  });

  it("is consistent with InventoryMetaSchema defaults (round-trip)", () => {
    const fromSchema = InventoryMetaSchema.parse({});
    expect(fromSchema).toEqual(DEFAULT_INVENTORY);
  });
});

// ----------------------------------------------------------------------------------------------------
// recordOnlyClassification — all behavioral facets null/unknown
// ----------------------------------------------------------------------------------------------------

describe("recordOnlyClassification", () => {
  it("returns a fully-valid ItemClassification for any name", () => {
    const c = recordOnlyClassification("Hoka Speedgoat 5");
    expect(c.name).toBe("Hoka Speedgoat 5");
  });

  it("all universal soft facets have value: null (known-unknown)", () => {
    const c = recordOnlyClassification("Mystery Tent");
    expect(c.universal.waterproofness.value).toBeNull();
    expect(c.universal.warmth.value).toBeNull();
    expect(c.universal.breathability.value).toBeNull();
    expect(c.universal.moisture_management.value).toBeNull();
    expect(c.universal.packability.value).toBeNull();
    expect(c.universal.wind_resistance.value).toBeNull();
    expect(c.universal.dry_speed.value).toBeNull();
    expect(c.universal.warmth_when_wet.value).toBeNull();
    expect(c.universal.technical_vs_lifestyle.value).toBeNull();
  });

  it("all universal hard facts have value: null", () => {
    const c = recordOnlyClassification("Some Jacket");
    expect(c.universal.upf.value).toBeNull();
    expect(c.identity.brand.value).toBeNull();
    expect(c.identity.model.value).toBeNull();
    expect(c.identity.price_cents.value).toBeNull();
    expect(c.identity.weight_grams.value).toBeNull();
  });

  it("all multilabel arrays are empty []", () => {
    const c = recordOnlyClassification("Patagonia Nano Puff");
    expect(c.multilabel.layering_role).toEqual([]);
    expect(c.multilabel.function_purpose).toEqual([]);
    expect(c.multilabel.body_zone_covered).toEqual([]);
    expect(c.multilabel.activity_fit).toEqual([]);
    expect(c.multilabel.conditions_fit).toEqual([]);
  });

  it("groups is empty and applicable_groups is []", () => {
    const c = recordOnlyClassification("Arc'teryx Beta AR");
    expect(c.groups).toEqual({});
    expect(c.applicable_groups).toEqual([]);
  });

  it("materials and treatments are empty arrays", () => {
    const c = recordOnlyClassification("Black Diamond Camelot");
    expect(c.materials).toEqual([]);
    expect(c.treatments).toEqual([]);
  });

  // Cross-archetype: 3 distinct item types to ensure no hardcoding
  it("cross-archetype: sleeping bag — all unknown", () => {
    const c = recordOnlyClassification("Sea to Summit Spark I");
    expect(c.groups.sleep).toBeUndefined();
    expect(c.universal.warmth.value).toBeNull();
  });

  it("cross-archetype: backpack — all unknown", () => {
    const c = recordOnlyClassification("Osprey Atmos 65");
    expect(c.groups.carry).toBeUndefined();
    expect(c.universal.packability.value).toBeNull();
  });

  it("cross-archetype: footwear — all unknown", () => {
    const c = recordOnlyClassification("La Sportiva Trango Tech");
    expect(c.groups.footwear).toBeUndefined();
    expect(c.universal.waterproofness.value).toBeNull();
  });
});

// ----------------------------------------------------------------------------------------------------
// itemMatchesSearch
// ----------------------------------------------------------------------------------------------------

describe("itemMatchesSearch", () => {
  // Hit on name
  it("matches on item name (exact, case-insensitive)", () => {
    expect(itemMatchesSearch({ name: "Patagonia Nano Puff Jacket" }, "nano puff")).toBe(true);
  });

  it("matches on item name with mixed case", () => {
    expect(itemMatchesSearch({ name: "Arc'teryx Beta AR" }, "BETA")).toBe(true);
  });

  // Hit on brand
  it("matches on brand", () => {
    expect(itemMatchesSearch({ name: "Nano Puff Jacket", brand: "Patagonia" }, "patagonia")).toBe(true);
  });

  // Hit on model
  it("matches on model", () => {
    expect(itemMatchesSearch({ name: "Jacket", brand: "Patagonia", model: "Nano Puff" }, "nano puff")).toBe(true);
  });

  // Miss cases
  it("does not match when query is absent from all fields", () => {
    expect(itemMatchesSearch({ name: "Kelty Galactic 30", brand: "Kelty", model: "Galactic 30" }, "gore-tex")).toBe(false);
  });

  it("does not match when brand/model are null and name misses", () => {
    expect(itemMatchesSearch({ name: "Rain Jacket", brand: null, model: null }, "sleeping bag")).toBe(false);
  });

  // Empty query matches everything
  it("empty query matches any item", () => {
    expect(itemMatchesSearch({ name: "Anything" }, "")).toBe(true);
  });

  // Whitespace normalization
  it("normalizes whitespace in query", () => {
    expect(itemMatchesSearch({ name: "Kelty Galactic 30" }, "  kelty  ")).toBe(true);
  });
});

// ----------------------------------------------------------------------------------------------------
// normalizeSearch
// ----------------------------------------------------------------------------------------------------

describe("normalizeSearch", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeSearch("  Hello   World  ")).toBe("hello world");
    expect(normalizeSearch("NANO\tPUFF")).toBe("nano puff");
    expect(normalizeSearch("already clean")).toBe("already clean");
  });
});

// ----------------------------------------------------------------------------------------------------
// normalizeTags
// ----------------------------------------------------------------------------------------------------

describe("normalizeTags", () => {
  // Splitting from a single comma-delimited string
  it("splits a comma-delimited string into trimmed tags", () => {
    expect(normalizeTags("ultralight, climbing, rain")).toEqual(["ultralight", "climbing", "rain"]);
  });

  it("splits a newline-delimited string", () => {
    expect(normalizeTags("ultralight\nclimbing\nrain")).toEqual(["ultralight", "climbing", "rain"]);
  });

  it("splits mixed comma and newline delimiters", () => {
    expect(normalizeTags("ultralight,climbing\nrain")).toEqual(["ultralight", "climbing", "rain"]);
  });

  // Trimming
  it("trims whitespace from each tag", () => {
    expect(normalizeTags("  ultralight  ,  climbing  ")).toEqual(["ultralight", "climbing"]);
  });

  // Empty filtering
  it("filters out empty strings produced by consecutive delimiters", () => {
    expect(normalizeTags("ultralight,,climbing")).toEqual(["ultralight", "climbing"]);
    expect(normalizeTags("ultralight\n\nclimbing")).toEqual(["ultralight", "climbing"]);
  });

  it("returns [] for an empty string", () => {
    expect(normalizeTags("")).toEqual([]);
  });

  it("returns [] for a whitespace-only string", () => {
    expect(normalizeTags("   ")).toEqual([]);
  });

  // Case-insensitive deduplication (first occurrence wins, preserves user casing)
  it("deduplicates case-insensitively (first occurrence wins)", () => {
    expect(normalizeTags("Climbing,climbing,CLIMBING")).toEqual(["Climbing"]);
  });

  it("preserves the casing of the first occurrence", () => {
    expect(normalizeTags("Rain, rain, RAIN")).toEqual(["Rain"]);
  });

  it("deduplication is case-insensitive across distinct mixed-case tags", () => {
    expect(normalizeTags("ultralight, UltraLight, ULTRALIGHT, hiking")).toEqual(["ultralight", "hiking"]);
  });

  // Array input
  it("accepts a pre-split array and deduplicates it", () => {
    expect(normalizeTags(["  wet  ", "RAIN", "rain"])).toEqual(["wet", "RAIN"]);
  });

  it("accepts an array of already-clean tags without modification", () => {
    expect(normalizeTags(["ultralight", "climbing", "rain"])).toEqual(["ultralight", "climbing", "rain"]);
  });

  it("filters empty strings from an array input", () => {
    expect(normalizeTags(["ultralight", "", "  ", "rain"])).toEqual(["ultralight", "rain"]);
  });
});

// ----------------------------------------------------------------------------------------------------
// classifyOfflineSafe — degrade-not-throw (the add-by-name path)
// ----------------------------------------------------------------------------------------------------

describe("classifyOfflineSafe — degrade on non-corpus names", () => {
  it("does not throw for a completely unknown item name", () => {
    expect(() => classifyOfflineSafe({ name: "Widget X9000" })).not.toThrow();
  });

  it("returns a classification with the correct name", () => {
    const c = classifyOfflineSafe({ name: "Widget X9000" });
    expect(c.name).toBe("Widget X9000");
  });

  it("all behavioral facets are unknown for a non-corpus name", () => {
    const c = classifyOfflineSafe({ name: "Mystery Gizmo Pro" });
    expect(c.universal.waterproofness.value).toBeNull();
    expect(c.universal.warmth.value).toBeNull();
    expect(c.multilabel.layering_role).toEqual([]);
    expect(c.applicable_groups).toEqual([]);
    expect(c.identity.brand.value).toBeNull();
  });

  // Cross-archetype: 3 distinct fictional items to rule out any hidden hardcoding
  it("cross-archetype: fictional tent — all unknown", () => {
    const c = classifyOfflineSafe({ name: "Acme UltraTent 3P" });
    expect(c.groups.sleep).toBeUndefined();
    expect(c.universal.wind_resistance.value).toBeNull();
  });

  it("cross-archetype: fictional rain jacket — all unknown", () => {
    const c = classifyOfflineSafe({ name: "Generic Hardshell 2000" });
    expect(c.groups.shell).toBeUndefined();
    expect(c.universal.waterproofness.value).toBeNull();
  });

  it("cross-archetype: fictional boot — all unknown", () => {
    const c = classifyOfflineSafe({ name: "Noname Mountain Boot V2" });
    expect(c.groups.footwear).toBeUndefined();
    expect(c.identity.weight_grams.value).toBeNull();
  });
});
