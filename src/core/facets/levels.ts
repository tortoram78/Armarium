// Canonical facet vocabulary — the SINGLE source of the allowed values for every enum/ordinal/
// multi-label facet. Ordinal arrays are ordered low -> high; that ORDER IS CANONICAL HERE (in code),
// never in Postgres enum declaration order (Audit A fix). The Zod schemas (classification.ts) and the
// facet registry (registry.ts) both import from this file, so the vocabulary can never drift.

// ---- universal scalar facets ----
export const WATERPROOFNESS = ["none", "dwr", "water_resistant", "wp_breathable", "wp_nonbreathable"] as const;
export const WIND_RESISTANCE = ["none", "wind_resistant", "windproof"] as const;
export const BREATHABILITY = ["low", "moderate", "high", "very_high"] as const;
export const MOISTURE_MANAGEMENT = ["wicks", "neutral", "absorbs_holds"] as const;
export const DRY_SPEED = ["slow", "moderate", "fast", "very_fast"] as const;
export const WARMTH_WHEN_WET = ["collapses", "neutral", "retains"] as const;
export const WARMTH = ["minimal", "light", "moderate", "high", "very_high"] as const;
export const PACKABILITY = ["bulky", "moderate", "packable", "ultra_packable"] as const;
export const TECH_LIFESTYLE = ["lifestyle", "mostly_lifestyle", "versatile", "mostly_technical", "technical"] as const;

// ---- multi-label facets ----
export const LAYERING_ROLE = [
  "next_to_skin", "base", "active_insulation", "static_insulation", "mid",
  "wind_shell", "weather_shell", "sleep_system", "standalone", "accessory",
] as const;
export const FUNCTION_PURPOSE = [
  "warmth", "insulation", "wind_protection", "rain_protection", "water_resistance",
  "sun_protection", "moisture_wicking", "cooling", "abrasion_protection", "carry", "sleep", "lifestyle",
] as const;
export const BODY_ZONE = ["head", "face", "neck", "torso", "arms", "hands", "legs", "feet", "eyes"] as const;
export const ACTIVITY_FIT = [
  "hiking", "backpacking", "alpine", "climbing", "trail_running", "watersports", "travel", "everyday", "camp",
] as const;
export const CONDITIONS_FIT = [
  "cold", "cool", "mild", "warm", "hot", "rain", "snow", "wind", "high_sun", "high_exertion", "static",
] as const;

// ---- insulation sub-model (shared by insulated garments AND sleeping bags) ----
export const FILL_TYPE = ["down", "synthetic", "fleece_grid", "fleece_pile", "other"] as const;
export const FILL_SPECIES = ["duck", "goose"] as const;
export const WET_PERFORMANCE = ["collapses", "retains_some", "unaffected"] as const;
export const WARMTH_FOR_WEIGHT = ["low", "moderate", "high", "very_high"] as const;

// ---- sleep sub-model ----
export const TEMP_STANDARD = [
  "en_iso_comfort", "en_iso_limit", "en_iso_lower", "manufacturer_season", "marketing_unknown",
] as const;
export const SLEEP_SHAPE = ["mummy", "semi_rectangular", "rectangular", "quilt"] as const;

// ---- shell sub-model ----
export const PROTECTION_CEILING = ["none", "light_spray", "light_rain", "sustained_rain", "storm"] as const;
export const SEAM_SEALING = ["none", "critical", "fully"] as const;

// ---- carry sub-model ----
export const SUSPENSION = ["frameless", "framesheet", "internal_frame", "external_frame"] as const;

// ---- footwear sub-model ----
export const ANKLE_HEIGHT = ["low", "mid", "high"] as const;
export const CRAMPON_COMPAT = ["none", "C1", "C2", "C3"] as const;
export const WATER_MANAGEMENT = ["fast_drain_breathable", "dwr", "waterproof_membrane"] as const;

