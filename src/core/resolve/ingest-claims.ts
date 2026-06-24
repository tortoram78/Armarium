// The claim INGESTION boundary (Phase 3 — ADR-0014 §2/§5): turn validated `LlmClaimsOutput` into the
// `EvidenceClaim[]` written to item_evidence, applying the hard-fact demotion guard mechanically.
//
// Two boundary policies enforced here (neither prompt-dependent):
//   1. HARD-FACT DEMOTION. An `inferred` hard fact (identity.brand/model/price/weight, universal.upf, the
//      group hard facts) has NOWHERE TO LIVE — it is DROPPED (not written). The item_evidence store holds
//      only asserting claims from a source allowed to assert that fact; an inferred hard fact is neither
//      authoritative nor a real absence to record. (Net effect on the resolved view is identical to the
//      old hardFact preprocessor: the facet stays null+unknown — re-confirmed by parseClassification.)
//      [JUDGMENT: ADR-0014 §2 describes writing a null/"unknown" demotion ROW; the LOCKED EvidenceClaim
//       port type forbids null-value / "unknown"-confidence rows ("only ever a real asserting claim").
//       Dropping resolves the conflict while preserving the invariant — flagged in the wave-2 handoff.]
//   2. NON-ASSERTING CLAIMS DROPPED. A claim the model marked confidence:"unknown" (or with a null value)
//      is an explicit "I don't know" — it is NOT a stored claim (it competes as an absence, which is the
//      default). The model's unknowns flow through `unresolvedQuestions`, not the evidence store.
//
// NOVEL keys (a facetKey not in the registry) ARE written to item_evidence (never silently dropped —
// ADR-0004) and additionally surfaced as `pendingFacets` for the human review queue (ADR-0014 §5). The
// assembler skips them when building the resolved classification (no schema to validate against).
//
// PURE: no next/*, no React, no DB, no networking.

import type { EvidenceClaim } from "../ports";
import type { LlmClaimsOutput } from "../classify/claims";
import { isHardFactKey, isRegistryFacetKey } from "./facet-paths";

/** The extractor-version stamp for LLM-claims-sourced evidence (ADR-0014 §3). */
export const LLM_CLAIMS_EXTRACTOR_VERSION = "llm-claims-v1";

/** One novel (non-registry) facet the LLM surfaced — parked for human review (mirrors pending_facets). */
export interface PendingFacet {
  facetKey: string;
  value: unknown;
  confidence: "low" | "medium" | "high";
  evidence: string;
}

export interface IngestedClaims {
  /** The claims to write to item_evidence (registry + novel; never the demoted/non-asserting ones). */
  claims: EvidenceClaim[];
  /** Novel-key claims to ALSO enqueue in pending_facets (siblings of their item_evidence rows). */
  pendingFacets: PendingFacet[];
  /** Facets the model could not determine — surfaced in review, never persisted (ADR-0014 §2). */
  unresolvedQuestions: string[];
}

/**
 * Ingest a validated `LlmClaimsOutput` into the evidence-store claim set + the review-queue side-channels.
 *
 * - Drops a claim whose `confidence` is "unknown" or whose `value` is null (a non-asserting "I don't know").
 * - Drops an `inferred` hard fact (the demotion guard — it has nowhere to live).
 * - Stamps every surviving claim `source:"inferred"`, `extractor_version:"llm-claims-v1"`.
 * - Routes a novel (non-registry) facetKey into BOTH `claims` (persisted) and `pendingFacets` (review).
 *
 * Pure; never throws on a validated `LlmClaimsOutput`.
 */
export function ingestLlmClaims(output: LlmClaimsOutput, observedAt?: string): IngestedClaims {
  const claims: EvidenceClaim[] = [];
  const pendingFacets: PendingFacet[] = [];

  for (const c of output.claims) {
    // Non-asserting: the model explicitly does not know. Not a stored claim (competes as absence).
    if (c.confidence === "unknown" || c.value === null || c.value === undefined) continue;
    const confidence = c.confidence; // narrowed to low|medium|high by the guard above

    // Hard-fact demotion: an inferred hard fact is dropped — never written (it has nowhere to live).
    if (isHardFactKey(c.facetKey)) continue;

    const claim: EvidenceClaim = {
      facetKey: c.facetKey,
      value: c.value,
      confidence,
      source: "inferred",
      evidence: c.evidence,
      extractorVersion: LLM_CLAIMS_EXTRACTOR_VERSION,
      ...(observedAt ? { observedAt } : {}),
    };
    claims.push(claim);

    // A novel key is persisted (above) AND parked for review; the assembler will skip it.
    if (!isRegistryFacetKey(c.facetKey)) {
      pendingFacets.push({ facetKey: c.facetKey, value: c.value, confidence, evidence: c.evidence });
    }
  }

  return { claims, pendingFacets, unresolvedQuestions: [...output.unresolvedQuestions] };
}
