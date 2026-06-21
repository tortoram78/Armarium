-- Phase 3 step 1: enable Postgres Row-Level Security + ownership policies.
-- The app connects as the 'postgres' role (table OWNER) which bypasses RLS;
-- these policies protect the public PostgREST/anon endpoint only.
-- All auth.uid() calls are wrapped in (select auth.uid()) per Supabase perf guidance.

-- ============================================================
-- 1. User-owned tables: items, trips, pending_facets
-- ============================================================

ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "items_owner" ON "items";
--> statement-breakpoint
CREATE POLICY "items_owner" ON "items"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
--> statement-breakpoint

ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "trips_owner" ON "trips";
--> statement-breakpoint
CREATE POLICY "trips_owner" ON "trips"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
--> statement-breakpoint

ALTER TABLE "pending_facets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "pending_facets_owner" ON "pending_facets";
--> statement-breakpoint
CREATE POLICY "pending_facets_owner" ON "pending_facets"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
--> statement-breakpoint

-- ============================================================
-- 2. Item subtype tables (keyed by item_id, no user_id column)
--    Access is gated through the parent items row.
-- ============================================================

ALTER TABLE "item_carry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_carry_owner" ON "item_carry";
--> statement-breakpoint
CREATE POLICY "item_carry_owner" ON "item_carry"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_carry".item_id AND i.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_carry".item_id AND i.user_id = (select auth.uid())));
--> statement-breakpoint

ALTER TABLE "item_footwear" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_footwear_owner" ON "item_footwear";
--> statement-breakpoint
CREATE POLICY "item_footwear_owner" ON "item_footwear"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_footwear".item_id AND i.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_footwear".item_id AND i.user_id = (select auth.uid())));
--> statement-breakpoint

ALTER TABLE "item_insulation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_insulation_owner" ON "item_insulation";
--> statement-breakpoint
CREATE POLICY "item_insulation_owner" ON "item_insulation"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_insulation".item_id AND i.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_insulation".item_id AND i.user_id = (select auth.uid())));
--> statement-breakpoint

ALTER TABLE "item_shell" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_shell_owner" ON "item_shell";
--> statement-breakpoint
CREATE POLICY "item_shell_owner" ON "item_shell"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_shell".item_id AND i.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_shell".item_id AND i.user_id = (select auth.uid())));
--> statement-breakpoint

ALTER TABLE "item_sleep" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_sleep_owner" ON "item_sleep";
--> statement-breakpoint
CREATE POLICY "item_sleep_owner" ON "item_sleep"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_sleep".item_id AND i.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_sleep".item_id AND i.user_id = (select auth.uid())));
--> statement-breakpoint

ALTER TABLE "item_treatments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "item_treatments_owner" ON "item_treatments";
--> statement-breakpoint
CREATE POLICY "item_treatments_owner" ON "item_treatments"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_treatments".item_id AND i.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = "item_treatments".item_id AND i.user_id = (select auth.uid())));
--> statement-breakpoint

-- ============================================================
-- 3. Shared reference tables: materials, treatments
--    Read-only for authenticated; writes only via owner/service connection.
-- ============================================================

ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "materials_read" ON "materials";
--> statement-breakpoint
CREATE POLICY "materials_read" ON "materials"
  FOR SELECT TO authenticated
  USING (true);
--> statement-breakpoint

ALTER TABLE "treatments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "treatments_read" ON "treatments";
--> statement-breakpoint
CREATE POLICY "treatments_read" ON "treatments"
  FOR SELECT TO authenticated
  USING (true);
--> statement-breakpoint

-- ============================================================
-- 4. classification_cache — fully locked to owner/service connection.
--    No policies: the public API cannot read or write this table.
-- ============================================================

ALTER TABLE "classification_cache" ENABLE ROW LEVEL SECURITY;
