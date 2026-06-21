// Postgres ClassificationCacheRepository — Drizzle ORM over the `classification_cache` table.
// This module is safe to import with no DATABASE_URL: `getDb()` throws only on first query, never at
// module load. The client is the shared lazy singleton from ./db; importing this file has ZERO
// connection side effects.
//
// Design:
//   - `getCached(key)` — point-select by primary key; returns null if absent.
//   - `putCached(entry)` — upsert via `onConflictDoUpdate`; preserves `created_at` on collision.

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { classificationCache } from "@/db/schema";
import type { ClassificationCacheRepository } from "@/core/ports";
import type { CachedClassification, CacheUpsert } from "@/core/cache";

export const postgresCache: ClassificationCacheRepository = {
  async getCached(key: string): Promise<CachedClassification | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(classificationCache)
      .where(eq(classificationCache.key, key));
    const row = rows[0];
    if (!row) return null;
    return {
      key: row.key,
      name: row.name,
      classification: row.classification,
      source: row.source as CachedClassification["source"],
      modelId: row.modelId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  async putCached(entry: CacheUpsert): Promise<void> {
    const db = getDb();
    const now = new Date();
    await db
      .insert(classificationCache)
      .values({
        key: entry.key,
        name: entry.name,
        classification: entry.classification,
        source: entry.source,
        modelId: entry.modelId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: classificationCache.key,
        set: {
          name: entry.name,
          classification: entry.classification,
          source: entry.source,
          modelId: entry.modelId,
          // updatedAt stamped to now; createdAt is deliberately NOT overwritten (preserved from first insert)
          updatedAt: now,
        },
      });
  },
};
