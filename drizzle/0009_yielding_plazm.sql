CREATE TABLE "collection_items" (
	"collection_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_items_collection_id_item_id_pk" PRIMARY KEY("collection_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "user_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_items_item_idx" ON "collection_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "collections_user_idx" ON "collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_user_tags_idx" ON "items" USING gin ("user_tags");
--> statement-breakpoint

-- ============================================================
-- RLS: collections (user-owned; mirrors the items/trips pattern from 0003_enable_rls_auth.sql)
-- ============================================================

ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "collections_owner" ON "collections";
--> statement-breakpoint
CREATE POLICY "collections_owner" ON "collections"
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
--> statement-breakpoint

-- ============================================================
-- RLS: collection_items (no user_id column; access gated via parent collections row —
--      mirrors the item subtype table pattern from 0003_enable_rls_auth.sql)
-- ============================================================

ALTER TABLE "collection_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "collection_items_owner" ON "collection_items";
--> statement-breakpoint
CREATE POLICY "collection_items_owner" ON "collection_items"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "collections" c
    WHERE c.id = "collection_items".collection_id
      AND c.user_id = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "collections" c
    WHERE c.id = "collection_items".collection_id
      AND c.user_id = (select auth.uid())
  ));