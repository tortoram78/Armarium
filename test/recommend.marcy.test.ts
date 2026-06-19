import { describe, it, expect } from "vitest";
import { INVENTORY_SEED } from "@/core/seed-corpus";
import { resolveFromClassification } from "@/core/resolved";
import { recommend } from "@/core/recommend";
import { evaluateCapability } from "@/core/capabilities";
import { MARCY_ENVELOPE } from "@/core/trips";

// The canonical end-to-end proof: the 3 pre-seeded items against the Mount Marcy plan must surface
// exactly the three intended gaps and nothing spurious.
describe("Mount Marcy recommendation over the 3 owned items", () => {
  const items = INVENTORY_SEED.map((e) => resolveFromClassification(e.slug, e.classification));
  const result = recommend(items, MARCY_ENVELOPE);

  it("surfaces exactly the 3 intended gaps", () => {
    const gaps = result.gaps.map((g) => g.capability).sort();
    expect(gaps).toEqual(["packable_insulation", "weather_shell", "wicking_base"]);
    expect(result.gaps).toHaveLength(3);
  });

  it("flags the missing weather shell as CRITICAL", () => {
    const shell = result.gaps.find((g) => g.capability === "weather_shell");
    expect(shell?.severity).toBe("critical");
  });

  it("does NOT count the Terre Planing's DWR as a weather shell (fails, not blocked)", () => {
    const terre = items.find((i) => i.id === "terre-planing")!;
    expect(evaluateCapability(terre, "weather_shell")).toBe("fails");
    expect(evaluateCapability(terre, "rain_protection")).toBe("fails");
  });

  it("recommends the Terre Planing for sun protection (its real strength)", () => {
    const sun = result.outcomes.find((o) => o.capability === "sun_protection")!;
    expect(sun.status).toBe("satisfied");
    expect(sun.satisfiedBy.some((r) => r.name.includes("Terre Planing"))).toBe(true);
    expect(result.picks.some((p) => p.id === "terre-planing")).toBe(true);
  });

  it("produces no spurious 'uncertain' outcomes for this inventory", () => {
    expect(result.uncertain).toHaveLength(0);
  });

  it("never upgrades the Kelty '30' to a certified EN/ISO comfort rating", () => {
    const kelty = INVENTORY_SEED.find((e) => e.slug === "kelty-galactic-30")!.classification;
    const std = kelty.groups.sleep!.temp_rating_standard;
    expect(std.value).not.toBe("en_iso_comfort");
    if (std.value !== null) expect(std.confidence).not.toBe("high");
  });
});
