// Evidence shapes — the universal contract for every stored value (load-bearing rules #1, #2).
// Soft facets are confidence-graded; hard facts may only carry a value from an authoritative source
// (manufacturer/user) and are mechanically demoted to null+unknown otherwise. "Unknown" is a
// first-class, representable state — never a guess.

import { z } from "zod";

export const CONFIDENCE = ["low", "medium", "high"] as const;
export const SOURCE = ["manufacturer", "user", "inferred", "derived_from_material", "unknown"] as const;
export const HARD_SOURCE = ["manufacturer", "user"] as const;

export type Confidence = (typeof CONFIDENCE)[number];
export type Source = (typeof SOURCE)[number];

export type Evidence<T> =
  | { value: T; confidence: Confidence; source: Source; evidence: string }
  | { value: null; confidence: "unknown"; source: "unknown"; evidence?: string };

export type HardFact<T> =
  | { value: T; source: (typeof HARD_SOURCE)[number]; evidence: string }
  | { value: null; source: "unknown"; evidence?: string };

/** A confidence-graded soft facet whose `value` may be null (= known-unknown). */
export const evidence = <T extends z.ZodTypeAny>(value: T) =>
  z.union([
    z.object({
      value,
      confidence: z.enum(CONFIDENCE),
      source: z.enum(SOURCE),
      evidence: z.string().min(1),
    }),
    z.object({
      value: z.null(),
      confidence: z.literal("unknown"),
      source: z.literal("unknown"),
      evidence: z.string().optional(),
    }),
  ]);

/**
 * A hard fact. A non-null value REQUIRES source ∈ {manufacturer, user}. Any stated value from a
 * non-authoritative source (inferred / derived_from_material / unknown) is rewritten to null+unknown
 * BEFORE validation — so a fabricated spec has nowhere to live (load-bearing rule #2), independent of
 * prompt wording.
 */
export const hardFact = <T extends z.ZodTypeAny>(value: T) =>
  z.preprocess((raw) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as object)) {
      const r = raw as { value: unknown; source?: unknown; evidence?: unknown };
      const stated = r.value !== null && r.value !== undefined;
      const authoritative = r.source === "manufacturer" || r.source === "user";
      if (stated && !authoritative) {
        return {
          value: null,
          source: "unknown",
          evidence:
            typeof r.evidence === "string"
              ? r.evidence
              : `demoted: hard fact had non-authoritative source '${String(r.source)}'`,
        };
      }
    }
    return raw;
  }, z.union([
    z.object({ value, source: z.enum(HARD_SOURCE), evidence: z.string().min(1) }),
    z.object({ value: z.null(), source: z.literal("unknown"), evidence: z.string().optional() }),
  ]));

/** Canonical "we don't know" literals. */
export const UNKNOWN_SOFT = { value: null, confidence: "unknown", source: "unknown" } as const;
export const UNKNOWN_HARD = { value: null, source: "unknown" } as const;

export const isKnown = <T>(e: Evidence<T> | HardFact<T> | undefined | null): boolean =>
  e != null && e.value !== null;

/** A soft value is usable for a safety-relevant decision only if known with at least the given confidence. */
export function isConfident<T>(e: Evidence<T> | undefined | null, min: Confidence = "medium"): boolean {
  if (!e || e.value === null) return false;
  const order: Confidence[] = ["low", "medium", "high"];
  if (e.confidence === "unknown") return false;
  return order.indexOf(e.confidence) >= order.indexOf(min);
}
