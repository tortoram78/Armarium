// Postgres ClassificationCacheRepository — Drizzle ORM over the split store (ADR-0012 Element 5):
//   - llm_draft_cache  — GLOBAL low-authority drafts (PK key).
//   - user_overrides   — PER-USER corrections/confirmations (PK (user_id, key)), RLS-scoped.
// This module is safe to import with no DATABASE_URL: `getDb()` throws only on first query, never at
// module load. Importing this file has ZERO connection side effects.
//
// Design:
//   - `lookup(userId, key)` — point-select the per-user override FIRST (authority "user"); else the
//     shared draft (authority "draft"); else null. This per-user-first precedence is the security
//     guarantee — a draft hit can never out-rank or leak another user's override.
//   - `putDraft` / `putUserOverride` — upsert via `onConflictDoUpdate`; `created_at` preserved on
//     collision (only `updated_at` + payload columns are overwritten).

import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { llmDraftCache, userOverrides } from "@/db/schema";
import type { ClassificationCacheRepository } from "@/core/cache";

export const postgresCache: ClassificationCacheRepository = {
  async lookup(userId, key) {
    const db = getDb();

    // 1. Per-user override wins (authority "user").
    const overrideRows = await db
      .select()
      .from(userOverrides)
      .where(and(eq(userOverrides.userId, userId), eq(userOverrides.key, key)));
    const override = overrideRows[0];
    if (override) {
      return { classification: override.classification, authority: "user", modelId: null };
    }

    // 2. Else the shared low-authority draft (authority "draft").
    const draftRows = await db.select().from(llmDraftCache).where(eq(llmDraftCache.key, key));
    const draft = draftRows[0];
    if (draft) {
      return { classification: draft.classification, authority: "draft", modelId: draft.modelId };
    }

    return null;
  },

  async putDraft(key, name, classification, modelId, source = "llm") {
    const db = getDb();
    const now = new Date();
    await db
      .insert(llmDraftCache)
      .values({ key, name, classification, source, modelId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: llmDraftCache.key,
        // updatedAt stamped to now; createdAt deliberately NOT overwritten (preserved from first insert).
        set: { name, classification, source, modelId, updatedAt: now },
      });
  },

  async putUserOverride(userId, key, name, classification) {
    const db = getDb();
    const now = new Date();
    await db
      .insert(userOverrides)
      .values({ userId, key, name, classification, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [userOverrides.userId, userOverrides.key],
        set: { name, classification, updatedAt: now },
      });
  },
};
