// Capabilities — derived predicates over a ResolvedItem's facets, each returning a 3-state result
// (DESIGN.md §5). `blocked_unknown` makes "unknown on a safety-relevant input ⇒ surface 'verify',
// never silently satisfy" a first-class, testable property. Capabilities take an optional context
// (the trip conditions) so envelope-dependent ones (e.g. sleep_warmth) can reason about the target.
// Every facet read here is a capabilityGate in the registry (stored hot, never JSONB).

import type { ResolvedItem } from "../resolved";
import type { Confidence, Evidence } from "../evidence";
import { isConfident } from "../evidence";
import { fToC, type TripConditions } from "../conditions";
import {
  WATERPROOFNESS, WIND_RESISTANCE, BREATHABILITY, PACKABILITY, WARMTH, DRY_SPEED, atLeast, rank,
  type Warmth,
} from "../facets/levels";

export type CapResult = "satisfies" | "fails" | "blocked_unknown";

export interface CapabilityContext {
  conditions?: TripConditions;
}

export const CAPABILITY_KEYS = [
  "weather_shell",
  "rain_protection",
  "wind_protection",
  "breathable_shell",
  "wicking_base",
  "packable_insulation",
  "sun_protection",
  "cooling",
  "sleep_warmth",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Human-readable labels for the UI. */
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  weather_shell: "Waterproof / windproof shell",
  rain_protection: "Rain protection",
  wind_protection: "Wind protection",
  breathable_shell: "Breathable shell",
  wicking_base: "Wicking base layer",
  packable_insulation: "Packable insulation",
  sun_protection: "Sun protection",
  cooling: "Hot-weather cooling layer",
  sleep_warmth: "Sleep warmth",
};

function gateSoft<T>(e: Evidence<T> | undefined, ok: (v: T) => boolean, min: Confidence = "medium"): CapResult {
  if (!e || e.value === null) return "blocked_unknown";
  if (!isConfident(e, min)) return "blocked_unknown";
  return ok(e.value) ? "satisfies" : "fails";
}

function combineOr(...rs: CapResult[]): CapResult {
  if (rs.includes("satisfies")) return "satisfies";
  if (rs.includes("blocked_unknown")) return "blocked_unknown";
  return "fails";
}

const rain_protection = (it: ResolvedItem): CapResult =>
  gateSoft(it.universal.waterproofness, (v) => atLeast(WATERPROOFNESS, v, "wp_breathable"));

const wind_protection = (it: ResolvedItem): CapResult =>
  gateSoft(it.universal.wind_resistance, (v) => atLeast(WIND_RESISTANCE, v, "windproof"));

const weather_shell = (it: ResolvedItem): CapResult => combineOr(rain_protection(it), wind_protection(it));

const breathable_shell = (it: ResolvedItem): CapResult => {
  const ws = weather_shell(it);
  if (ws !== "satisfies") return ws;
  return gateSoft(it.universal.breathability, (v) => atLeast(BREATHABILITY, v, "high"));
};

const wicking_base = (it: ResolvedItem): CapResult => {
  const roles = it.multilabel.layering_role;
  if (!roles.includes("next_to_skin") && !roles.includes("base")) return "fails";
  const mm = gateSoft(it.universal.moisture_management, (v) => v === "wicks");
  if (mm !== "satisfies") return mm;
  const ww = gateSoft(it.universal.warmth_when_wet, (v) => v !== "collapses");
  if (ww !== "satisfies") return ww;
  return gateSoft(it.universal.warmth, (v) => atLeast(WARMTH, v, "light"));
};

const packable_insulation = (it: ResolvedItem): CapResult => {
  const roles = it.multilabel.layering_role;
  const isWornInsulation = roles.includes("active_insulation") || roles.includes("static_insulation");
  if (!isWornInsulation) return "fails";
  return gateSoft(it.universal.packability, (v) => atLeast(PACKABILITY, v, "packable"));
};

const sun_protection = (it: ResolvedItem): CapResult => {
  const upf = it.universal.upf;
  if (upf.value !== null && upf.value >= 30) return "satisfies";
  if (it.multilabel.function_purpose.includes("sun_protection")) return "satisfies";
  return "fails";
};

/** Hot-weather active layer: wicks, dries fast, breathes well. */
const cooling = (it: ResolvedItem): CapResult => {
  const mm = gateSoft(it.universal.moisture_management, (v) => v === "wicks");
  if (mm !== "satisfies") return mm;
  const dr = gateSoft(it.universal.dry_speed, (v) => atLeast(DRY_SPEED, v, "fast"));
  if (dr !== "satisfies") return dr;
  return gateSoft(it.universal.breathability, (v) => atLeast(BREATHABILITY, v, "high"));
};

/** Sleep system rated for the trip's expected low. Uncertain rating standard ⇒ verify (blocked). */
const sleep_warmth = (it: ResolvedItem, ctx?: CapabilityContext): CapResult => {
  const sleep = it.groups.sleep;
  if (!sleep) return "fails";
  const tv = sleep.temp_rating_value;
  if (tv.value === null) return "blocked_unknown";
  const unit = sleep.temp_rating_unit.value ?? "F";
  const ratingC = unit === "C" ? tv.value : fToC(tv.value);
  const target = ctx?.conditions?.temp_min_c ?? null;
  if (target === null) return "blocked_unknown";
  if (ratingC > target) return "fails"; // not warm enough for the expected low
  const std = sleep.temp_rating_standard;
  const certified = std.value !== null && std.value !== "marketing_unknown" && std.confidence === "high";
  return certified ? "satisfies" : "blocked_unknown"; // adequate but rating provenance uncertain → verify
};

