// Classification cache — the app's self-building knowledge base. A normalized item NAME maps to a
// stored, validated classification, so a repeat add reuses it instead of re-hitting the LLM. The
// review-before-save step still gates everything, and user corrections/confirmations upsert
// AUTHORITATIVE (source:"user") entries — so the KB gets better the more the app is used. Pure: no IO.

import type { ItemClassification } from "./classification";

export const CACHE_SOURCES = ["llm", "user", "seed"] as const;
export type CacheSource = (typeof CACHE_SOURCES)[number];

export interface CachedClassification {
  key: string;
  name: string;
  classification: ItemClassification;
  source: CacheSource;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CacheUpsert {
  key: string;
  name: string;
  classification: ItemClassification;
  source: CacheSource;
  modelId: string | null;
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
