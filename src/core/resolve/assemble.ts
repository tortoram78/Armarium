// The CLAIM → CLASSIFICATION assembler (Phase 3 — ADR-0014 §3).
//
// Given the FULL claim set for one item (every claim ever made about every facet, from every source),
// resolve each facet to its winner and assemble the resolved `ItemClassification` — the shape capability
// gates + recommendations read (UNCHANGED downstream contract). This is where the resolver, previously
// fed only 2 claims at a time (behavioral.ts), receives N claims from the durable evidence store.
//
// FLOW (per ADR-0014 §3):
//   group claims by facetKey
//   → for each registry facet_key: resolveFacet(its claims) → write the winner into the nested slot
//   → materials: precedence-resolve the whole composition array (manufacturer out-ranks inferred)
//   → applicable_groups: emergent (the groups that ended up with any present field)
//   → parseClassification(assembled)   ← the single Zod boundary: closed-enum + hardFact demotion
//
// DEMOTION runs in TWO places, both mechanical (never prompt-dependent):
//   1. at the claim BOUNDARY (toLlmEvidenceClaims): an `inferred` hard fact is dropped — never written.
//   2. HERE, as defense-in-depth: parseClassification's `hardFact` preprocessor re-demotes any non-
//      authoritative hard fact that reached the assembled blob, so the resolved shape is guaranteed valid.
//
// UNREGISTERED keys (novel LLM facets) are SKIPPED here — they have no schema to validate against — but
// they persist in item_evidence (and pending_facets) for the human review queue (ADR-0014 §5).
//
// PURE: no next/*, no React, no DB, no networking. Reuses `resolveFacet` UNCHANGED.

import { parseClassification, type ItemClassification } from "../classification";
import { unknownBehavioralClassification } from "../enrich/merge";
import type { EvidenceClaim } from "../ports";
import type { Source } from "../evidence";
import { resolveFacet, type Claim, type ClaimConfidence } from "./resolve-facet";
import { FACET_PATHS, type FacetPathDef } from "./facet-paths";

/** The facetKey under which a whole composition (materials array) is claimed/resolved. */
export const MATERIALS_FACET_KEY = "materials";

/** The facetKey under which the whole treatments array is claimed/resolved (one atomic claim, like materials). */
export const TREATMENTS_FACET_KEY = "treatments";

/** An at-rest EvidenceClaim → the resolver's Claim<V>. Asserting by construction (the store holds only
 *  asserting claims), so confidence is one of low|medium|high — never the "unknown" floor. */
function toResolverClaim<V>(c: EvidenceClaim): Claim<V> {
  return {
    value: c.value as V,
    confidence: c.confidence as ClaimConfidence,
    source: c.source,
    evidence: c.evidence,
  };
}

/** Write `value` at the dotted `path` into the assembly object, creating intermediate objects as needed. */
function setAtPath(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]!] = value;
}

/** A resolved scalar claim → the stored Evidence/HardFact envelope (null winner → the known-unknown
 *  literal, so the persisted shape is exactly what the schema expects). The fact tier decides which
 *  literal: a hard fact has no `confidence` field. */
function scalarEnvelope(def: FacetPathDef, winner: Claim<unknown>): unknown {
  if (winner.value === null) {
    return def.fact === "hard"
      ? { value: null, source: "unknown" }
      : { value: null, confidence: "unknown", source: "unknown" };
  }
  if (def.fact === "hard") {
    return { value: winner.value, source: winner.source, evidence: winner.evidence };
  }
  return {
    value: winner.value,
    confidence: winner.confidence,
    source: winner.source,
    evidence: winner.evidence,
  };
}

/** The groups, in registry order, used to seed group objects + derive applicable_groups. */
const GROUP_ORDER = ["insulation", "sleep", "shell", "carry", "footwear"] as const;

/** The fields of each group, precomputed from FACET_PATHS (so it can never drift from the schema). */
const GROUP_FIELDS: Record<string, FacetPathDef[]> = (() => {
  const m: Record<string, FacetPathDef[]> = {};
  for (const def of FACET_PATHS) {
    if (!def.group) continue;
    (m[def.group] ??= []).push(def);
  }
  return m;
})();

/**
 * Seed a complete all-unknown group object on the assembly (idempotent). The group schema requires EVERY
 * field present, so any group with at least one claimed field must carry the rest as their unknown literal
 * — a hard field as UNKNOWN_HARD (`{value:null, source:"unknown"}`), a soft field as UNKNOWN_SOFT.
 */
function ensureGroupScaffold(scaffold: Record<string, unknown>, group: string): void {
  const groups = (scaffold.groups ??= {}) as Record<string, unknown>;
  if (groups[group] != null) return; // already seeded
  const obj: Record<string, unknown> = {};
  for (const f of GROUP_FIELDS[group] ?? []) {
    obj[f.path[f.path.length - 1]!] =
      f.fact === "hard" ? { value: null, source: "unknown" } : { value: null, confidence: "unknown", source: "unknown" };
  }
  groups[group] = obj;
}

