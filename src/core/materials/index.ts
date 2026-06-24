// Framework-agnostic CORE of material-behavior derivation.
//
// PURE: no next/*, no React, no DB, no networking. Imports only `zod`, the canonical facet vocab, and the
// classification types. This module is NOT yet wired into the classify pipeline — that integration (with
// provenance precedence: derived_from_material out-ranks inferred, under manufacturer/user) is a separate
// phase. This phase exports the authoritative library + the derivation engine for review.
//
//   MATERIAL_LIBRARY  — the curated fiber/membrane/insulation → behavior table (validated at load).
//   lookupFiber       — resolve a raw fiber name to its library entry (null when not curated).
//   deriveFromComposition — composition → sparse behavioral-facet overlay (source:"derived_from_material").

export {
  MATERIAL_LIBRARY,
  BEHAVIOR_PROPERTIES,
  canonFiberKey,
  lookupFiber,
  lookupCanonical,
  libraryFiberKeys,
  type MaterialLibraryEntry,
  type LibraryProp,
  type LibraryConfidence,
  type BehaviorProperty,
} from "./library";

export {
  deriveFromComposition,
  type DerivedFacets,
  type DerivedValue,
} from "./derive";
