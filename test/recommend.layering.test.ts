import { describe, it, expect } from "vitest";
import { recommend, type TripEnvelope } from "@/core/recommend";
import { evaluateCombination } from "@/core/recommend/combine";
import { deriveRequirements } from "@/core/recommend/derive";
import { evaluateCapability, warmthTargetRank } from "@/core/capabilities";
import { defaultConditions } from "@/core/conditions";
import type { TripConditions } from "@/core/conditions";
import { mkResolved, s } from "./helpers";

// LAYERING-SYSTEM REASONING (ADR-0010). The combination-aware recommender must let a *set* of items
// occupying distinct layering slots satisfy a requirement no single item satisfies — while staying
// EMERGENT (no outfit templates) and keeping unknown first-class. These tests are deliberately
// cross-archetype (cold-dry / cold-wet / mild / unknown) so the engine cannot be secretly hardcoded:
// the same generic combiner must produce a system in one case and refuse to over-trigger in another.

const env = (name: string, c: TripConditions): TripEnvelope => ({
  name,
  conditions: c,
  required: deriveRequirements(c),
});

describe("layering systems — additive warmth (cold-dry archetype)", () => {
  // tmin = -7 -> warmth target rank 5. No single worn layer reaches it; base(1)+mid(2)+insulation(2)=5.
  const cold = defaultConditions({
    temp_min_c: -7, temp_max_c: 2, precipitation: "none", wind: "calm", sun: "low",
    exertion: "low", duration: "day", exposure: "exposed", activities: ["hiking"],
  });

  // A light base (warmth light), a fleece mid (moderate), and a bulky synthetic insulator (moderate).
  // The insulator is BULKY -> it fails single-item packable_insulation, so only the SYSTEM can satisfy.
  const base = mkResolved("base", "merino base", {
    warmth: s("light", "high", "manufacturer", "150 wt merino"),
    moisture_management: s("wicks", "high", "inferred", "merino"),
    warmth_when_wet: s("retains", "high", "inferred", "wool"),
  }, { layering_role: ["next_to_skin", "base"] });

  const mid = mkResolved("mid", "fleece mid", {
    warmth: s("moderate", "high", "manufacturer", "200-wt fleece"),
  }, { layering_role: ["mid"] });

  const insulator = mkResolved("ins", "bulky synthetic puffy", {
    warmth: s("moderate", "high", "manufacturer", "60g synthetic"),
    packability: s("bulky", "high", "manufacturer", "thick, does not compress"),
  }, { layering_role: ["static_insulation", "standalone"] });

  const items = [base, mid, insulator];

  it("derives the warmth target as a cumulative ordinal rank", () => {
    expect(warmthTargetRank({ conditions: cold })).toBe(5);
  });

  it("no single item satisfies packable_insulation (the bulky puffy fails on packability)", () => {
    const ctx = { conditions: cold };
    expect(items.filter((it) => evaluateCapability(it, "packable_insulation", ctx) === "satisfies")).toHaveLength(0);
  });

  it("base + mid + insulation COMBINE to satisfy the cold warmth requirement as a system", () => {
    const res = recommend(items, env("Cold dry", cold));
    const warmth = res.outcomes.find((o) => o.capability === "packable_insulation")!;
    expect(warmth.status).toBe("satisfied");
    expect(warmth.satisfiedBy).toHaveLength(0); // not satisfied by any single item
    expect(warmth.satisfiedBySystem).toHaveLength(1);
    const sys = warmth.satisfiedBySystem[0]!.items.map((r) => r.id).sort();
    expect(sys).toEqual(["base", "ins", "mid"]); // all three layers cited as the system
    expect(res.gaps.some((g) => g.capability === "packable_insulation")).toBe(false);
  });

  it("the same three items removed leaves a genuine gap (proves the system is load-bearing)", () => {
    const res = recommend([base], env("Cold dry, base only", cold)); // base alone: warmth 1 < target 5
    const warmth = res.outcomes.find((o) => o.capability === "packable_insulation")!;
    expect(warmth.status).toBe("gap");
    expect(warmth.satisfiedBySystem).toHaveLength(0);
  });

  it("system members all appear in picks with the capability attributed", () => {
    const res = recommend(items, env("Cold dry", cold));
    const ids = res.picks.filter((p) => p.capabilities.includes("packable_insulation")).map((p) => p.id).sort();
    expect(ids).toEqual(["base", "ins", "mid"]);
  });

  it("two items in the SAME structural slot do NOT double-count (a system needs distinct slots)", () => {
    // Two base layers (slot 0) + one mid (slot 1): best-per-slot = 1 + 2 = 3 < target 5. No system.
    const baseB = mkResolved("baseB", "second base", {
      warmth: s("light", "high", "manufacturer", "another 150 wt base"),
    }, { layering_role: ["base", "next_to_skin"] });
    const res = recommend([base, baseB, mid], env("Cold dry, two bases", cold));
    const warmth = res.outcomes.find((o) => o.capability === "packable_insulation")!;
    expect(warmth.status).toBe("gap");
    expect(warmth.satisfiedBySystem).toHaveLength(0);
  });
});

