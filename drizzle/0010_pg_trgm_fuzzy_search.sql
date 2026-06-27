-- ADR-0031 deploy-side: enable pg_trgm and add GIN trigram indexes for fuzzy/ranked search.
-- These indexes back the similarity() + GREATEST(similarity(...)) ORDER BY in listItemsPage
-- when a search query is present. The extension is idempotent (IF NOT EXISTS).
-- Indexes are CONCURRENTLY-safe to add on a live DB; the migration applies them without locking
-- reads/writes (Supabase runs migrations in a single transaction by default — if that blocks,
-- apply this out-of-band with CREATE INDEX CONCURRENTLY after the extension is enabled).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "items_name_trgm_idx" ON "items" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "items_brand_trgm_idx" ON "items" USING gin ("brand" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "items_model_trgm_idx" ON "items" USING gin ("model" gin_trgm_ops);
