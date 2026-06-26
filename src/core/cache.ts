// Classification cache — the app's self-building knowledge base. A normalized item NAME maps to a
// stored, validated classification, so a repeat add reuses it instead of re-hitting the LLM. The
// review-before-save step still gates everything. Pure: no IO.
//
// ARCHITECTURE (ADR-0012 Element 5 — the cache split):
//   The cache is split into TWO stores so one user's correction can never poison another's:
//     1. llm_draft_cache  — GLOBAL, low-authority DRAFTS (LLM-extracted + seed). A hit is a starting
//        draft; review still gates saving. NOT authoritative. Service-role only (no user data here).
//     2. user_overrides   — PER-USER corrections/confirmations, RLS-scoped to the owner. A correction
//        by user A NEVER affects user B's lookups.
//   `lookup` checks the per-user override FIRST (authority "user"), then the shared draft (authority
//   "draft") — mirroring the resolver's `user > inferred` precedence.
//   (`canonical_facts`, an authoritative product-level store, is DEFERRED to Phase 4 — it needs the
//   canonical_products table that does not exist yet.)

import type { ItemClassification } from "./classification";

/** Provenance recorded on a shared DRAFT. Drafts only ever come from the LLM or the seed corpus —
 *  user corrections/confirmations are NOT drafts; they go to the per-user override store. */
export const DRAFT_SOURCES = ["llm", "seed"] as const;
export type DraftSource = (typeof DRAFT_SOURCES)[number];

/** Where a `lookup` hit came from, in precedence order. `"user"` (a per-user override) outranks
 *  `"draft"` (a shared low-authority draft) — same ordering the facet resolver uses. */
export type CacheAuthority = "user" | "draft";

/** A resolved cache hit: the classification to reuse, its authority tier, and the model that produced
 *  it (drafts carry the classifying model id; overrides carry the model that last wrote the item). */
export interface CacheLookupHit {
  classification: ItemClassification;
  authority: CacheAuthority;
  modelId: string | null;
}

/** A catalog suggestion: a previously-classified product the user can add WITH its specs in one tap
 *  (the self-building product catalog — ADR-0025). Drawn from the GLOBAL draft store only (never a
 *  user's private override), so it is shareable across users without leaking anyone's corrections. */
export interface CatalogHit {
  key: string;
  name: string;
  classification: ItemClassification;
}

/**
 * The self-building classification knowledge base (split store — ADR-0012 Element 5).
 *
 * `lookup` resolves a name to the best available classification by precedence: a PER-USER override
 * (authority "user") wins over the GLOBAL low-authority draft (authority "draft"); a miss is null.
 * Writes are explicit about which store they target — a classify-miss/seed writes a DRAFT (global,
 * low-authority), a user correction/confirmation writes a USER OVERRIDE scoped to that user. This is
 * the contract that kills cross-tenant poisoning: there is no write path that lets user A's correction
 * land in a store user B reads.
 */
export interface ClassificationCacheRepository {
  /** Per-user override first (authority "user"), else the shared draft (authority "draft"), else null. */
  lookup(userId: string, key: string): Promise<CacheLookupHit | null>;
  /** Upsert a GLOBAL low-authority draft (LLM-extracted or seed). Visible to every user as a draft. */
  putDraft(key: string, name: string, classification: ItemClassification, modelId: string | null, source?: DraftSource): Promise<void>;
  /** Upsert a PER-USER override (correction/confirmation), scoped to `userId`. Never seen by other users. */
  putUserOverride(userId: string, key: string, name: string, classification: ItemClassification): Promise<void>;
  /** Name-search the GLOBAL draft store for add-time autocomplete (ADR-0025 self-building catalog).
   *  Returns up to `limit` products, best name match first. Never reads per-user overrides. */
  searchCatalog(query: string, limit: number): Promise<CatalogHit[]>;
}

/**
 * Stable lookup key from an item name: lowercased, accent-folded, punctuation→space, whitespace
 * collapsed. Idempotent. v0 keys on NAME only (so a correction to "X" improves every future add of
 * "X"); keying on brand|model once known is a documented future refinement.
 */
export function normalizeCacheKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
