// Postgres ClassificationCacheRepository — Drizzle ORM over the split store (ADR-0012 Element 5):
//   - llm_draft_cache  — GLOBAL low-authority drafts (PK key).
//   - user_overrides   — PER-USER corrections/confirmations (PK (user_id, key)).
// This module is safe to import with no DATABASE_URL: `getDb()` throws only on first query, never at
// module load. Importing this file has ZERO connection side effects.
//
// TENANT ISOLATION: the app connects as the table OWNER role, which BYPASSES RLS (no table sets FORCE
// ROW LEVEL SECURITY), so the user_overrides RLS policy is DORMANT for this connection — it guards only
// the public PostgREST/anon surface. The `WHERE user_id = $userId` filter in `lookup`/`putUserOverride`
// (below) is the SOLE live per-user scoping and is MANDATORY; there is no DB backstop. DB-level
// defense-in-depth (FORCE RLS + per-request auth.uid()) is a future hardening, deliberately not yet in
// place. The cross-tenant guard test (test/repo.cross-tenant.test.ts) pins the lookup-isolation contract.
//
// Design:
//   - `lookup(userId, key)` — point-select the per-user override FIRST (authority "user"); else the
//     shared draft (authority "draft"); else null. This per-user-first precedence is the security
//     guarantee — a draft hit can never out-rank or leak another user's override.
//   - `putDraft` / `putUserOverride` — upsert via `onConflictDoUpdate`; `created_at` preserved on
//     collision (only `updated_at` + payload columns are overwritten).

import { and, eq, ilike, sql } from "drizzle-orm";
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

  async searchCatalog(query, limit) {
    const q = query.trim();
    if (!q) return [];
    const db = getDb();
    // Name ILIKE over the GLOBAL draft store; shortest names first (closest match), then alphabetical.
    const rows = await db
      .select({ key: llmDraftCache.key, name: llmDraftCache.name, classification: llmDraftCache.classification })
      .from(llmDraftCache)
      .where(ilike(llmDraftCache.name, `%${q}%`))
      .orderBy(sql`char_length(${llmDraftCache.name})`, llmDraftCache.name)
      .limit(limit);
    return rows.map((r) => ({ key: r.key, name: r.name, classification: r.classification }));
  },
};
