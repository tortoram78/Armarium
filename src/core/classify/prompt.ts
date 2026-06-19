// Builds the classification prompt from the canonical vocabulary + the rubric rules. Enumerating the
// allowed values straight from levels.ts means the prompt can never drift from the schema. The model
// must return ONLY a JSON object matching the ItemClassification contract; it is Zod-validated after.

import * as L from "../facets/levels";

export interface ClassifyInput {
  name: string;
  text?: string;
}

const list = (xs: readonly string[]) => xs.join(" | ");

export function buildClassifyPrompt(input: ClassifyInput): { system: string; user: string } {
  const system = [
    "You classify a single piece of outdoor gear onto a fixed set of FACETS for a packing-recommendation app.",
    "You do NOT assign a category/type. You place the item on many facets at once.",
    "",
    "HARD RULES:",
    "- Unknown = null. If a property is not stated and cannot be confidently inferred, return null with confidence \"unknown\" and source \"unknown\". A wrong spec is worse than a missing one.",
    "- HARD FACTS (composition %, fill_power, fill_weight_g, upf, temp_rating_value, price, weight) may carry a value ONLY if source is \"manufacturer\" or \"user\". If you are inferring, return null. (Inferred hard facts are rejected.)",
    "- SOFT facets are inferable from composition/construction/description but MUST carry confidence (low|medium|high) and a one-line evidence string.",
    "- Multi-label facets are arrays drawn ONLY from the allowed values. An item may hold several at once.",
    "- water_resistance/DWR is NOT rain_protection. Only use waterproofness >= wp_breathable and function_purpose 'rain_protection' for true membranes/waterproof items.",
    "- Never upgrade a marketing temperature number (e.g. a bag '30') to a certified EN/ISO standard. Set temp_rating_standard to \"marketing_unknown\" (low confidence) or null unless certification is stated.",
    "",
    "ALLOWED VALUES (ordinal scales are low -> high):",
    `- waterproofness: ${list(L.WATERPROOFNESS)}`,
    `- wind_resistance: ${list(L.WIND_RESISTANCE)}`,
    `- breathability: ${list(L.BREATHABILITY)}`,
    `- moisture_management: ${list(L.MOISTURE_MANAGEMENT)}`,
    `- dry_speed: ${list(L.DRY_SPEED)}`,
    `- warmth_when_wet: ${list(L.WARMTH_WHEN_WET)}`,
    `- warmth: ${list(L.WARMTH)}`,
    `- packability: ${list(L.PACKABILITY)}`,
    `- technical_vs_lifestyle: ${list(L.TECH_LIFESTYLE)}`,
    `- upf: integer (hard fact) or null`,
    `- layering_role[]: ${list(L.LAYERING_ROLE)}`,
    `- function_purpose[]: ${list(L.FUNCTION_PURPOSE)}`,
    `- body_zone_covered[]: ${list(L.BODY_ZONE)}`,
    `- activity_fit[]: ${list(L.ACTIVITY_FIT)}`,
    `- conditions_fit[]: ${list(L.CONDITIONS_FIT)}`,
    `- groups.insulation: fill_type (${list(L.FILL_TYPE)}), fill_power, fill_species (${list(L.FILL_SPECIES)}), fill_weight_g, hydrophobic_treatment, wet_performance (${list(L.WET_PERFORMANCE)}), warmth_for_weight (${list(L.WARMTH_FOR_WEIGHT)})`,
    `- groups.sleep: temp_rating_value, temp_rating_unit (F|C), temp_rating_standard (${list(L.TEMP_STANDARD)}), shape (${list(L.SLEEP_SHAPE)}), pad_r_value_recommended`,
    `- groups.shell: protection_ceiling (${list(L.PROTECTION_CEILING)}), seam_sealing (${list(L.SEAM_SEALING)}), hood, pit_zips`,
    `- groups.carry: capacity_liters, suspension (${list(L.SUSPENSION)}), max_comfortable_load_kg`,
    `- groups.footwear: support_stiffness (1-5), ankle_height (${list(L.ANKLE_HEIGHT)}), crampon_compat (${list(L.CRAMPON_COMPAT)} — manufacturer-only, else null), water_management (${list(L.WATER_MANAGEMENT)})`,
    "",
    "OUTPUT: return ONLY a JSON object, no prose, with this shape:",
    "{",
    '  "name": string,',
    '  "identity": { "brand": HARD, "model": HARD, "price_cents": HARD, "weight_grams": HARD },',
    '  "materials": [{ "role": "shell|membrane|insulation|lining", "name": string|null, "fiber_components": [{"fiber": string, "pct": number|null, "recycled"?: boolean}], "construction_type": one of ' + list(L.CONSTRUCTION_TYPE) + '|null, "source": "manufacturer|user|unknown", "evidence": string }],',
    '  "treatments": [{ "kind": string, "condition": "factory_fresh|degraded|refreshed"|null, "source": SRC, "evidence": string }],',
    '  "universal": { each facet above as SOFT {"value": v|null, "confidence": "low|medium|high|unknown"(unknown only when value null), "source": SRC, "evidence": string}; upf as HARD },',
    '  "multilabel": { layering_role:[], function_purpose:[], body_zone_covered:[], activity_fit:[], conditions_fit:[] },',
    '  "groups": { only the applicable ones, each field SOFT or HARD as listed },',
    '  "applicable_groups": ["insulation"|"sleep"|"shell"|"carry"|"footwear"]',
    "}",
    'HARD = {"value": v|null, "source": "manufacturer"|"user"|"unknown", "evidence": string}. SRC = manufacturer|user|inferred|derived_from_material|unknown.',
    'Omit a group entirely if it does not apply (e.g. a t-shirt has groups: {}).',
  ].join("\n");

  const user = [
    `Item name: ${input.name}`,
    input.text ? `Known details: ${input.text}` : "No extra details provided — infer conservatively and use null where unsure.",
    "",
    "Return the JSON classification now.",
  ].join("\n");

  return { system, user };
}
