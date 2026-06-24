// NL trip parsing — turn a free-text trip description into a structured TripConditions envelope.
// Mirrors the classification pipeline's discipline: the live path uses an INJECTED Anthropic client and
// Zod-validates the model output before returning; the offline path is a deterministic heuristic so the
// app (and tests) run with no API key. Either way the OUTPUT is a validated TripConditions — the same
// structured envelope deriveRequirements() reasons over, so NL input never bypasses the structured
// contract (the engine stays general; nothing is hardcoded to one trip).

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODEL_ID } from "../config";
import { toLlmUsage, type LlmUsage } from "../obs/log";
import {
  TripConditionsSchema, defaultConditions, fToC,
  PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE,
  type TripConditions,
} from "../conditions";

export interface ParseConditionsDeps {
  anthropic: Anthropic;
  model?: string;
  /**
   * Optional usage sink (mirrors the classify path). Invoked once per LLM call with model + token counts so
   * the server can meter spend without core importing a console. The offline heuristic never calls the LLM
   * and never reports usage, so absent usage is the clean default.
   */
  onUsage?: (usage: LlmUsage) => void;
}

const PARSE_MAX_TOKENS = 1024;

export class ConditionsParseError extends Error {}

// The model returns a PARTIAL (every field optional); we merge onto defaults so an unstated field is an
// explicit default, never an invented one. Enums are closed — free strings are rejected.
const PartialConditionsSchema = z.object({
  temp_min_c: z.number().nullable().optional(),
  temp_max_c: z.number().nullable().optional(),
  precipitation: z.enum(PRECIPITATION).optional(),
  wind: z.enum(WIND).optional(),
  sun: z.enum(SUN).optional(),
  exertion: z.enum(EXERTION).optional(),
  duration: z.enum(DURATION).optional(),
  exposure: z.enum(EXPOSURE).optional(),
  activities: z.array(z.string()).optional(),
});

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function buildParsePrompt(): string {
  const list = (xs: readonly string[]) => xs.join(" | ");
  return [
    "You convert a free-text outdoor-trip description into a STRUCTURED conditions envelope for a",
    "packing engine. Return ONLY a JSON object; omit any field you cannot determine (do not guess).",
    "Temperatures are degrees CELSIUS (convert if the text is Fahrenheit). temp_min_c/temp_max_c are the",
    "expected low/high the person will be EXPOSED to (include wind-chill / altitude effects in reasoning).",
    "",
    "Fields (all optional):",
    `- temp_min_c: number | null`,
    `- temp_max_c: number | null`,
    `- precipitation: ${list(PRECIPITATION)}`,
    `- wind: ${list(WIND)}`,
    `- sun: ${list(SUN)}`,
    `- exertion: ${list(EXERTION)}`,
    `- duration: ${list(DURATION)}`,
    `- exposure: ${list(EXPOSURE)}  (alpine = above treeline / exposed summit / glacier)`,
    `- activities: string[]  (e.g. ["hiking","alpine"])`,
    "",
    'Output exactly: {"temp_min_c":..,"temp_max_c":..,"precipitation":..,"wind":..,"sun":..,"exertion":..,"duration":..,"exposure":..,"activities":[..]}',
  ].join("\n");
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new ConditionsParseError("No JSON object in model output.");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ConditionsParseError("Model output was not valid JSON.");
  }
}

/** Live LLM parse: model emits a partial envelope, Zod-validated, merged onto defaults. */
export async function parseTripConditions(description: string, deps: ParseConditionsDeps): Promise<TripConditions> {
  const model = deps.model ?? MODEL_ID;
  const msg = await deps.anthropic.messages.create({
    model,
    max_tokens: PARSE_MAX_TOKENS,
    system: buildParsePrompt(),
    messages: [{ role: "user", content: `Trip description: ${description}\n\nReturn the JSON now.` }],
  });
  deps.onUsage?.(toLlmUsage(model, msg.usage));
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = PartialConditionsSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new ConditionsParseError("Trip conditions failed validation.");
  return TripConditionsSchema.parse(defaultConditions(stripUndefined(parsed.data)));
}

