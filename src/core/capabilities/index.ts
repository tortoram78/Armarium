// Capabilities — derived predicates over a ResolvedItem's facets, each returning a 3-state result
// (DESIGN.md §5). `blocked_unknown` makes "unknown on a safety-relevant input ⇒ surface 'verify',
// never silently satisfy" a first-class, testable property. Every facet read here is a capabilityGate
// in the registry (stored hot, never JSONB).

import type { ResolvedItem } from "../resolved";
import type { Confidence, Evidence } from "../evidence";
import { isConfident } from "../evidence";
import { WATERPROOFNESS, WIND_RESISTANCE, BREATHABILITY, PACKABILITY, WARMTH, atLeast } from "../facets/levels";

export type CapResult = "satisfies" | "fails" | "blocked_unknown";

export const CAPABILITY_KEYS = [
  "weather_shell",
  "rain_protection",
  "wind_protection",
  "breathable_shell",
  "wicking_base",
  "packable_insulation",
  "sun_protection",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Evaluate a soft facet under confidence gating: unknown or under-confident ⇒ blocked_unknown. */
function gateSoft<T>(e: Evidence<T> | undefined, ok: (v: T) => boolean, min: Confidence = "medium"): CapResult {
  if (!e || e.value === null) return "blocked_unknown";
  if (!isConfident(e, min)) return "blocked_unknown";
  return ok(e.value) ? "satisfies" : "fails";
}

/** OR-combine sub-results: any satisfies ⇒ satisfies; else any blocked ⇒ blocked; else fails. */
function combineOr(...rs: CapResult[]): CapResult {
  if (rs.includes("satisfies")) return "satisfies";
  if (rs.includes("blocked_unknown")) return "blocked_unknown";
  return "fails";
}

const rain_protection = (it: ResolvedItem): CapResult =>
  gateSoft(it.universal.waterproofness, (v) => atLeast(WATERPROOFNESS, v, "wp_breathable"));

const wind_protection = (it: ResolvedItem): CapResult =>
  gateSoft(it.universal.wind_resistance, (v) => atLeast(WIND_RESISTANCE, v, "windproof"));

/** A genuine weather shell: real rain OR real wind protection. (DWR/water-resistant never qualifies.) */
const weather_shell = (it: ResolvedItem): CapResult => combineOr(rain_protection(it), wind_protection(it));

const breathable_shell = (it: ResolvedItem): CapResult => {
  const ws = weather_shell(it);
  if (ws !== "satisfies") return ws;
  return gateSoft(it.universal.breathability, (v) => atLeast(BREATHABILITY, v, "high"));
};

/** A thermal next-to-skin layer that manages moisture and won't fail when wet. */
const wicking_base = (it: ResolvedItem): CapResult => {
  const roles = it.multilabel.layering_role;
  if (!roles.includes("next_to_skin") && !roles.includes("base")) return "fails";
  const mm = gateSoft(it.universal.moisture_management, (v) => v === "wicks");
  if (mm !== "satisfies") return mm;
  const ww = gateSoft(it.universal.warmth_when_wet, (v) => v !== "collapses");
  if (ww !== "satisfies") return ww;
  return gateSoft(it.universal.warmth, (v) => atLeast(WARMTH, v, "light"));
};

/** Packable WORN insulation. Sleeping bags (sleep_system role) are deliberately excluded. */
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

export const CAPABILITIES: Record<CapabilityKey, (it: ResolvedItem) => CapResult> = {
  weather_shell,
  rain_protection,
  wind_protection,
  breathable_shell,
  wicking_base,
  packable_insulation,
  sun_protection,
};

export function evaluateCapability(it: ResolvedItem, key: CapabilityKey): CapResult {
  return CAPABILITIES[key](it);
}
