// The packing-plan model (ADR-0027) — the rebuilt engine's output. Where the old `RecommendationResult`
// was a per-CAPABILITY audit (satisfied/verify/gap over ~9 thermal facets), a `PackingPlan` is a real,
// quantified, gear-FIRST packing CHECKLIST: sections by purpose, each line either covered by gear you own,
// a "verify", or a gap — with quantities scaled to the trip. It is computed deterministically from the
// trip + the resolved closet (no LLM in this layer — Layer B breadth/narration is a later additive pass).
//
// PURE: this module declares types only. The Need MODEL is the generalization of `Capability`: a need is
// a unit of "what this trip requires", spanning ALL packing domains, expressed as DATA (see catalog.ts) —
// NOT a hardcoded category that routes logic. `NeedCategory` is a grouping/scoping TAG, never a switch.

import type { TripConditions } from "../conditions";
import type { CapabilityKey } from "../capabilities";

/**
 * The packing domains, a flat OPEN tag set used to GROUP the checklist and scope quantities. It is not a
 * routing enum — no engine logic branches on it; need derivation runs the same rule evaluation for every
 * need regardless of category. (This is the same posture `layering_role` holds — a facet/tag, not a
 * category — see ADR-0010/0027.)
 */
export const NEED_CATEGORIES = [
  "protection", // worn weather protection (shells)
  "insulation", // worn warmth (base/mid/puffy)
  "sun", // sun layers + sunscreen/glasses/hat
  "footwear",
  "carry", // the pack itself
  "shelter", // tent / bivy / emergency shelter
  "sleep", // bag + pad
  "water", // hydration + treatment
  "nutrition", // food + fuel + cooking
  "navigation", // map / compass / gps
  "light", // headlamp + batteries
  "first_aid",
  "fire", // ignition + repair/tools
  "hygiene", // toiletries
  "power", // phone / charging
  "docs", // permits / id / cash
  "activity", // activity-specific gear (poles, traction, bear canister…)
] as const;
export type NeedCategory = (typeof NEED_CATEGORIES)[number];

export const NEED_CATEGORY_LABELS: Record<NeedCategory, string> = {
  protection: "Weather protection",
  insulation: "Insulation & layers",
  sun: "Sun protection",
  footwear: "Footwear",
  carry: "Pack",
  shelter: "Shelter",
  sleep: "Sleep system",
  water: "Water",
  nutrition: "Food & cooking",
  navigation: "Navigation",
  light: "Light",
  first_aid: "First aid",
  fire: "Fire & repair",
  hygiene: "Hygiene",
  power: "Power & electronics",
  docs: "Documents & money",
  activity: "Activity-specific",
};

export type Severity = "critical" | "high" | "medium" | "low";

/** A scaled quantity for a line, e.g. {amount:3, unit:"pairs"} or {amount:2, unit:"L / day"}. */
export interface Quantity {
  amount: number;
  unit: string;
}

/**
 * The trip context the need rules reason over — the structured conditions plus derived trip shape
 * (days/nights from duration, party size, activities). The single input to every need's `applies`.
 */
export interface TripContext {
  conditions: TripConditions;
  activities: string[];
  days: number;
  nights: number;
  partySize: number;
}

/**
 * A NEED SPEC — the data that defines one packing requirement. `applies` returns the need's severity for
 * this trip (or null when it doesn't apply); the engine evaluates the SAME function for every need. A need
 * either maps to a faceted `capability` (so owned gear is matched by the existing evidence engine —
 * owned/verify/gap, never fabricated) OR is a generic item matched loosely by name (`matchTerms`).
 */
export interface NeedSpec {
  key: string;
  label: string;
  category: NeedCategory;
  /** Returns the severity this trip demands of the need, or null if the need is not required. */
  applies: (ctx: TripContext) => Severity | null;
  /** If set, coverage is decided by the faceted capability engine (3-state, unknown-safe). */
  capability?: CapabilityKey;
  /** For generic (non-faceted) needs: owned gear is matched when its name/tags contain one of these. */
  matchTerms?: readonly string[];
  /** Scaled quantity for this trip (counts, litres/day, days of food …). Null when a count is meaningless. */
  quantity?: (ctx: TripContext) => Quantity | null;
  /** Consumable (food/fuel/water) vs durable — drives display + (later) resupply reasoning. */
  consumable?: boolean;
  /** A short, human "why this is on your list". */
  rationale?: (ctx: TripContext) => string;
}

/** A reference to an owned item that covers (or might cover) a line. */
export interface PackItemRef {
  id: string;
  name: string;
}

export type LineStatus = "owned" | "verify" | "gap";

/** One line of the packing checklist. */
export interface PackingLine {
  key: string;
  label: string;
  category: NeedCategory;
  severity: Severity;
  status: LineStatus;
  quantity: Quantity | null;
  consumable: boolean;
  rationale?: string;
  /** Owned gear covering this line individually. */
  ownedBy: PackItemRef[];
  /** Owned gear covering it TOGETHER as a worn system (layering) — empty unless a system was needed. */
  systemBy: PackItemRef[];
  /** Owned gear that MIGHT cover it but has an unknown deciding facet ("verify"). */
  verifyBy: PackItemRef[];
}

/** A grouped section of the checklist. */
export interface PackingSection {
  category: NeedCategory;
  label: string;
  lines: PackingLine[];
}

/** Roll-up counts + the kit's known weight for the trip. */
export interface PackingSummary {
  total: number;
  owned: number;
  verify: number;
  gap: number;
  /** Sum of known `weight_grams` across owned items matched into the plan, or null if none are known. */
  weightGrams: number | null;
  /** Capacity of the largest owned pack matched into the carry need, if known (litres). */
  packCapacityL: number | null;
}

/** The rebuilt engine's output: a real, quantified, gear-first packing checklist for a trip. */
export interface PackingPlan {
  trip: string;
  sections: PackingSection[];
  summary: PackingSummary;
}
