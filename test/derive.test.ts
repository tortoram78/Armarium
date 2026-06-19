import { describe, it, expect } from "vitest";
import { deriveRequirements } from "@/core/recommend/derive";
import { planTrip } from "@/core/recommend/plan";
import { resolveFromClassification } from "@/core/resolved";
import { INVENTORY_SEED } from "@/core/seed-corpus";
import { TRIP_PRESETS } from "@/core/trips";
import type { CapabilityKey } from "@/core/capabilities";

const preset = (slug: string) => TRIP_PRESETS.find((p) => p.slug === slug)!;
const caps = (slug: string): CapabilityKey[] => deriveRequirements(preset(slug).conditions).map((r) => r.capability).sort();

// The engine is GENERAL: different conditions derive different required capabilities. No trip is special-cased.
describe("deriveRequirements is general across trip archetypes", () => {
  it("desert day -> sun + cooling, no shell/insulation", () => {
    expect(caps("desert-day")).toEqual(["cooling", "sun_protection"]);
  });

  it("multi-day rain -> shell + insulation + base + sleep, no sun/cooling", () => {
    expect(caps("rain-multiday")).toEqual(["packable_insulation", "sleep_warmth", "weather_shell", "wicking_base"]);
  });

  it("alpine day -> shell + insulation + base + sun, no sleep/cooling", () => {
    expect(caps("marcy-alpine")).toEqual(["packable_insulation", "sun_protection", "weather_shell", "wicking_base"]);
  });

  it("casual mild travel -> no hard requirements (lifestyle items are fine)", () => {
    expect(caps("casual-travel")).toEqual([]);
  });
});

describe("the same inventory yields different results per trip", () => {
  const inventory = INVENTORY_SEED.map((e) => resolveFromClassification(e.slug, e.classification));

  it("the Terre Planing shines in the desert (sun + cooling), unlike on Marcy", () => {
    const res = planTrip(inventory, "Desert", preset("desert-day").conditions);
    const terre = res.picks.find((p) => p.id === "terre-planing");
    expect(terre?.capabilities.sort()).toEqual(["cooling", "sun_protection"]);
    expect(res.gaps).toHaveLength(0); // desert needs sun+cooling, both covered by the Terre Planing
  });

  it("multi-day rain surfaces the shell gap and flags the uncertain sleeping-bag rating to verify", () => {
    const res = planTrip(inventory, "Rainy days", preset("rain-multiday").conditions);
    expect(res.gaps.some((g) => g.capability === "weather_shell")).toBe(true);
    // Kelty bag: adequate-looking but uncertain '30' standard -> surfaced as "verify", not a silent pass.
    expect(res.uncertain.some((u) => u.capability === "sleep_warmth")).toBe(true);
  });

  it("casual travel has zero gaps for this closet", () => {
    const res = planTrip(inventory, "City trip", preset("casual-travel").conditions);
    expect(res.gaps).toHaveLength(0);
    expect(res.outcomes).toHaveLength(0);
  });
});
