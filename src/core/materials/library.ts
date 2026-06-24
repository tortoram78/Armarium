// The authoritative material-behavior library — a CURATED table of the behavioral properties that
// material physics determines from a fiber/membrane/insulation ALONE.
//
// WHY THIS EXISTS: today behavioral facets (moisture_management, dry_speed, warmth_when_wet, …) are
// LLM-inferred per item (`source:"inferred"` — the weakest tier). Material physics determines much of
// that behavior near-deterministically from COMPOSITION (a cellulosic-dominant knit absorbs and holds
// water and loses its loft when wet; polyester wicks and dries fast). This table encodes that physics
// once, authoritatively, so the derivation engine (`derive.ts`) can emit `source:"derived_from_material"`
// — a stronger, auditable provenance than a per-item guess.
//
// AUTHORING DISCIPLINE (this is the approved "bootstrap-then-curate"; the author IS the bootstrap):
//   - Every value is a member of the canonical vocabulary in `facets/levels.ts` — never an invented level.
//     A Zod schema validates the WHOLE library at module load, and a test asserts every value is a valid
//     vocabulary member, so this table can NEVER drift from the ontology.
//   - Per-property CONFIDENCE reflects how deterministic that property is FROM THE FIBER ALONE. Moisture
//     and wet-warmth behavior are intrinsic to the fiber's chemistry → high. Intrinsic dry speed follows
//     moisture regain → mostly high/medium. BREATHABILITY and absolute WARMTH depend on construction
//     (knit vs woven, weight, loft) far more than on the fiber → LOW, or omitted entirely. A wrong/over-
//     confident library poisons every derivation, so we prefer omission to a confident guess.
//   - A property a fiber does NOT determine on its own is simply ABSENT from that entry (not guessed).
//
// PURE: no next/*, no React, no DB, no networking. Imports only `zod` + the canonical vocab.

import { z } from "zod";
import * as L from "./../facets/levels";

// ---- the per-property confidence marker (mirrors evidence.ts CONFIDENCE) ----
const CONFIDENCE = ["low", "medium", "high"] as const;
export type LibraryConfidence = (typeof CONFIDENCE)[number];

/** One behavioral property the fiber determines: the vocabulary value + how deterministic it is alone. */
const propSchema = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.object({
    value: z.enum(values),
    confidence: z.enum(CONFIDENCE),
    rationale: z.string().min(1),
  });

export type LibraryProp<V extends string> = { value: V; confidence: LibraryConfidence; rationale: string };

/**
 * A single library entry: the behaviors a canonical fiber/membrane/insulation determines on its own.
 * EVERY property is OPTIONAL — a fiber maps only the properties its physics actually pins down. The
 * absence of a property means "not determinable from this fiber alone" (→ the engine leaves it unknown),
 * NOT "the property is neutral". `warmth` is intentionally rarely present and never above `low`
 * confidence: absolute warmth is a function of construction/weight, not of fiber identity.
 */
const entrySchema = z.object({
  /** Canonical fiber key, post-normalization (see canonFiberKey) — the table's primary key. */
  fiber: z.string().min(1),
  /** What kind of material this is — drives how the engine treats it in a blend. */
  class: z.enum(["natural", "synthetic", "membrane", "insulation", "elastomer"]),
  /** Human label for UI / audit (e.g. "Merino wool"). */
  label: z.string().min(1),
  moisture_management: propSchema(L.MOISTURE_MANAGEMENT).optional(),
  dry_speed: propSchema(L.DRY_SPEED).optional(),
  warmth_when_wet: propSchema(L.WARMTH_WHEN_WET).optional(),
  breathability: propSchema(L.BREATHABILITY).optional(),
  warmth: propSchema(L.WARMTH).optional(),
});

export type MaterialLibraryEntry = z.infer<typeof entrySchema>;

// A behavioral property that a derivation can read off an entry (the soft, vocabulary-typed ones).
export type BehaviorProperty =
  | "moisture_management"
  | "dry_speed"
  | "warmth_when_wet"
  | "breathability"
  | "warmth";

