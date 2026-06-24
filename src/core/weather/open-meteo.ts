// PURE adapters: raw Open-Meteo provider JSON → the normalized `ForecastData` domain type. No networking
// lives here — the HTTP fetch is a thin server shim built separately. This module owns ONLY the testable
// raw→domain adaptation + Zod validation at the boundary, so the same logic can back a future MCP server.
//
// The raw schemas below describe the Open-Meteo response shapes we depend on; everything outside those
// fields is ignored (`.passthrough()` is intentional — providers add fields and we must not break). We
// REQUEST metric units (°C, mm, km/h) from the fetcher (`temperature_unit=celsius`,
// `precipitation_unit=mm`, `wind_speed_unit=kmh`) and do NOT unit-convert here; we only validate the
// numeric metrics are present.
//
// Degrade policy for a malformed FORECAST (missing `daily` block OR mismatched daily array lengths): we
// return EMPTY days rather than throwing. This is the safer choice — `forecastToConditions([])` already
// maps an empty window to unknown/default conditions (never fabricated), so a broken provider payload
// degrades to "no weather data" instead of surfacing a 500 to the UI. Total + never throws on shape: the
// only throw path is `adaptOpenMeteoForecast` rejecting input that is not even an object (programmer
// error), via the raw Zod parse on the envelope.

import { z } from "zod";
import { type ForecastData, type ForecastLocation } from "./forecast";

// --- Raw Open-Meteo FORECAST response -----------------------------------------------------------------
// The `daily` block carries PARALLEL arrays (one entry per day, aligned by index). `daily` itself is
// optional so a degenerate/empty provider response parses cleanly and degrades to empty days rather than
// throwing. `precipitation_probability_max` entries may be null (documented "unknown probability").
const RawOpenMeteoDailySchema = z.object({
  time: z.array(z.string()),
  temperature_2m_max: z.array(z.number()),
  temperature_2m_min: z.array(z.number()),
  precipitation_sum: z.array(z.number()),
  precipitation_probability_max: z.array(z.number().nullable()),
  wind_speed_10m_max: z.array(z.number()),
  weather_code: z.array(z.number().nullable()),
});

export const RawOpenMeteoForecastSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
    timezone_abbreviation: z.string().optional(),
    utc_offset_seconds: z.number().optional(),
    daily: RawOpenMeteoDailySchema.optional(),
    daily_units: z.record(z.string()).optional(),
  })
  .passthrough();

export type RawOpenMeteoForecast = z.infer<typeof RawOpenMeteoForecastSchema>;

// --- Raw Open-Meteo GEOCODING response ----------------------------------------------------------------
// Open-Meteo geocoding returns `results?: [...]`. Absent/empty results = unknown location (first-class).
const RawOpenMeteoGeocodingResultSchema = z
  .object({
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
    country: z.string().optional(),
    admin1: z.string().optional(),
  })
  .passthrough();

export const RawOpenMeteoGeocodingSchema = z
  .object({
    results: z.array(RawOpenMeteoGeocodingResultSchema).optional(),
  })
  .passthrough();

export type RawOpenMeteoGeocoding = z.infer<typeof RawOpenMeteoGeocodingSchema>;

/**
 * Adapt a raw Open-Meteo forecast response into the normalized `ForecastDay[]`.
 *
 * Mapping (per index across the parallel `daily` arrays):
 *  - date            ← time
 *  - tempMaxC        ← temperature_2m_max
 *  - tempMinC        ← temperature_2m_min
 *  - precipSumMm     ← precipitation_sum
 *  - precipProbMaxPct← precipitation_probability_max  (NULL → 0, documented "unknown probability")
 *  - windMaxKmh      ← wind_speed_10m_max
 *  - weatherCode     ← weather_code
 *
 * Degrade (return EMPTY days, never throw on bad shape): missing `daily` block, OR any daily array whose
 * length differs from `time.length`. A malformed forecast becomes "no weather data" downstream.
 *
 * Throws only if `rawJson` is not a valid forecast ENVELOPE (not an object / missing lat-lng) — a caller
 * programmer error, surfaced by the boundary Zod parse.
 */
export function adaptOpenMeteoForecast(rawJson: unknown): ForecastData["days"] {
  const raw = RawOpenMeteoForecastSchema.parse(rawJson);
  const daily = raw.daily;
  if (!daily) return [];

  const n = daily.time.length;
  const aligned =
    daily.temperature_2m_max.length === n &&
    daily.temperature_2m_min.length === n &&
    daily.precipitation_sum.length === n &&
    daily.precipitation_probability_max.length === n &&
    daily.wind_speed_10m_max.length === n &&
    daily.weather_code.length === n;
  if (!aligned) return []; // mismatched arrays ⇒ unsafe to zip → degrade to no weather data

  // Alignment is verified above, so every parallel array has exactly `n` entries — `map` over the index
  // array keeps access in-bounds without needing non-null assertions (satisfies noUncheckedIndexedAccess).
  return daily.time.map((date, i) => ({
    date,
    tempMaxC: daily.temperature_2m_max[i] as number,
    tempMinC: daily.temperature_2m_min[i] as number,
    precipSumMm: daily.precipitation_sum[i] as number,
    // NULL probability is "unknown" in Open-Meteo's docs; treat as 0 so it can't spuriously upgrade
    // precipitation. Numeric accumulation (precipSumMm) still drives wet/dry independently.
    precipProbMaxPct: daily.precipitation_probability_max[i] ?? 0,
    windMaxKmh: daily.wind_speed_10m_max[i] as number,
    weatherCode: daily.weather_code[i] ?? null,
  }));
}

/**
 * Adapt a raw Open-Meteo geocoding response into a `ForecastLocation`, taking the FIRST result.
 * `locationLabel` is a readable `"name, admin1, country"` with missing parts omitted.
 * No results / absent `results` → `null` (unknown location is first-class; the UI falls back to manual
 * entry). Throws only if `rawJson` is not a valid geocoding ENVELOPE.
 */
export function adaptOpenMeteoGeocoding(rawJson: unknown): ForecastLocation | null {
  const raw = RawOpenMeteoGeocodingSchema.parse(rawJson);
  const top = raw.results?.[0];
  if (!top) return null;

  const locationLabel = [top.name, top.admin1, top.country].filter(Boolean).join(", ");

  return {
    latitude: top.latitude,
    longitude: top.longitude,
    timezone: top.timezone,
    locationLabel,
  };
}

/** Assemble the final normalized `ForecastData` from a resolved location + adapted days. */
export function buildForecast(location: ForecastLocation, days: ForecastData["days"]): ForecastData {
  return { location, days };
}
