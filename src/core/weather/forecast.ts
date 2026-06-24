// Normalized forecast domain types — the shape the server's Open-Meteo client adapts raw JSON INTO,
// and the shape forecastToConditions() consumes. Defined here (in the pure core) so both sides share
// one contract: the networking client owns raw→ForecastData; this module owns ForecastData→Conditions.
// No raw Open-Meteo fields leak in — this is a clean domain type, not the provider's JSON.

import { z } from "zod";

/**
 * One day of the trip window. Temperatures in Celsius, precip in millimetres / percent, wind in km/h.
 * `weatherCode` is the WMO weather-interpretation code (Open-Meteo's `weathercode`): we only read the
 * coarse snow band (71–77 snowfall, 85–86 snow showers) to distinguish frozen precip; everything else
 * is decided by the numeric metrics so we never depend on the full code table.
 */
export const ForecastDaySchema = z.object({
  date: z.string(),
  tempMaxC: z.number(),
  tempMinC: z.number(),
  precipSumMm: z.number(),
  precipProbMaxPct: z.number(),
  windMaxKmh: z.number(),
  weatherCode: z.number().nullable(),
});
export type ForecastDay = z.infer<typeof ForecastDaySchema>;

/** The resolved location the forecast is for (geocoded by the server client; carried for display). */
export const ForecastLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  locationLabel: z.string(),
});
export type ForecastLocation = z.infer<typeof ForecastLocationSchema>;

/** The full normalized forecast over the trip window. `days` may be empty (degenerate → unknown). */
export const ForecastDataSchema = z.object({
  location: ForecastLocationSchema,
  days: z.array(ForecastDaySchema),
});
export type ForecastData = z.infer<typeof ForecastDataSchema>;
