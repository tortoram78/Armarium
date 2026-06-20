// In-memory classification cache — the dev/demo knowledge base. Seeded from the canonical corpus so
// known prototype items are instant cache hits with no LLM call. A Postgres impl (postgres-cache.ts)
// backs durable deployments; getCacheRepository() selects between them.

import type { ClassificationCacheRepository } from "@/core/ports";
import type { CachedClassification } from "@/core/cache";
import { normalizeCacheKey } from "@/core/cache";
import { SEED_CORPUS } from "@/core/seed-corpus";

const store = new Map<string, CachedClassification>();
let seeded = false;

function ensureSeed() {
  if (seeded) return;
  seeded = true;
  const now = new Date().toISOString();
  for (const e of SEED_CORPUS) {
    const key = normalizeCacheKey(e.classification.name);
    if (!store.has(key)) {
      store.set(key, {
        key,
        name: e.classification.name,
        classification: e.classification,
        source: "seed",
        modelId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

export const memoryCache: ClassificationCacheRepository = {
  async getCached(key) {
    ensureSeed();
    const hit = store.get(key);
    return hit ? structuredClone(hit) : null;
  },
  async putCached(entry) {
    ensureSeed();
    const now = new Date().toISOString();
    const existing = store.get(entry.key);
    store.set(entry.key, {
      key: entry.key,
      name: entry.name,
      classification: structuredClone(entry.classification),
      source: entry.source,
      modelId: entry.modelId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  },
};