/**
 * Assemble the resolved `ItemClassification` from an item's full claim set.
 *
 * - Per registry facet: `resolveFacet` over its claims → the winner written into the nested slot. A facet
 *   with no asserting claim resolves to the canonical unknown (its absence is honest, never fabricated).
 * - `materials`: the highest-precedence composition claim wins WHOLESALE (manufacturer over inferred over
 *   derived) — a composition is one atomic stated fact; we never interleave two sources' fiber lists.
 * - `applicable_groups`: EMERGENT — the groups that ended up with at least one present (non-unknown) field.
 * - The assembled blob is validated by `parseClassification` (closed enums + hardFact demotion) before return.
 *
 * Pure; never throws on a well-formed claim set (a malformed claim's value simply fails resolution and the
 * facet stays unknown, OR — if it produced an out-of-vocab value — parseClassification rejects the blob,
 * which is the intended hard boundary). Unregistered facetKeys are ignored here (they live in the store).
 */
export function assembleClassification(name: string, claims: readonly EvidenceClaim[]): ItemClassification {
  // Group claims by facetKey once.
  const byKey = new Map<string, EvidenceClaim[]>();
  for (const c of claims) {
    const list = byKey.get(c.facetKey);
    if (list) list.push(c);
    else byKey.set(c.facetKey, [c]);
  }

  // Start from an all-unknown scaffold (correct shape for every soft/hard/multilabel slot + empty groups).
  const scaffold = unknownBehavioralClassification(name) as unknown as Record<string, unknown>;

  // 1. Resolve each registry scalar/multilabel facet and write the winner.
  const groupsPresent = new Set<string>();
  for (const def of FACET_PATHS) {
    const facetClaims = byKey.get(def.key);
    if (!facetClaims || facetClaims.length === 0) continue; // no claim → keep the scaffold's unknown/[]

    const winner = resolveFacet(facetClaims.map(toResolverClaim));

    if (def.shape === "multilabel") {
      // A multilabel facet stores a plain string[] (no envelope). A null winner → []. The array is
      // validated against its closed enum by parseClassification.
      setAtPath(scaffold, def.path, Array.isArray(winner.value) ? winner.value : []);
      continue;
    }

    // A group facet: seed the FULL group object (all fields at their unknown literal) before writing into
    // it — the group schema requires EVERY field present, so a partial group object would fail validation.
    if (def.group) {
      ensureGroupScaffold(scaffold, def.group);
      if (winner.value !== null) groupsPresent.add(def.group);
    }
    setAtPath(scaffold, def.path, scalarEnvelope(def, winner));
  }

  // 2. Materials: precedence-resolve the whole composition array as one atomic claim.
  const materialsClaims = byKey.get(MATERIALS_FACET_KEY);
  if (materialsClaims && materialsClaims.length > 0) {
    const winner = resolveFacet(materialsClaims.map(toResolverClaim));
    scaffold.materials = Array.isArray(winner.value) ? winner.value : [];
  }

  // 2b. Treatments: precedence-resolve the whole treatments array as one atomic claim — exactly like
  //     materials. A treatments list is one stated set (a manufacturer DWR finish out-ranks an inferred
  //     guess); we never interleave two sources' treatment rows. Resolved BEFORE parseClassification so the
  //     winning array is validated by the single Zod boundary below.
  const treatmentsClaims = byKey.get(TREATMENTS_FACET_KEY);
  if (treatmentsClaims && treatmentsClaims.length > 0) {
    const winner = resolveFacet(treatmentsClaims.map(toResolverClaim));
    scaffold.treatments = Array.isArray(winner.value) ? winner.value : [];
  }

  // Provisional applicable_groups so the blob validates; corrected post-demotion below.
  scaffold.applicable_groups = [...groupsPresent];

  // 3. The single Zod boundary: closed-enum validation + hardFact demotion (defense-in-depth). A group
  //    whose ONLY present fields were inferred hard facts is demoted to all-null here.
  const parsed = parseClassification(scaffold) as unknown as Record<string, unknown>;

  // 4. applicable_groups + empty-group pruning are EMERGENT and computed POST-demotion: a group counts as
  //    present only if it still carries a non-null field after the hard-fact guard ran. (groupsPresent
  //    over-counts a group that held only an inferred hard fact — correct it against the parsed result.)
  const parsedGroups = (parsed.groups ?? {}) as Record<string, unknown>;
  for (const g of GROUP_ORDER) {
    if (parsedGroups[g] != null && !hasPresentField(parsedGroups[g])) delete parsedGroups[g];
  }
  parsed.applicable_groups = GROUP_ORDER.filter((g) => parsedGroups[g] != null && hasPresentField(parsedGroups[g]));

  return parsed as unknown as ItemClassification;
}

/** True iff a group object carries at least one slot with a non-null value (a real, present field). */
function hasPresentField(group: unknown): boolean {
  if (typeof group !== "object" || group === null) return false;
  return Object.values(group as Record<string, unknown>).some(
    (v) => typeof v === "object" && v !== null && (v as { value?: unknown }).value != null,
  );
}

// ----------------------------------------------------------------------------------------------------
// DECOMPOSER — a resolved ItemClassification → claims (for offline/seed items; ADR-0014 §5).
// ----------------------------------------------------------------------------------------------------

