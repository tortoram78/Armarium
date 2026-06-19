// The LLM classification contract (Layer 1). The model emits an object matching ItemClassification;
// it is Zod-validated BEFORE any persistence/use (load-bearing rule #1). Unknown = null with a
// confidence/source marker (rule #2); hard facts are demoted to null+unknown unless authoritatively
// sourced. This schema is the single boundary between model output and the rest of the system.

import { z } from "zod";
import { evidence, hardFact, HARD_SOURCE, SOURCE } from "./evidence";
import * as L from "./facets/levels";

// ---- materials & treatments (composition is a hard fact when stated) ----
const fiberComponent = z.object({
  fiber: z.string().min(1),
  pct: z.number().min(0).max(100).nullable(),
  recycled: z.boolean().optional(),
});

const materialInput = z.object({
  role: z.enum(["shell", "membrane", "insulation", "lining"]),
  name: z.string().nullable(),
  fiber_components: z.array(fiberComponent),
  construction_type: z.enum(L.CONSTRUCTION_TYPE).nullable(),
  source: z.enum([...HARD_SOURCE, "unknown"]),
  evidence: z.string(),
});

const treatmentInput = z.object({
  kind: z.string().min(1), // 'dwr' | 'hydrophobic_down' | ...
  condition: z.enum(["factory_fresh", "degraded", "refreshed"]).nullable(),
  source: z.enum(SOURCE),
  evidence: z.string(),
});

// ---- identity hard facts ----
const identity = z.object({
  brand: hardFact(z.string().min(1)),
  model: hardFact(z.string().min(1)),
  price_cents: hardFact(z.number().int().nonnegative()),
  weight_grams: hardFact(z.number().int().nonnegative()),
});

// ---- universal soft behavioral facets (+ the one hard universal facet, upf) ----
const universal = z.object({
  waterproofness: evidence(z.enum(L.WATERPROOFNESS)),
  wind_resistance: evidence(z.enum(L.WIND_RESISTANCE)),
  breathability: evidence(z.enum(L.BREATHABILITY)),
  moisture_management: evidence(z.enum(L.MOISTURE_MANAGEMENT)),
  dry_speed: evidence(z.enum(L.DRY_SPEED)),
  warmth_when_wet: evidence(z.enum(L.WARMTH_WHEN_WET)),
  warmth: evidence(z.enum(L.WARMTH)),
  packability: evidence(z.enum(L.PACKABILITY)),
  technical_vs_lifestyle: evidence(z.enum(L.TECH_LIFESTYLE)),
  upf: hardFact(z.number().int().nonnegative()),
});

// ---- multi-label facets (closed enums; never free strings — Audit A fix) ----
const multilabel = z.object({
  layering_role: z.array(z.enum(L.LAYERING_ROLE)),
  function_purpose: z.array(z.enum(L.FUNCTION_PURPOSE)),
  body_zone_covered: z.array(z.enum(L.BODY_ZONE)),
  activity_fit: z.array(z.enum(L.ACTIVITY_FIT)),
  conditions_fit: z.array(z.enum(L.CONDITIONS_FIT)),
});

// ---- composable optional domain groups ----
const insulationGroup = z.object({
  fill_type: hardFact(z.enum(L.FILL_TYPE)),
  fill_power: hardFact(z.number().int().positive()),
  fill_species: hardFact(z.enum(L.FILL_SPECIES)),
  fill_weight_g: hardFact(z.number().int().positive()),
  hydrophobic_treatment: hardFact(z.boolean()),
  wet_performance: evidence(z.enum(L.WET_PERFORMANCE)),
  warmth_for_weight: evidence(z.enum(L.WARMTH_FOR_WEIGHT)),
});

const sleepGroup = z.object({
  temp_rating_value: hardFact(z.number().int()),
  temp_rating_unit: hardFact(z.enum(["F", "C"])),
  temp_rating_standard: evidence(z.enum(L.TEMP_STANDARD)),
  shape: evidence(z.enum(L.SLEEP_SHAPE)),
  pad_r_value_recommended: evidence(z.number().nonnegative()),
});

const shellGroup = z.object({
  protection_ceiling: evidence(z.enum(L.PROTECTION_CEILING)),
  seam_sealing: hardFact(z.enum(L.SEAM_SEALING)),
  hood: hardFact(z.boolean()),
  pit_zips: hardFact(z.boolean()),
});

const carryGroup = z.object({
  capacity_liters: hardFact(z.number().positive()),
  suspension: evidence(z.enum(L.SUSPENSION)),
  max_comfortable_load_kg: evidence(z.number().nonnegative()),
});

const footwearGroup = z.object({
  support_stiffness: evidence(z.number().int().min(1).max(5)),
  ankle_height: evidence(z.enum(L.ANKLE_HEIGHT)),
  crampon_compat: hardFact(z.enum(L.CRAMPON_COMPAT)),
  water_management: evidence(z.enum(L.WATER_MANAGEMENT)),
});

const groups = z.object({
  insulation: insulationGroup.optional(),
  sleep: sleepGroup.optional(),
  shell: shellGroup.optional(),
  carry: carryGroup.optional(),
  footwear: footwearGroup.optional(),
});

export const ItemClassificationSchema = z.object({
  name: z.string().min(1),
  identity,
  materials: z.array(materialInput),
  treatments: z.array(treatmentInput),
  universal,
  multilabel,
  groups,
  applicable_groups: z.array(z.enum(L.GROUP_KEYS)),
});

export type ItemClassification = z.infer<typeof ItemClassificationSchema>;
export type UniversalFacets = z.infer<typeof universal>;
export type MultiLabelFacets = z.infer<typeof multilabel>;
export type FacetGroups = z.infer<typeof groups>;
export type InsulationGroup = z.infer<typeof insulationGroup>;
export type SleepGroup = z.infer<typeof sleepGroup>;
export type ShellGroup = z.infer<typeof shellGroup>;

/** Validate raw model output. Throws on invalid input — unvalidated text never proceeds. */
export function parseClassification(raw: unknown): ItemClassification {
  return ItemClassificationSchema.parse(raw);
}

export function safeParseClassification(raw: unknown) {
  return ItemClassificationSchema.safeParse(raw);
}
