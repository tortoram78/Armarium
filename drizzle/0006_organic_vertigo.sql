-- Evidence-architecture Phase 3: the item_evidence store (ADR-0012 Element 2).
--
-- One row per CLAIM (one source's assertion about one facet) — the durable, queryable backing for the
-- resolver's Claim<V> set. A facet may have several rows (one per source); the resolver groups by
-- facet_key and decides the winner via SOURCE_PRECEDENCE. Persisted with REPLACE semantics on save
-- (a re-resolution writes the current full claim set for the item).
--
-- NO DATA BACKFILL (deliberate): existing items keep their resolved `classification` jsonb as-is; this
-- table populates on each item's NEXT save (when the classify pipeline starts writing claims — a
-- separate follow-up wave). An item with no row here simply has no per-claim audit log yet.

CREATE TABLE "item_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"facet_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"extractor_version" text,
	"evidence" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_evidence" ADD CONSTRAINT "item_evidence_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_evidence_item_facet_idx" ON "item_evidence" USING btree ("item_id","facet_key");--> statement-breakpoint

-- ============================================================
-- Row-Level Security (out-of-band, mirrors drizzle/0003_enable_rls_auth.sql §2 — the item subtype
-- tables). item_evidence is keyed by item_id with NO user_id column, so access is gated through the
-- parent items row. The app connects as the 'postgres' role (table OWNER) which bypasses RLS — this
-- single FOR ALL policy protects the public PostgREST/anon endpoint only (the dual-layer model).
-- auth.uid() is wrapped in (select auth.uid()) per Supabase perf guidance.
-- ============================================================

ALTER TABLE "item_evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_evidence_owner" ON "item_evidence";
--> statement-breakpoint
CREATE POLICY "item_evidence_owner" ON "item_evidence"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_evidence".item_id AND i.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_evidence".item_id AND i.user_id = (select auth.uid())));