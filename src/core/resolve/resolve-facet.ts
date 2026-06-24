// The RESOLVER — the keystone of evidence-first classification.
//
// A facet's value is no longer "whatever the LLM emitted". It is the WINNER of a set of CLAIMS, each
// from a distinct source, decided by an EXPLICIT, documented, deterministic precedence policy. This
// makes precedence — previously implicit in the manufacturer overlay + the hard-fact demotion guard —
// a first-class, testable thing. The same engine will later admit manufacturer/user behavioral claims
// without changing any caller.
//
// PURE: no next/*, no React, no DB, no networking. Imports only the SOURCE/CONFIDENCE vocabulary + types
// from evidence.ts. `resolveFacet` is total and NEVER throws.

import type { Confidence, Source } from "../evidence";

// ----------------------------------------------------------------------------------------------------
// THE CLAIM
// ----------------------------------------------------------------------------------------------------

/**
 * A claim's confidence. Mirrors the evidence envelope exactly: a graded {low,medium,high} for an
 * asserted value, or the `"unknown"` literal that an absent (value:null) claim carries. Keeping
 * `"unknown"` in the type makes the map from `Evidence<V>` lossless — an unknown facet IS a claim.
 */
export type ClaimConfidence = Confidence | "unknown";

/**
 * One source's assertion about a single facet. `value:null` means "this source has NO opinion" (an
 * absent/unknown claim) — it never out-competes a source that DOES assert a value. A non-null value
 * carries a graded confidence, a source, and an evidence string (the audit trail).
 *
 * This is the SAME shape as the evidence envelope's asserted branch, generalized so any source's value
 * (an LLM `inferred`, a `derived_from_material`, a future `manufacturer`/`user` behavioral fact) is a
 * uniform competitor in `resolveFacet`.
 */
export interface Claim<V> {
  value: V | null;
  confidence: ClaimConfidence;
  source: Source;
  evidence: string;
}

// ----------------------------------------------------------------------------------------------------
// THE POLICY — source precedence (a total order) + the confidence-override rule
// ----------------------------------------------------------------------------------------------------

/**
 * SOURCE PRECEDENCE — the single, authoritative, total order. THIS IS THE POLICY.
 *
 *     user  >  manufacturer  >  derived_from_material  >  inferred  >  unknown
 *
 * Rationale, strongest → weakest:
 *   - `user`                 a human owner's correction is final — they hold the physical item.
 *   - `manufacturer`         a stated spec from the maker (authoritative, but not the owner's eyes-on).
 *   - `derived_from_material`  computed from composition by material physics — stronger than a guess
 *                            because it is a chemistry-grounded rule applied to a stated fact.
 *   - `inferred`             the LLM's best guess from name/description — the weakest *positive* tier.
 *   - `unknown`              no claim at all (the "we don't know" floor).
 *
 * Higher index = higher precedence. `user`/`manufacturer` are the AUTHORITATIVE sources (a stated fact);
 * the rest are non-authoritative (a computation or a guess).
 */
export const SOURCE_PRECEDENCE = ["unknown", "inferred", "derived_from_material", "manufacturer", "user"] as const;

/** Sources that win PURELY by precedence regardless of confidence — a stated fact beats any guess. */
export const AUTHORITATIVE_SOURCES = ["user", "manufacturer"] as const;

const PRECEDENCE_RANK: Record<Source, number> = {
  unknown: 0,
  inferred: 1,
  derived_from_material: 2,
  manufacturer: 3,
  user: 4,
};

/** True iff the source is part of the precedence vocabulary (a real claim source, not garbage input). */
function isRecognized(source: Source): boolean {
  return Object.prototype.hasOwnProperty.call(PRECEDENCE_RANK, source);
}

/**
 * Precedence of a source. An UNRECOGNIZED source (not in the SOURCE enum — only reachable via malformed
 * input, since validated data is enum-constrained) ranks STRICTLY BELOW every real source, so it can
 * never out-compete a legitimate assertion. Totality: never throws.
 */
function precedenceOf(source: Source): number {
  return isRecognized(source) ? PRECEDENCE_RANK[source] : -1;
}

const CONFIDENCE_RANK: Record<ClaimConfidence, number> = {
  unknown: -1,
  low: 0,
  medium: 1,
  high: 2,
};

/** Confidence rank; an unrecognized confidence ranks at the `unknown` floor (totality). */
function confidenceOf(confidence: ClaimConfidence): number {
  return CONFIDENCE_RANK[confidence] ?? -1;
}

function isAuthoritative(source: Source): boolean {
  return source === "user" || source === "manufacturer";
}

