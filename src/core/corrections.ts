// User corrections — turn flat form values into a corrected ItemClassification, building the proper
// Evidence/HardFact envelopes with source:"user". This is the heart of the verify→correct→re-plan
// loop: because the user is an AUTHORITATIVE source, a corrected HARD fact (fill_power, temp_rating,
// upf, capacity, seam_sealing…) survives the hardFact demotion guard and therefore actually moves a
// capability outcome. Pure + framework-agnostic; the server action just collects the form and calls
// applyUserCorrections, then re-validates with safeParseClassification before persisting.

import type { ItemClassification } from "./classification";
import { UNKNOWN_SOFT, UNKNOWN_HARD, type Evidence, type HardFact } from "./evidence";
import * as L from "./facets/levels";
import type { GroupKey } from "./facets/levels";

export type EditTier = "soft_enum" | "soft_num" | "hard_int" | "hard_num" | "hard_enum" | "multi";

export interface EditableFacet {
  /** Dotted path that doubles as the form field `name`, e.g. "universal.warmth". */
  path: string;
  label: string;
  tier: EditTier;
  /** Allowed values for enum/multi tiers. */
  vocab?: readonly string[];
  /** Present ⇒ only editable when the item carries this domain group. */
  group?: GroupKey;
}

const USER_EVIDENCE = "user correction";
const UNKNOWN = "unknown";

const softEnum = (value: string): Evidence<string> => ({ value, confidence: "high", source: "user", evidence: USER_EVIDENCE });
const softNum = (value: number): Evidence<number> => ({ value, confidence: "high", source: "user", evidence: USER_EVIDENCE });
const hard = <T>(value: T): HardFact<T> => ({ value, source: "user", evidence: USER_EVIDENCE });

// The DECISIVE editable facets — the soft universals (behavioural) plus the hard facts/group fields
// that gate capabilities. Intentionally focused: editing a facet that no capability reads is noise.
export const EDITABLE_UNIVERSAL: readonly EditableFacet[] = [
  { path: "universal.waterproofness", label: "Waterproofness", tier: "soft_enum", vocab: L.WATERPROOFNESS },
  { path: "universal.wind_resistance", label: "Wind resistance", tier: "soft_enum", vocab: L.WIND_RESISTANCE },
  { path: "universal.breathability", label: "Breathability", tier: "soft_enum", vocab: L.BREATHABILITY },
  { path: "universal.moisture_management", label: "Moisture management", tier: "soft_enum", vocab: L.MOISTURE_MANAGEMENT },
  { path: "universal.dry_speed", label: "Dry speed", tier: "soft_enum", vocab: L.DRY_SPEED },
  { path: "universal.warmth_when_wet", label: "Warmth when wet", tier: "soft_enum", vocab: L.WARMTH_WHEN_WET },
  { path: "universal.warmth", label: "Warmth", tier: "soft_enum", vocab: L.WARMTH },
  { path: "universal.packability", label: "Packability", tier: "soft_enum", vocab: L.PACKABILITY },
  { path: "universal.technical_vs_lifestyle", label: "Technical vs lifestyle", tier: "soft_enum", vocab: L.TECH_LIFESTYLE },
  { path: "universal.upf", label: "UPF (rating)", tier: "hard_int" },
];

export const EDITABLE_GROUPS: readonly EditableFacet[] = [
  // insulation — warmth gates
  { path: "groups.insulation.fill_power", label: "Fill power", tier: "hard_int", group: "insulation" },
  { path: "groups.insulation.fill_weight_g", label: "Fill weight (g)", tier: "hard_int", group: "insulation" },
  { path: "groups.insulation.fill_type", label: "Fill type", tier: "hard_enum", vocab: L.FILL_TYPE, group: "insulation" },
  { path: "groups.insulation.warmth_for_weight", label: "Warmth for weight", tier: "soft_enum", vocab: L.WARMTH_FOR_WEIGHT, group: "insulation" },
  // sleep — sleep_warmth gate
  { path: "groups.sleep.temp_rating_value", label: "Temp rating", tier: "hard_int", group: "sleep" },
  { path: "groups.sleep.temp_rating_unit", label: "Temp unit (F/C)", tier: "hard_enum", vocab: ["F", "C"], group: "sleep" },
  { path: "groups.sleep.temp_rating_standard", label: "Temp standard", tier: "soft_enum", vocab: L.TEMP_STANDARD, group: "sleep" },
  // shell — weather_shell gates
  { path: "groups.shell.protection_ceiling", label: "Protection ceiling", tier: "soft_enum", vocab: L.PROTECTION_CEILING, group: "shell" },
  { path: "groups.shell.seam_sealing", label: "Seam sealing", tier: "hard_enum", vocab: L.SEAM_SEALING, group: "shell" },
  // carry — carry gate
  { path: "groups.carry.capacity_liters", label: "Capacity (L)", tier: "hard_num", group: "carry" },
];

