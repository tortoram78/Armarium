// Combination-aware capability evaluation — the layering-system upgrade (DESIGN.md §5; ADR-0010).
//
// The single-item path (index.ts) asks "does ANY one item satisfy this capability?". Real packing is a
// SYSTEM: a wicking base + a fleece mid + a shell together handle conditions no single piece can. This
// module evaluates a derived requirement across *sets* of owned items occupying DISTINCT structural
// layering slots, when (and only when) the capability declares a combination strategy.
//
// It is strictly EMERGENT: there are no outfit templates and no category routing. The combiner composes
// over (a) the `layering_role` facet — to define which slot an item fills and enforce distinct slots —
// and (b) the per-capability `CombinationSpec` metadata, which says HOW to aggregate (sum warmth vs.
// require a protective layer over a warmth base). Add a layering role or a new combinable capability and
// the logic follows automatically; nothing here knows about any specific product.

import type { ResolvedItem } from "../resolved";
import { atLeast, WARMTH, type LayeringRole } from "../facets/levels";
import {
  type CapResult,
  type CapabilityKey,
  type CapabilityContext,
  type CombinationSpec,
  CAPABILITY_COMBINATION,
  evaluateCapability,
  warmthContribution,
  warmthTargetRank,
} from "../capabilities";

/**
 * A combination outcome: the aggregate state + the item ids involved.
 *  - result "satisfies": `itemIds` are the members of the satisfying system (≥1).
 *  - result "blocked_unknown": `itemIds` are the would-be contributors whose unknown deciding facet
 *    caused the demotion — surfaced to the user as "verify".
 *  - result "fails": no viable system; `itemIds` is empty.
 */
export interface ComboResult {
  result: CapResult;
  itemIds: string[];
}

const FAILS: ComboResult = { result: "fails", itemIds: [] };

// ---------------------------------------------------------------------------------------------------
// Structural slots — an EMERGENT partition of `layering_role` into the physical "tiers" a worn system
// stacks through. Distinct slots are what make a *set* a real system (you don't form a layering system
// from two base layers). Derived from the role vocabulary, not hardcoded outfits; an item occupies the
// HIGHEST tier among its roles (a base/standalone piece worn as the outer layer still fills one slot).
// ---------------------------------------------------------------------------------------------------

const SLOT_OF_ROLE: Partial<Record<LayeringRole, number>> = {
  next_to_skin: 0,
  base: 0,
  active_insulation: 1,
  mid: 1,
  static_insulation: 2,
  wind_shell: 3,
  weather_shell: 3,
  standalone: 1, // a standalone worn piece occupies a mid-ish body slot for stacking purposes
  // sleep_system / accessory: no worn-stacking slot (undefined) — excluded from layering systems.
};

/** The structural slot an item fills (highest tier among its roles), or null if it doesn't stack. */
function slotOf(it: ResolvedItem): number | null {
  let slot: number | null = null;
  for (const role of it.multilabel.layering_role) {
    const s = SLOT_OF_ROLE[role];
    if (s === undefined) continue;
    slot = slot === null ? s : Math.max(slot, s);
  }
  return slot;
}

// ---------------------------------------------------------------------------------------------------
// Strategy: additive_warmth — worn layers each contribute an ordinal warmth value; a set of items in
// DISTINCT slots sums toward the thermal target derived from the trip's expected low. Greedy from the
// warmest eligible items, one per slot, until the target is reached. If the target can't be reached but
// an unknown-warmth worn layer exists that *could* have closed the gap, the system demotes to "verify"
// rather than declaring a gap — unknown is first-class.
// ---------------------------------------------------------------------------------------------------

function combineAdditiveWarmth(items: ResolvedItem[], ctx?: CapabilityContext): ComboResult {
  const target = warmthTargetRank(ctx);
  if (target === null) return FAILS; // no thermal demand from the conditions ⇒ nothing to combine for

  // Best contributing item per structural slot, plus any worn layer whose warmth is unknown.
  const bestBySlot = new Map<number, { id: string; value: number }>();
  const unknownContributors: string[] = [];
  for (const it of items) {
    const slot = slotOf(it);
    if (slot === null) continue;
    const c = warmthContribution(it);
    if (c.result === "blocked_unknown") {
      unknownContributors.push(it.id);
      continue;
    }
    if (c.result !== "satisfies") continue;
    const cur = bestBySlot.get(slot);
    if (!cur || c.value > cur.value) bestBySlot.set(slot, { id: it.id, value: c.value });
  }

  // Sum the per-slot best contributions (distinct slots guaranteed by the map key) high→low and stop
  // once the target is met, so the system cites the minimal set that reaches it.
  const contributors = [...bestBySlot.values()].sort((a, b) => b.value - a.value);
  let sum = 0;
  const used: string[] = [];
  for (const c of contributors) {
    if (sum >= target) break;
    sum += c.value;
    used.push(c.id);
  }
  if (sum >= target) return { result: "satisfies", itemIds: used };

  // Couldn't reach the target with known warmth. If an unknown-warmth worn layer exists, it MIGHT close
  // the gap ⇒ verify (cite those layers); otherwise it's a genuine gap (fails).
  return unknownContributors.length > 0
    ? { result: "blocked_unknown", itemIds: unknownContributors }
    : FAILS;
}