type CapFn = (it: ResolvedItem, ctx?: CapabilityContext) => CapResult;

export const CAPABILITIES: Record<CapabilityKey, CapFn> = {
  weather_shell,
  rain_protection,
  wind_protection,
  breathable_shell,
  wicking_base,
  packable_insulation,
  sun_protection,
  cooling,
  sleep_warmth,
};

export function evaluateCapability(it: ResolvedItem, key: CapabilityKey, ctx?: CapabilityContext): CapResult {
  return CAPABILITIES[key](it, ctx);
}

// ---------------------------------------------------------------------------------------------------
// Combination (layering-system) metadata — the substrate for combine.ts (DESIGN.md §5).
//
// A capability may be satisfiable not only by ONE item but by a *system* of items occupying distinct
// `layering_role` slots. WHICH aggregation applies, and over which facet, is declared HERE per
// capability — it is NOT hardcoded into the combiner and never branches on item identity. Two emergent
// strategies, both composing over registry facets:
//
//   • "additive_warmth": worn layers each contribute an ordinal `warmth` value; a set of items in
//     distinct structural slots SUMS toward a thermal target derived from the trip's expected low.
//     (base + active-insulation + static-insulation stack up to the target). Unknown warmth on a
//     would-be contributor ⇒ the combination demotes to blocked_unknown (never fabricate warmth).
//
//   • "shell_over_warmth": a weather system is the PRESENCE of a member satisfying a protective
//     sub-capability (`weather_shell`) over a member providing a warmth base, from DISTINCT items.
//     Both arms are required — drop the shell and weather protection is gone; drop the base and there
//     is nothing to protect. This is conjunctive presence, not summation.
//
// `singleItem` capabilities (e.g. sun_protection, sleep_warmth) declare no combination — a system of
// hats does not "add up" to sun protection — so the combiner leaves them to the single-item path.
// ---------------------------------------------------------------------------------------------------

export type CombinationStrategy = "additive_warmth" | "shell_over_warmth";

export interface CombinationSpec {
  strategy: CombinationStrategy;
  /**
   * For shell_over_warmth: the sub-capability whose single-item satisfaction provides the protective
   * arm. The other arm is a generic warmth base (warmth ≥ `baseWarmthMin`). Composed, never hardcoded.
   */
  protectiveCapability?: CapabilityKey;
  /** Minimum per-item warmth (ordinal level) to count as the "warmth base" arm of a composite system. */
  baseWarmthMin?: Warmth;
}

/**
 * Per-capability combination declaration. Absent ⇒ the capability is single-item only (the combiner
 * skips it). This map is the ONLY place the layering aggregation kind is decided — driven by capability
 * semantics + the warmth/shell facets in the registry, not by any product category or outfit template.
 */
export const CAPABILITY_COMBINATION: Partial<Record<CapabilityKey, CombinationSpec>> = {
  // Cold warmth need: a stack of worn layers sums toward the thermal target.
  packable_insulation: { strategy: "additive_warmth" },
  // Cold-wet protection: insulation (or any warmth base) UNDER a true weather shell — both required.
  weather_shell: { strategy: "shell_over_warmth", protectiveCapability: "weather_shell", baseWarmthMin: "light" },
};

/**
 * A worn layer's additive warmth contribution as a 3-state result + ordinal value. Only items that are
 * actually worn insulation/clothing layers (not sleep systems, not bare accessories) contribute. The
 * deciding facet is `warmth`; unknown/low-confidence ⇒ blocked_unknown so a combination can never
 * fabricate warmth. Returns the ordinal rank (0..n) when it satisfies, for the combiner to sum.
 */
export function warmthContribution(it: ResolvedItem): { result: CapResult; value: number } {
  const roles = it.multilabel.layering_role;
  // Worn clothing layers that legitimately stack on the body. Sleep systems and pure accessories do not.
  const wornLayer =
    roles.includes("next_to_skin") || roles.includes("base") || roles.includes("mid") ||
    roles.includes("active_insulation") || roles.includes("static_insulation") ||
    roles.includes("wind_shell") || roles.includes("weather_shell") || roles.includes("standalone");
  if (!wornLayer) return { result: "fails", value: 0 };
  const w = it.universal.warmth;
  if (w.value === null || !isConfident(w, "medium")) return { result: "blocked_unknown", value: 0 };
  if (!atLeast(WARMTH, w.value, "light")) return { result: "fails", value: 0 }; // contributes no real warmth
  return { result: "satisfies", value: rank(WARMTH, w.value) };
}

/**
 * Maps the trip's expected low (°C) to a cumulative warmth target on the WARMTH ordinal scale: the
 * total `warmth` rank a worn system must reach. Emergent and tunable — colder low ⇒ higher target.
 * Returns null when there is no temperature to reason about (⇒ no additive demand).
 */
export function warmthTargetRank(ctx?: CapabilityContext): number | null {
  const tmin = ctx?.conditions?.temp_min_c ?? null;
  if (tmin === null) return null;
  // Targets expressed as a SUM of warmth ranks (WARMTH ranks: minimal0 light1 moderate2 high3 very_high4).
  // A single "high"-warmth puffy = rank 3; below targets intentionally exceed any one light/mid layer in
  // the cold so that a *stack* is required, while a single sufficiently-warm item still clears them.
  if (tmin <= -10) return 6; // deep cold: needs e.g. base(1)+mid(2)+insulation(3) or a very_high+high pair
  if (tmin <= -5) return 5;
  if (tmin <= 0) return 4;
  if (tmin <= 4) return 3;
  if (tmin <= 8) return 2;
  return null; // ≥ ~8°C low: no additive warmth demand
}
