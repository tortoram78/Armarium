// The composition → behavioral-facets derivation engine.
//
// `deriveFromComposition(materials)` reads a validated `ItemClassification["materials"]` array and returns
// a PARTIAL overlay of universal behavioral facets — each as the standard evidence envelope
// `{value, confidence, source:"derived_from_material", evidence}` — for ONLY the facets the composition
// actually determines. Everything else is absent (the caller treats absent as unknown). It NEVER
// fabricates: an undetermined property, or a fiber not in the library, simply produces no entry.
//
// PROVENANCE (for the later classify-pipeline integration — not built here): `derived_from_material`
// out-ranks `inferred` but sits UNDER `manufacturer`/`user`. The output is shaped so a caller can apply
// that precedence: it is a sparse map keyed by facet, each value carrying its own source, so the caller
// merges field-by-field (e.g. "take derived over inferred; never over manufacturer/user").
//
// EMERGENT, NOT HARDCODED: behavior is computed from the library + the `pct` values via a general
// weighted-consensus rule (below). There is NO per-named-product or per-item special-casing. The
// hemp/cotton → absorbs_holds + collapses result, the polyester → wicks/fast result, and the
// nylon/elastane → nylon-wins result all fall out of the SAME rule applied to different compositions.
//
// PURE: no next/*, no React, no DB, no networking. Imports only the library + the canonical vocab + types.

import * as L from "./../facets/levels";
import type { ItemClassification } from "./../classification";
import {
  lookupFiber,
  type MaterialLibraryEntry,
  type BehaviorProperty,
  type LibraryConfidence,
} from "./library";

type Materials = ItemClassification["materials"];

// ---- output shape ----------------------------------------------------------------------------------

/** One derived behavioral facet: the standard evidence envelope, always source:"derived_from_material". */
export interface DerivedValue<V extends string> {
  value: V;
  confidence: LibraryConfidence;
  source: "derived_from_material";
  evidence: string;
}

/**
 * The sparse overlay produced from a composition. Each field is present ONLY when the composition
 * determines it; an absent field means "not determinable from composition" (→ caller keeps it unknown,
 * or whatever a stronger source already set). The keys are exactly the universal soft behavioral facets
 * a fiber can influence — a deliberate subset of `UniversalFacets` (we never derive waterproofness,
 * wind_resistance, packability, or technical_vs_lifestyle from fiber, as those are construction/finish/
 * design properties, not material chemistry).
 */
export interface DerivedFacets {
  moisture_management?: DerivedValue<L.MoistureManagement>;
  dry_speed?: DerivedValue<L.DrySpeed>;
  warmth_when_wet?: DerivedValue<L.WarmthWhenWet>;
  breathability?: DerivedValue<L.Breathability>;
  warmth?: DerivedValue<L.Warmth>;
}

// ---- internal: normalized fiber contributions ------------------------------------------------------

interface Contribution {
  /** Raw stated fiber name (for evidence strings). */
  raw: string;
  /** Library entry for this fiber, or null if not curated. */
  entry: MaterialLibraryEntry | null;
  /** Composition share in [0,1], normalized across the materials we counted. */
  share: number;
}

/**
 * Which materials to derive from. We derive from the SINGLE most relevant material layer rather than
 * mixing a shell and a separate lining into one nonsensical blend. Preference order mirrors how the
 * other facets key off the worn outer face: shell > membrane > insulation > lining. (The enrichment
 * mapper already collapses a full composition string to one material with role "shell" in the common
 * case, so this usually selects that one.) When several share the top role, we union their fibers — a
 * single stated composition spread across rows is still one fabric.
 */
const ROLE_PRIORITY: Record<Materials[number]["role"], number> = {
  shell: 4,
  membrane: 3,
  insulation: 2,
  lining: 1,
};

function selectMaterials(materials: Materials): Materials {
  if (materials.length === 0) return [];
  let bestRank = -1;
  for (const m of materials) {
    const r = ROLE_PRIORITY[m.role] ?? 0;
    if (r > bestRank) bestRank = r;
  }
  return materials.filter((m) => (ROLE_PRIORITY[m.role] ?? 0) === bestRank);
}

/**
 * Build normalized fiber contributions from the selected materials.
 *
 * - Fibers are canonicalized (via the library's normalizer, aligned with the enrichment parser).
 * - Duplicate canonical fibers (e.g. split across rows) are merged by summing share.
 * - `pct` drives the weight. When NO component states a pct (a bare "merino wool" with pct:null), we
 *   fall back to EQUAL shares so a single-fiber composition still derives; a partial-pct blend uses the
 *   stated numbers and ignores the unweighted remainder (rare, and conservative).
 */
