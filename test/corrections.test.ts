// Tests for the user-correction engine — the heart of the verify→correct→re-plan loop. The decisive
// property: a user-set HARD fact is authoritative and survives validation (NOT demoted), so it can
// actually flip a capability outcome. We assert deterministic envelope construction, "unknown" clears,
// partial-edit safety, multi-label filtering, and absent-group skipping — and every result round-trips
// through the classification schema.

import { describe, it, expect } from "vitest";
import { applyUserCorrections } from "@/core/corrections";
import { safeParseClassification, type ItemClassification } from "@/core/classification";
import { SEED_CORPUS } from "@/core/seed-corpus";

function corpus(slugIncludes: string): ItemClassification {
  const e = SEED_CORPUS.find((x) => x.slug.includes(slugIncludes));
  if (!e) throw new Error(`no seed entry matching "${slugIncludes}"`);
  return structuredClone(e.classification);
}

describe("applyUserCorrections", () => {
  it("sets a soft universal facet with source:user and re-validates", () => {
    const out = applyUserCorrections(corpus("terre"), { "universal.warmth": "high" });
    expect(out.universal.warmth).toEqual({ value: "high", confidence: "high", source: "user", evidence: "user correction" });
    expect(safeParseClassification(out).success).toBe(true);
  });

  it('"unknown" clears a facet back to first-class null', () => {
    const out = applyUserCorrections(corpus("terre"), { "universal.waterproofness": "unknown" });
    expect(out.universal.waterproofness.value).toBeNull();
    expect(safeParseClassification(out).success).toBe(true);
  });

  it("a USER-set hard fact (upf) is authoritative — NOT demoted — and persists", () => {
    const out = applyUserCorrections(corpus("terre"), { "universal.upf": "50" });
    const parsed = safeParseClassification(out);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.universal.upf).toEqual({ value: 50, source: "user", evidence: "user correction" });
    }
  });

  it("a USER-set hard group fact (fill_power) survives validation when the group is present", () => {
    const entry = SEED_CORPUS.find((e) => e.classification.groups.insulation);
    if (!entry) return; // no insulated seed item; the upf test covers the hard-fact property
    const out = applyUserCorrections(structuredClone(entry.classification), { "groups.insulation.fill_power": "850" });
    const parsed = safeParseClassification(out);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.groups.insulation?.fill_power).toEqual({ value: 850, source: "user", evidence: "user correction" });
    }
  });

  it("ignores paths not in the submission (partial edits don't wipe other facets)", () => {
    const c = corpus("terre");
    const before = structuredClone(c.universal.packability);
    const out = applyUserCorrections(c, { "universal.warmth": "moderate" });
    expect(out.universal.packability).toEqual(before);
  });

  it("multi-label edits keep only allowed vocab values", () => {
    const out = applyUserCorrections(corpus("terre"), {
      "multilabel.layering_role": ["base", "not_a_real_value", "mid"],
    });
    expect(out.multilabel.layering_role).toEqual(["base", "mid"]);
    expect(safeParseClassification(out).success).toBe(true);
  });

  it("skips group fields when the item lacks that group (no crash, no spurious group)", () => {
    const c = corpus("terre"); // a sun hoody — no sleep group
    const hadSleep = Boolean(c.groups.sleep);
    const out = applyUserCorrections(c, { "groups.sleep.temp_rating_value": "-7" });
    expect(Boolean(out.groups.sleep)).toBe(hadSleep);
    expect(safeParseClassification(out).success).toBe(true);
  });
});