describe("layering systems — shell over warmth (cold-wet archetype): BOTH arms required", () => {
  // The conjunctive weather system: a true shell over a distinct warmth base. Tested at the combination
  // engine directly (this is where the "both must be present" invariant lives): removing the shell drops
  // weather protection; removing the warmth base drops it too.
  const coldWet = defaultConditions({
    temp_min_c: -3, temp_max_c: 6, precipitation: "sustained", wind: "strong", sun: "low",
    exertion: "moderate", duration: "day", exposure: "exposed", activities: ["hiking"],
  });
  const ctx = { conditions: coldWet };

  const shell = mkResolved("shell", "hardshell", {
    waterproofness: s("wp_breathable", "high", "manufacturer", "3L membrane"),
    wind_resistance: s("windproof", "high", "manufacturer", "membrane"),
    warmth: s("minimal", "high", "inferred", "uninsulated shell"),
  }, { layering_role: ["weather_shell"] });

  const insulator = mkResolved("ins", "synthetic puffy", {
    warmth: s("high", "high", "manufacturer", "100g synthetic"),
    packability: s("packable", "high", "manufacturer", "compressible"),
    // A puffy is known NOT to be a weather shell — stated, not left unknown (honest classification).
    waterproofness: s("none", "high", "inferred", "untreated face fabric"),
    wind_resistance: s("none", "medium", "inferred", "air-permeable shell"),
  }, { layering_role: ["static_insulation", "standalone"] });

  it("shell + insulation together satisfy the weather-protection system", () => {
    const combo = evaluateCombination([shell, insulator], "weather_shell", ctx);
    expect(combo.result).toBe("satisfies");
    expect(combo.itemIds.sort()).toEqual(["ins", "shell"]);
  });

  it("REMOVING THE SHELL drops weather protection (insulation alone is not a weather system)", () => {
    const combo = evaluateCombination([insulator], "weather_shell", ctx);
    expect(combo.result).toBe("fails");
    // And the single-item path also can't make a puffy into a shell.
    expect(evaluateCapability(insulator, "weather_shell", ctx)).toBe("fails");
  });

  it("REMOVING THE INSULATION drops the SYSTEM (a bare shell forms no shell-over-warmth system)", () => {
    // The shell alone has no distinct warmth base, so the *combination* yields no system. (Its single-
    // item weather_shell still passes — that path is asserted separately; here we prove the conjunction.)
    const combo = evaluateCombination([shell], "weather_shell", ctx);
    expect(combo.result).toBe("fails");
    expect(combo.itemIds).toHaveLength(0);
  });
});

