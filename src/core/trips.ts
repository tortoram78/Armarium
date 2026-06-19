// Trip presets — structured conditions for common archetypes, used to seed the Plan UI and to exercise
// the general engine. These are *inputs* to deriveRequirements, not hardcoded recommendation logic, so
// any of them (and any user-described trip) flows through the same reasoning.

import { defaultConditions, type TripConditions } from "./conditions";

export interface TripPreset {
  slug: string;
  name: string;
  description: string;
  conditions: TripConditions;
}

export const MARCY_CONDITIONS: TripConditions = defaultConditions({
  temp_min_c: 3,
  temp_max_c: 12,
  precipitation: "light",
  wind: "strong",
  sun: "high",
  exertion: "high",
  duration: "day",
  exposure: "alpine",
  activities: ["hiking", "alpine"],
});

export const TRIP_PRESETS: TripPreset[] = [
  {
    slug: "marcy-alpine",
    name: "Mount Marcy — mid-June alpine summit",
    description: "Alpine summit, cold and windy, long day hike with afternoon-shower potential.",
    conditions: MARCY_CONDITIONS,
  },
  {
    slug: "desert-day",
    name: "Desert day hike",
    description: "Hot, exposed, intense sun, low humidity.",
    conditions: defaultConditions({
      temp_min_c: 18, temp_max_c: 36, precipitation: "none", wind: "breezy", sun: "high",
      exertion: "moderate", duration: "day", exposure: "exposed", activities: ["hiking"],
    }),
  },
  {
    slug: "rain-multiday",
    name: "Multi-day rain backpacking",
    description: "Sustained rain, cool, several days out.",
    conditions: defaultConditions({
      temp_min_c: 6, temp_max_c: 14, precipitation: "sustained", wind: "breezy", sun: "low",
      exertion: "moderate", duration: "multiday", exposure: "exposed", activities: ["backpacking", "hiking"],
    }),
  },
  {
    slug: "casual-travel",
    name: "Casual city travel",
    description: "Mild, sheltered, low exertion, lifestyle-leaning.",
    conditions: defaultConditions({
      temp_min_c: 12, temp_max_c: 22, precipitation: "none", wind: "calm", sun: "moderate",
      exertion: "low", duration: "day", exposure: "sheltered", activities: ["travel", "everyday"],
    }),
  },
];
