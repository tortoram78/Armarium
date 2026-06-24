// The facet registry — the single source of truth for every facet's metadata: which storage tier it
// lives in, whether it is universal or domain-specific, hard fact vs soft, and whether it gates a
// capability. The classification Zod schemas and the capability predicates are validated against this
// registry by tests (registry integrity + the "capability gates must be hot, never JSONB" invariant).

import * as L from "./levels";

export type FacetKind = "boolean" | "ordinal" | "nominal" | "continuous" | "multilabel";
export type FacetGroup = "identity" | "universal" | "multilabel" | "insulation" | "sleep" | "shell" | "carry" | "footwear";
export type FacetTier = "column" | "group" | "jsonb";

export interface FacetDef {
  key: string;
  label: string;
  group: FacetGroup;
  kind: FacetKind;
  levels?: readonly string[];
  unit?: string;
  scope: "universal" | "domain";
  fact: "hard" | "soft";
  tier: FacetTier;
  /** If true this facet is read by a capability predicate and MUST be stored hot (column/group). */
  capabilityGate: boolean;
}

const def = (d: FacetDef): FacetDef => d;

export const FACETS = {
  // ---- identity / universal hard facts ----
  weight_grams: def({ key: "weight_grams", label: "Weight", group: "identity", kind: "continuous", unit: "g", scope: "universal", fact: "hard", tier: "column", capabilityGate: false }),
  upf: def({ key: "upf", label: "UPF", group: "universal", kind: "continuous", scope: "universal", fact: "hard", tier: "column", capabilityGate: true }),

  // ---- universal soft behavioral facets ----
  waterproofness: def({ key: "waterproofness", label: "Waterproofness", group: "universal", kind: "ordinal", levels: L.WATERPROOFNESS, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  wind_resistance: def({ key: "wind_resistance", label: "Wind resistance", group: "universal", kind: "ordinal", levels: L.WIND_RESISTANCE, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  breathability: def({ key: "breathability", label: "Breathability", group: "universal", kind: "ordinal", levels: L.BREATHABILITY, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  moisture_management: def({ key: "moisture_management", label: "Moisture management", group: "universal", kind: "nominal", levels: L.MOISTURE_MANAGEMENT, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  dry_speed: def({ key: "dry_speed", label: "Dry speed", group: "universal", kind: "ordinal", levels: L.DRY_SPEED, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  warmth_when_wet: def({ key: "warmth_when_wet", label: "Warmth when wet", group: "universal", kind: "ordinal", levels: L.WARMTH_WHEN_WET, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  warmth: def({ key: "warmth", label: "Warmth", group: "universal", kind: "ordinal", levels: L.WARMTH, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  packability: def({ key: "packability", label: "Packability", group: "universal", kind: "ordinal", levels: L.PACKABILITY, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  technical_vs_lifestyle: def({ key: "technical_vs_lifestyle", label: "Technical vs lifestyle", group: "universal", kind: "ordinal", levels: L.TECH_LIFESTYLE, scope: "universal", fact: "soft", tier: "column", capabilityGate: false }),

  // ---- multi-label facets ----
  layering_role: def({ key: "layering_role", label: "Layering role", group: "multilabel", kind: "multilabel", levels: L.LAYERING_ROLE, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  function_purpose: def({ key: "function_purpose", label: "Function / purpose", group: "multilabel", kind: "multilabel", levels: L.FUNCTION_PURPOSE, scope: "universal", fact: "soft", tier: "column", capabilityGate: true }),
  body_zone_covered: def({ key: "body_zone_covered", label: "Body zone covered", group: "multilabel", kind: "multilabel", levels: L.BODY_ZONE, scope: "universal", fact: "soft", tier: "column", capabilityGate: false }),
  activity_fit: def({ key: "activity_fit", label: "Activity fit", group: "multilabel", kind: "multilabel", levels: L.ACTIVITY_FIT, scope: "universal", fact: "soft", tier: "column", capabilityGate: false }),
  conditions_fit: def({ key: "conditions_fit", label: "Conditions fit", group: "multilabel", kind: "multilabel", levels: L.CONDITIONS_FIT, scope: "universal", fact: "soft", tier: "column", capabilityGate: false }),

  // ---- insulation group (shared by garments + sleeping bags) ----
  fill_type: def({ key: "fill_type", label: "Fill type", group: "insulation", kind: "nominal", levels: L.FILL_TYPE, scope: "domain", fact: "hard", tier: "group", capabilityGate: true }),
  fill_power: def({ key: "fill_power", label: "Fill power", group: "insulation", kind: "continuous", scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),
  fill_species: def({ key: "fill_species", label: "Fill species", group: "insulation", kind: "nominal", levels: L.FILL_SPECIES, scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),
  fill_weight_g: def({ key: "fill_weight_g", label: "Fill weight", group: "insulation", kind: "continuous", unit: "g", scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),
  hydrophobic_treatment: def({ key: "hydrophobic_treatment", label: "Hydrophobic down treatment", group: "insulation", kind: "boolean", scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),
  wet_performance: def({ key: "wet_performance", label: "Insulation wet performance", group: "insulation", kind: "ordinal", levels: L.WET_PERFORMANCE, scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),
  warmth_for_weight: def({ key: "warmth_for_weight", label: "Warmth for weight", group: "insulation", kind: "ordinal", levels: L.WARMTH_FOR_WEIGHT, scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),

  // ---- sleep group ----
  temp_rating_value: def({ key: "temp_rating_value", label: "Temp rating (number)", group: "sleep", kind: "continuous", scope: "domain", fact: "hard", tier: "group", capabilityGate: true }),
  temp_rating_unit: def({ key: "temp_rating_unit", label: "Temp rating unit", group: "sleep", kind: "nominal", levels: ["F", "C"], scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),
  temp_rating_standard: def({ key: "temp_rating_standard", label: "Temp rating standard", group: "sleep", kind: "nominal", levels: L.TEMP_STANDARD, scope: "domain", fact: "soft", tier: "group", capabilityGate: true }),
  sleep_shape: def({ key: "sleep_shape", label: "Bag shape", group: "sleep", kind: "nominal", levels: L.SLEEP_SHAPE, scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),
  pad_r_value_recommended: def({ key: "pad_r_value_recommended", label: "Recommended pad R-value", group: "sleep", kind: "continuous", scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),

  // ---- shell group ----
  protection_ceiling: def({ key: "protection_ceiling", label: "Weather protection ceiling", group: "shell", kind: "ordinal", levels: L.PROTECTION_CEILING, scope: "domain", fact: "soft", tier: "group", capabilityGate: true }),
  seam_sealing: def({ key: "seam_sealing", label: "Seam sealing", group: "shell", kind: "nominal", levels: L.SEAM_SEALING, scope: "domain", fact: "hard", tier: "group", capabilityGate: true }),
  hood: def({ key: "hood", label: "Hood", group: "shell", kind: "boolean", scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),
  pit_zips: def({ key: "pit_zips", label: "Pit zips", group: "shell", kind: "boolean", scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),

  // ---- carry group ----
  capacity_liters: def({ key: "capacity_liters", label: "Capacity", group: "carry", kind: "continuous", unit: "L", scope: "domain", fact: "hard", tier: "group", capabilityGate: true }),
  suspension: def({ key: "suspension", label: "Suspension", group: "carry", kind: "nominal", levels: L.SUSPENSION, scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),
  max_comfortable_load_kg: def({ key: "max_comfortable_load_kg", label: "Max comfortable load", group: "carry", kind: "continuous", unit: "kg", scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),

  // ---- footwear group ----
  support_stiffness: def({ key: "support_stiffness", label: "Support / stiffness", group: "footwear", kind: "ordinal", scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),
  ankle_height: def({ key: "ankle_height", label: "Ankle height", group: "footwear", kind: "nominal", levels: L.ANKLE_HEIGHT, scope: "domain", fact: "soft", tier: "group", capabilityGate: false }),
  crampon_compat: def({ key: "crampon_compat", label: "Crampon compatibility", group: "footwear", kind: "nominal", levels: L.CRAMPON_COMPAT, scope: "domain", fact: "hard", tier: "group", capabilityGate: false }),
  water_management: def({ key: "water_management", label: "Water management", group: "footwear", kind: "nominal", levels: L.WATER_MANAGEMENT, scope: "domain", fact: "soft", tier: "group", capabilityGate: true }),
} satisfies Record<string, FacetDef>;

export type FacetKey = keyof typeof FACETS;
export const FACET_KEYS = Object.keys(FACETS) as FacetKey[];
export const facet = (key: FacetKey): FacetDef => FACETS[key];

/** Capability-gating facets must be stored hot (column/group), never in the JSONB long-tail bag. */
export const capabilityGateFacets = FACET_KEYS.filter((k) => FACETS[k].capabilityGate);
