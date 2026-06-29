// The packing engine (ADR-0027) — assembles a trip + the resolved closet into a quantified, gear-first
// PackingPlan. PURE + deterministic + offline (no LLM in this layer). Coverage for a need that maps to a
// faceted `capability` is decided by the EXISTING evidence engine (evaluateCapability + the layering
// combiner) — so owned/verify/gap is unknown-safe and never fabricates; a generic need is matched loosely
// by name/tags against owned gear. The result is the same 3-state honesty the auditor had, but expressed
// as a real checklist that spans the whole list and scales quantities to the trip.

import type { ResolvedItem } from "../resolved";
import type { TripConditions } from "../conditions";
import {
  type CapabilityKey,
  type CapabilityContext,
  evaluateCapability,
} from "../capabilities";
import { evaluateCombination } from "../recommend/combine";
import { NEED_SPECS, SEVERITY_ORDER } from "./catalog";
import {
  NEED_CATEGORIES,
  NEED_CATEGORY_LABELS,
  type PackItemRef,
  type PackingLine,
  type PackingPlan,
  type PackingSection,
  type TripContext,
  type NeedCategory,
} from "./types";

export interface PackingOpts {
  /** Trip-type / activity tags (drive activity-specific + urban-vs-backcountry needs). Defaults to the
   *  conditions' own `activities`. */
  activities?: string[];
  /** Number of people the plan packs for (scales consumables). Default 1. */
  partySize?: number;
  /** Explicit trip length in days; otherwise derived from `duration`. */
  days?: number;
}

/** day → 1 day / 0 nights; overnight → 2 / 1; multiday → 4 / 3. Tunable; Phase 2 will accept explicit days. */
function daysFromDuration(d: TripConditions["duration"]): number {
  return d === "multiday" ? 4 : d === "overnight" ? 2 : 1;
}

export function tripContext(conditions: TripConditions, opts: PackingOpts = {}): TripContext {
  const days = opts.days && opts.days > 0 ? Math.round(opts.days) : daysFromDuration(conditions.duration);
  const activities = (opts.activities ?? conditions.activities ?? []).map((a) => a.toLowerCase());
  return {
    conditions,
    activities,
    days,
    nights: Math.max(0, days - 1),
    partySize: opts.partySize && opts.partySize > 0 ? Math.round(opts.partySize) : 1,
  };
}

const ref = (it: ResolvedItem): PackItemRef => ({ id: it.id, name: it.name });

/** Faceted coverage for a capability-backed need — mirrors recommend/index.ts (single item OR a layering
 *  system; unknown deciding facet ⇒ "verify"). */
function coverByCapability(
  items: ResolvedItem[],
  capability: CapabilityKey,
  ctx: CapabilityContext,
): { ownedBy: PackItemRef[]; systemBy: PackItemRef[]; verifyBy: PackItemRef[] } {
  const ownedBy: PackItemRef[] = [];
  const verifyBy: PackItemRef[] = [];
  const byId = new Map(items.map((it) => [it.id, it] as const));
  for (const it of items) {
    const r = evaluateCapability(it, capability, ctx);
    if (r === "satisfies") ownedBy.push(ref(it));
    else if (r === "blocked_unknown") verifyBy.push(ref(it));
  }
  const systemBy: PackItemRef[] = [];
  if (ownedBy.length === 0) {
    const combo = evaluateCombination(items, capability, ctx);
    if (combo.result === "satisfies" && combo.itemIds.length > 0) {
      for (const id of combo.itemIds) {
        const it = byId.get(id);
        if (it) systemBy.push(ref(it));
      }
    } else if (combo.result === "blocked_unknown") {
      for (const id of combo.itemIds) {
        if (!verifyBy.some((v) => v.id === id)) {
          const it = byId.get(id);
          if (it) verifyBy.push(ref(it));
        }
      }
    }
  }
  return { ownedBy, systemBy, verifyBy };
}

