import { describe, it, expect } from "vitest";
import { parseClassification, safeParseClassification, type ItemClassification } from "@/core/classification";
import { SEED_CORPUS } from "@/core/seed-corpus";

describe("ItemClassification contract", () => {
  it("validates every seed-corpus classification", () => {
    for (const entry of SEED_CORPUS) {
      expect(() => parseClassification(entry.classification)).not.toThrow();
    }
  });

  it("rejects an out-of-vocabulary scalar facet value", () => {
    const bad = structuredClone(SEED_CORPUS[0]!.classification) as unknown as Record<string, any>;
    bad.universal.waterproofness = { value: "soaked", confidence: "high", source: "manufacturer", evidence: "x" };
    expect(safeParseClassification(bad).success).toBe(false);
  });

  it("rejects a free-string multi-label value (closed enums only)", () => {
    const bad = structuredClone(SEED_CORPUS[0]!.classification) as unknown as Record<string, any>;
    bad.multilabel.layering_role = ["totally_made_up"];
    expect(safeParseClassification(bad).success).toBe(false);
  });

  it("demotes an inferred hard fact (upf) to null during validation", () => {
    const tweaked = structuredClone(SEED_CORPUS[0]!.classification) as unknown as Record<string, any>;
    tweaked.universal.upf = { value: 40, source: "inferred", evidence: "guessed" };
    const parsed: ItemClassification = parseClassification(tweaked);
    expect(parsed.universal.upf.value).toBeNull();
    expect(parsed.universal.upf.source).toBe("unknown");
  });
});