/** A claim is "asserting" iff it actually carries a value. A null claim is just an absence. */
function asserts<V>(c: Claim<V>): boolean {
  return c.value !== null;
}

/**
 * THE OVERRIDE RULE (the one clean policy, applied pairwise: does `challenger` beat the running `best`?):
 *
 *   A higher-precedence asserting claim wins over a lower-precedence asserting claim,
 *   UNLESS the higher-precedence claim's source is NON-AUTHORITATIVE *and* its confidence is
 *   STRICTLY LOWER than the claim it would override — in which case it DEFERS (the lower one stands).
 *
 * In words: precedence decides, EXCEPT a non-authoritative source may not clobber a more-confident claim
 * with its own *less*-confident one. Authoritative sources (user/manufacturer) are never subject to the
 * exception — a stated fact beats a guess even when the guess sounds more certain (rule #2).
 *
 * This single rule produces both headline behaviors:
 *   - `derived_from_material` (high) overrides `inferred` (any) — the moisture correction.
 *   - `derived_from_material` (low warmth) does NOT override `inferred` (high warmth) — warmth defers.
 *
 * Equal precedence (e.g. two `inferred`): higher confidence wins; on a true tie the incumbent stands
 * (stable, order-independent for the way callers assemble claims — see resolveBehavioralFacets).
 */
function challengerBeats<V>(challenger: Claim<V>, best: Claim<V>): boolean {
  const cP = precedenceOf(challenger.source);
  const bP = precedenceOf(best.source);
  const cConf = confidenceOf(challenger.confidence);
  const bConf = confidenceOf(best.confidence);

  if (cP > bP) {
    // Higher precedence — wins, UNLESS the challenger is a non-authoritative source bringing a strictly
    // weaker claim than a RECOGNIZED claim it would override (don't defer to garbage-source input).
    if (!isAuthoritative(challenger.source) && isRecognized(best.source) && cConf < bConf) {
      return false; // defer: a weaker guess/derivation must not clobber a stronger legitimate one
    }
    return true;
  }

  if (cP < bP) {
    // Lower precedence — can only win by the symmetric exception: the INCUMBENT (higher precedence) is a
    // recognized non-authoritative source and strictly less confident than this challenger. (Handles
    // claims arriving in any order, so resolution is order-independent.)
    return !isAuthoritative(best.source) && isRecognized(best.source) && cConf > bConf;
  }

  // Equal precedence → higher confidence wins; tie → incumbent stays (stable).
  return cConf > bConf;
}

// ----------------------------------------------------------------------------------------------------
// THE RESOLVE
// ----------------------------------------------------------------------------------------------------

const UNKNOWN_CLAIM: Claim<never> = {
  value: null,
  confidence: "unknown", // evidence.ts treats null + "unknown" + "unknown" as the canonical absence
  source: "unknown",
  evidence: "no source asserted a value",
};

/**
 * Resolve a set of competing claims into the single winning claim by the precedence + confidence policy.
 *
 * - Only ASSERTING claims (value !== null) compete. If none assert, the result is the canonical UNKNOWN.
 * - The winner is decided pairwise by `challengerBeats` (precedence, with the non-authoritative
 *   weaker-confidence exception). The result is order-independent for distinct sources.
 * - AUDITABILITY: the winner's `evidence` is annotated with the losing asserting claims' provenance, so a
 *   resolution can always be explained ("won over: inferred(high) 'synthetic puffy'"). The winner's
 *   value/confidence/source are untouched — only the evidence trail grows.
 *
 * Pure, total, never throws (a malformed claim with an unknown source simply ranks at the `unknown`
 * floor and loses to any real assertion).
 */
export function resolveFacet<V>(claims: ReadonlyArray<Claim<V>>): Claim<V> {
  const asserting = claims.filter(asserts);
  if (asserting.length === 0) return { ...UNKNOWN_CLAIM };

  let best = asserting[0]!;
  for (let i = 1; i < asserting.length; i++) {
    const challenger = asserting[i]!;
    if (challengerBeats(challenger, best)) best = challenger;
  }

  const losers = asserting.filter((c) => c !== best);
  if (losers.length === 0) return { ...best };

  return { ...best, evidence: appendTrail(best.evidence, losers) };
}

/** Append a compact "won over: …" provenance trail to the winner's evidence (kept auditable). */
function appendTrail<V>(winnerEvidence: string, losers: ReadonlyArray<Claim<V>>): string {
  const trail = losers
    .map((c) => `${c.source}(${c.confidence}) ${String(c.value)}${c.evidence ? ` — ${c.evidence}` : ""}`)
    .join("; ");
  return `${winnerEvidence} [resolver: won over ${trail}]`;
}
