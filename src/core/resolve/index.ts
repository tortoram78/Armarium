// Framework-agnostic CORE of evidence resolution.
//
// PURE: no next/*, no React, no DB, no networking. The resolver turns a facet's competing CLAIMS into a
// single winner by an EXPLICIT, documented precedence + confidence policy (resolve-facet.ts), and applies
// that to the universal behavioral facets against the material-derivation overlay (behavioral.ts).
//
//   resolveFacet             — competing claims → the winning claim (the policy lives here).
//   SOURCE_PRECEDENCE        — the authoritative total order (user > manufacturer > derived > inferred > unknown).
//   resolveBehavioralFacets  — apply the resolver to a classification's behavioral facets vs derivation.

export {
  resolveFacet,
  SOURCE_PRECEDENCE,
  AUTHORITATIVE_SOURCES,
  type Claim,
  type ClaimConfidence,
} from "./resolve-facet";

export { resolveBehavioralFacets, BEHAVIORAL_KEYS } from "./behavioral";

// Phase 3 (ADR-0014): the claims pipeline — facet-key paths, the claim→classification assembler + the
// classification→claims decomposer, the LLM-claim ingestion boundary, and the non-LLM claim producers.
export {
  FACET_PATHS,
  FACET_PATH_BY_KEY,
  isHardFactKey,
  isRegistryFacetKey,
  type FacetPathDef,
} from "./facet-paths";

export {
  assembleClassification,
  decomposeToClaims,
  MATERIALS_FACET_KEY,
} from "./assemble";

export {
  ingestLlmClaims,
  LLM_CLAIMS_EXTRACTOR_VERSION,
  type IngestedClaims,
  type PendingFacet,
} from "./ingest-claims";

export {
  manufacturerClaims,
  derivedClaims,
  MANUFACTURER_EXTRACTOR_VERSION,
  MATERIAL_DERIVE_EXTRACTOR_VERSION,
} from "./source-claims";