/**
 * Decompose a RESOLVED `ItemClassification` back into the flat claim set that produced it — so an item
 * classified offline (cache hit / seed corpus / draft cache) still gets a durable evidence trail
 * (ADR-0014 §5). Each present facet becomes one claim carrying its OWN stored source (usually "inferred",
 * sometimes already "manufacturer"/"user" on a seed item) — we never relabel a facet's provenance.
 *
 * It is a DEGRADED trail: confidence is taken from the stored envelope (a hard fact, which has none, is
 * recorded at "high" — it survived as an authoritative stated fact). Only PRESENT (value !== null) facets
 * are emitted: the store holds asserting claims only, and an absent facet needs no row (its absence is the
 * default). `extractorVersion` is stamped by the caller (e.g. "offline-classifier-v1" / "seed-v1").
 *
 * Pure; never throws on a validated classification.
 */
export function decomposeToClaims(c: ItemClassification, extractorVersion: string): EvidenceClaim[] {
  const out: EvidenceClaim[] = [];

  // Scalar + multilabel registry facets.
  for (const def of FACET_PATHS) {
    const slot = readAtPath(c as unknown as Record<string, unknown>, def.path);
    if (slot === undefined) continue; // group absent → no claim

    if (def.shape === "multilabel") {
      if (Array.isArray(slot) && slot.length > 0) {
        out.push({
          facetKey: def.key,
          value: slot,
          confidence: "high", // a multilabel set is asserted as-is (no graded confidence on the array)
          source: "inferred",
          evidence: `offline classification: ${def.key}`,
          extractorVersion,
        });
      }
      continue;
    }

    // Scalar envelope (Evidence or HardFact).
    const env = slot as { value?: unknown; confidence?: unknown; source?: unknown; evidence?: unknown };
    if (env == null || env.value == null) continue; // unknown facet → no claim
    out.push({
      facetKey: def.key,
      value: env.value,
      // Hard facts carry no confidence; record them at "high" (they survived as authoritative stated facts).
      confidence: normalizeConfidence(env.confidence),
      source: (env.source as Source) ?? "inferred",
      evidence: typeof env.evidence === "string" && env.evidence.length > 0 ? env.evidence : `offline classification: ${def.key}`,
      extractorVersion,
    });
  }

  // Materials: the whole composition as one claim (when present).
  if (Array.isArray(c.materials) && c.materials.length > 0) {
    // A composition's source is the materials' own stated source (manufacturer on a seed item, else
    // inferred). Take the strongest present source so a manufacturer-stated composition is recorded as such.
    const source = strongestMaterialSource(c.materials);
    out.push({
      facetKey: MATERIALS_FACET_KEY,
      value: c.materials,
      confidence: "high",
      source,
      evidence: `offline classification: composition`,
      extractorVersion,
    });
  }

  // Treatments: the whole treatments list as one claim (when present) — symmetric with materials, so a
  // round-trip can never silently erase a manufacturer-stated DWR finish on a seed/legacy item. Take the
  // strongest present source so an authoritatively-stated treatment is recorded (and out-ranks) as such.
  if (Array.isArray(c.treatments) && c.treatments.length > 0) {
    const source = strongestTreatmentSource(c.treatments);
    out.push({
      facetKey: TREATMENTS_FACET_KEY,
      value: c.treatments,
      confidence: "high",
      source,
      evidence: `offline classification: treatments`,
      extractorVersion,
    });
  }

  return out;
}

/** Read a value at a dotted path; undefined if any intermediate node is missing (e.g. an absent group). */
function readAtPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
    if (node === undefined) return undefined;
  }
  return node;
}

/** Coerce a stored envelope confidence to the at-rest claim confidence (hard facts → "high"). */
function normalizeConfidence(conf: unknown): "low" | "medium" | "high" {
  return conf === "low" || conf === "medium" || conf === "high" ? conf : "high";
}

/** The strongest source present across a composition's material rows (manufacturer/user > … > inferred). */
function strongestMaterialSource(materials: ItemClassification["materials"]): Source {
  const rank: Record<string, number> = { unknown: 0, inferred: 1, derived_from_material: 2, manufacturer: 3, user: 4 };
  let best: Source = "inferred";
  let bestRank = rank.inferred!;
  for (const m of materials) {
    const r = rank[m.source] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      best = m.source as Source;
    }
  }
  return best;
}

/** The strongest source present across a treatments list's rows (manufacturer/user > derived > inferred).
 *  Mirrors strongestMaterialSource so a manufacturer-stated treatment (e.g. a factory DWR) round-trips as
 *  authoritative rather than being relabeled "inferred". */
function strongestTreatmentSource(treatments: ItemClassification["treatments"]): Source {
  const rank: Record<string, number> = { unknown: 0, inferred: 1, derived_from_material: 2, manufacturer: 3, user: 4 };
  let best: Source = "inferred";
  let bestRank = rank.inferred!;
  for (const t of treatments) {
    const r = rank[t.source] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      best = t.source as Source;
    }
  }
  return best;
}
