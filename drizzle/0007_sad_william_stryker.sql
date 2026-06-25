-- Phase 3 / ADR-0018: display-only item photos (Supabase Storage, PRIVATE bucket + signed URLs).
--
-- This Drizzle-managed migration adds ONLY the `image_path` column (the object path in the private
-- `item-images` bucket, or null when no photo). The STORAGE setup (the private bucket + the per-user
-- storage.objects RLS policies) lives OUT-OF-BAND in the sibling file
--   drizzle/0007_item_images_storage.out-of-band.sql
-- because those statements touch the `storage` schema, owned by Supabase's `supabase_storage_admin`
-- role — NOT the `postgres` migration role drizzle-kit connects as. The orchestrator applies that
-- sibling on the live project via the Supabase Management API, exactly like the 0003 RLS policies.

ALTER TABLE "items" ADD COLUMN "image_path" text;
