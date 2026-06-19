import { describe, it, expect } from "vitest";
import { groupCloset } from "@/core/closet";
import { resolveFromClassification } from "@/core/resolved";
import { SEED_CORPUS } from "@/core/seed-corpus";

const items = SEED_CORPUS.map((e) => resolveFromClassification(e.slug, e.classification));

describe("emergent closet grouping (categories as queries, multi-membership)", () => {
  it("groups by capability; the Terre Planing appears under sun protection", () => {
    const groups = groupCloset(items, "capability");
    const sun = groups.find((g) => g.key === "sun_protection");
    expect(sun?.itemIds).toContain("terre-planing");
  });

  it("an item can appear in MULTIPLE layering-role groups (no single bucket)", () => {
    const groups = groupCloset(items, "layering_role");
    const inNextToSkin = groups.find((g) => g.key === "next_to_skin")?.itemIds ?? [];
    const inStandalone = groups.find((g) => g.key === "standalone")?.itemIds ?? [];
    expect(inNextToSkin).toContain("terre-planing");
    expect(inStandalone).toContain("terre-planing");
  });

  it("the sleeping bag groups under sleep_system, not as worn insulation", () => {
    const groups = groupCloset(items, "layering_role");
    expect(groups.find((g) => g.key === "sleep_system")?.itemIds).toContain("kelty-galactic-30");
    expect(groups.find((g) => g.key === "static_insulation")?.itemIds ?? []).not.toContain("kelty-galactic-30");
  });

  it("groups by warmth and only returns non-empty groups", () => {
    const groups = groupCloset(items, "warmth");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.itemIds.length).toBeGreaterThan(0);
  });
});
