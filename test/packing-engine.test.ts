// ADR-0027 — the rebuilt packing engine. A trip → a quantified, gear-first CHECKLIST (not a 9-capability
// audit). Per the standing engineering lesson, generality is asserted across ≥3 DISTINCT archetypes so the
// engine cannot be secretly hardcoded to one trip: the need set, quantities, and owned/gap matching must
// genuinely vary with the conditions.

import { describe, it, expect } from "vitest";
import { planPacking, type PackingPlan } from "@/core/packing";
import { resolveFromClassification } from "@/core/resolved";
import { unknownBehavioralClassification } from "@/core/enrich";
import { DEFAULT_INVENTORY } from "@/core/inventory";
import { defaultConditions, type TripConditions } from "@/core/conditions";

/** A closet item identified only by name/tags (facets unknown) — exercises the generic matcher. */
function item(name: string, tags: string[] = []) {
  const c = unknownBehavioralClassification(name);
  return resolveFromClassification(
    name.replace(/\s+/g, "-").toLowerCase(),
    c,
    { ...DEFAULT_INVENTORY, userTags: tags },
  );
}

const line = (p: PackingPlan, key: string) => p.sections.flatMap((s) => s.lines).find((l) => l.key === key);
const cats = (p: PackingPlan) => new Set(p.sections.map((s) => s.category));
const lineCount = (p: PackingPlan) => p.sections.reduce((n, s) => n + s.lines.length, 0);

const ALPINE_DAY: TripConditions = defaultConditions({
  temp_min_c: 3, temp_max_c: 12, precipitation: "light", wind: "strong", sun: "high",
  exertion: "high", duration: "day", exposure: "alpine", activities: ["hiking", "alpine"],
});
const MULTIDAY_WET: TripConditions = defaultConditions({
  temp_min_c: 0, temp_max_c: 12, precipitation: "sustained", wind: "breezy", sun: "low",
  exertion: "moderate", duration: "multiday", exposure: "exposed", activities: ["backpacking", "hiking"],
});
const DESERT_DAY: TripConditions = defaultConditions({
  temp_min_c: 18, temp_max_c: 36, precipitation: "none", wind: "breezy", sun: "high",
  exertion: "moderate", duration: "day", exposure: "exposed", activities: ["hiking"],
});
const CITY_TRAVEL: TripConditions = defaultConditions({
  temp_min_c: 12, temp_max_c: 22, precipitation: "none", wind: "calm", sun: "moderate",
  exertion: "low", duration: "day", exposure: "sheltered", activities: ["travel", "city"],
});

describe("packing engine — produces a real, broad checklist (not a 9-capability audit)", () => {
  it("spans many packing domains beyond clothing", () => {
    const p = planPacking([], "Cascades", MULTIDAY_WET);
    // The old auditor could only ever speak to clothing/thermal. The new plan covers the big-3 + essentials.
    for (const c of ["protection", "shelter", "sleep", "water", "nutrition", "navigation", "light", "first_aid"]) {
      expect(cats(p).has(c as never)).toBe(true);
    }
    expect(lineCount(p)).toBeGreaterThan(15);
  });
});

