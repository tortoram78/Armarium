// Conditions -> required capabilities. The general "reason backward from the trip to what gear must do"
// logic (decision-driver artifact). Works for ANY trip; thresholds are explicit and tunable. This is
// the heart of de-coupling the recommender from any single trip.

import type { TripConditions } from "../conditions";
import type { Requirement } from "./index";

export function deriveRequirements(c: TripConditions): Requirement[] {
  const reqs: Requirement[] = [];
  const tmin = c.temp_min_c;
  const tmax = c.temp_max_c;

  const wetLight = c.precipitation === "light";
  const heavyWet = c.precipitation === "sustained" || c.precipitation === "snow";
  const alpine = c.exposure === "alpine";
  const exposed = c.exposure === "exposed" || alpine;
  const cold = tmin !== null && tmin <= 8;
  const veryCold = tmin !== null && tmin <= -5;
  const coolDay = tmax !== null && tmax <= 18;
  const hot = tmax !== null && tmax >= 24;

  // A real waterproof/windproof shell — driven by precip or strong wind or a cold alpine objective.
  if (heavyWet || wetLight || c.wind === "strong" || (alpine && cold)) {
    const severity = heavyWet || alpine ? "critical" : "high";
    reqs.push({
      capability: "weather_shell",
      severity,
      reason: heavyWet
        ? "Sustained precipitation expected — needs a true waterproof shell."
        : alpine
          ? "Cold, exposed alpine objective — needs wind/weather protection."
          : "Wind or light precipitation expected.",
    });
  }

  // Packable worn insulation for cold (and cold stops on exposed days).
  if (cold) {
    const severity: Requirement["severity"] = veryCold ? "critical" : (tmin !== null && tmin <= 2) || exposed ? "high" : "medium";
    reqs.push({ capability: "packable_insulation", severity, reason: "Cold temperatures — needs packable warmth for stops/summit." });
  }

  // Wicking base when working hard in the cool/cold (sweat-then-chill is dangerous).
  if ((c.exertion === "high" || c.exertion === "moderate") && coolDay) {
    reqs.push({ capability: "wicking_base", severity: "high", reason: "High exertion in cool conditions — needs a non-cotton wicking base." });
  }

  // Sun protection in high UV (open sun or altitude).
  if (c.sun === "high" || alpine) {
    const severity: Requirement["severity"] = c.sun === "high" && hot ? "high" : "medium";
    reqs.push({ capability: "sun_protection", severity, reason: alpine ? "High-altitude UV." : "Strong sun exposure." });
  }

  // Hot-weather cooling layer.
  if (hot && c.sun !== "low") {
    reqs.push({ capability: "cooling", severity: tmax !== null && tmax >= 30 ? "high" : "medium", reason: "Hot and sunny — needs a fast-drying, breathable layer." });
  }

  // Overnight sleep warmth.
  if (c.duration === "overnight" || c.duration === "multiday") {
    reqs.push({ capability: "sleep_warmth", severity: "high", reason: "Overnight — needs a sleep system for the expected low." });
  }

  return reqs;
}
