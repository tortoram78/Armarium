// User corrections — turn flat form values into a corrected ItemClassification, building the proper
// Evidence/HardFact envelopes with source:"user". This is the heart of the verify→correct→re-plan
// loop: because the user is an AUTHORITATIVE source, a corrected HARD fact (fill_power, temp_rating,
// upf, capacity, seam_sealing…) survives the hardFact demotion guard and therefore actually moves a
// capability outcome. Pure + framework-agnostic; the server action just collects the form and calls
// applyUserCorrections, then re-validates with safeParseClassification before persisting.

import type { ItemClassification } from "./classification";
import { UNKNOWN_SOFT, UNKNOWN_HARD, type Evidence, type HardFact } from "./evidence";
import type { EvidenceClaim } from "./ports";
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

/**
 * Turn a flat map of form values (path → raw string, or string[] for multi) into `source:"user"` CLAIMS
 * for the item_evidence store (ADR-0014 §3 user-correction path). A user is AUTHORITATIVE, so each claim
 * out-ranks every inferred/derived/manufacturer competitor at the resolver — a corrected hard fact actually
 * moves a capability outcome.
 *
 * - A SET value (non-blank) → one asserting user claim at the facet's dotted path (= its facetKey).
 * - A BLANK/"unknown" value → NO claim (the store holds only asserting claims; a re-resolve from the
 *   remaining claims then reflects the next-strongest source, or honest unknown). A HARD clear of a facet
 *   the user wants forced to null is the direct-classification-write path's job, not this additive one.
 * - The path doubles as the facetKey (e.g. "universal.warmth", "groups.insulation.fill_power",
 *   "multilabel.layering_role"); group fields are emitted regardless of whether the item carries the group
 *   — an unregistered/absent slot is simply skipped by the assembler.
 *
 * Pure; never throws. Closed-enum / int validity is enforced downstream by the assembler's parseClassification.
 */
export function userCorrectionClaims(
  values: Record<string, string | string[] | undefined>,
): EvidenceClaim[] {
  const out: EvidenceClaim[] = [];
  const USER = "user" as const;

  for (const f of EDITABLE_SCALAR) {
    const raw = values[f.path];
    if (raw === undefined) continue;
    const str = Array.isArray(raw) ? (raw[0] ?? "") : raw;
    if (str === "" || str === UNKNOWN) continue; // a clear writes no claim (additive: user assertions only)

    let value: string | number = str;
    if (f.tier === "soft_num" || f.tier === "hard_num") {
      const n = Number(str);
      if (!Number.isFinite(n)) continue;
      value = n;
    } else if (f.tier === "hard_int") {
      const n = Number(str);
      if (!Number.isFinite(n)) continue;
      value = Math.round(n);
    }
    out.push({ facetKey: f.path, value, confidence: "high", source: USER, evidence: USER_EVIDENCE });
  }

  for (const m of EDITABLE_MULTILABEL) {
    const raw = values[m.path];
    if (raw === undefined) continue;
    const arr = Array.isArray(raw) ? raw : [raw];
    const allowed = new Set(m.vocab ?? []);
    const filtered = arr.filter((v) => allowed.has(v));
    if (filtered.length === 0) continue; // empty multilabel clear → no claim
    out.push({ facetKey: m.path, value: filtered, confidence: "high", source: USER, evidence: USER_EVIDENCE });
  }

  return out;
}