export const EDITABLE_MULTILABEL: readonly EditableFacet[] = [
  { path: "multilabel.layering_role", label: "Layering role", tier: "multi", vocab: L.LAYERING_ROLE },
  { path: "multilabel.function_purpose", label: "Function / purpose", tier: "multi", vocab: L.FUNCTION_PURPOSE },
  { path: "multilabel.body_zone_covered", label: "Body zone", tier: "multi", vocab: L.BODY_ZONE },
  { path: "multilabel.activity_fit", label: "Activity fit", tier: "multi", vocab: L.ACTIVITY_FIT },
  { path: "multilabel.conditions_fit", label: "Conditions fit", tier: "multi", vocab: L.CONDITIONS_FIT },
];

export const EDITABLE_SCALAR: readonly EditableFacet[] = [...EDITABLE_UNIVERSAL, ...EDITABLE_GROUPS];

/** Group facets applicable to an item = those whose group is present on the classification. */
export function editableGroupFacets(c: ItemClassification): EditableFacet[] {
  const present = new Set(Object.keys(c.groups ?? {}));
  return EDITABLE_GROUPS.filter((f) => f.group && present.has(f.group));
}

function setScalar(target: Record<string, unknown>, key: string, tier: EditTier, raw: string) {
  const blank = raw === "" || raw === UNKNOWN;
  switch (tier) {
    case "soft_enum":
      target[key] = blank ? UNKNOWN_SOFT : softEnum(raw);
      break;
    case "soft_num": {
      const n = Number(raw);
      target[key] = blank || !Number.isFinite(n) ? UNKNOWN_SOFT : softNum(n);
      break;
    }
    case "hard_enum":
      target[key] = blank ? UNKNOWN_HARD : hard(raw);
      break;
    case "hard_num": {
      const n = Number(raw);
      target[key] = blank || !Number.isFinite(n) ? UNKNOWN_HARD : hard(n);
      break;
    }
    case "hard_int": {
      const n = Number(raw);
      target[key] = blank || !Number.isFinite(n) ? UNKNOWN_HARD : hard(Math.round(n));
      break;
    }
  }
}

/**
 * Apply a flat map of form values (path → raw string, or string[] for multi) onto a clone of the
 * classification, building source:"user" envelopes. Missing paths are left untouched. Group fields are
 * skipped if the item lacks that group. The result must still be run through safeParseClassification
 * by the caller (closed enums / int constraints are enforced there).
 */
export function applyUserCorrections(
  c: ItemClassification,
  values: Record<string, string | string[] | undefined>,
): ItemClassification {
  const next = structuredClone(c);

  for (const f of EDITABLE_SCALAR) {
    const raw = values[f.path];
    if (raw === undefined) continue; // not part of this submission
    const str = Array.isArray(raw) ? (raw[0] ?? "") : raw;
    const parts = f.path.split(".");
    if (parts[0] === "universal" && parts[1]) {
      setScalar(next.universal as unknown as Record<string, unknown>, parts[1], f.tier, str);
    } else if (parts[0] === "groups" && parts[1] && parts[2]) {
      const grp = (next.groups as Record<string, unknown>)[parts[1]] as Record<string, unknown> | undefined;
      if (!grp) continue; // item doesn't carry this group
      setScalar(grp, parts[2], f.tier, str);
    }
  }

  for (const m of EDITABLE_MULTILABEL) {
    const raw = values[m.path];
    if (raw === undefined) continue;
    const key = m.path.split(".")[1];
    if (!key) continue;
    const arr = Array.isArray(raw) ? raw : [raw];
    const allowed = new Set(m.vocab ?? []);
    (next.multilabel as unknown as Record<string, string[]>)[key] = arr.filter((v) => allowed.has(v));
  }

  return next;
}
