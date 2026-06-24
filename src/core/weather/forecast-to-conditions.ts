// forecastToConditions — a PURE, total mapping from a normalized weather forecast to the EXISTING
// TripConditions envelope the recommender already reasons over. This is an INPUT CONVENIENCE, not a
// model change: it only fills the facets weather can actually determine (temp band, precipitation,
// wind, and the window's duration), and leaves everything weather cannot know (sun, exertion, exposure,
// activities) at the existing defaults. It never fabricates: a degenerate/empty forecast returns the
// weather-derived facets at their unknown/default. The function is total and never throws.
//
// Aggregation rule of thumb: take the WORST case across the window so safety-relevant capabilities
// (cold-protection, weather shell) are driven by the harshest day/night, never averaged away. The
// COLDEST night (min of tempMinC) and the WARMEST day (max of tempMaxC) define the spanned band; the
// wettest/windiest day defines precipitation/wind.

import { defaultConditions, type TripConditions, type Precipitation, type Wind, type Duration } from "../conditions";
import type { ForecastData } from "./forecast";

// WMO weather-interpretation codes that mean frozen precipitation (snowfall / snow showers). Used only
// to upgrade precipitation to "snow"; the magnitude is still decided by the numeric metrics.
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

// --- Thresholds (explicit + tunable; chosen to align with deriveRequirements' temp gates) ------------
// Precipitation: distinguish dry / showers / sustained wet. A day counts as "wet" when there is both a
// meaningful accumulation AND a non-trivial probability; sustained needs a heavier total.
const PRECIP_LIGHT_MM = 1; // ≥1 mm over a day registers as at least light
const PRECIP_SUSTAINED_MM = 10; // ≥10 mm total in a single day ⇒ sustained
const PRECIP_PROB_PCT = 40; // ≥40% max probability corroborates that precip is expected, not incidental
// Wind (km/h): rough Beaufort-style bands for the calm/breezy/strong facet.
const WIND_BREEZY_KMH = 20; // ≳ Beaufort 3
const WIND_STRONG_KMH = 38; // ≳ Beaufort 6 (near gale) — the threshold that should demand a windproof shell

function classifyPrecipitation(totalMm: number, maxProbPct: number, anySnow: boolean): Precipitation {
  const wet = totalMm >= PRECIP_LIGHT_MM || maxProbPct >= PRECIP_PROB_PCT;
  if (!wet) return "none";
  if (anySnow) return "snow";
  if (totalMm >= PRECIP_SUSTAINED_MM) return "sustained";
  return "light";
}

function classifyWind(maxKmh: number): Wind {
  if (maxKmh >= WIND_STRONG_KMH) return "strong";
  if (maxKmh >= WIND_BREEZY_KMH) return "breezy";
  return "calm";
}

// Duration from the number of distinct days in the window. Weather can't know the trip's intent, but the
// window length is a concrete fact the forecast carries, and duration is an EXISTING facet.
function classifyDuration(dayCount: number): Duration {
  if (dayCount >= 3) return "multiday";
  if (dayCount === 2) return "overnight";
  return "day";
}

/**
 * Map a normalized forecast onto the existing TripConditions. Fills ONLY weather-determinable facets:
 *  - temp_min_c  ← coldest night (min of tempMinC)        (drives cold-protection; never averaged)
 *  - temp_max_c  ← warmest day  (max of tempMaxC)
 *  - precipitation ← total precip + max probability (+ WMO snow codes)
 *  - wind        ← windiest day (max windMaxKmh)
 *  - duration    ← number of days in the window
 * Leaves sun / exertion / exposure / activities at their defaults (weather cannot determine them).
 * An empty forecast returns plain defaults (temps null = unknown, calm/none) — no fabrication.
 */
export function forecastToConditions(forecast: ForecastData): TripConditions {
  const days = forecast.days;
  if (days.length === 0) {
    // Degenerate window: nothing known. Weather-derived facets stay at their unknown/default.
    return defaultConditions();
  }

  let coldestNight = Infinity;
  let warmestDay = -Infinity;
  let precipTotalMm = 0;
  let maxPrecipProbPct = 0;
  let maxWindKmh = 0;
  let anySnow = false;

  for (const d of days) {
    if (d.tempMinC < coldestNight) coldestNight = d.tempMinC;
    if (d.tempMaxC > warmestDay) warmestDay = d.tempMaxC;
    precipTotalMm += d.precipSumMm;
    if (d.precipProbMaxPct > maxPrecipProbPct) maxPrecipProbPct = d.precipProbMaxPct;
    if (d.windMaxKmh > maxWindKmh) maxWindKmh = d.windMaxKmh;
    if (d.weatherCode !== null && SNOW_CODES.has(d.weatherCode)) anySnow = true;
  }

  // `Infinity`/`-Infinity` only survive if every day had non-finite temps; guard to keep totality.
  const temp_min_c = Number.isFinite(coldestNight) ? coldestNight : null;
  const temp_max_c = Number.isFinite(warmestDay) ? warmestDay : null;

  return defaultConditions({
    temp_min_c,
    temp_max_c,
    precipitation: classifyPrecipitation(precipTotalMm, maxPrecipProbPct, anySnow),
    wind: classifyWind(maxWindKmh),
    duration: classifyDuration(days.length),
  });
}
