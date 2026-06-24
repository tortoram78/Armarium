// The authoritative bridge between a dot-namespaced `facetKey` (the item_evidence / LlmClaim key, e.g.
// "universal.warmth", "groups.insulation.fill_power") and its slot in the nested `ItemClassification`.
//
// One table drives BOTH directions so they can never drift:
//   - the ASSEMBLER (claims → resolved ItemClassification) writes a resolved facet at `setPath`.
//   - the DECOMPOSER (a resolved ItemClassification → claims, for offline/seed items) reads each facet.
// `materials`/`treatments`/`applicable_groups` are whole-array/derived fields handled specially by the
// assembler — they are NOT per-facet resolver slots, so they live OUTSIDE this scalar table.
//
// "hard" marks the facets that are hard FACTS (identity + upf + the group hard facts). At the claim
// boundary an `inferred` hard fact has nowhere to live (ADR-0004/0014) — it is dropped, never written.
// The closed enum / int validation itself happens downstream in `parseClassification`.
//
// PURE: no next/*, no React, no DB. Imports only the levels vocab + group keys for typing.

import * as L from "../facets/levels";

/** One scalar/multilabel facet addressable by a dot-namespaced key. */
export interface FacetPathDef {
  /** The dot-namespaced key as it appears in item_evidence / an LlmClaim. */
  key: string;
  /** "soft" → Evidence envelope; "hard" → HardFact envelope (demoted unless authoritatively sourced). */
  fact: "soft" | "hard";
  /** "scalar" → a single Evidence/HardFact slot; "multilabel" → a plain string[] (no envelope). */
  shape: "scalar" | "multilabel";
  /** The path into ItemClassification: e.g. ["universal","warmth"] or ["groups","insulation","fill_power"]. */
  path: readonly string[];
  /** For a group facet, which group it belongs to (so the assembler creates the group only when needed). */
  group?: L.GroupKey;
}

const universalSoft = (key: string): FacetPathDef => ({
  key: `universal.${key}`,
  fact: "soft",
  shape: "scalar",
  path: ["universal", key],
});

const multilabel = (key: string): FacetPathDef => ({
  key: `multilabel.${key}`,
  fact: "soft",
  shape: "multilabel",
  path: ["multilabel", key],
});

const groupField = (
  group: L.GroupKey,
  key: string,
  fact: "soft" | "hard",
): FacetPathDef => ({
  key: `groups.${group}.${key}`,
  fact,
  shape: "scalar",
  path: ["groups", group, key],
  group,
});

const identityHard = (key: string): FacetPathDef => ({
  key: `identity.${key}`,
  fact: "hard",
  shape: "scalar",
  path: ["identity", key],
});

/**
 * Every per-facet resolver slot, in a single table. Mirrors the `ItemClassification` schema field-for-
 * field (classification.ts) — keep these in lockstep. `materials`/`treatments`/`applicable_groups` are
 * deliberately absent (whole-array/derived; handled by the assembler, not the per-facet resolve loop).
 */
export const FACET_PATHS: readonly FacetPathDef[] = [
  // identity hard facts
  identityHard("brand"),
  identityHard("model"),
  identityHard("price_cents"),
  identityHard("weight_grams"),

  // universal soft behavioral facets + the one hard universal (upf)
  universalSoft("waterproofness"),
  universalSoft("wind_resistance"),
  universalSoft("breathability"),
  universalSoft("moisture_management"),
  universalSoft("dry_speed"),
  universalSoft("warmth_when_wet"),
  universalSoft("warmth"),
  universalSoft("packability"),
  universalSoft("technical_vs_lifestyle"),
  { key: "universal.upf", fact: "hard", shape: "scalar", path: ["universal", "upf"] },

  // multi-label facets (plain string[])
  multilabel("layering_role"),
  multilabel("function_purpose"),
  multilabel("body_zone_covered"),
  multilabel("activity_fit"),
  multilabel("conditions_fit"),

  // insulation group
  groupField("insulation", "fill_type", "hard"),
  groupField("insulation", "fill_power", "hard"),
  groupField("insulation", "fill_species", "hard"),
  groupField("insulation", "fill_weight_g", "hard"),
  groupField("insulation", "hydrophobic_treatment", "hard"),
  groupField("insulation", "wet_performance", "soft"),
  groupField("insulation", "warmth_for_weight", "soft"),

  // sleep group
  groupField("sleep", "temp_rating_value", "hard"),
  groupField("sleep", "temp_rating_unit", "hard"),
  groupField("sleep", "temp_rating_standard", "soft"),
  groupField("sleep", "sleep_shape", "soft"),
  groupField("sleep", "pad_r_value_recommended", "soft"),

  // shell group
  groupField("shell", "protection_ceiling", "soft"),
  groupField("shell", "seam_sealing", "hard"),
  groupField("shell", "hood", "hard"),
  groupField("shell", "pit_zips", "hard"),

  // carry group
  groupField("carry", "capacity_liters", "hard"),
  groupField("carry", "suspension", "soft"),
  groupField("carry", "max_comfortable_load_kg", "soft"),

  // footwear group
  groupField("footwear", "support_stiffness", "soft"),
  groupField("footwear", "ankle_height", "soft"),
  groupField("footwear", "crampon_compat", "hard"),
  groupField("footwear", "water_management", "soft"),
];

/** Fast lookup by key. */
export const FACET_PATH_BY_KEY: ReadonlyMap<string, FacetPathDef> = new Map(
  FACET_PATHS.map((d) => [d.key, d] as const),
);

/** True iff a dot-namespaced facetKey names a HARD fact (identity/upf/group hard facts). */
export function isHardFactKey(facetKey: string): boolean {
  return FACET_PATH_BY_KEY.get(facetKey)?.fact === "hard";
}

/** True iff a facetKey is a recognized per-facet resolver slot (vs a whole-array/novel/unknown key). */
export function isRegistryFacetKey(facetKey: string): boolean {
  return FACET_PATH_BY_KEY.has(facetKey);
}
