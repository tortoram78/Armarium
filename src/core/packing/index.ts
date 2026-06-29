// Packing engine (ADR-0027) — public surface. A trip + the resolved closet → a quantified, gear-first
// PackingPlan. Pure, deterministic, offline; the framework-agnostic core the web app (and a future MCP
// server) call instead of the old capability auditor.

export { planPacking, tripContext, type PackingOpts } from "./engine";
export {
  enrichPlanWithLlm,
  mergeEnrichment,
  type PackingEnrichDeps,
  type PackingEnrichment,
} from "./enrich";
export { NEED_SPECS } from "./catalog";
export {
  NEED_CATEGORIES,
  NEED_CATEGORY_LABELS,
  type NeedCategory,
  type NeedSpec,
  type Severity,
  type Quantity,
  type TripContext,
  type PackItemRef,
  type LineStatus,
  type PackingLine,
  type PackingSection,
  type PackingSummary,
  type PackingPlan,
} from "./types";
