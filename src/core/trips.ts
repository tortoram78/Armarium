// Reusable trip envelopes. The canonical Marcy plan reduces to the required-capability set the
// recommendation engine reasons over.

import type { TripEnvelope } from "./recommend";

export const MARCY_ENVELOPE: TripEnvelope = {
  name: "Mount Marcy — mid-June alpine summit",
  description: "alpine summit, cold and windy, long day hike",
  required: [
    { capability: "weather_shell", severity: "critical" },
    { capability: "packable_insulation", severity: "high" },
    { capability: "wicking_base", severity: "high" },
    { capability: "sun_protection", severity: "medium" },
  ],
};
