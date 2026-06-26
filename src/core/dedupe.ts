// Duplicate-detection predicate for add-time (quick-add + batch).
// Pure, framework-agnostic, no imports beyond the project contract.
// Conservative by design: prefer a missed duplicate over a false positive that blocks a legitimate add.
// Unknown / empty brand or model never force a match on their own.

import { normalizeSearch } from "./inventory";

// ----------------------------------------------------------------------------------------------------
// normalizeItemName — aggressive normalization for matching
// ----------------------------------------------------------------------------------------------------

/**
 * Aggressive normalization for deduplication matching: lowercase, trim, collapse whitespace,
 * strip all punctuation. Builds on normalizeSearch (trim + lowercase + collapse whitespace) and
 * additionally removes punctuation characters so that apostrophes, hyphens, dots, etc. don't
 * prevent a match between "Arc'teryx" and "Arcteryx".
 */
export function normalizeItemName(s: string): string {
  // First apply the shared search normalization (trim, lowercase, collapse whitespace)
  const base = normalizeSearch(s);
  // Then strip punctuation (anything that is not a word character or a space)
  // and collapse any whitespace gaps left behind
  return base.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------------
// DedupeFields — the minimal shape required to run deduplication
// ----------------------------------------------------------------------------------------------------

export interface DedupeFields {
  name: string;
  brand?: string | null;
  model?: string | null;
}

// ----------------------------------------------------------------------------------------------------
// isLikelyDuplicate — conservative three-clause predicate
// ----------------------------------------------------------------------------------------------------

/**
 * Returns true when `a` and `b` very likely refer to the same owned item.
 *
 * Match is declared when ANY of the following holds:
 *  1. Normalized names are equal.
 *  2. Both items have a non-empty brand AND model, and normalized `brand + " " + model` are equal.
 *  3. One normalized name CONTAINS the other AND they share a normalized brand — guards the
 *     "Patagonia Nano Puff Jacket" vs "Nano Puff Jacket" (same brand, one name is a substring)
 *     case without letting unrelated items with one generic word in common collide.
 *
 * Empty / unknown brand or model are ignored and never force a match on their own.
 * Be conservative: return false when evidence is ambiguous.
 */
export function isLikelyDuplicate(a: DedupeFields, b: DedupeFields): boolean {
  const normA = normalizeItemName(a.name);
  const normB = normalizeItemName(b.name);
  const brandA = a.brand ? normalizeItemName(a.brand) : "";
  const brandB = b.brand ? normalizeItemName(b.brand) : "";
  const modelA = a.model ? normalizeItemName(a.model) : "";
  const modelB = b.model ? normalizeItemName(b.model) : "";

  // Clause 1: identical normalized names, with no contradicting brand evidence.
  // If both sides carry a non-empty brand and those brands differ, identical names are NOT
  // sufficient — "Nano Puff" by Patagonia vs "Nano Puff" by Rab are different items.
  if (normA === normB) {
    const brandsContradict = brandA && brandB && brandA !== brandB;
    if (!brandsContradict) return true;
  }

  // Clause 2: both have brand + model and brand+model strings match
  if (brandA && modelA && brandB && modelB) {
    const sigA = `${brandA} ${modelA}`;
    const sigB = `${brandB} ${modelB}`;
    if (sigA === sigB) return true;
  }

  // Clause 3: one name contains the other AND shared non-empty brand
  if (brandA && brandB && brandA === brandB) {
    if (normA.length > 0 && normB.length > 0) {
      if (normA.includes(normB) || normB.includes(normA)) return true;
    }
  }

  return false;
}

// ----------------------------------------------------------------------------------------------------
// findDuplicateIn — scan an existing list for the first likely duplicate of a candidate
// ----------------------------------------------------------------------------------------------------

/**
 * Returns the first item in `existing` for which `isLikelyDuplicate(candidate, item)` is true,
 * or null if no match is found.
 */
export function findDuplicateIn<T extends DedupeFields>(
  candidate: DedupeFields,
  existing: T[],
): T | null {
  for (const item of existing) {
    if (isLikelyDuplicate(candidate, item)) return item;
  }
  return null;
}