function buildContributions(materials: Materials): Contribution[] {
  const selected = selectMaterials(materials);
  const flat: { raw: string; pct: number | null }[] = [];
  for (const m of selected) {
    for (const c of m.fiber_components) {
      if (!c || typeof c.fiber !== "string" || c.fiber.trim() === "") continue;
      flat.push({ raw: c.fiber, pct: typeof c.pct === "number" && c.pct >= 0 ? c.pct : null });
    }
  }
  if (flat.length === 0) return [];

  // Merge by canonical key, summing stated pct; track raw label + whether any pct was stated.
  const merged = new Map<string, { raw: string; entry: MaterialLibraryEntry | null; pct: number; hasPct: boolean }>();
  for (const f of flat) {
    const entry = lookupFiber(f.raw);
    // Key by canonical entry fiber when known, else by a normalized-but-unknown token so two spellings of
    // the same unknown fiber still merge.
    const key = entry?.fiber ?? normalizeUnknown(f.raw);
    const prev = merged.get(key);
    const pct = f.pct ?? 0;
    const hasPct = f.pct != null;
    if (!prev) merged.set(key, { raw: f.raw, entry, pct, hasPct });
    else {
      prev.pct += pct;
      prev.hasPct = prev.hasPct || hasPct;
    }
  }

  const items = [...merged.values()];
  const anyPct = items.some((i) => i.hasPct && i.pct > 0);
  const totalPct = items.reduce((s, i) => s + (i.hasPct ? i.pct : 0), 0);

  return items.map((i) => {
    let share: number;
    if (anyPct && totalPct > 0) {
      // Weight by stated pct; an item with no stated pct in a partially-stated blend contributes 0 weight.
      share = i.hasPct ? i.pct / totalPct : 0;
    } else {
      // No percentages anywhere → equal shares (so a single bare fiber still derives at full weight).
      share = 1 / items.length;
    }
    return { raw: i.raw, entry: i.entry, share };
  });
}

