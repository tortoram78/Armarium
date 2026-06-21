// Cross-archetype tests for the offline NL trip parser. Per the engineering lesson ("a passing
// canonical test is not proof of generality"), we assert sensible envelopes AND derived requirements
// across ≥3 distinct trips, so the parser can't secretly collapse onto one archetype.

import { describe, it, expect } from "vitest";
import { parseConditionsHeuristic } from "@/core/recommend/parse-conditions";
import { deriveRequirements } from "@/core/recommend/derive";
import { TripConditionsSchema } from "@/core/conditions";

function analyze(desc: string) {
  const c = parseConditionsHeuristic(desc);
  expect(() => TripConditionsSchema.parse(c)).not.toThrow();
  return { c, reqs: deriveRequirements(c).map((r) => r.capability) };
}

describe("parseConditionsHeuristic — cross-archetype", () => {
  it("cold windy alpine summit → shell + insulation + wicking + sun", () => {
    const { c, reqs } = analyze("Cold and windy alpine summit, long day hike with a chance of afternoon showers");
    expect(c.exposure).toBe("alpine");
    expect(c.wind).toBe("strong");
    expect(c.precipitation).toBe("light");
    expect(reqs).toContain("weather_shell");
    expect(reqs).toContain("packable_insulation");
    expect(reqs).toContain("wicking_base");
    expect(reqs).toContain("sun_protection");
  });

  it("hot desert day hike → cooling + sun, no insulation", () => {
    const { c, reqs } = analyze("Hot exposed desert day hike with intense sun");
    expect(c.sun).toBe("high");
    expect(c.temp_max_c).not.toBeNull();
    expect(c.temp_max_c as number).toBeGreaterThanOrEqual(24);
    expect(reqs).toContain("sun_protection");
    expect(reqs).toContain("cooling");
    expect(reqs).not.toContain("packable_insulation");
  });

  it("multi-day sustained rain → critical weather_shell + sleep_warmth", () => {
    const { c, reqs } = analyze("Multi-day backpacking trip in sustained rain, cool temperatures");
    expect(c.precipitation).toBe("sustained");
    expect(c.duration).toBe("multiday");
    expect(reqs).toContain("weather_shell");
    expect(reqs).toContain("sleep_warmth");
  });

  it("casual city travel → no critical shell/insulation requirements", () => {
    const { c, reqs } = analyze("Casual city travel, mild weather, relaxed pace");
    expect(c.exposure).toBe("sheltered");
    expect(c.exertion).toBe("low");
    expect(reqs).not.toContain("weather_shell");
    expect(reqs).not.toContain("packable_insulation");
  });

  it("explicit Fahrenheit is converted to Celsius", () => {
    const { c } = analyze("Day hike, temps around 32F");
    expect(c.temp_min_c).toBe(0);
  });
});
