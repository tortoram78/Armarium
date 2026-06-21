ALTER TABLE "items" ADD COLUMN "classification" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;