// ---- apparel sub-model ----
// garment_role: structural facet (multilabel) — analogous to layering_role for clothing
export const GARMENT_ROLE = [
  "top", "bottom", "dress", "outerwear", "underlayer", "footwear", "headwear", "accessory", "full_body",
] as const;
// formality: ordinal scale (low → high)
export const FORMALITY = [
  "loungewear", "casual", "smart_casual", "business_casual", "business", "formal",
] as const;
// fit: nominal
export const FIT = ["slim", "tailored", "regular", "relaxed", "oversized"] as const;
// pattern: nominal
export const PATTERN = ["solid", "striped", "plaid", "checked", "floral", "graphic", "colorblock", "other"] as const;
// care: multilabel
export const CARE = ["machine_wash", "hand_wash", "dry_clean", "line_dry", "tumble_dry", "iron"] as const;
// occasion: multilabel
export const OCCASION = [
  "work", "everyday", "athletic", "evening", "formal_event", "lounge", "travel", "outdoor",
] as const;

// ---- material library ----
export const CONSTRUCTION_TYPE = [
  "woven", "knit", "grid_fleece", "pile_fleece", "membrane", "insulation_fill", "other",
] as const;
export const GROUP_KEYS = ["insulation", "sleep", "shell", "carry", "footwear", "apparel"] as const;

// ---- value-type unions derived from the vocab ----
export type Waterproofness = (typeof WATERPROOFNESS)[number];
export type WindResistance = (typeof WIND_RESISTANCE)[number];
export type Breathability = (typeof BREATHABILITY)[number];
export type MoistureManagement = (typeof MOISTURE_MANAGEMENT)[number];
export type DrySpeed = (typeof DRY_SPEED)[number];
export type WarmthWhenWet = (typeof WARMTH_WHEN_WET)[number];
export type Warmth = (typeof WARMTH)[number];
export type Packability = (typeof PACKABILITY)[number];
export type TechLifestyle = (typeof TECH_LIFESTYLE)[number];
export type LayeringRole = (typeof LAYERING_ROLE)[number];
export type FunctionPurpose = (typeof FUNCTION_PURPOSE)[number];
export type BodyZone = (typeof BODY_ZONE)[number];
export type ActivityFit = (typeof ACTIVITY_FIT)[number];
export type ConditionsFit = (typeof CONDITIONS_FIT)[number];
export type FillType = (typeof FILL_TYPE)[number];
export type FillSpecies = (typeof FILL_SPECIES)[number];
export type WetPerformance = (typeof WET_PERFORMANCE)[number];
export type WarmthForWeight = (typeof WARMTH_FOR_WEIGHT)[number];
export type TempStandard = (typeof TEMP_STANDARD)[number];
export type SleepShape = (typeof SLEEP_SHAPE)[number];
export type ProtectionCeiling = (typeof PROTECTION_CEILING)[number];
export type SeamSealing = (typeof SEAM_SEALING)[number];
export type Suspension = (typeof SUSPENSION)[number];
export type AnkleHeight = (typeof ANKLE_HEIGHT)[number];
export type CramponCompat = (typeof CRAMPON_COMPAT)[number];
export type WaterManagement = (typeof WATER_MANAGEMENT)[number];
export type ConstructionType = (typeof CONSTRUCTION_TYPE)[number];
export type GroupKey = (typeof GROUP_KEYS)[number];
export type GarmentRole = (typeof GARMENT_ROLE)[number];
export type Formality = (typeof FORMALITY)[number];
export type Fit = (typeof FIT)[number];
export type Pattern = (typeof PATTERN)[number];
export type Care = (typeof CARE)[number];
export type Occasion = (typeof OCCASION)[number];

/** Rank of an ordinal value within its (low->high) scale; -1 if not found. */
export function rank<const T extends readonly string[]>(scale: T, value: string | null | undefined): number {
  if (value == null) return -1;
  return scale.indexOf(value);
}

/** True iff `value` is at least `threshold` on the given ordinal scale. */
export function atLeast<const T extends readonly string[]>(
  scale: T,
  value: string | null | undefined,
  threshold: T[number],
): boolean {
  const v = rank(scale, value ?? undefined);
  return v >= 0 && v >= rank(scale, threshold);
}
