ALTER TABLE "trips" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "items_user_keyset_idx" ON "items" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trips_user_idx" ON "trips" USING btree ("user_id");