// ===================================================================================================
// THE TABLE. Authored from textile material science. Grouped by class for readability; order is
// irrelevant (the registry is keyed by `fiber`).
//
// Confidence rubric used consistently below:
//   high   — intrinsic to the fiber's chemistry, true regardless of construction
//            (e.g. wool retains warmth when wet; polypropylene cannot absorb water → wicks, dries fast).
//   medium — strongly tied to the fiber but with a real construction dependency
//            (e.g. cotton's dry_speed is slow, but a gauze dries faster than a heavy canvas).
//   low    — present but construction-dominated; emitted only where the fiber still nudges it
//            (almost exclusively the rare `warmth` tendency, and a couple of breathability calls).
// ===================================================================================================
const ENTRIES: MaterialLibraryEntry[] = [
  // ------------------------------------------------------------------------------------------------
  // NATURAL — protein (animal) fibers: the wet-warmth standouts.
  // ------------------------------------------------------------------------------------------------
  {
    fiber: "merino",
    class: "natural",
    label: "Merino wool",
    // Wool wicks vapor and buffers moisture; it manages moisture well even though it can hold a lot by weight.
    moisture_management: { value: "wicks", confidence: "high", rationale: "wool wicks vapor and buffers moisture across a wide range; hygroscopic but keeps skin feeling dry" },
    // Holds significant water by mass (high regain); dries notably slower than synthetics.
    dry_speed: { value: "slow", confidence: "medium", rationale: "high moisture regain (~30%); dries slower than synthetics, faster than cotton at equal weight" },
    // The defining property: keeps insulating value when damp because the fiber's crimp/structure resists collapse.
    warmth_when_wet: { value: "retains", confidence: "high", rationale: "crimped protein fiber retains loft and insulates when damp — the classic merino advantage" },
    // Absolute warmth is a weight/knit question (a 150 g/m^2 tee vs a 320 g/m^2 expedition top); fiber alone only leans warm.
    warmth: { value: "moderate", confidence: "low", rationale: "wool leans warmer than cellulosics per weight, but absolute warmth depends on knit weight/thickness — low confidence from fiber alone" },
  },
  {
    fiber: "wool",
    class: "natural",
    label: "Wool",
    moisture_management: { value: "wicks", confidence: "high", rationale: "wool wicks and buffers moisture; hygroscopic yet keeps skin comfortable" },
    dry_speed: { value: "slow", confidence: "medium", rationale: "high moisture regain; slow to dry, construction-dependent" },
    warmth_when_wet: { value: "retains", confidence: "high", rationale: "protein fiber retains insulating loft when wet" },
    warmth: { value: "moderate", confidence: "low", rationale: "leans warm per weight; absolute warmth is construction-driven" },
  },
  {
    fiber: "silk",
    class: "natural",
    label: "Silk",
    // Protein fiber; absorbs moisture (high regain) and feels damp — managed less actively than wool.
    moisture_management: { value: "neutral", confidence: "medium", rationale: "protein fiber with moderate regain; absorbs some moisture, neither strongly wicking nor as absorbent as cellulosics" },
    dry_speed: { value: "moderate", confidence: "medium", rationale: "moderate regain and very fine fibers — dries faster than cotton, slower than synthetics" },
    // Loses much of its (already modest) insulation when wet; behaves between collapse and neutral. Be conservative.
    warmth_when_wet: { value: "neutral", confidence: "low", rationale: "thin protein fiber; modest insulation that degrades somewhat when wet — between retain and collapse, low confidence" },
  },
  {
    fiber: "down",
    class: "insulation",
    label: "Down (untreated)",
    // The marquee failure mode: down clumps and collapses when wet, losing nearly all loft (hence warmth-when-wet).
    warmth_when_wet: { value: "collapses", confidence: "high", rationale: "untreated down clumps and loses loft when wet — near-total loss of insulation ('down dies wet')" },
    dry_speed: { value: "slow", confidence: "high", rationale: "saturated down holds water in the plumules and dries very slowly" },
    // Down is the highest warmth-for-weight insulator that exists; the fiber identity itself strongly implies high warmth (loft permitting).
    warmth: { value: "high", confidence: "low", rationale: "best-in-class warmth-for-weight, but absolute warmth depends on fill weight + power, not on 'it is down' alone" },
  },
  {
    fiber: "feather",
    class: "insulation",
    label: "Feather/down blend",
    warmth_when_wet: { value: "collapses", confidence: "high", rationale: "feather/down loses loft when wet, like down" },
    dry_speed: { value: "slow", confidence: "high", rationale: "holds water and dries slowly when saturated" },
    warmth: { value: "moderate", confidence: "low", rationale: "feather is less lofty than pure down; absolute warmth is fill-driven" },
  },

  // ------------------------------------------------------------------------------------------------
  // NATURAL — cellulosic (plant) fibers: hydrophilic; "cotton kills". Manmade cellulosics included here
  // because chemically they behave the same way (absorb/hold, slow to dry, lose warmth when wet).
  // ------------------------------------------------------------------------------------------------
  {
    fiber: "cotton",
    class: "natural",
    label: "Cotton",
    moisture_management: { value: "absorbs_holds", confidence: "high", rationale: "hydrophilic cellulose absorbs and holds water against the skin rather than moving it" },
    dry_speed: { value: "slow", confidence: "high", rationale: "very high moisture regain; cotton dries slowly — a core safety fact" },
    warmth_when_wet: { value: "collapses", confidence: "high", rationale: "wet cotton loses insulating value and wicks heat from the body ('cotton kills')" },
  },
  {
    fiber: "hemp",
    class: "natural",
    label: "Hemp",
    moisture_management: { value: "absorbs_holds", confidence: "high", rationale: "bast cellulosic fiber; hydrophilic, absorbs and holds moisture like cotton/linen" },
    dry_speed: { value: "slow", confidence: "high", rationale: "high regain cellulosic — slow to dry" },
    warmth_when_wet: { value: "collapses", confidence: "high", rationale: "cellulosic; loses insulating value when wet" },
  },
  {
    fiber: "linen",
    class: "natural",
    label: "Linen (flax)",
    // Linen absorbs a lot but releases it faster than cotton and feels cool/dry — manage it as absorbing but a touch quicker-drying.
    moisture_management: { value: "absorbs_holds", confidence: "high", rationale: "flax cellulose is hydrophilic — absorbs moisture readily" },
    dry_speed: { value: "moderate", confidence: "medium", rationale: "absorbs heavily but releases moisture faster than cotton; dries quicker than cotton, slower than synthetics" },
    warmth_when_wet: { value: "collapses", confidence: "high", rationale: "cellulosic; no meaningful wet insulation" },
  },
  {
    fiber: "rayon",
    class: "natural",
    label: "Rayon/viscose",
    moisture_management: { value: "absorbs_holds", confidence: "high", rationale: "regenerated cellulose; highly absorbent, holds water against the skin" },
    dry_speed: { value: "slow", confidence: "medium", rationale: "high regain regenerated cellulose — slow to dry, weakens when wet" },
    warmth_when_wet: { value: "collapses", confidence: "high", rationale: "cellulosic chemistry — loses warmth when wet" },
  },
  {
    fiber: "lyocell",
    class: "natural",
    label: "Lyocell/Tencel",
    // Lyocell is engineered cellulose: very efficient at moving moisture into the fiber (good "wicking"-feel) yet still cellulosic when saturated.
    moisture_management: { value: "absorbs_holds", confidence: "medium", rationale: "engineered cellulose moves moisture into the fiber efficiently (dry hand-feel) but is fundamentally absorbent — holds water when saturated" },
    dry_speed: { value: "slow", confidence: "medium", rationale: "high regain cellulosic; dries slowly despite good moisture distribution" },
    warmth_when_wet: { value: "collapses", confidence: "high", rationale: "cellulosic — no useful insulation when wet" },
  },
  {
    fiber: "bamboo",
    class: "natural",
    label: "Bamboo (viscose)",
    // Almost always bamboo viscose (regenerated cellulose), so chemically a rayon.
    moisture_management: { value: "absorbs_holds", confidence: "medium", rationale: "almost always bamboo viscose (regenerated cellulose) — absorbent like rayon" },
    dry_speed: { value: "slow", confidence: "medium", rationale: "regenerated cellulose, high regain — slow to dry" },
    warmth_when_wet: { value: "collapses", confidence: "medium", rationale: "cellulosic chemistry; loses warmth when wet" },
  },

  // ------------------------------------------------------------------------------------------------
  // SYNTHETIC — hydrophobic thermoplastics: wick, dry fast, keep some warmth when wet.
  // ------------------------------------------------------------------------------------------------
  {
    fiber: "polyester",
    class: "synthetic",
    label: "Polyester",
    moisture_management: { value: "wicks", confidence: "high", rationale: "hydrophobic fiber (low regain ~0.4%); transports liquid along fibers rather than absorbing it" },
    dry_speed: { value: "fast", confidence: "high", rationale: "absorbs almost no water into the fiber — surface water evaporates quickly" },
    warmth_when_wet: { value: "neutral", confidence: "high", rationale: "fiber holds no water internally; a synthetic layer keeps usable warmth when damp" },
  },
  {
    fiber: "nylon",
    class: "synthetic",
    label: "Nylon (polyamide)",
    // Nylon has slightly higher regain (~4%) than polyester, so wicking/dry are a notch less absolute — still hydrophobic.
    moisture_management: { value: "wicks", confidence: "medium", rationale: "hydrophobic but slightly higher regain (~4%) than polyester — wicks well, absorbs marginally more" },
    dry_speed: { value: "fast", confidence: "medium", rationale: "low regain — dries fast, a touch slower than polyester due to higher water uptake" },
    warmth_when_wet: { value: "neutral", confidence: "high", rationale: "thermoplastic holds little water; retains usable warmth when damp" },
  },
  {
    fiber: "polypropylene",
    class: "synthetic",
    label: "Polypropylene",
    // The most hydrophobic common fiber: ~0% regain. The textbook fast-dry, wicking base fiber.
    moisture_management: { value: "wicks", confidence: "high", rationale: "essentially zero moisture regain — cannot absorb water, only transports it; the strongest wicking common fiber" },
    dry_speed: { value: "very_fast", confidence: "high", rationale: "0% regain → holds no internal water → dries faster than any other common fiber" },
    warmth_when_wet: { value: "retains", confidence: "high", rationale: "absorbs no water and is light/lofty — keeps insulating value when wet" },
  },
  {
    fiber: "acrylic",
    class: "synthetic",
    label: "Acrylic",
    // Wool-substitute synthetic; hydrophobic, used for warmth (sweaters/fleece-adjacent).
    moisture_management: { value: "wicks", confidence: "medium", rationale: "hydrophobic synthetic (low regain) — does not absorb water into the fiber" },
    dry_speed: { value: "fast", confidence: "medium", rationale: "low regain — dries quickly, though often knit thick for warmth which slows it" },
    warmth_when_wet: { value: "retains", confidence: "medium", rationale: "synthetic that holds little water; commonly used as a wool substitute for warmth that survives damp" },
    warmth: { value: "moderate", confidence: "low", rationale: "knit as a warmth fiber (sweaters), but absolute warmth is construction/weight-driven" },
  },
  {
    fiber: "elastane",
    class: "elastomer",
    label: "Elastane (spandex)",
    // A stretch elastomer, almost always a MINORITY (2-20%). It adds stretch, not moisture behavior; it
    // is hydrophobic and does not change a blend's moisture/dry/warmth character. We give it the
    // synthetic-leaning moisture tendency at LOW confidence so a near-pure-elastane edge case isn't
    // mislabeled, but the engine treats it as behaviorally inert in normal minority blends (see derive.ts).
    moisture_management: { value: "neutral", confidence: "low", rationale: "hydrophobic stretch elastomer; used in small % for stretch — contributes negligibly to moisture behavior" },
    dry_speed: { value: "fast", confidence: "low", rationale: "hydrophobic; as a minority it does not slow a blend's drying" },
  },

  // ------------------------------------------------------------------------------------------------
  // SYNTHETIC INSULATION — lofted polyester batting; the wet-weather alternative to down.
  // ------------------------------------------------------------------------------------------------
  {
    fiber: "primaloft",
    class: "insulation",
    label: "PrimaLoft (synthetic insulation)",
    // Polyester microfiber batting designed expressly to keep loft (and thus warmth) when wet.
    warmth_when_wet: { value: "retains", confidence: "high", rationale: "polyester microfiber insulation engineered to keep loft and insulate when wet — its defining selling point" },
    dry_speed: { value: "fast", confidence: "high", rationale: "hydrophobic polyester microfiber sheds water and dries far faster than down" },
    warmth: { value: "moderate", confidence: "low", rationale: "warmth depends on the loft/fill weight used, not on the material name — low confidence from material alone" },
  },
  {
    fiber: "synthetic_insulation",
    class: "insulation",
    label: "Synthetic insulation (generic)",
    warmth_when_wet: { value: "retains", confidence: "high", rationale: "lofted polyester batting keeps insulating value when wet, unlike down" },
    dry_speed: { value: "fast", confidence: "high", rationale: "hydrophobic polyester — dries quickly" },
  },
  {
    fiber: "fleece",
    class: "synthetic",
    label: "Fleece (polyester pile/grid)",
    // Knitted/napped polyester; behaviorally polyester but specifically lofted for warmth that survives wet.
    moisture_management: { value: "wicks", confidence: "high", rationale: "polyester pile — transports moisture, does not absorb it into the fiber" },
    dry_speed: { value: "fast", confidence: "high", rationale: "hydrophobic polyester pile sheds water and dries fast" },
    warmth_when_wet: { value: "retains", confidence: "high", rationale: "lofted synthetic keeps usable warmth when damp" },
    warmth: { value: "moderate", confidence: "low", rationale: "fleece is built for warmth, but the actual value depends on pile weight (100/200/300) — low confidence from name alone" },
  },

  // ------------------------------------------------------------------------------------------------
  // MEMBRANES / LAMINATES — these ARE the construction. Breathability is an intrinsic property of the
  // laminate (low-to-moderate), so it is the one place we assert breathability with real confidence.
  // ------------------------------------------------------------------------------------------------
  {
    fiber: "eptfe",
    class: "membrane",
    label: "ePTFE membrane (Gore-Tex type)",
    // A waterproof/breathable laminate. Breathability is moderate (it is the trade-off the membrane makes);
    // far below an open knit but real (MVTR). Waterproofness itself is handled elsewhere (not asked here).
    breathability: { value: "moderate", confidence: "medium", rationale: "waterproof/breathable laminate passes vapor (MVTR) but far less freely than an open textile — moderate is intrinsic to the membrane" },
  },
  {
    fiber: "pu_laminate",
    class: "membrane",
    label: "PU laminate membrane",
    // Polyurethane laminates breathe less than ePTFE on average; many are effectively non-breathable.
    breathability: { value: "low", confidence: "medium", rationale: "polyurethane laminates generally pass less vapor than ePTFE — low breathability is intrinsic to the membrane" },
  },
];

