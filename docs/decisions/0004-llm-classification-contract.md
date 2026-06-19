# 0004 — LLM classification contract (evidence shape, validation, unknowns)

**Status:** Proposed (awaiting approval — Phase 0 gate)
**Date:** 2026-06-19
**Full design:** [`DESIGN.md` §4, §7](../../DESIGN.md) · [classification rubric](../phase0/classification-rubric.md)

## Context
Layer 1 (LLM classification onto facets) is the core of the product, and the most dangerous place for a
hallucinated spec to enter the system. A wrong spec (e.g. labelling the Terre Planing "waterproof", or
upgrading the Kelty "30" to an EN comfort rating) is worse than a missing one — it produces unsafe
recommendations.

## Decision
The boundary between the model and the system is a **Zod schema**; unvalidated model text never reaches
the DB or UI.
- The LLM emits an **evidence-shaped** `ItemClassification`: per facet `{ key, value|null, confidence,
  source, evidence }`, plus materials, treatments, and multi-label arrays.
- **Unknown = `null` with `confidence: "unknown"`**, never guessed.
- **Hard-fact source guard (mechanical):** a hard fact (composition %, fill power, fill weight, UPF,
  EN/ISO rating, denier, crampon compatibility, mm rating) may carry a value **only** if `source ∈
  {manufacturer, user}`; an inferred hard fact is rewritten to `null + unknown` by the validator,
  independent of prompt wording.
- **Multi-label facets** validate against the **closed** registry level sets (no free strings).
- **Novel facet keys are parked in `pending_facets`**, never silently discarded.
- Three representable states: known / known-unknown / never-assessed.
- The model is referenced via one constant `MODEL_ID = "claude-sonnet-4-6"`, swappable.

## Alternatives considered
- **Trust free-form model JSON / lenient parsing.** Rejected: lets fabricated specs and unrecognized
  values persist — exactly the failure this project must avoid.
- **Silently drop unrecognized keys** (Architecture B's original ingest). Rejected: loses legitimate
  novel extractions; `pending_facets` keeps them for review.
- **Allow inferred hard facts with low confidence.** Rejected: confidence is not a license to fabricate
  a spec; hard facts are null unless stated.

## Consequences
- Calibrated confidence + evidence strings make every value auditable and reviewable.
- The rubric needs anchor examples to prevent inter-run drift (provided in the rubric doc).
- Some facets will frequently be null (fill weight, temp-rating standard); the UI and recommender must
  treat null as "verify", never as a default value.
