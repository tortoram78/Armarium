-- ============================================================================================
-- OUT-OF-BAND storage setup for display-only item photos (Phase 3 / ADR-0018).
--
-- Companion to drizzle/0007_sad_william_stryker.sql (which adds items.image_path). This file is NOT a
-- Drizzle-managed migration and is NOT in drizzle/meta/_journal.json — `drizzle-kit migrate` does NOT
-- and MUST NOT run it. It touches the `storage` schema (storage.buckets / storage.objects), owned by
-- Supabase's `supabase_storage_admin` role, NOT the `postgres` role drizzle-kit connects as.
--
-- HOW IT IS APPLIED: the orchestrator runs these statements ONCE on the live Supabase project via the
-- Supabase Management API (or the dashboard SQL editor) — the same out-of-band path the 0003 RLS
-- policies use (the cloud sandbox cannot reach raw Postgres on 5432/6543, and the storage schema needs
-- elevated ownership anyway). It is IDEMPOTENT (ON CONFLICT / DROP POLICY IF EXISTS) and re-runnable.
--
-- PRIVATE bucket: public=false → objects have NO public URL. Every read is a short-lived signed URL
-- minted by the SERVICE_ROLE storage client (src/server/item-images.ts → getSignedItemImageUrl).
--
-- PATH SCHEME — the contract the upload UI + the signing helper must BOTH honour:
--     <user_id>/<item_id>/<uuid>.<ext>
-- The RLS policies below key the FIRST path segment to the owner's auth.uid(), so an authenticated user
-- can only read/write objects under their own `<user_id>/` prefix. buildItemImageObjectPath(userId,
-- itemId, ext) in src/server/item-images.ts is the SINGLE constructor of this scheme — keep them in sync.
--
-- ISOLATION MODEL (mirrors the DB RLS note in 0003 + postgres-repo.ts): the signing helper connects with
-- the SERVICE_ROLE key, which BYPASSES storage RLS. These policies therefore protect the public/
-- authenticated (anon + logged-in PostgREST) storage surface only; for app traffic the live isolation is
-- the service-role signing + the user-scoped `WHERE user_id` item read that yields image_path. Per-user
-- folder RLS is the defense-in-depth layer for any direct (non-service-role) storage access.
-- ============================================================================================

-- 1. The private bucket. Idempotent: a re-run leaves an existing bucket untouched.
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', false)
on conflict (id) do nothing;

-- 2. Per-user-folder RLS on storage.objects, scoped to this bucket. (storage.objects already has RLS
--    enabled by Supabase.) Each policy requires: the object is in `item-images` AND its first path
--    segment equals the caller's uid — i.e. the `<user_id>/...` prefix matches the logged-in user.
--    auth.uid() is wrapped in (select auth.uid()) per Supabase perf guidance and cast to text to compare
--    against the (text) folder segment.

drop policy if exists "item_images_insert_own" on storage.objects;
create policy "item_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "item_images_select_own" on storage.objects;
create policy "item_images_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "item_images_update_own" on storage.objects;
create policy "item_images_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "item_images_delete_own" on storage.objects;
create policy "item_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