describe("packing engine — generality across archetypes (≥3 distinct cases)", () => {
  it("overnight needs (shelter/sleep) appear ONLY for overnight trips", () => {
    expect(line(planPacking([], "x", MULTIDAY_WET, { activities: ["backpacking"] }), "shelter")).toBeTruthy();
    expect(line(planPacking([], "x", ALPINE_DAY), "shelter")).toBeUndefined();
    expect(line(planPacking([], "x", ALPINE_DAY), "sleep_bag")).toBeUndefined();
  });

  it("insulation appears in the cold, NOT in the desert heat", () => {
    expect(line(planPacking([], "x", ALPINE_DAY), "insulating_layer")).toBeTruthy();
    expect(line(planPacking([], "x", DESERT_DAY), "insulating_layer")).toBeUndefined();
  });

  it("sun protection appears under high sun, NOT on the overcast multiday", () => {
    expect(line(planPacking([], "x", DESERT_DAY), "sun_layer")).toBeTruthy();
    expect(line(planPacking([], "x", MULTIDAY_WET), "sun_layer")).toBeUndefined();
  });

  it("a city-travel trip is lifestyle-leaning — no shelter/sleep/navigation, docs lead", () => {
    const p = planPacking([], "Lisbon", CITY_TRAVEL);
    expect(line(p, "shelter")).toBeUndefined();
    expect(line(p, "navigation")).toBeUndefined();
    expect(line(p, "docs")!.severity).toBe("high");
  });

  it("the four archetypes yield genuinely different need sets", () => {
    const sigs = [ALPINE_DAY, MULTIDAY_WET, DESERT_DAY, CITY_TRAVEL].map((c) =>
      planPacking([], "x", c).sections.flatMap((s) => s.lines.map((l) => l.key)).sort().join(","),
    );
    expect(new Set(sigs).size).toBe(4); // no two archetypes collapse onto the same list
  });
});

describe("packing engine — quantities scale with the trip", () => {
  it("food scales from a day-trip snack to N days of meals", () => {
    const day = line(planPacking([], "x", ALPINE_DAY), "food")!;
    const multi = line(planPacking([], "x", MULTIDAY_WET), "food")!;
    expect(multi.quantity!.amount).toBeGreaterThan(day.quantity!.amount);
    expect(multi.quantity!.amount).toBe(4); // multiday → ~4 days
  });

  it("socks and party size scale the count", () => {
    const solo = line(planPacking([], "x", MULTIDAY_WET), "socks")!;
    const pair = line(planPacking([], "x", MULTIDAY_WET, { partySize: 2 }), "socks")!;
    expect(pair.quantity!.amount).toBe(solo.quantity!.amount * 2);
  });
});

describe("packing engine — matches owned gear (closet-aware), gaps the rest", () => {
  const closet = [
    item("MSR Hubba Hubba NX Tent"),
    item("Black Diamond Spot 400 Headlamp"),
    item("Sawyer Squeeze Water Filter"),
    item("Osprey Atmos AG 65 Pack"),
    item("Darn Tough Hiker Socks"),
  ];

  it("owned items attach to their need line as 'owned'; unmatched needs are gaps", () => {
    const p = planPacking(closet, "Cascades", MULTIDAY_WET, { activities: ["backpacking"] });
    const shelter = line(p, "shelter")!;
    expect(shelter.status).toBe("owned");
    expect(shelter.ownedBy.map((r) => r.name).join()).toMatch(/Hubba/);

    expect(line(p, "headlamp")!.status).toBe("owned");
    expect(line(p, "water_treatment")!.status).toBe("owned");
    expect(line(p, "pack")!.status).toBe("owned");
    expect(line(p, "socks")!.status).toBe("owned");

    // First-aid + stove are not in the closet → honest gaps to fill.
    expect(line(p, "first_aid")!.status).toBe("gap");
    expect(line(p, "stove")!.status).toBe("gap");
  });

  it("the brand-substring traps do NOT cross-match (MSR tent ≠ stove; Spot ≠ cook pot)", () => {
    const p = planPacking(closet, "Cascades", MULTIDAY_WET, { activities: ["backpacking"] });
    expect(line(p, "stove")!.status).toBe("gap"); // 'MSR Hubba' must not match the stove need
    expect(line(p, "cookware")!.status).toBe("gap"); // 'Spot' must not match cook pot
  });

  it("an empty closet yields a complete plan that is ALL gaps/verify — still useful (cold-start)", () => {
    const p = planPacking([], "Cascades", MULTIDAY_WET);
    expect(p.summary.owned).toBe(0);
    expect(p.summary.total).toBeGreaterThan(15);
    expect(p.summary.gap + p.summary.verify).toBe(p.summary.total);
  });
});
