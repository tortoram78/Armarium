// Inventory layer contract — the domain-agnostic layer that decouples ownership from classification.
// Pure, framework-agnostic, Zod-validated. No next/*, no React, no DB singletons. Dependencies are
// received, never constructed here.
//
// This is the SINGLE source of truth for ownership/physical metadata that the persistence layer stores
// alongside (not inside) the behavioral classification. It is NOT derived from the LLM output.
//
// DOMAIN REGISTRY SEAM: `KNOWN_DOMAINS` lists the domains for which full behavioral facet-sets are
// modeled. 'gear' is the only fully-modeled domain in v1; future extension points (apparel, electronics,
// collectibles…) are expected to be added here. The `domains` field on an item marks which behavioral
// facet-sets apply and is NEVER a routing discriminator — the no-hardcoded-categories invariant holds:
// grouping and recommendations are emergent queries over the facet space, not category switches.
// A record-only / non-gear item has `domains: []`.

import { z } from "zod";

// ----------------------------------------------------------------------------------------------------
// Ownership status
// ----------------------------------------------------------------------------------------------------

export const OWNERSHIP_STATUS = ["wishlist", "owned", "loaned", "retired", "sold"] as const;
export type OwnershipStatus = (typeof OWNERSHIP_STATUS)[number];

// ----------------------------------------------------------------------------------------------------
// Condition
// ----------------------------------------------------------------------------------------------------

export const CONDITION = ["new", "good", "worn", "end_of_life"] as const;
export type Condition = (typeof CONDITION)[number];

// ----------------------------------------------------------------------------------------------------
// Domain registry seam
// ----------------------------------------------------------------------------------------------------

/**
 * The set of behavioral domains for which full facet-sets are modeled. Gear is the only fully-modeled
 * domain in v1; apparel/electronics/collectibles are future extension points. `domains: string[]` on an
 * item marks which behavioral facet-sets apply and is NEVER a routing discriminator (no-hardcoded-
 * categories invariant). A record-only / non-gear item has `domains: []`.
 */
export const KNOWN_DOMAINS = ["gear"] as const;
export type KnownDomain = (typeof KNOWN_DOMAINS)[number];

// ----------------------------------------------------------------------------------------------------
// InventoryMeta — the ownership/physical envelope stored alongside the classification
// ----------------------------------------------------------------------------------------------------

/**
 * Physical and ownership metadata for one item. Stored by the persistence layer; NOT derived from the
 * LLM classification. The classification carries behavioral facets (waterproofness, warmth, layering
 * role…); this carries who owns it, its condition, where it is stored, and which behavioral domains apply.
 */
export interface InventoryMeta {
  /** Current ownership state. Defaults to 'owned'. */
  ownershipStatus: OwnershipStatus;
  /** Number of units. Must be a positive integer; defaults to 1. */
  quantity: number;
  /** Observed physical condition; null = not recorded. */
  condition: Condition | null;
  /** ISO 8601 date (YYYY-MM-DD) when the item was acquired; null = not recorded. */
  acquiredAt: string | null;
  /** Purchase price in cents (e.g. 9900 = $99.00); null = not recorded. */
  pricePaidCents: number | null;
  /** Where the item was acquired (e.g. "REI", "eBay"); null = not recorded. */
  acquiredFrom: string | null;
  /** Physical storage location (e.g. "garage shelf A"); null = not recorded. */
  storageLocation: string | null;
  /** User-entered size (e.g. "M", "10.5"); null = not recorded. */
  size: string | null;
  /** User-entered color description; null = not recorded. */
  color: string | null;
  /** Free-form user notes; null = not recorded. */
  userNotes: string | null;
  /**
   * Which behavioral facet-sets apply to this item. Use KNOWN_DOMAINS values for first-class domains;
   * unknown or non-gear items use []. This is a set membership marker, NOT a routing discriminator.
   */
  domains: string[];
  /**
   * Free-form user-curated tags (e.g. "ultralight", "borrowed", "climbing"). Orthogonal to facets —
   * NOT a capability input, NOT a hardcoded category. Purely a user cross-cutting label. Defaults to [].
   */
  userTags: string[];
}

// ----------------------------------------------------------------------------------------------------
// Zod schema
// ----------------------------------------------------------------------------------------------------

export const InventoryMetaSchema = z.object({
  ownershipStatus: z.enum(OWNERSHIP_STATUS).default("owned"),
  quantity: z.number().int().min(1).default(1),
  condition: z.enum(CONDITION).nullable().default(null),
  acquiredAt: z.string().nullable().default(null),
  pricePaidCents: z.number().int().nonnegative().nullable().default(null),
  acquiredFrom: z.string().nullable().default(null),
  storageLocation: z.string().nullable().default(null),
  size: z.string().nullable().default(null),
  color: z.string().nullable().default(null),
  userNotes: z.string().nullable().default(null),
  domains: z.array(z.string()).default([]),
  userTags: z.array(z.string()).default([]),
});

// ----------------------------------------------------------------------------------------------------
// Default value
// ----------------------------------------------------------------------------------------------------

/** The all-default InventoryMeta. Use when no ownership details are supplied by the caller. */
export const DEFAULT_INVENTORY: InventoryMeta = {
  ownershipStatus: "owned",
  quantity: 1,
  condition: null,
  acquiredAt: null,
  pricePaidCents: null,
  acquiredFrom: null,
  storageLocation: null,
  size: null,
  color: null,
  userNotes: null,
  domains: [],
  userTags: [],
};

// ----------------------------------------------------------------------------------------------------
// Search helpers — canonical predicate shared between the in-memory repo and Postgres (ILIKE mirror)
// ----------------------------------------------------------------------------------------------------

/** Normalize a search string: trim, lowercase, collapse runs of whitespace to a single space. */
export function normalizeSearch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True iff the item's name/brand/model contains the query as a case-insensitive substring.
 * Postgres mirrors this with ILIKE so both paths return the same items.
 */
export function itemMatchesSearch(
  fields: { name: string; brand?: string | null; model?: string | null },
  query: string,
): boolean {
  if (!query) return true;
  const q = normalizeSearch(query);
  const norm = (s: string | null | undefined) => (s ? normalizeSearch(s) : "");
  return norm(fields.name).includes(q) || norm(fields.brand).includes(q) || norm(fields.model).includes(q);
}

// ----------------------------------------------------------------------------------------------------
// Tag helpers — for the user-curated tags feature
// ----------------------------------------------------------------------------------------------------

/**
 * Normalize a raw tag input (a string with comma/newline delimiters, or an already-split array)
 * into a clean, deduplicated array of trimmed tags. Preserves the user's chosen casing but
 * deduplicates case-insensitively (first occurrence wins). Filters out empty strings.
 *
 * @example
 *   normalizeTags("ultralight, Climbing,  climbing")  → ["ultralight", "Climbing"]
 *   normalizeTags(["  wet  ", "RAIN", "rain"])         → ["wet", "RAIN"]
 */
export function normalizeTags(raw: string[] | string): string[] {
  const parts: string[] = Array.isArray(raw)
    ? raw
    : raw.split(/[,\n]+/);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  return result;
}
