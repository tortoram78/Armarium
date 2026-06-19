// Structured trip conditions — the general envelope the recommender reasons over. Any trip (alpine,
// desert, multi-day rain, casual travel) is expressed here, by NL parsing or a structured form. This is
// what de-couples the engine from any one trip: recommendations are derived from these conditions, not
// hardcoded.

import { z } from "zod";

export const PRECIPITATION = ["none", "light", "sustained", "snow"] as const;
export const WIND = ["calm", "breezy", "strong"] as const;
export const SUN = ["low", "moderate", "high"] as const;
export const EXERTION = ["low", "moderate", "high"] as const;
export const DURATION = ["day", "overnight", "multiday"] as const;
export const EXPOSURE = ["sheltered", "exposed", "alpine"] as const;

export type Precipitation = (typeof PRECIPITATION)[number];
export type Wind = (typeof WIND)[number];
export type Sun = (typeof SUN)[number];
export type Exertion = (typeof EXERTION)[number];
export type Duration = (typeof DURATION)[number];
export type Exposure = (typeof EXPOSURE)[number];

export const TripConditionsSchema = z.object({
  temp_min_c: z.number().nullable(),
  temp_max_c: z.number().nullable(),
  precipitation: z.enum(PRECIPITATION),
  wind: z.enum(WIND),
  sun: z.enum(SUN),
  exertion: z.enum(EXERTION),
  duration: z.enum(DURATION),
  exposure: z.enum(EXPOSURE),
  activities: z.array(z.string()),
});
export type TripConditions = z.infer<typeof TripConditionsSchema>;

export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const cToF = (c: number): number => (c * 9) / 5 + 32;

export function defaultConditions(p: Partial<TripConditions> = {}): TripConditions {
  return {
    temp_min_c: null,
    temp_max_c: null,
    precipitation: "none",
    wind: "calm",
    sun: "moderate",
    exertion: "moderate",
    duration: "day",
    exposure: "sheltered",
    activities: [],
    ...p,
  };
}
