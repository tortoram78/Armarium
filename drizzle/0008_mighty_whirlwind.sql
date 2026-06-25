ALTER TABLE "items" ADD COLUMN "ownership_status" text DEFAULT 'owned' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "acquired_at" date;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "price_paid_cents" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "acquired_from" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "storage_location" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "user_notes" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "domains" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "items_domains_idx" ON "items" USING gin ("domains");--> statement-breakpoint
-- Backfill: catalog-only rows (in_inventory = false) should reflect 'wishlist', not 'owned'.
-- The new column defaults to 'owned' which is correct for rows where in_inventory = true;
-- this corrects the catalog-only rows that existed before the inventory layer was introduced.
UPDATE "items" SET "ownership_status" = 'wishlist' WHERE "in_inventory" = false;