// Hermetic tests for the thin Open-Meteo HTTP fetcher. NO real network: every call goes through an
// INJECTED `fetchFn` returning captured fixture responses (the cloud sandbox cannot reach external HTTP
// APIs; the live call is verified on Vercel). We assert the fetcher's logic + the "fail-to-unknown"
// contract: the ONLY outcomes are a valid `ForecastData` or `null`. We also assert the EXACT request
// URL/params (daily fields + metric units + start/end), because wrong units silently mis-scale the
// downstream thresholds.

import { describe, it, expect } from "vitest";
import { getForecast, type ForecastDeps } from "@/server/weather-fetcher";
import { ForecastDataSchema } from "@/core/weather";

// --- Captured fixture payloads (shapes match the REAL Open-Meteo API) ----------------------------------

const GEO_HIT = {
  results: [
    {
      name: "Lake Placid",
      latitude: 44.2795,
      longitude: -73.9799,
      timezone: "America/New_York",
      country: "United States",
      admin1: "New York",
    },
  ],
};

const GEO_MISS = { results: [] };

const FORECAST_OK = {
  latitude: 44.25,
  longitude: -73.98,
  timezone: "America/New_York",
  timezone_abbreviation: "EST",
  utc_offset_seconds: -18000,
  daily: {
    time: ["2026-01-10", "2026-01-11"],
    temperature_2m_max: [1.4, -2.1],
    temperature_2m_min: [-7.2, -11.0],
    precipitation_sum: [12.3, 0.0],
    precipitation_probability_max: [80, null],
    wind_speed_10m_max: [48.2, 51.0],
    weather_code: [73, 0],
  },
};

// --- Injectable fetch helpers --------------------------------------------------------------------------

/** A JSON `Response` with a configurable status. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A stub fetch that records every requested URL and replies based on which host was hit. `geo`/`forecast`
 * may be a Response, a payload (wrapped 200 JSON), or a function that throws — letting each test drive a
 * specific failure mode.
 */
function stubFetch(opts: {
  urls: string[];
  geo?: Response | (() => never);
  forecast?: Response | (() => never);
}): ForecastDeps["fetchFn"] {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    opts.urls.push(url);
    const isGeo = url.includes("geocoding-api.open-meteo.com");
    const handler = isGeo ? opts.geo : opts.forecast;
    if (typeof handler === "function") return handler();
    if (handler) return handler;
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
}

// -------------------------------------------------------------------------------------------------------

describe("getForecast — happy path", () => {
  it("geocode hit + forecast → a valid ForecastData (location label + days)", async () => {
    const urls: string[] = [];
    const result = await getForecast("Lake Placid", "2026-01-10", "2026-01-11", {
      fetchFn: stubFetch({
        urls,
        geo: jsonResponse(GEO_HIT),
        forecast: jsonResponse(FORECAST_OK),
      }),
    });

    expect(result).not.toBeNull();
    expect(() => ForecastDataSchema.parse(result)).not.toThrow();
    expect(result!.location.locationLabel).toBe("Lake Placid, New York, United States");
    expect(result!.days).toHaveLength(2);
    expect(result!.days[0]).toMatchObject({ date: "2026-01-10", tempMaxC: 1.4, windMaxKmh: 48.2 });
    expect(result!.days[1]).toMatchObject({ date: "2026-01-11", tempMinC: -11.0, weatherCode: 0 });
    // null precipitation_probability_max degrades to 0 via the adapter (documented "unknown").
    expect(result!.days[1]!.precipProbMaxPct).toBe(0);
  });
});

describe("getForecast — geocode miss", () => {
  it("no results → null, and the forecast endpoint is NOT called", async () => {
    const urls: string[] = [];
    const result = await getForecast("Nowheresville XYZ", "2026-01-10", "2026-01-11", {
      fetchFn: stubFetch({ urls, geo: jsonResponse(GEO_MISS) }),
    });

    expect(result).toBeNull();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("geocoding-api.open-meteo.com");
    expect(urls.some((u) => u.includes("api.open-meteo.com/v1/forecast"))).toBe(false);
  });
});

describe("getForecast — forecast fetch fails", () => {
  it("forecast throws → null (not a throw)", async () => {
    const urls: string[] = [];
    const result = await getForecast("Lake Placid", "2026-01-10", "2026-01-11", {
      fetchFn: stubFetch({
        urls,
        geo: jsonResponse(GEO_HIT),
        forecast: () => {
          throw new Error("network down");
        },
      }),
    });
    expect(result).toBeNull();
  });

  it("forecast returns a non-OK status → null", async () => {
    const urls: string[] = [];
    const result = await getForecast("Lake Placid", "2030-01-10", "2030-01-25", {
      fetchFn: stubFetch({
        urls,
        geo: jsonResponse(GEO_HIT),
        // Out-of-horizon window → Open-Meteo replies with an error status, not 200.
        forecast: jsonResponse({ error: true, reason: "out of range" }, 400),
      }),
    });
    expect(result).toBeNull();
  });
});

describe("getForecast — malformed forecast JSON", () => {
  it("non-JSON forecast body → null (parse failure caught, not thrown)", async () => {
    const urls: string[] = [];
    const result = await getForecast("Lake Placid", "2026-01-10", "2026-01-11", {
      fetchFn: stubFetch({
        urls,
        geo: jsonResponse(GEO_HIT),
        forecast: new Response("<!doctype html>not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      }),
    });
    expect(result).toBeNull();
  });
});

describe("getForecast — request URLs and params", () => {
  it("builds the geocoding + forecast URLs with the exact daily fields, metric units, and date window", async () => {
    const urls: string[] = [];
    await getForecast("Lake Placid", "2026-01-10", "2026-01-11", {
      fetchFn: stubFetch({
        urls,
        geo: jsonResponse(GEO_HIT),
        forecast: jsonResponse(FORECAST_OK),
      }),
    });

    expect(urls).toHaveLength(2);

    // Geocoding request.
    const geoUrl = urls[0]!;
    expect(geoUrl).toContain("https://geocoding-api.open-meteo.com/v1/search");
    const geoParams = new URL(geoUrl).searchParams;
    expect(geoParams.get("name")).toBe("Lake Placid"); // URL-encoded space round-trips correctly
    expect(geoParams.get("count")).toBe("1");
    expect(geoParams.get("language")).toBe("en");
    expect(geoParams.get("format")).toBe("json");

    // Forecast request — the adapter validates these EXACT daily fields + metric units.
    const fcUrl = urls[1]!;
    expect(fcUrl).toContain("https://api.open-meteo.com/v1/forecast");
    const fc = new URL(fcUrl).searchParams;
    expect(fc.get("latitude")).toBe("44.2795");
    expect(fc.get("longitude")).toBe("-73.9799");
    expect(fc.get("daily")).toBe(
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code",
    );
    expect(fc.get("temperature_unit")).toBe("celsius");
    expect(fc.get("precipitation_unit")).toBe("mm");
    expect(fc.get("wind_speed_unit")).toBe("kmh");
    expect(fc.get("timezone")).toBe("auto");
    expect(fc.get("start_date")).toBe("2026-01-10");
    expect(fc.get("end_date")).toBe("2026-01-11");
  });
});
