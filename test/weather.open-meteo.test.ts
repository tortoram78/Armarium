// Adapter tests: raw Open-Meteo provider JSON → normalized ForecastData domain types. Fixtures are
// constructed to match the REAL Open-Meteo API response shapes (parallel daily arrays; geocoding results;
// the documented null precipitation_probability_max case; malformed short-array + missing-daily payloads;
// empty geocoding). Per the "cross-archetype, not one canonical case" lesson we cover distinct shapes and
// every documented edge, asserting the adapted output AND re-validating it against the domain schema.

import { describe, it, expect } from "vitest";
import {
  adaptOpenMeteoForecast,
  adaptOpenMeteoGeocoding,
  buildForecast,
  ForecastDaySchema,
  ForecastLocationSchema,
  ForecastDataSchema,
  type RawOpenMeteoForecast,
  type RawOpenMeteoGeocoding,
} from "@/core/weather";

// --- Realistic raw FORECAST fixture (metric units, as the fetcher requests) ---------------------------
// Three-day window for an alpine location. Day 1 carries a NULL precipitation_probability_max (the
// documented "unknown probability" case). weather_code 73 = moderate snowfall on day 1.
const RAW_FORECAST: RawOpenMeteoForecast = {
  latitude: 44.125,
  longitude: -73.875,
  timezone: "America/New_York",
  timezone_abbreviation: "EST",
  utc_offset_seconds: -18000,
  daily: {
    time: ["2026-01-10", "2026-01-11", "2026-01-12"],
    temperature_2m_max: [1.4, -2.1, 3.0],
    temperature_2m_min: [-7.2, -11.0, -4.5],
    precipitation_sum: [12.3, 0.0, 2.1],
    precipitation_probability_max: [null, 0, 65],
    wind_speed_10m_max: [48.2, 51.0, 22.5],
    weather_code: [73, 0, 61],
  },
  daily_units: {
    time: "iso8601",
    temperature_2m_max: "°C",
    temperature_2m_min: "°C",
    precipitation_sum: "mm",
    precipitation_probability_max: "%",
    wind_speed_10m_max: "km/h",
    weather_code: "wmo code",
  },
};

describe("adaptOpenMeteoForecast — happy path", () => {
  const days = adaptOpenMeteoForecast(RAW_FORECAST);

  it("zips the parallel daily arrays into one ForecastDay per index", () => {
    expect(days).toHaveLength(3);
    expect(days[0]).toEqual({
      date: "2026-01-10",
      tempMaxC: 1.4,
      tempMinC: -7.2,
      precipSumMm: 12.3,
      precipProbMaxPct: 0, // null → 0 (documented unknown probability)
      windMaxKmh: 48.2,
      weatherCode: 73,
    });
    expect(days[1]).toEqual({
      date: "2026-01-11",
      tempMaxC: -2.1,
      tempMinC: -11.0,
      precipSumMm: 0.0,
      precipProbMaxPct: 0,
      windMaxKmh: 51.0,
      weatherCode: 0,
    });
    expect(days[2]!.precipProbMaxPct).toBe(65);
    expect(days[2]!.weatherCode).toBe(61);
  });

  it("maps a NULL precipitation_probability_max to 0, never to null/NaN", () => {
    expect(days[0]!.precipProbMaxPct).toBe(0);
    expect(Number.isNaN(days[0]!.precipProbMaxPct)).toBe(false);
  });

  it("produces days that satisfy the ForecastDay domain schema", () => {
    for (const d of days) {
      expect(() => ForecastDaySchema.parse(d)).not.toThrow();
    }
  });

  it("does not unit-convert: metric values pass through verbatim", () => {
    expect(days[0]!.tempMaxC).toBe(1.4); // already °C
    expect(days[0]!.windMaxKmh).toBe(48.2); // already km/h
    expect(days[0]!.precipSumMm).toBe(12.3); // already mm
  });
});

