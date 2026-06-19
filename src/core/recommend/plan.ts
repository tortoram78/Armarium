// planTrip — the Layer 2 entry point. Given the inventory and structured conditions, derive the
// required capabilities and produce picks + gaps. The web app and (later) an MCP server both call this.

import type { ResolvedItem } from "../resolved";
import type { TripConditions } from "../conditions";
import { recommend, type RecommendationResult, type TripEnvelope } from "./index";
import { deriveRequirements } from "./derive";

export function buildEnvelope(name: string, conditions: TripConditions, description?: string): TripEnvelope {
  return { name, description, conditions, required: deriveRequirements(conditions) };
}

export function planTrip(
  items: ResolvedItem[],
  name: string,
  conditions: TripConditions,
  description?: string,
): RecommendationResult {
  return recommend(items, buildEnvelope(name, conditions, description));
}