/** Loose coverage for a generic need — owned gear whose name or user-tags contain any match term. */
function coverByTerms(items: ResolvedItem[], terms: readonly string[]): PackItemRef[] {
  const t = terms.map((s) => s.toLowerCase());
  const out: PackItemRef[] = [];
  for (const it of items) {
    const hay = `${it.name} ${it.inventory.userTags.join(" ")}`.toLowerCase();
    if (t.some((term) => hay.includes(term))) out.push(ref(it));
  }
  return out;
}

/**
 * Build the packing plan: evaluate every need spec against the trip, match owned gear, group by category,
 * and roll up the summary. The output is deterministic — same trip + same closet → same plan.
 */
export function planPacking(
  items: ResolvedItem[],
  name: string,
  conditions: TripConditions,
  opts: PackingOpts = {},
): PackingPlan {
  const ctx = tripContext(conditions, opts);
  const capCtx: CapabilityContext = { conditions };
  const byId = new Map(items.map((it) => [it.id, it] as const));

  // Catalog order, for a stable within-section sort (severity-first, then the order specs are declared).
  const specOrder = new Map(NEED_SPECS.map((s, i) => [s.key, i] as const));

  const lines: PackingLine[] = [];
  NEED_SPECS.forEach((spec) => {
    const severity = spec.applies(ctx);
    if (!severity) return;

    let ownedBy: PackItemRef[] = [];
    let systemBy: PackItemRef[] = [];
    let verifyBy: PackItemRef[] = [];
    if (spec.capability) {
      ({ ownedBy, systemBy, verifyBy } = coverByCapability(items, spec.capability, capCtx));
    } else if (spec.matchTerms) {
      ownedBy = coverByTerms(items, spec.matchTerms);
    }

    const status =
      ownedBy.length > 0 || systemBy.length > 0 ? "owned" : verifyBy.length > 0 ? "verify" : "gap";

    lines.push({
      key: spec.key,
      label: spec.label,
      category: spec.category,
      severity,
      status,
      quantity: spec.quantity?.(ctx) ?? null,
      consumable: Boolean(spec.consumable),
      rationale: spec.rationale?.(ctx) || undefined,
      ownedBy,
      systemBy,
      verifyBy,
    });
  });

  // Group into sections in canonical category order; within a section, severity-first then catalog order.
  const sections: PackingSection[] = [];
  for (const category of NEED_CATEGORIES) {
    const inCat = lines
      .filter((l) => l.category === category)
      .sort((a, b) => {
        const s = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
        return s !== 0 ? s : (specOrder.get(a.key) ?? 0) - (specOrder.get(b.key) ?? 0);
      });
    if (inCat.length > 0) {
      sections.push({ category, label: NEED_CATEGORY_LABELS[category], lines: inCat });
    }
  }

  // Pack capacity: the largest known capacity among owned items matched into the carry need.
  let packCapacityL: number | null = null;
  for (const l of lines) {
    if (l.category !== "carry") continue;
    for (const r of l.ownedBy) {
      const cap = byId.get(r.id)?.groups.carry?.capacity_liters;
      if (cap && cap.value !== null) packCapacityL = Math.max(packCapacityL ?? 0, cap.value);
    }
  }

  // Pack weight (ADR-0027 §Phase 4): sum the known `weight_grams` of every DISTINCT owned item matched
  // into the plan (single + system). Null when none of the matched gear has a known weight — honest,
  // never a fabricated total. (Generic/consumable lines and gaps carry no owned item, so contribute none.)
  const ownedIds = new Set<string>();
  for (const l of lines) {
    for (const r of l.ownedBy) ownedIds.add(r.id);
    for (const r of l.systemBy) ownedIds.add(r.id);
  }
  let weightGrams: number | null = null;
  for (const id of ownedIds) {
    const w = byId.get(id)?.weightGrams;
    if (w !== null && w !== undefined) weightGrams = (weightGrams ?? 0) + w;
  }

  const summary = {
    total: lines.length,
    owned: lines.filter((l) => l.status === "owned").length,
    verify: lines.filter((l) => l.status === "verify").length,
    gap: lines.filter((l) => l.status === "gap").length,
    weightGrams,
    packCapacityL,
  };

  return { trip: name, sections, summary };
}