function normalizeUnknown(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---- the consensus rule ----------------------------------------------------------------------------

// Behaviorally-inert classes in a MINORITY: an elastomer (elastane/spandex) adds stretch, not moisture/
// warmth/dry behavior. Below this share it is dropped from the behavioral consensus entirely (so 88%
// nylon / 12% elastane derives nylon's behavior, undiluted). At/above it (a near-pure elastane oddity)
// it participates normally.
const INERT_ELASTOMER_MAX_SHARE = 0.4;

/** A property's value→share tally plus the strongest single contributor's confidence for that value. */
interface Tally {
  /** Summed share per candidate value. */
  byValue: Map<string, number>;
  /** Best (highest) library confidence seen among contributors voting for the winning value. */
  bestConfidenceForValue: Map<string, LibraryConfidence>;
  /** Total share that actually had a value for this property (≤ 1). */
  determinedShare: number;
  /** Raw labels of contributors that voted, for the evidence string. */
  voters: { raw: string; value: string; share: number }[];
}

const CONF_RANK: Record<LibraryConfidence, number> = { low: 0, medium: 1, high: 2 };
const RANK_CONF: LibraryConfidence[] = ["low", "medium", "high"];

function strongerConf(a: LibraryConfidence | undefined, b: LibraryConfidence): LibraryConfidence {
  if (a === undefined) return b;
  return CONF_RANK[a] >= CONF_RANK[b] ? a : b;
}
function weakerConf(a: LibraryConfidence, b: LibraryConfidence): LibraryConfidence {
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

/** Effective contributions for the consensus: drop a minority inert elastomer; renormalize the rest. */
function effectiveContributions(contribs: Contribution[]): Contribution[] {
  const elastomerShare = contribs
    .filter((c) => c.entry?.class === "elastomer")
    .reduce((s, c) => s + c.share, 0);
  // Only drop the elastomer if there IS a non-elastomer fiber to carry the behavior, and it's a minority.
  const nonElastomer = contribs.filter((c) => c.entry?.class !== "elastomer");
  const hasOther = nonElastomer.some((c) => c.share > 0);
  if (elastomerShare > 0 && elastomerShare <= INERT_ELASTOMER_MAX_SHARE && hasOther) {
    const remaining = nonElastomer.reduce((s, c) => s + c.share, 0);
    if (remaining > 0) {
      return nonElastomer.map((c) => ({ ...c, share: c.share / remaining }));
    }
  }
  return contribs;
}

function tally(contribs: Contribution[], prop: BehaviorProperty): Tally {
  const byValue = new Map<string, number>();
  const bestConfidenceForValue = new Map<string, LibraryConfidence>();
  const voters: { raw: string; value: string; share: number }[] = [];
  let determinedShare = 0;
  for (const c of contribs) {
    const p = c.entry?.[prop];
    if (!p) continue; // fiber unknown OR this fiber doesn't determine this property
    determinedShare += c.share;
    byValue.set(p.value, (byValue.get(p.value) ?? 0) + c.share);
    bestConfidenceForValue.set(p.value, strongerConf(bestConfidenceForValue.get(p.value), p.confidence));
    voters.push({ raw: c.raw, value: p.value, share: c.share });
  }
  return { byValue, bestConfidenceForValue, determinedShare, voters };
}

/**
 * The share of the WINNING value at which we will derive a property, and how we set confidence:
 *   - A value must command at least MAJORITY of the determined share to win.
 *   - The MORE of the blend agrees, the higher the confidence is allowed to be (capped by the library's
 *     own confidence for that value — we never exceed how deterministic the fiber itself makes it):
 *       dominant (>=0.8 of determined share)  → keep the library confidence
 *       majority (>=0.5)                       → demote one step (a real blend is less certain)
 *       below majority                          → DO NOT derive (genuinely ambiguous → unknown)
 *   - If less than HALF of the whole composition even has an opinion on the property, do not derive.
 */
const DOMINANT_SHARE = 0.8;
const MAJORITY_SHARE = 0.5;
const MIN_DETERMINED_SHARE = 0.5;

function decide<V extends string>(
  prop: BehaviorProperty,
  contribs: Contribution[],
): DerivedValue<V> | undefined {
  const t = tally(contribs, prop);
  if (t.determinedShare < MIN_DETERMINED_SHARE || t.byValue.size === 0) return undefined;

  // Winning value = the one with the most share among contributors that have a value for this property.
  let winner: string | undefined;
  let winnerShare = 0;
  for (const [value, share] of t.byValue) {
    if (share > winnerShare) {
      winnerShare = share;
      winner = value;
    }
  }
  if (winner === undefined) return undefined;

  // Share of the winner WITHIN the determined opinions (so a tiny inert remainder doesn't block a clear win).
  const winnerFraction = winnerShare / t.determinedShare;
  if (winnerFraction < MAJORITY_SHARE) return undefined; // genuinely split → leave unknown

  const libConf = t.bestConfidenceForValue.get(winner) ?? "low";
  let confidence: LibraryConfidence;
  if (winnerFraction >= DOMINANT_SHARE && t.determinedShare >= DOMINANT_SHARE) {
    confidence = libConf; // effectively single-fiber-dominant: trust the library's own confidence
  } else {
    confidence = weakerConf(demote(libConf), libConf); // a real blend: one step less certain than pure
  }

  const evidence = buildEvidence(prop, winner, t, winnerFraction);
  return { value: winner as V, confidence, source: "derived_from_material", evidence };
}

function demote(c: LibraryConfidence): LibraryConfidence {
  const i = CONF_RANK[c];
  return RANK_CONF[Math.max(0, i - 1)]!;
}

function buildEvidence(prop: BehaviorProperty, winner: string, t: Tally, winnerFraction: number): string {
  const composition = t.voters
    .filter((v) => v.share > 0)
    .map((v) => `${v.raw} ${(v.share * 100).toFixed(0)}%→${v.value}`)
    .join(", ");
  const pct = (winnerFraction * 100).toFixed(0);
  return `derived ${prop}=${winner} from composition (${composition}); ${pct}% of behavior-bearing fibers agree`;
}

// ---- public API ------------------------------------------------------------------------------------

/**
 * Derive the behavioral facets a composition determines. Returns a SPARSE overlay: only present keys are
 * determined; absent = unknown (never fabricated). Pure; never throws on a well-formed materials array.
 *
 * @param materials a validated `ItemClassification["materials"]` (composition with fiber + pct).
 */
export function deriveFromComposition(materials: Materials): DerivedFacets {
  const out: DerivedFacets = {};
  if (!Array.isArray(materials) || materials.length === 0) return out;

  const contribs = buildContributions(materials);
  if (contribs.length === 0) return out;
  const eff = effectiveContributions(contribs);

  const moisture = decide<L.MoistureManagement>("moisture_management", eff);
  if (moisture) out.moisture_management = moisture;

  const dry = decide<L.DrySpeed>("dry_speed", eff);
  if (dry) out.dry_speed = dry;

  const wet = decide<L.WarmthWhenWet>("warmth_when_wet", eff);
  if (wet) out.warmth_when_wet = wet;

  const breath = decide<L.Breathability>("breathability", eff);
  if (breath) out.breathability = breath;

  const warmth = decide<L.Warmth>("warmth", eff);
  if (warmth) out.warmth = warmth;

  return out;
}
