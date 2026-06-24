-- Evidence-architecture Phase 2: the cache split (ADR-0012 Element 5).
--
-- Splits the single shared `classification_cache` into:
--   1. llm_draft_cache — GLOBAL, low-authority DRAFTS (LLM-extracted + seed). Service-role only.
--   2. user_overrides  — PER-USER corrections/confirmations, RLS-scoped to the owner.
-- This kills cross-tenant poisoning: a correction by user A could previously land in the single shared
-- cache and reshape EVERY other user's next classification. Going forward, corrections/confirmations are
-- written to user_overrides scoped to the acting user, and `lookup` resolves per-user-override BEFORE
-- the shared draft.
--
-- EXISTING-ROW HANDLING (deliberate): ALL existing classification_cache rows are migrated into
-- llm_draft_cache as drafts, REGARDLESS of their old `source` ("llm" | "user" | "seed"). Rationale: the
-- old "user" rows were already GLOBAL/shared data (the whole bug), so demoting them to shared drafts
-- preserves the status-quo behavior WITHOUT falsely attributing a shared correction to one specific
-- user (we have no per-user provenance to attribute it to). New corrections go to user_overrides and a
-- user can re-correct, which then scopes correctly. The old `source` collapses to "llm" (a draft is a
-- draft); `model_id` is carried through.

-- 1. New tables.
CREATE TABLE "llm_draft_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"classification" jsonb NOT NULL,
	"source" text NOT NULL,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_overrides" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"classification" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_overrides_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint

-- 2. Migrate existing rows into llm_draft_cache as DRAFTS (see header). Demote every old `source` to
--    "llm"; preserve key/name/classification/model_id and timestamps. ON CONFLICT keeps it idempotent.
INSERT INTO "llm_draft_cache" ("key", "name", "classification", "source", "model_id", "created_at", "updated_at")
SELECT "key", "name", "classification", 'llm', "model_id", "created_at", "updated_at"
FROM "classification_cache"
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- 3. Drop the old single shared cache.
DROP TABLE "classification_cache" CASCADE;
--> statement-breakpoint

-- ============================================================
-- 4. Row-Level Security (out-of-band, mirrors drizzle/0003_enable_rls_auth.sql).
--    The app connects as the 'postgres' role (table OWNER) which bypasses RLS; these policies protect
--    the public PostgREST/anon endpoint only. auth.uid() is wrapped in (select auth.uid()) per Supabase
--    perf guidance.
-- ============================================================

-- 4a. user_overrides — per-user owner policy (identical pattern to items/trips/pending_facets in 0003).
ALTER TABLE "user_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "user_overrides_owner" ON "user_overrides";
--> statement-breakpoint
CREATE POLICY "user_overrides_owner" ON "user_overrides"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
--> statement-breakpoint

-- 4b. llm_draft_cache — fully locked to the owner/service connection, exactly like the old
--     classification_cache (0003 §4). No policies: the public API cannot read or write it.
ALTER TABLE "llm_draft_cache" ENABLE ROW LEVEL SECURITY;
