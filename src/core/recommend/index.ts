// Recommendation + gap analysis — pure reasoning over the facet space (Layer 2). A trip envelope is a
// set of required capabilities (derived from conditions; see derive.ts) with severities; each is
// evaluated across the inventory into satisfied / uncertain (blocked_unknown ⇒ "verify") / gap.

import type { ResolvedItem } from "../resolved";
import type { TripConditions } from "../conditions";
import { type CapabilityKey, type CapResult, type CapabilityContext, evaluateCapability } from "../capabilities";
import { evaluateCombination } from "./combine";

export type Severity = "critical" | "high" | "medium" | "low";

export interface Requirement {
  capability: CapabilityKey;
  severity: Severity;
  reason?: string;
}

export interface TripEnvelope {
  name: string;
  description?: string;
  conditions?: TripConditions;
  required: Requirement[];
}

export interface ItemRef {
  id: string;
  name: string;
}

/**
 * A "system": a set of items (≥2, distinct layering slots) that JOINTLY satisfy a capability no single
 * member satisfies alone (e.g. base+mid+insulation for warmth, or insulation+shell for cold-wet). The
 * combination logic is emergent — see recommend/combine.ts.
 */
export interface ItemSystem {
  items: ItemRef[];
}

export interface CapabilityOutcome {
  capability: CapabilityKey;
  severity: Severity;
  reason?: string;
  status: "satisfied" | "uncertain" | "gap";
  /** Items that satisfy the capability INDIVIDUALLY (the original single-item path). Unchanged shape. */
  satisfiedBy: ItemRef[];
  /**
   * Sets of items that satisfy the capability TOGETHER as a layering system (additive — additive to the
   * single-item path). Empty when no system is needed/found. A capability is "satisfied" iff
   * `satisfiedBy` is non-empty OR `satisfiedBySystem` is non-empty.
   */
  satisfiedBySystem: ItemSystem[];
  /** Items that *might* satisfy but have an unknown/low-confidence deciding facet — "verify". */
  blockedBy: ItemRef[];
}

export interface Pick {
  id: string;
  name: string;
  capabilities: CapabilityKey[];
}

export interface Gap {
  capability: CapabilityKey;
  severity: Severity;
  reason?: string;
}

export interface RecommendationResult {
  trip: string;
  outcomes: CapabilityOutcome[];
  picks: Pick[];
  gaps: Gap[];
  uncertain: Gap[];
}

export function recommend(items: ResolvedItem[], env: TripEnvelope): RecommendationResult {
  const ctx: CapabilityContext = { conditions: env.conditions };

  const byId = new Map(items.map((it) => [it.id, it]));
  const ref = (id: string): ItemRef => ({ id, name: byId.get(id)?.name ?? id });

  const outcomes: CapabilityOutcome[] = env.required.map(({ capability, severity, reason }) => {
    const satisfiedBy: ItemRef[] = [];
    const blockedBy: ItemRef[] = [];
    for (const it of items) {
      const r: CapResult = evaluateCapability(it, capability, ctx);
      if (r === "satisfies") satisfiedBy.push({ id: it.id, name: it.name });
      else if (r === "blocked_unknown") blockedBy.push({ id: it.id, name: it.name });
    }

    // Combination (layering-system) path — consulted only when no single item already satisfies, so it
    // never invents extra layers for an already-covered need. A combinable capability may satisfy via a
    // *system*, or demote a would-be system to "verify" when a deciding facet is unknown.
    const satisfiedBySystem: ItemSystem[] = [];
    if (satisfiedBy.length === 0) {
      const combo = evaluateCombination(items, capability, ctx);
      if (combo.result === "satisfies" && combo.itemIds.length > 0) {
        satisfiedBySystem.push({ items: combo.itemIds.map(ref) });
      } else if (combo.result === "blocked_unknown") {
        // Surface the would-be contributors as "verify" (dedup against the single-item blockedBy).
        for (const id of combo.itemIds) {
          if (!blockedBy.some((b) => b.id === id)) blockedBy.push(ref(id));
        }
      }
    }

    const status: CapabilityOutcome["status"] =
      satisfiedBy.length > 0 || satisfiedBySystem.length > 0
        ? "satisfied"
        : blockedBy.length > 0
          ? "uncertain"
          : "gap";
    return { capability, severity, reason, status, satisfiedBy, satisfiedBySystem, blockedBy };
  });

  const pickMap = new Map<string, Pick>();
  const addPick = (r: ItemRef, cap: CapabilityKey) => {
    const existing = pickMap.get(r.id) ?? { id: r.id, name: r.name, capabilities: [] };
    if (!existing.capabilities.includes(cap)) existing.capabilities.push(cap);
    pickMap.set(r.id, existing);
  };
  for (const o of outcomes) {
    for (const r of o.satisfiedBy) addPick(r, o.capability);
    for (const sys of o.satisfiedBySystem) for (const r of sys.items) addPick(r, o.capability);
  }

  const gaps: Gap[] = outcomes
    .filter((o) => o.status === "gap")
    .map((o) => ({ capability: o.capability, severity: o.severity, reason: o.reason }));
  const uncertain: Gap[] = outcomes
    .filter((o) => o.status === "uncertain")
    .map((o) => ({ capability: o.capability, severity: o.severity, reason: o.reason }));

  return { trip: env.name, outcomes, picks: [...pickMap.values()], gaps, uncertain };
}