// ---------------------------------------------------------------------------------------------------
// Offline heuristic — deterministic keyword mapping so the app runs with no API key. It is intentionally
// conservative: unrecognised text falls back to mild defaults, and the user can always adjust the
// structured form. The goal is a *reasonable* envelope across archetypes (alpine / desert / rain /
// casual), not perfection — tested in test/parse-conditions.test.ts across ≥3 distinct trips.
// ---------------------------------------------------------------------------------------------------

interface TempBand { min: number; max: number; }

function explicitTemps(t: string): Partial<TempBand> {
  // "10 to 20", "10-20" (optionally with a unit on the second number)
  const range = t.match(/(-?\d+)\s*(?:to|-|–)\s*(-?\d+)\s*°?\s*([cf])?/);
  if (range) {
    const a = Number(range[1]), b = Number(range[2]);
    const toC = (n: number) => (range[3] === "f" ? Math.round(fToC(n)) : n);
    return { min: toC(Math.min(a, b)), max: toC(Math.max(a, b)) };
  }
  // single "30f" / "30 °c" / "30 degrees"
  const single = t.match(/(-?\d+)\s*°?\s*(?:degrees?\s*)?([cf])\b/);
  if (single) {
    const n = Number(single[1]);
    const c = single[2] === "f" ? Math.round(fToC(n)) : n;
    return { min: c, max: c };
  }
  return {};
}

function bandFromKeywords(t: string): TempBand | null {
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("freezing", "below freezing", "subzero", "sub-zero", "winter", "snow", "ice", "frigid")) return { min: -6, max: 2 };
  if (has("alpine", "cold", "chilly", "frosty")) return { min: 2, max: 10 };
  if (has("hot", "desert", "scorching", "heat")) return { min: 18, max: 33 };
  if (has("cool", "crisp", "brisk")) return { min: 6, max: 14 };
  if (has("warm", "mild", "temperate", "pleasant")) return { min: 12, max: 22 };
  return null;
}

export function parseConditionsHeuristic(description: string): TripConditions {
  const t = ` ${description.toLowerCase()} `;
  const has = (...w: string[]) => w.some((x) => t.includes(x));

  const precipitation =
    has("blizzard", "snowstorm", " snow", "snowy") ? "snow"
    : has("sustained rain", "all-day rain", "all day rain", "downpour", "pouring", "soaking", "days of rain", "constant rain", "heavy rain") ? "sustained"
    : has("rain", "shower", "drizzle", "wet", "damp", "precip", "storm") ? "light"
    : "none";

  const wind =
    has("windy", "gale", "gusty", "strong wind", "high wind", "exposed ridge", "blustery") ? "strong"
    : has("breez", "light wind") ? "breezy"
    : "calm";

  const exposure =
    has("alpine", "summit", "above treeline", "above tree line", "glacier", "ridge", "high altitude", "mountaineer") ? "alpine"
    : has("exposed", "desert", "open terrain", "open country", "tundra") ? "exposed"
    : "sheltered";

  const sun =
    has("intense sun", "high sun", "strong sun", "desert", "glacier", "blazing", "sunny") || exposure === "alpine" ? "high"
    : has("overcast", "cloudy", "cloud", "shade", "shaded", "rain", "fog") ? "low"
    : "moderate";

  const exertion =
    has("scrambl", "climb", "summit", "strenuous", "fast", "trail run", "trail-run", "running", "hard effort", "steep") ? "high"
    : has("relaxed", "casual", "leisurely", "stroll", "easy", "city", "town", "sightsee") ? "low"
    : "moderate";

  const duration =
    has("multi-day", "multiday", "multi day", "several days", "days out", "backpack", "thru-hike", "thru hike", "nights") ? "multiday"
    : has("overnight", "one night", "two day", "weekend") ? "overnight"
    : "day";

  const band = { ...bandFromKeywords(t), ...explicitTemps(t) };
  const temp_min_c = band.min ?? null;
  const temp_max_c = band.max ?? null;

  const activities: string[] = [];
  for (const a of ["hiking", "backpacking", "alpine", "climbing", "travel", "camp", "watersports"]) {
    if (t.includes(a)) activities.push(a);
  }

  return defaultConditions({
    temp_min_c, temp_max_c, precipitation, wind, sun, exertion, duration, exposure, activities,
  });
}
