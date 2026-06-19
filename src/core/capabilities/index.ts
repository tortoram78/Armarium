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
  WATERPROOFNESS, WIND_RESISTANCE, BREATHABILITY, PACKABILITY, WARMTH, DRY_SPEED, atLeast,
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
