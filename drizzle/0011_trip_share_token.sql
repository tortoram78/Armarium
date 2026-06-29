-- ADR-0033: read-only public shared-trip links. Add an unguessable share token to trips.
-- Null = not shared; the token is the sole capability for the public /t/[token] page.

ALTER TABLE "trips" ADD COLUMN "share_token" text;
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_share_token_unique" UNIQUE("share_token");
