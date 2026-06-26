// Builds the CLAIMS classification prompt from the canonical vocabulary + the rubric rules (Phase 3 —
// ADR-0014 §2). Enumerating the allowed values straight from levels.ts means the prompt can never drift
// from the schema. The model returns a flat array of CLAIMS — one per facet it can assess, each with its
// own evidence + graded confidence — plus `unresolvedQuestions` (facets it could not determine). It does
// NOT emit a resolved ItemClassification; resolution happens after, in the assembler. The output is
// Zod-validated by `LlmClaimsSchema` before any use.

import * as L from "../facets/levels";

export interface ClassifyInput {
  name: string;
  text?: string;
}

const list = (xs: readonly string[]) => xs.join(" | ");

export function buildClassifyPrompt(input: ClassifyInput): { system: string; user: string } {
  const system = [
    "You classify a single wearable or piece of outdoor gear onto a fixed set of FACETS for a packing-recommendation app.",
    "You do NOT assign a category/type. You emit CLAIMS — one per facet you can assess — each with its own evidence.",
    "",
    "OUTPUT a SINGLE JSON object, no prose, of this exact shape:",
    "{",
    '  "name": string,                       // the normalized item name',
    '  "claims": [',
    '    { "facetKey": string, "value": <scalar|array>, "confidence": "low"|"medium"|"high", "source": "inferred", "evidence": string },',
    "    ...",
    "  ],",
    '  "unresolvedQuestions": [ string, ... ] // facets you could NOT determine, e.g. "fill power not stated"',
    "}",
    "",
    "CLAIM RULES:",
    '- One claim PER facet you can assess. `source` is ALWAYS "inferred" (you are inferring; you never state a manufacturer/user spec).',
    "- `confidence` is low | medium | high. `evidence` is a one-line rationale and must NEVER be empty.",
    "- Emit a claim ONLY for a facet you can actually assess from the name/details. If you cannot determine a facet, DO NOT emit a claim for it — instead add a short note to `unresolvedQuestions` (e.g. \"fill power not stated\"). A missing claim is correct; a guessed one is not. A wrong value is worse than an honest gap.",
    "- HARD FACTS (identity.brand, identity.model, identity.price_cents, identity.weight_grams, universal.upf, groups.insulation.fill_power, groups.insulation.fill_weight_g, groups.insulation.fill_type, groups.insulation.fill_species, groups.insulation.hydrophobic_treatment, groups.sleep.temp_rating_value, groups.sleep.temp_rating_unit, groups.shell.seam_sealing, groups.shell.hood, groups.shell.pit_zips, groups.carry.capacity_liters, groups.footwear.crampon_compat) are accepted ONLY when literally stated. Since your source is always \"inferred\", DO NOT emit claims for hard facts — list them in `unresolvedQuestions` if relevant. (An inferred hard fact is rejected and dropped.)",
    "- Multi-label facets take an ARRAY value drawn ONLY from the allowed values. An item may hold several at once.",
    "- water_resistance/DWR is NOT rain_protection. Only claim waterproofness >= wp_breathable and function_purpose 'rain_protection' for true membranes/waterproof items.",
    "- Never upgrade a marketing temperature number to a certified EN/ISO standard. Use temp_rating_standard \"marketing_unknown\" (low) or omit it unless certification is stated.",
    "- For clothing/apparel, assess the apparel facets (garment_role, formality, fit, pattern, care, occasion) AND the universal fabric facets (warmth, breathability, moisture_management). An item can be BOTH apparel and gear (e.g. a fleece) — emit whatever facets apply; never force a single category.",
    "",
    "FACET KEYS and their ALLOWED VALUES (ordinal scales are low -> high):",
    `- universal.waterproofness: ${list(L.WATERPROOFNESS)}`,
    `- universal.wind_resistance: ${list(L.WIND_RESISTANCE)}`,
    `- universal.breathability: ${list(L.BREATHABILITY)}`,
    `- universal.moisture_management: ${list(L.MOISTURE_MANAGEMENT)}`,
    `- universal.dry_speed: ${list(L.DRY_SPEED)}`,
    `- universal.warmth_when_wet: ${list(L.WARMTH_WHEN_WET)}`,
    `- universal.warmth: ${list(L.WARMTH)}`,
    `- universal.packability: ${list(L.PACKABILITY)}`,
    `- universal.technical_vs_lifestyle: ${list(L.TECH_LIFESTYLE)}`,
    `- multilabel.layering_role[]: ${list(L.LAYERING_ROLE)}`,
    `- multilabel.function_purpose[]: ${list(L.FUNCTION_PURPOSE)}`,
    `- multilabel.body_zone_covered[]: ${list(L.BODY_ZONE)}`,
    `- multilabel.activity_fit[]: ${list(L.ACTIVITY_FIT)}`,
    `- multilabel.conditions_fit[]: ${list(L.CONDITIONS_FIT)}`,
    `- groups.insulation.wet_performance: ${list(L.WET_PERFORMANCE)}`,
    `- groups.insulation.warmth_for_weight: ${list(L.WARMTH_FOR_WEIGHT)}`,
    `- groups.sleep.temp_rating_standard: ${list(L.TEMP_STANDARD)}`,
    `- groups.sleep.sleep_shape: ${list(L.SLEEP_SHAPE)}`,
    `- groups.sleep.pad_r_value_recommended: number`,
    `- groups.shell.protection_ceiling: ${list(L.PROTECTION_CEILING)}`,
    `- groups.carry.suspension: ${list(L.SUSPENSION)}`,
    `- groups.carry.max_comfortable_load_kg: number (kg)`,
    `- groups.footwear.support_stiffness: integer 1-5`,
    `- groups.footwear.ankle_height: ${list(L.ANKLE_HEIGHT)}`,
    `- groups.footwear.water_management: ${list(L.WATER_MANAGEMENT)}`,
    `- groups.apparel.garment_role[]: ${list(L.GARMENT_ROLE)}`,
    `- groups.apparel.formality: ${list(L.FORMALITY)}`,
    `- groups.apparel.fit: ${list(L.FIT)}`,
    `- groups.apparel.pattern: ${list(L.PATTERN)}`,
    `- groups.apparel.care[]: ${list(L.CARE)}`,
    `- groups.apparel.occasion[]: ${list(L.OCCASION)}`,
    "",
    "COMPOSITION: if (and only if) the details literally state a fabric composition, emit ONE claim with facetKey \"materials\" whose value is an array of",
    '  { "role": "shell"|"membrane"|"insulation"|"lining", "name": string|null, "fiber_components": [{"fiber": string, "pct": number|null, "recycled"?: boolean}], "construction_type": ' + list(L.CONSTRUCTION_TYPE) + '|null, "source": "manufacturer", "evidence": string }.',
    "  Only emit a materials claim from a STATED composition (source \"manufacturer\"); never invent fibers or percentages.",
  ].join("\n");

  const user = [
    `Item name: ${input.name}`,
    input.text ? `Known details: ${input.text}` : "No extra details provided — infer conservatively; emit a claim only where you are reasonably confident, and list the rest in unresolvedQuestions.",
    "",
    "Return the JSON claims object now.",
  ].join("\n");

  return { system, user };
}
