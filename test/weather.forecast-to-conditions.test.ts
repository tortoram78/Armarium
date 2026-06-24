// Cross-archetype tests for forecastToConditions. Per the engineering lesson ("a passing canonical test
// is not proof of generality"), we assert DISTINCT conditions across ≥3 weather archetypes plus edge
// cases, so the mapping can't secretly collapse onto one archetype. Fixtures are captured-shape
// ForecastData (not live fetches).

import { describe, it, expect } from "vitest";
import { forecastToConditions, ForecastDataSchema, type ForecastData, type ForecastDay } from "@/core/weather";
import { TripConditionsSchema, defaultConditions } from "@/core/conditions";
import { deriveRequirements } from "@/core/recommend/derive";

const LOC = { latitude: 44.11, longitude: -73.92, timezone: "America/New_York", locationLabel: "Test, NY" };

function day(p: Partial<ForecastDay> & { date: string }): ForecastDay {
  return {
    tempMaxC: 15,
    tempMinC: 5,
    precipSumMm: 0,
    precipProbMaxPct: 0,
    windMaxKmh: 5,
    weatherCode: 0,
    ...p,
  };
}

function forecast(days: ForecastDay[]): ForecastData {
  return { location: LOC, days };
}

function analyze(f: ForecastData) {
  const c = forecastToConditions(f);
  expect(() => TripConditionsSchema.parse(c)).not.toThrow();
  expect(() => ForecastDataSchema.parse(f)).not.toThrow();
  return { c, reqs: deriveRequirements(c).map((r) => r.capability) };
}

describe("forecastToConditions — cross-archetype", () => {
  it("cold-wet-windy multi-day → cold band + sustained wet + strong wind (shell + insulation)", () => {
    const { c, reqs } = analyze(
      forecast([
        day({ date: "2026-01-10", tempMaxC: 1, tempMinC: -7, precipSumMm: 12, precipProbMaxPct: 90, windMaxKmh: 50, weatherCode: 73 }),
        day({ date: "2026-01-11", tempMaxC: 0, tempMinC: -9, precipSumMm: 8, precipProbMaxPct: 80, windMaxKmh: 45, weatherCode: 75 }),
        day({ date: "2026-01-12", tempMaxC: 3, tempMinC: -5, precipSumMm: 6, precipProbMaxPct: 70, windMaxKmh: 40, weatherCode: 71 }),
      ]),
    );
    expect(c.temp_min_c).toBe(-9); // coldest night across the window, NOT averaged
    expect(c.temp_max_c).toBe(3);
    expect(c.precipitation).toBe("snow"); // WMO snow codes present
    expect(c.wind).toBe("strong");
    expect(c.duration).toBe("multiday");
    // very-cold (-9 ≤ -5) + snow → critical shell + insulation; multiday → sleep warmth
    expect(reqs).toContain("weather_shell");
    expect(reqs).toContain("packable_insulation");
    expect(reqs).toContain("sleep_warmth");
  });

  it("hot-dry-calm single→two-day → hot band + dry + calm (cooling, no insulation/shell)", () => {
    const { c, reqs } = analyze(
      forecast([
        day({ date: "2026-07-01", tempMaxC: 34, tempMinC: 21, precipSumMm: 0, precipProbMaxPct: 5, windMaxKmh: 8, weatherCode: 0 }),
        day({ date: "2026-07-02", tempMaxC: 31, tempMinC: 19, precipSumMm: 0, precipProbMaxPct: 0, windMaxKmh: 12, weatherCode: 1 }),
      ]),
    );
    expect(c.temp_min_c).toBe(19);
    expect(c.temp_max_c).toBe(34);
    expect(c.precipitation).toBe("none");
    expect(c.wind).toBe("calm");
    expect(c.duration).toBe("overnight");
    expect(reqs).not.toContain("weather_shell");
    expect(reqs).not.toContain("packable_insulation");
  });

  it("mild mixed week — cold nights, warm days → band SPANS (coldest night respected)", () => {
    const { c, reqs } = analyze(
      forecast([
        day({ date: "2026-05-01", tempMaxC: 22, tempMinC: 3, precipSumMm: 0, precipProbMaxPct: 10, windMaxKmh: 15 }),
        day({ date: "2026-05-02", tempMaxC: 24, tempMinC: 1, precipSumMm: 2, precipProbMaxPct: 45, windMaxKmh: 22 }),
        day({ date: "2026-05-03", tempMaxC: 19, tempMinC: 5, precipSumMm: 0, precipProbMaxPct: 20, windMaxKmh: 18 }),
        day({ date: "2026-05-04", tempMaxC: 25, tempMinC: 4, precipSumMm: 1, precipProbMaxPct: 30, windMaxKmh: 30 }),
      ]),
    );
    expect(c.temp_min_c).toBe(1); // coldest night not averaged away by the 24°C days
    expect(c.temp_max_c).toBe(25); // warmest day
    expect(c.precipitation).toBe("light"); // 5 mm total + 45% prob, no heavy day, no snow
    expect(c.wind).toBe("breezy"); // peak 30 km/h — between 20 and 38
    expect(c.duration).toBe("multiday");
    // cold night (1 ≤ 8) but not very-cold → insulation present; warm day (25 ≥ 24) → could be hot/cooling
    expect(reqs).toContain("packable_insulation");
  });
});

describe("forecastToConditions — edges & totality (unknown is first-class)", () => {
  it("empty forecast → plain defaults, temps unknown (null), nothing fabricated", () => {
    const c = forecastToConditions(forecast([]));
    expect(c).toEqual(defaultConditions());
    expect(c.temp_min_c).toBeNull();
    expect(c.temp_max_c).toBeNull();
    expect(c.precipitation).toBe("none");
    expect(c.wind).toBe("calm");
    expect(c.duration).toBe("day");
  });

  it("single day → day duration; band uses that day's min/max", () => {
    const { c } = analyze(
      forecast([day({ date: "2026-09-09", tempMaxC: 16, tempMinC: 9, precipSumMm: 3, precipProbMaxPct: 60, windMaxKmh: 25 })]),
    );
    expect(c.duration).toBe("day");
    expect(c.temp_min_c).toBe(9);
    expect(c.temp_max_c).toBe(16);
    expect(c.precipitation).toBe("light"); // 3 mm + 60% prob, under sustained threshold
    expect(c.wind).toBe("breezy");
  });

  it("trace precip below thresholds → dry; null weatherCode tolerated", () => {
    const { c } = analyze(
      forecast([day({ date: "2026-08-08", precipSumMm: 0.3, precipProbMaxPct: 15, windMaxKmh: 3, weatherCode: null })]),
    );
    expect(c.precipitation).toBe("none"); // 0.3 mm + 15% prob both under thresholds
    expect(c.wind).toBe("calm");
  });

  it("weather facets only — sun/exertion/exposure/activities stay at defaults", () => {
    const { c } = analyze(
      forecast([day({ date: "2026-06-06", tempMaxC: 28, tempMinC: 14, precipSumMm: 0, precipProbMaxPct: 0, windMaxKmh: 10 })]),
    );
    const d = defaultConditions();
    expect(c.sun).toBe(d.sun);
    expect(c.exertion).toBe(d.exertion);
    expect(c.exposure).toBe(d.exposure);
    expect(c.activities).toEqual(d.activities);
  });
});