// ===================================================================================================
// Canonical fiber normalization — ALIGNED with the enrichment parser's canonFiber/FIBER_ALIASES
// (parse-html.ts) so "poly"/"polyamide"/"merino wool"/"spandex" resolve to the SAME canonical keys the
// extractor produces. We do not fork a conflicting alias map; we extend the same intent with the extra
// membrane/insulation aliases this library needs (the extractor only ever sees fibers, not membranes).
// ===================================================================================================

/**
 * Alias map (canonical-key target on the right). Superset of parse-html.ts's FIBER_ALIASES — every alias
 * there resolves the same way here, plus library-only synonyms (membranes, insulations, fiber spellings).
 * Keys are already lower-cased + descriptor-stripped before lookup (see canonFiberKey).
 */
const FIBER_ALIASES: Record<string, string> = {
  // --- aligned with parse-html.ts ---
  poly: "polyester",
  polyester: "polyester",
  polyamide: "nylon",
  nylon: "nylon",
  "merino wool": "merino",
  merino: "merino",
  wool: "wool",
  "organic cotton": "cotton",
  cotton: "cotton",
  spandex: "elastane",
  lycra: "elastane",
  elastane: "elastane",
  // --- cellulosics & their synonyms ---
  hemp: "hemp",
  linen: "linen",
  flax: "linen",
  viscose: "rayon",
  rayon: "rayon",
  "viscose rayon": "rayon",
  tencel: "lyocell",
  lyocell: "lyocell",
  bamboo: "bamboo",
  "bamboo viscose": "bamboo",
  "bamboo rayon": "bamboo",
  // --- protein fibers ---
  silk: "silk",
  cashmere: "wool",
  alpaca: "wool",
  mohair: "wool",
  "lambs wool": "wool",
  "virgin wool": "wool",
  "shetland wool": "wool",
  // --- synthetics ---
  polypropylene: "polypropylene",
  polypro: "polypropylene",
  pp: "polypropylene",
  acrylic: "acrylic",
  // --- down / feather ---
  down: "down",
  "goose down": "down",
  "duck down": "down",
  feather: "feather",
  feathers: "feather",
  // --- fleece (polyester pile / grid) ---
  fleece: "fleece",
  "polyester fleece": "fleece",
  microfleece: "fleece",
  // --- synthetic insulation ---
  primaloft: "primaloft",
  coreloft: "synthetic_insulation",
  thinsulate: "synthetic_insulation",
  plumafill: "synthetic_insulation",
  "synthetic insulation": "synthetic_insulation",
  // --- membranes / laminates ---
  "gore-tex": "eptfe",
  goretex: "eptfe",
  gore: "eptfe",
  eptfe: "eptfe",
  ptfe: "eptfe",
  "pu laminate": "pu_laminate",
  polyurethane: "pu_laminate",
  pu: "pu_laminate",
};