// ---------------------------------------------------------------------------------------------------
// Strategy: shell_over_warmth — a weather SYSTEM is a member satisfying the protective sub-capability
// (e.g. weather_shell) over a DISTINCT member providing a warmth base. Conjunctive presence: both arms
// required. (The single-item path already catches a one-piece shell; this only adds the case where the
// shell and the warmth are different garments — the realistic cold-wet kit.) An unknown deciding facet
// on the would-be protective arm demotes the system to "verify".
// ---------------------------------------------------------------------------------------------------

function combineShellOverWarmth(items: ResolvedItem[], spec: CombinationSpec, ctx?: CapabilityContext): ComboResult {
  const protectiveCap = spec.protectiveCapability;
  if (!protectiveCap) return FAILS;
  const baseMin = spec.baseWarmthMin ?? "light";

  // The warmth base arm: any worn layer with warmth ≥ baseMin (known) — reuse warmthContribution for the
  // unknown-demotion semantics, then apply the spec's ordinal floor.
  let protectiveId: string | null = null;
  const protectiveUnknownIds: string[] = [];
  const baseIds: string[] = [];
  const baseUnknownIds: string[] = [];

  for (const it of items) {
    const prot = evaluateCapability(it, protectiveCap, ctx);
    if (prot === "satisfies" && protectiveId === null) protectiveId = it.id;
    else if (prot === "blocked_unknown") protectiveUnknownIds.push(it.id);

    const c = warmthContribution(it);
    if (c.result === "blocked_unknown") baseUnknownIds.push(it.id);
    else if (c.result === "satisfies" && atLeast(WARMTH, it.universal.warmth.value, baseMin)) baseIds.push(it.id);
  }

  // Need a warmth base that is a DISTINCT item from the protective shell.
  const distinctBase = baseIds.find((id) => id !== protectiveId) ?? null;

  if (protectiveId !== null && distinctBase !== null) {
    return { result: "satisfies", itemIds: [protectiveId, distinctBase] };
  }
  // Both arms must be present for a system. If exactly one arm is firmly present and the other is only
  // UNKNOWN (an item that could have completed the system), demote to verify (cite the unknown arm);
  // otherwise there is no system (fails — the single-item path or a genuine gap governs).
  const baseUnknownDistinct = baseUnknownIds.filter((id) => id !== protectiveId);
  const protectiveUnknownDistinct = protectiveUnknownIds.filter((id) => !baseIds.includes(id) || baseIds.length > 1);

  if (protectiveId !== null && distinctBase === null && baseUnknownDistinct.length > 0) {
    return { result: "blocked_unknown", itemIds: [protectiveId, ...baseUnknownDistinct] };
  }
  if (distinctBase !== null && protectiveId === null && protectiveUnknownDistinct.length > 0) {
    return { result: "blocked_unknown", itemIds: [distinctBase, ...protectiveUnknownDistinct] };
  }
  return FAILS;
}

/**
 * Evaluate a capability across COMBINATIONS of owned items. Returns the system that satisfies (or a
 * "verify" demotion), or `fails` when no viable system exists / the capability isn't combinable. The
 * single-item path is evaluated by the caller FIRST; this only runs to find a *system* the single-item
 * path missed.
 */
export function evaluateCombination(
  items: ResolvedItem[],
  capability: CapabilityKey,
  ctx?: CapabilityContext,
): ComboResult {
  const spec = CAPABILITY_COMBINATION[capability];
  if (!spec) return FAILS;
  switch (spec.strategy) {
    case "additive_warmth":
      return combineAdditiveWarmth(items, ctx);
    case "shell_over_warmth":
      return combineShellOverWarmth(items, spec, ctx);
  }
}
