// Recommendation + gap analysis — pure reasoning over the facet space (Layer 2). A trip envelope is a
// set of required capabilities (derived from conditions; see derive.ts) with severities; each is
// evaluated across the inventory into satisfied / uncertain (blocked_unknown ⇒ "verify") / gap.

import type { ResolvedItem } from "../resolved";
import type { TripConditions } from "../conditions";
import { type CapabilityKey, type CapResult, type CapabilityContext, evaluateCapability } from "../capabilities";

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

export interface CapabilityOutcome {
  capability: CapabilityKey;
  severity: Severity;
  reason?: string;
  status: "satisfied" | "uncertain" | "gap";
  satisfiedBy: ItemRef[];
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

  const outcomes: CapabilityOutcome[] = env.required.map(({ capability, severity, reason }) => {
    const satisfiedBy: ItemRef[] = [];
    const blockedBy: ItemRef[] = [];
    for (const it of items) {
      const r: CapResult = evaluateCapability(it, capability, ctx);
      if (r === "satisfies") satisfiedBy.push({ id: it.id, name: it.name });
      else if (r === "blocked_unknown") blockedBy.push({ id: it.id, name: it.name });
    }
    const status: CapabilityOutcome["status"] =
      satisfiedBy.length > 0 ? "satisfied" : blockedBy.length > 0 ? "uncertain" : "gap";
    return { capability, severity, reason, status, satisfiedBy, blockedBy };
  });

  const pickMap = new Map<string, Pick>();
  for (const o of outcomes) {
    for (const ref of o.satisfiedBy) {
      const existing = pickMap.get(ref.id) ?? { id: ref.id, name: ref.name, capabilities: [] };
      existing.capabilities.push(o.capability);
      pickMap.set(ref.id, existing);
    }
  }

  const gaps: Gap[] = outcomes
    .filter((o) => o.status === "gap")
    .map((o) => ({ capability: o.capability, severity: o.severity, reason: o.reason }));
  const uncertain: Gap[] = outcomes
    .filter((o) => o.status === "uncertain")
    .map((o) => ({ capability: o.capability, severity: o.severity, reason: o.reason }));

  return { trip: env.name, outcomes, picks: [...pickMap.values()], gaps, uncertain };
}
