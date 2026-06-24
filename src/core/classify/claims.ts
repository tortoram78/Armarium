// The CLAIMS-based LLM contract (Layer 1, Phase 3 — ADR-0014 §2). The model no longer emits a final
// resolved `ItemClassification`; it emits a flat array of CLAIMS — one per facet it can assess, each with
// its own confidence + evidence string — plus a list of `unresolvedQuestions` (facets it could not
// determine). Resolution (precedence adjudication across all sources) happens AFTER, in the assembler.
//
// `source` is LOCKED to "inferred": the LLM may only ever assert an inference. The authoritative sources
// (`manufacturer` via URL enrichment, `user` via a correction, `derived_from_material` via composition)
// are reachable ONLY through their own extractors, never laundered through the model's output.
//
// PURE: imports only `zod`. Validated by `parseLlmClaims` BEFORE any use — unvalidated model text never
// proceeds (load-bearing rule #2).

import { z } from "zod";

/** One claim from the LLM for one facet. `value` is validated against the per-facet enum LATER, when the
 *  resolved classification is assembled and run through `parseClassification` — here we only pin the
 *  envelope shape (a model that emits an out-of-vocab value fails at the assembler's Zod boundary). */
export const LlmClaimSchema = z.object({
  /** Dot-namespaced facet key, e.g. "universal.warmth", "identity.brand", "groups.insulation.fill_power",
   *  "multilabel.layering_role", "materials". (See ADR-0014 §1 facet_key namespace.) */
  facetKey: z.string().min(1),
  /** Scalar for ordinals/numerics/booleans; array for multilabel; array-of-materials for "materials". */
  value: z.unknown(),
  confidence: z.enum(["low", "medium", "high", "unknown"]),
  /** LOCKED: the LLM can only ever assert an inference. */
  source: z.literal("inferred"),
  /** The model's stated rationale for this claim; never empty. */
  evidence: z.string().min(1),
});

export const LlmClaimsSchema = z.object({
  /** The normalized item name (unchanged from the current contract). */
  name: z.string().min(1),
  claims: z.array(LlmClaimSchema),
  /** Facets the model could NOT determine ("fill power not stated"). First-class — surfaced in review,
   *  never written to item_evidence (these carry no value). ADR-0014 §2. */
  unresolvedQuestions: z.array(z.string()),
});

export type LlmClaim = z.infer<typeof LlmClaimSchema>;
export type LlmClaimsOutput = z.infer<typeof LlmClaimsSchema>;

/** Validate raw model output as claims. Throws on invalid input — unvalidated text never proceeds. */
export function parseLlmClaims(raw: unknown): LlmClaimsOutput {
  return LlmClaimsSchema.parse(raw);
}

export function safeParseLlmClaims(raw: unknown) {
  return LlmClaimsSchema.safeParse(raw);
}
