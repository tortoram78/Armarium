// Thin Open-Meteo HTTP fetcher — the ONLY networking piece of weather auto-conditions (Phase 3 step 3).
//
// This is the network half the pure core (`src/core/weather`) deliberately omits. The core owns the
// testable raw→domain adaptation (`adaptOpenMeteoGeocoding`, `adaptOpenMeteoForecast`, `buildForecast`)
// and Zod validation at the boundary; this module owns ONLY the two HTTP calls (geocode → forecast) and
// wires their JSON through those pure adapters.
//
// CONTRACT — "fail to unknown", consistent with the project-wide unknown-is-first-class rule:
//   The only two outcomes are a valid `ForecastData` or `null`. This function NEVER throws and NEVER
//   surfaces a 500. ANY failure — an unknown location (geocode returns no results), a network error, a
//   non-OK HTTP status, a JSON parse failure, or an adapter throw (e.g. geocoding JSON missing the
//   `timezone` the adapter requires) — degrades to `null`. The recommendation flow already treats absent
//   weather as unknown conditions, and the trip-form UI falls back to manual condition entry on `null`.
//
// FORECAST HORIZON: Open-Meteo's forecast endpoint covers ~16 days ahead. A far-future `startDate`/
// `endDate` (or any out-of-range window) makes the API return an error payload / non-200 → our catch
// yields `null` → the UI falls back to manual entry. We do not special-case this; it is just one more
// degrade-to-null path.
//
// PURITY: no module-load side effects, no env reads at import, no new npm dependency — global `fetch`
// only, injected via `deps.fetchFn` in tests so the hermetic gate never touches the real network (the
// cloud sandbox cannot reliably reach external HTTP APIs; the live call is verified on Vercel).
//
// FUTURE OPTIMIZATION (intentionally omitted in v1): a short-TTL in-memory cache keyed by
// (location,start,end) would cut duplicate geocode/forecast round-trips for repeated planning of the
// same trip. Skipped here to keep the module side-effect-free and trivially testable; add later if the
// call volume warrants it.

import {
  adaptOpenMeteoForecast,
  adaptOpenMeteoGeocoding,
  buildForecast,
  type ForecastData,
} from "@/core/weather";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// The EXACT daily fields + metric units the pure adapter validates. Wrong units would silently mis-scale
// the downstream thresholds, so these are pinned here next to the request, not spread across call sites.
const DAILY_FIELDS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "weather_code",
].join(",");

export interface ForecastDeps {
  /** Defaults to the real `globalThis.fetch`. Injected so tests never touch the network. */
  fetchFn?: typeof fetch;
}

/** Build the geocoding request URL for a free-text location query. */
function buildGeocodingUrl(location: string): string {
  const params = new URLSearchParams({
    name: location,
    count: "1",
    language: "en",
    format: "json",
  });
  return `${GEOCODING_URL}?${params.toString()}`;
}

/** Build the forecast request URL for resolved coordinates + an ISO (yyyy-mm-dd) date window. */
function buildForecastUrl(latitude: number, longitude: number, startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: DAILY_FIELDS,
    temperature_unit: "celsius",
    precipitation_unit: "mm",
    wind_speed_unit: "kmh",
    timezone: "auto",
    start_date: startDate,
    end_date: endDate,
  });
  return `${FORECAST_URL}?${params.toString()}`;
}

/** GET a URL and parse the JSON body. Throws on non-OK status or a parse failure (caught by the caller). */
async function fetchJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchFn(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`open-meteo: non-OK status ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch a normalized forecast for a free-text `location` over an ISO (yyyy-mm-dd) `startDate`..`endDate`
 * window. Geocode → forecast → adapt, all through the pure core.
 *
 * Returns `null` (never throws) when the location is unknown OR anything in the pipeline fails — see the
 * "fail to unknown" contract in the module header.
 */
export async function getForecast(
  location: string,
  startDate: string,
  endDate: string,
  deps?: ForecastDeps,
): Promise<ForecastData | null> {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return null;

  try {
    // 1. Geocode the free-text location to coordinates. No results → unknown location → null (the
    //    forecast endpoint is NOT called).
    const geoJson = await fetchJson(fetchFn, buildGeocodingUrl(location));
    const resolved = adaptOpenMeteoGeocoding(geoJson);
    if (!resolved) return null;

    // 2. Forecast for the resolved coordinates over the window, in the exact metric units the adapter
    //    validates. An out-of-horizon window makes the API return an error → caught below → null.
    const forecastJson = await fetchJson(
      fetchFn,
      buildForecastUrl(resolved.latitude, resolved.longitude, startDate, endDate),
    );
    const days = adaptOpenMeteoForecast(forecastJson);

    return buildForecast(resolved, days);
  } catch {
    // Any network error, non-OK status, JSON parse failure, or adapter throw → degrade to unknown.
    return null;
  }
}