describe("layering systems — mild archetype: a single item suffices, combination must NOT over-trigger", () => {
  // Mild conditions: warm enough that derive emits NO warmth/shell requirement, and a single sun layer
  // covers what is needed. The combination logic must neither invent a layering need nor add layers.
  const mild = defaultConditions({
    temp_min_c: 14, temp_max_c: 24, precipitation: "none", wind: "calm", sun: "high",
    exertion: "low", duration: "day", exposure: "sheltered", activities: ["travel"],
  });

  const sunHoody = mkResolved("sun", "sun hoody", {
    moisture_management: s("wicks", "high", "manufacturer", "polyester"),
    dry_speed: s("fast", "high", "manufacturer", "fast-dry"),
    breathability: s("high", "high", "inferred", "airy"),
    warmth: s("minimal", "high", "inferred", "single layer"),
    upf: { value: 50, source: "manufacturer", evidence: "UPF 50" },
  }, { layering_role: ["next_to_skin", "standalone"], function_purpose: ["sun_protection", "cooling"] });

  const fleece = mkResolved("fleece", "warm fleece", {
    warmth: s("high", "high", "manufacturer", "300-wt"),
  }, { layering_role: ["mid"] });

  it("there is no additive warmth demand in mild conditions (target is null)", () => {
    expect(warmthTargetRank({ conditions: mild })).toBe(null);
  });

  it("a single item covers the needs; no spurious systems and no insulation requirement invented", () => {
    const res = recommend([sunHoody, fleece], env("Mild travel", mild));
    // The only requirements derived are sun + cooling; both satisfied by the single sun hoody.
    const sun = res.outcomes.find((o) => o.capability === "sun_protection")!;
    expect(sun.status).toBe("satisfied");
    expect(sun.satisfiedBy.some((r) => r.id === "sun")).toBe(true);
    expect(sun.satisfiedBySystem).toHaveLength(0);
    // No packable_insulation requirement exists at all in mild conditions.
    expect(res.outcomes.some((o) => o.capability === "packable_insulation")).toBe(false);
    // Even asking the combiner directly: no warmth system is fabricated (no thermal demand).
    expect(evaluateCombination([sunHoody, fleece], "packable_insulation", { conditions: mild }).result).toBe("fails");
  });
});

describe("layering systems — unknown deciding facet demotes a would-be system to VERIFY (not a false satisfy)", () => {
  // Cold-dry target 5. base(1)+mid(2)=3 < 5; the third layer that could close the gap has UNKNOWN warmth.
  // The engine must demote to "verify" (uncertain), never fabricate the missing warmth to satisfy.
  const cold = defaultConditions({
    temp_min_c: -7, temp_max_c: 2, precipitation: "none", wind: "calm", sun: "low",
    exertion: "low", duration: "day", exposure: "exposed", activities: ["hiking"],
  });

  const base = mkResolved("base", "merino base", {
    warmth: s("light", "high", "manufacturer", "150 wt"),
  }, { layering_role: ["base"] });
  const mid = mkResolved("mid", "fleece", {
    warmth: s("moderate", "high", "manufacturer", "200 wt"),
  }, { layering_role: ["mid"] });
  // A worn static-insulation piece whose warmth is genuinely unknown (no value).
  const mystery = mkResolved("mystery", "unlabeled puffy", {}, { layering_role: ["static_insulation"] });

  it("a combination needing the unknown layer demotes to 'verify', not 'satisfied'", () => {
    const res = recommend([base, mid, mystery], env("Cold dry, unknown layer", cold));
    const warmth = res.outcomes.find((o) => o.capability === "packable_insulation")!;
    expect(warmth.status).toBe("uncertain"); // blocked_unknown surfaced
    expect(warmth.satisfiedBySystem).toHaveLength(0); // never fabricated into a satisfying system
    expect(warmth.blockedBy.some((r) => r.id === "mystery")).toBe(true); // the unknown layer flagged to verify
    expect(res.uncertain.some((u) => u.capability === "packable_insulation")).toBe(true);
    expect(res.gaps.some((g) => g.capability === "packable_insulation")).toBe(false);
  });

  it("a low-confidence warmth on the deciding layer also demotes (not a confident satisfy)", () => {
    const lowConf = mkResolved("lowconf", "maybe-warm puffy", {
      warmth: s("high", "low", "inferred", "guessed warm"),
    }, { layering_role: ["static_insulation"] });
    const res = recommend([base, mid, lowConf], env("Cold dry, low-confidence layer", cold));
    const warmth = res.outcomes.find((o) => o.capability === "packable_insulation")!;
    expect(warmth.status).toBe("uncertain");
    expect(warmth.satisfiedBySystem).toHaveLength(0);
  });
});
