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
