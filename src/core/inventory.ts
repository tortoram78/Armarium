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
 * The set of behavioral domains for which full facet-sets are modeled. 'gear' and 'apparel' are
 * the two fully-modeled domains; electronics/collectibles are future extension points.
 * `domains: string[]` on an item marks which behavioral facet-sets apply and is NEVER a routing
 * discriminator (no-hardcoded-categories invariant). A record-only / non-gear item has `domains: []`.
 * An item can hold multiple domains simultaneously (e.g. a fleece is both gear and apparel).
 */
export const KNOWN_DOMAINS = ["gear", "apparel"] as const;
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

/** The fields a closet search ranks over. name/brand/model are the identity; tags are user labels. */
export interface SearchFields {
  name: string;
  brand?: string | null;
  model?: string | null;
  tags?: readonly string[];
}

/** A field's character trigram set (for Dice-coefficient fuzzy similarity). Pads with spaces so short
 *  strings still yield trigrams and word boundaries count. */
function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice-coefficient similarity (0..1) over character trigrams — the typo-tolerance primitive
 *  ("patagona" ≈ "patagonia"). Cheap, dependency-free, and the same shape pg_trgm uses in Postgres. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

/** Per-field weights — a name hit ranks above a brand hit above a model/tag hit. */
const FIELD_WEIGHT = { name: 1, brand: 0.95, model: 0.9, tag: 0.85 } as const;

/** The query's weighted field list, in rank order. */
function weightedFields(fields: SearchFields): [string | null | undefined, number][] {
  return [
    [fields.name, FIELD_WEIGHT.name],
    [fields.brand, FIELD_WEIGHT.brand],
    [fields.model, FIELD_WEIGHT.model],
    ...(fields.tags ?? []).map((t) => [t, FIELD_WEIGHT.tag] as [string, number]),
  ];
}

/** How well one query token matches one field token: exact > prefix > substring > fuzzy(typo). 0 = miss. */
function tokenMatch(fieldTok: string, queryTok: string): number {
  if (fieldTok === queryTok) return 1;
  if (fieldTok.startsWith(queryTok) || queryTok.startsWith(fieldTok)) return 0.85;
  if (fieldTok.includes(queryTok)) return 0.72;
  const sim = trigramSimilarity(fieldTok, queryTok);
  return sim >= 0.5 ? 0.4 + sim * 0.3 : 0; // typo tolerance, always below a real substring hit
}

/**
 * Relevance score (0 = no match, higher = better) of an item against a free-text query, ranked across
 * name/brand/model/tags with typo tolerance and word-order independence. The single source of truth for
 * closet search ranking; the Postgres path mirrors it (token ILIKE now; pg_trgm ranking is ADR-0031 §next).
 *
 * Two signals, the higher wins: (a) a whole-PHRASE hit in one field (exact/prefix/substring), and
 * (b) TOKEN COVERAGE — every query token must match some field token (possibly across different fields,
 * possibly fuzzily); the score is the mean of per-token best matches. A query token that matches nothing
 * sinks the token signal to 0, so unrelated queries score 0.
 */
export function searchScore(fields: SearchFields, query: string): number {
  if (!query) return 1;
  const q = normalizeSearch(query);
  if (!q) return 1;
  const list = weightedFields(fields);

  // (a) whole-phrase hit in a single field.
  let phrase = 0;
  for (const [raw, w] of list) {
    if (!raw) continue;
    const f = normalizeSearch(raw);
    if (!f) continue;
    if (f === q) phrase = Math.max(phrase, w);
    else if (f.startsWith(q)) phrase = Math.max(phrase, w * 0.95);
    else if (f.includes(q)) phrase = Math.max(phrase, w * 0.85);
  }

  // (b) token coverage across ALL fields.
  const fieldToks: [string, number][] = [];
  for (const [raw, w] of list) {
    if (!raw) continue;
    for (const ft of normalizeSearch(raw).split(" ").filter(Boolean)) fieldToks.push([ft, w]);
  }
  const qTokens = q.split(" ").filter(Boolean);
  let sum = 0;
  let coveredAll = true;
  for (const qt of qTokens) {
    let best = 0;
    for (const [ft, w] of fieldToks) best = Math.max(best, tokenMatch(ft, qt) * w);
    if (best === 0) coveredAll = false;
    sum += best;
  }
  const tokenScore = coveredAll && qTokens.length > 0 ? (sum / qTokens.length) * 0.8 : 0;

  return Math.max(phrase, tokenScore);
}

/**
 * True iff the item is a relevant search hit (score above the fuzzy floor). Backward-compatible boolean
 * wrapper over `searchScore` — now typo-tolerant and tag-aware, not just a substring test.
 */
export function itemMatchesSearch(fields: SearchFields, query: string): boolean {
  if (!query) return true;
  return searchScore(fields, query) > 0;
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