// Component/garment-part descriptor words that may trail a fiber name (same intent as parse-html.ts:
// "polyester shell", "nylon lining" — these name WHERE a fiber sits, not the fiber). Stripped before alias
// lookup. (We deliberately do NOT strip "fleece"/"insulation"/"fill" here, since for THIS library those are
// material identities, not positional descriptors — that is the one intentional divergence, and it only
// adds resolutions the extractor never needs.)
const DESCRIPTOR_WORDS =
  /\b(shell|lining|liner|body|face|backer|backing|trim|insert|inserts|panel|panels|mesh|fabric|material|main|exterior|interior|outer|inner|content)\b/gi;

/**
 * Normalize a raw stated fiber/material name to this library's canonical key.
 * Mirrors parse-html.ts's canonFiber: lower-case, collapse whitespace, drop descriptor + recycled/organic
 * qualifiers, then alias-canonicalize. Returns the cleaned token unchanged when no alias matches (so an
 * unknown fiber stays a stable, distinct key rather than collapsing onto something wrong).
 */
export function canonFiberKey(raw: string): string {
  if (typeof raw !== "string") return "";
  let t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  t = t
    .replace(DESCRIPTOR_WORDS, " ")
    .replace(/\brecycled\b/gi, " ")
    .replace(/\borganic\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return FIBER_ALIASES[t] ?? t;
}

// ===================================================================================================
// Validate the WHOLE library at module load. A bad entry (an off-vocabulary value, a missing rationale)
// throws HERE, at import — the library can never ship in a drifted state. The library.test.ts also
// asserts validity, so a drift is caught both at runtime import and in CI.
// ===================================================================================================
const libraryArraySchema = z.array(entrySchema);

/** Frozen, validated entries. Throws at import if any entry violates the schema/vocabulary. */
export const MATERIAL_LIBRARY: readonly MaterialLibraryEntry[] = Object.freeze(
  libraryArraySchema.parse(ENTRIES),
);

// Index by canonical fiber key for O(1) lookup. Assert no duplicate keys (a duplicate would silently
// shadow — a curation bug we want to fail loudly).
const BY_FIBER: ReadonlyMap<string, MaterialLibraryEntry> = (() => {
  const m = new Map<string, MaterialLibraryEntry>();
  for (const e of MATERIAL_LIBRARY) {
    if (m.has(e.fiber)) {
      throw new Error(`material library: duplicate fiber key "${e.fiber}"`);
    }
    m.set(e.fiber, e);
  }
  return m;
})();

/** Look up a library entry by ANY raw fiber name (normalized first). null when the fiber is not curated. */
export function lookupFiber(rawFiber: string): MaterialLibraryEntry | null {
  const key = canonFiberKey(rawFiber);
  if (key === "") return null;
  return BY_FIBER.get(key) ?? null;
}

/** Look up by an ALREADY-canonical key (no normalization). null when absent. */
export function lookupCanonical(key: string): MaterialLibraryEntry | null {
  return BY_FIBER.get(key) ?? null;
}

/** The full set of canonical fiber keys present in the library (for tests / introspection). */
export function libraryFiberKeys(): string[] {
  return [...BY_FIBER.keys()];
}

/** The behavioral properties the engine reads off entries, in derivation order. */
export const BEHAVIOR_PROPERTIES: readonly BehaviorProperty[] = [
  "moisture_management",
  "dry_speed",
  "warmth_when_wet",
  "breathability",
  "warmth",
] as const;