describe("adaptOpenMeteoForecast — degrade policy", () => {
  it("missing `daily` block → empty days (degrade to no weather data, no throw)", () => {
    const raw = { latitude: 10, longitude: 20, timezone: "UTC" };
    expect(adaptOpenMeteoForecast(raw)).toEqual([]);
  });

  it("mismatched array lengths (short array) → empty days, never a half-zipped row", () => {
    const malformed = {
      ...RAW_FORECAST,
      daily: {
        ...RAW_FORECAST.daily!,
        temperature_2m_min: [-7.2, -11.0], // only 2 of 3 → misaligned
      },
    };
    expect(adaptOpenMeteoForecast(malformed)).toEqual([]);
  });

  it("a single-day window adapts to exactly one day", () => {
    const oneDay = {
      latitude: 0,
      longitude: 0,
      timezone: "UTC",
      daily: {
        time: ["2026-06-01"],
        temperature_2m_max: [20],
        temperature_2m_min: [11],
        precipitation_sum: [0],
        precipitation_probability_max: [10],
        wind_speed_10m_max: [8],
        weather_code: [1],
      },
    };
    const days = adaptOpenMeteoForecast(oneDay);
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-06-01");
  });

  it("throws on a non-object / missing-envelope payload (caller programmer error)", () => {
    expect(() => adaptOpenMeteoForecast(null)).toThrow();
    expect(() => adaptOpenMeteoForecast({ daily: RAW_FORECAST.daily })).toThrow(); // no lat/lng
  });
});

// --- GEOCODING -----------------------------------------------------------------------------------------
const RAW_GEOCODING: RawOpenMeteoGeocoding = {
  results: [
    {
      name: "Lake Placid",
      latitude: 44.2795,
      longitude: -73.9799,
      timezone: "America/New_York",
      country: "United States",
      admin1: "New York",
    },
    {
      name: "Lake Placid",
      latitude: 27.293,
      longitude: -81.363,
      timezone: "America/New_York",
      country: "United States",
      admin1: "Florida",
    },
  ],
};

describe("adaptOpenMeteoGeocoding", () => {
  it("takes the FIRST result and builds a readable `name, admin1, country` label", () => {
    const loc = adaptOpenMeteoGeocoding(RAW_GEOCODING);
    expect(loc).toEqual({
      latitude: 44.2795,
      longitude: -73.9799,
      timezone: "America/New_York",
      locationLabel: "Lake Placid, New York, United States",
    });
    expect(() => ForecastLocationSchema.parse(loc)).not.toThrow();
  });

  it("omits missing label parts (no admin1, no country) without leaving stray commas", () => {
    const loc = adaptOpenMeteoGeocoding({
      results: [{ name: "Nullarbor", latitude: -31.4, longitude: 130.9, timezone: "Australia/Adelaide" }],
    });
    expect(loc?.locationLabel).toBe("Nullarbor");
  });

  it("includes country when admin1 is absent (`name, country`)", () => {
    const loc = adaptOpenMeteoGeocoding({
      results: [
        { name: "Reykjavík", latitude: 64.1, longitude: -21.9, timezone: "Atlantic/Reykjavik", country: "Iceland" },
      ],
    });
    expect(loc?.locationLabel).toBe("Reykjavík, Iceland");
  });

  it("empty results array → null (unknown location is first-class)", () => {
    expect(adaptOpenMeteoGeocoding({ results: [] })).toBeNull();
  });

  it("absent `results` key → null", () => {
    expect(adaptOpenMeteoGeocoding({})).toBeNull();
  });
});

// --- buildForecast + round-trip ------------------------------------------------------------------------
describe("buildForecast", () => {
  it("assembles a ForecastData that validates against the domain schema end to end", () => {
    const location = adaptOpenMeteoGeocoding(RAW_GEOCODING)!;
    const days = adaptOpenMeteoForecast(RAW_FORECAST);
    const forecast = buildForecast(location, days);
    expect(() => ForecastDataSchema.parse(forecast)).not.toThrow();
    expect(forecast.location.locationLabel).toBe("Lake Placid, New York, United States");
    expect(forecast.days).toHaveLength(3);
  });

  it("assembles cleanly with empty days (degraded forecast) — still schema-valid", () => {
    const location = adaptOpenMeteoGeocoding(RAW_GEOCODING)!;
    const forecast = buildForecast(location, []);
    expect(() => ForecastDataSchema.parse(forecast)).not.toThrow();
    expect(forecast.days).toEqual([]);
  });
});
