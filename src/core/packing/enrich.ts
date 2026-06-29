// Layer B (ADR-0027 §B) — the ADDITIVE LLM breadth + narration layer over the deterministic packing plan.
//
// The deterministic catalog (catalog.ts) is the safety floor: the 10 Essentials + big-3 + consumables +
// clothing, matched against the closet with the evidence engine. It cannot enumerate the long tail of
// trip/activity/destination-specific items (a bear canister in the Sierra, microspikes in shoulder
// season, a passport for travel, reef-safe sunscreen for snorkeling). This layer asks an LLM for ONLY
// those extras + a short guide note.
//
// HARD CONTRACT (keeps the never-fabricate invariant): this layer proposes NEEDS only. It NEVER asserts
// the traveler owns anything — every suggested line is status "gap", `suggested:true`, with empty
// owned/system/verify. Output is Zod-shaped + validated before use; an unknown category collapses to
// "activity", an unknown severity to "medium". PURE CORE: receives an injected Anthropic client, reads no
// env, never throws (any failure → empty enrichment, so the deterministic plan stands alone offline).

import type Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID } from "../config";
import { toLlmUsage, type LlmUsage } from "../obs/log";
import { cToF } from "../conditions";
import {
  NEED_CATEGORIES,
  NEED_CATEGORY_LABELS,
  type NeedCategory,
  type PackingPlan,
  type PackingLine,
  type Severity,
  type TripContext,
} from "./types";

export interface PackingEnrichDeps {
  anthropic: Anthropic;
  model?: string;
  onUsage?: (usage: LlmUsage) => void;
}

export interface PackingEnrichment {
  narration: string | null;
  extraLines: PackingLine[];
}

const EMPTY: PackingEnrichment = { narration: null, extraLines: [] };
const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];
const CATSET = new Set<string>(NEED_CATEGORIES);
const MAX_SUGGESTIONS = 6;

/** Extract the JSON object from the model text (tolerates a ```json fence). Null on any parse failure. */
function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function conditionsLine(ctx: TripContext): string {
  const c = ctx.conditions;
  const parts: string[] = [];
  if (c.temp_min_c !== null && c.temp_max_c !== null)
    parts.push(`${c.temp_min_c}–${c.temp_max_c}°C (${Math.round(cToF(c.temp_min_c))}–${Math.round(cToF(c.temp_max_c))}°F)`);
  parts.push(`${c.precipitation} precip`, `${c.wind} wind`, `${c.sun} sun`, `${c.exertion} exertion`, c.exposure);
  parts.push(ctx.nights >= 1 ? `${ctx.days} days / ${ctx.nights} nights` : "day trip");
  return parts.join(", ");
}

/**
 * Ask the model for trip-specific extras + a guide note, given the trip and the list ALREADY produced.
 * Returns validated, ownership-free suggestion lines + an optional narration. Never throws.
 */
export async function enrichPlanWithLlm(
  plan: PackingPlan,
  ctx: TripContext,
  deps: PackingEnrichDeps,
): Promise<PackingEnrichment> {
  const model = deps.model ?? MODEL_ID;
  try {
    const existing = plan.sections.flatMap((s) => s.lines.map((l) => l.label));
    const system =
      "You are an expert backcountry + travel packing guide. You are given a trip and the packing list ALREADY " +
      "generated for it. Your job is to add ONLY items that are SPECIFIC to this trip's activity, terrain, " +
      "wildlife, climate, or destination and are NOT already covered — plus a brief guide note. RULES: " +
      "(1) NEVER claim the traveler owns anything. (2) Do NOT restate generic items already on the list. " +
      "(3) Prefer FEWER, high-signal items over filler — return [] if nothing trip-specific is missing. " +
      "(4) Think like a guide: permits/docs, wildlife protection (e.g. bear canister), terrain aids " +
      "(microspikes, trekking poles, gaiters), climate specifics, activity gear. Output JSON only.";
    const user =
      `Trip conditions: ${conditionsLine(ctx)}\n` +
      `Activities: ${ctx.activities.length ? ctx.activities.join(", ") : "general"}\n` +
      `Party size: ${ctx.partySize}\n` +
      `Already on the list: ${existing.join("; ")}\n\n` +
      "Reply with ONLY a JSON object in a ```json fenced block:\n" +
      "```json\n" +
      '{\n  "narration": "1–2 sentence guide note tailored to THIS trip (a risk to flag, a judgment call), or null",\n' +
      `  "suggestions": [ { "label": "short item name", "category": "one of: ${NEED_CATEGORIES.join(", ")}", "severity": "critical|high|medium|low", "rationale": "one short clause why" } ]\n}` +
      "\n```\n" +
      `At most ${MAX_SUGGESTIONS} suggestions; [] if there is nothing trip-specific to add.`;

    const msg = await deps.anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    });
    deps.onUsage?.(toLlmUsage(model, msg.usage));

    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const obj = extractJson(text);
    if (!obj) return EMPTY;

    const narration =
      typeof obj.narration === "string" && obj.narration.trim() !== "" ? obj.narration.trim() : null;

    const seen = new Set(existing.map((l) => l.toLowerCase()));
    const extraLines: PackingLine[] = [];
    const rawSuggestions = Array.isArray(obj.suggestions) ? obj.suggestions : [];
    for (const s of rawSuggestions) {
      if (extraLines.length >= MAX_SUGGESTIONS) break;
      if (!s || typeof s !== "object") continue;
      const o = s as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const category: NeedCategory =
        typeof o.category === "string" && CATSET.has(o.category) ? (o.category as NeedCategory) : "activity";
      const severity: Severity =
        typeof o.severity === "string" && SEVERITIES.includes(o.severity as Severity)
          ? (o.severity as Severity)
          : "medium";
      const rationale = typeof o.rationale === "string" && o.rationale.trim() !== "" ? o.rationale.trim() : undefined;
      extraLines.push({
        key: `llm:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`,
        label,
        category,
        severity,
        status: "gap",
        quantity: null,
        consumable: false,
        rationale,
        ownedBy: [],
        systemBy: [],
        verifyBy: [],
        suggested: true,
      });
    }
    return { narration, extraLines };
  } catch {
    // Network/SDK/parse failure — the deterministic plan stands alone. Never throw.
    return EMPTY;
  }
}

/**
 * Fold an enrichment into a plan (pure): append each suggested line into its category section (creating
 * the section if needed), set the narration, and recompute the summary counts. Suggested lines are gaps,
 * so they raise `total` + `gap`. Returns the plan unchanged when the enrichment is empty.
 */
export function mergeEnrichment(plan: PackingPlan, enrichment: PackingEnrichment): PackingPlan {
  if (!enrichment.narration && enrichment.extraLines.length === 0) return plan;
  const sections = plan.sections.map((s) => ({ ...s, lines: [...s.lines] }));
  for (const line of enrichment.extraLines) {
    let sec = sections.find((s) => s.category === line.category);
    if (!sec) {
      sec = { category: line.category, label: NEED_CATEGORY_LABELS[line.category], lines: [] };
      sections.push(sec);
    }
    sec.lines.push(line);
  }
  const all = sections.flatMap((s) => s.lines);
  return {
    ...plan,
    sections,
    narration: enrichment.narration ?? plan.narration ?? null,
    summary: {
      ...plan.summary,
      total: all.length,
      owned: all.filter((l) => l.status === "owned").length,
      verify: all.filter((l) => l.status === "verify").length,
      gap: all.filter((l) => l.status === "gap").length,
    },
  };
}
