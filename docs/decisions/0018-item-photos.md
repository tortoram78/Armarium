# ADR-0018 — Item photos: display-only, private Supabase Storage, signed-URL delivery

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 3 (unlocked backlog item; gated per ADR-0009)

---

## Context

ADR-0009 (2026-06-21) moved image-upload / photo enrichment from a hard block to an unlocked
backlog. The unlock condition is explicit: each unlocked item still requires its own `DESIGN.md`
update + ADR(s) + the dependency/infra decision before any implementation. This ADR is that gate
for item photos.

### Why photos now

Phase 3 steps 1–3 (real auth + multi-user, manufacturer URL enrichment, weather auto-conditions)
are in delivery. Auth is the prerequisite for any per-user file storage: without `auth.uid()` to
derive the storage path, cross-user file isolation is not enforceable. Phase 3 step 1 satisfies
that prerequisite.

The immediate product motivation is **richer closet cards and item spec sheets.** The current UI
displays items as text-only cards. A primary item photo — the garment hung up, the pack laid flat
— dramatically improves the ability to identify and distinguish items at a glance, especially in a
closet with many similar pieces (three black softshells, two grey fleeces). This is a UX
improvement that requires no new reasoning and does not change the classification contract.

### Why display-only first

The more ambitious path would be vision-assisted enrichment: send the photo to a multimodal LLM
and extract classification claims from the image. That path is explicitly deferred. The reasons:

1. **Complexity and accuracy risk.** A photo is much weaker evidence for facets like `fill_power`,
   `seam_sealing`, or `temp_rating_standard` than a manufacturer page or a user correction. Image-
   derived "facts" would carry lower confidence than LLM inference from a product name — adding a
   new source at the bottom of the provenance hierarchy that might mislead more than it helps.

2. **The correct extension point already exists.** When vision enrichment is ready, it slots cleanly
   into the evidence resolver as a new claim source (a new `Source` value such as
   `'vision_inferred'`, sitting between `'inferred'` and `'derived_from_material'` in precedence).
   The `item_evidence` table (ADR-0014) holds competing claims per `(item_id, facet_key)`;
   vision-extracted claims would be rows in that table, resolved by the same `resolveFacet()`
   function. No architectural change is needed — the extension is purely additive.

3. **Separation of concerns.** Storage, display, and enrichment are three separate decisions.
   Getting storage and display right first, with no vision dependency, is lower risk and delivers
   user value immediately.

The user directed display-only for this phase. Vision enrichment remains unlocked (per ADR-0009)
but is explicitly deferred to a future ADR.

### Storage provider choice

The project already runs on Supabase Postgres (ADR-0006) with Supabase Auth (ADR-0008). Supabase
Storage is a natural fit: it is part of the same Supabase project, its RLS policies reference the
same `auth.uid()` function used on all other user-owned tables, and `@supabase/supabase-js` is
already a project dependency. Adding Supabase Storage introduces no new vendor and no new npm
package.

---

## Decision

### A — Storage: a private `item-images` bucket in Supabase Storage

A single private bucket named `item-images` is provisioned in the Supabase project. Objects are
stored at the path:

```
<user_id>/<item_id>/<uuid>.<ext>
```

where `<user_id>` is the authenticated user's `auth.uid()` UUID, `<item_id>` is the item's UUID,
`<uuid>` is a client-generated random UUID (preventing collisions on re-uploads), and `<ext>` is
the file extension derived from the MIME type (`jpg`, `png`, `webp`).

The bucket is **not public.** Gear photos are personal; an attacker who obtains a Storage object
key should not be able to view another user's photos without a valid session. Signed URLs (§D)
provide time-bounded access.

### B — Storage RLS: per-user-folder isolation via `auth.uid()`

Storage RLS policies on `storage.objects` (the Supabase-managed table) enforce that an
authenticated user may only INSERT, SELECT, UPDATE, and DELETE objects whose path begins with
their own `auth.uid()` prefix. The standard Supabase per-user-folder pattern:

```sql
-- SELECT: user may only read objects under their own prefix
create policy "user reads own images"
  on storage.objects for select
  using (bucket_id = 'item-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- INSERT: user may only upload objects under their own prefix
create policy "user uploads own images"
  on storage.objects for insert
  with check (bucket_id = 'item-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- UPDATE / DELETE: same constraint
create policy "user manages own images"
  on storage.objects for update using (
    bucket_id = 'item-images' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "user deletes own images"
  on storage.objects for delete using (
    bucket_id = 'item-images' and auth.uid()::text = (storage.foldername(name))[1]);
```

This is the same `auth.uid()` ownership posture as the DB RLS policies on `items`, `trips`, and
`pending_facets` (ADR-0008 §C). Neither layer is redundant: the path scheme enforces the invariant
at the storage object level; app-layer checks at the server-action boundary enforce it at the
application level.

### C — Upload: client-side direct upload via `@supabase/supabase-js` storage

The browser uploads directly to Supabase Storage using the user's session JWT (available to
`@supabase/supabase-js` in the client via the cookie session established by ADR-0008 §B). Storage
RLS enforces the path prefix at upload time.

This decision keeps multi-MB file payloads off the Next.js server-action body. Next.js App Router
server actions have a `bodySizeLimit` default (4 MB in Next.js 14). A typical gear photo is 2–8 MB;
sending it through a server action risks hitting the limit, requires server memory proportional to
the file size, and adds unnecessary latency (client → Vercel edge → Vercel function → Supabase vs
client → Supabase directly).

**Flow:**

```
1. User selects a file in the UI (client component)
2. Client validates MIME type (jpeg/png/webp) and size (≤ 5 MB) before any upload
3. Client calls supabaseClient.storage.from('item-images').upload(path, file)
   — Storage RLS enforces <user_id>/<item_id>/<uuid>.<ext> path ownership
4. On success, client receives the storage object path
5. Client calls a server action: saveImagePath(itemId, storagePath)
   — server action calls requireUserId() to authenticate
   — server action verifies the path begins with userId (defence-in-depth)
   — server action writes storagePath to items.image_path via Drizzle
```

The server action `saveImagePath` is the only network call that crosses the Next.js server layer;
it carries only the lightweight storage path string, not the file bytes.

### D — Display: server-generated short-lived signed URLs

Reading objects from a private bucket requires a signed URL. When loading the closet or an item
detail page:

1. The server (service-role Supabase client) calls
   `supabase.storage.from('item-images').createSignedUrl(imagePath, expiresIn)` for each item
   that has a non-null `image_path`.
2. Signed URLs are generated in a single batched call where the SDK permits it; otherwise in a
   `Promise.all` over the list of paths.
3. The signed URLs are passed to the UI as props (Server Component → Client Component boundary).
4. The UI renders `<img src={signedUrl} />`. The signed URL is short-lived (suggested TTL: 3600
   seconds / 1 hour — sufficient for a page session, short enough to limit exposure if leaked).

The service-role client is already available in the server layer (used for migrations and seed
operations). It is injected, never imported directly in `src/core/`.

If `image_path` is null (item has no photo), the signed-URL generation step is skipped and the UI
renders the current text-only card layout — the fallback is the existing baseline with no
degradation.

### E — Schema: `items.image_path` (migration 0007)

A single nullable text column is added to the `items` table:

```ts
imagePath: text('image_path'),  // nullable; null = no photo
```

This is migration `drizzle/0007`. Only one primary image per item in v1. Multiple images per item
(gallery, alternate views) are a deferred enhancement — the path scheme `<user_id>/<item_id>/` is
a folder-per-item and supports multiple objects when that feature is added; the schema would gain
an `image_paths: text[]` column or a separate `item_images` join table at that point.

### F — Validation: MIME type + size cap before upload

Client-side validation (in the upload component, before any network call):

- **Accepted MIME types:** `image/jpeg`, `image/png`, `image/webp`.
- **Maximum size:** 5 MB. This accommodates a typical phone camera photo while keeping Storage
  costs and load times reasonable for a personal gear manager.
- Any file that fails validation is rejected with an inline error; no upload is attempted.

Server-side, the Supabase Storage bucket is configured with the same MIME type and size limits as
a defence-in-depth measure (Supabase Storage bucket metadata settings).

### G — Hermetic gate: storage client is lazy/injected; feature degrades when unconfigured

The `@supabase/supabase-js` storage client requires `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (the same vars that gate auth). `isAuthConfigured()` (ADR-0008 §D)
is already false when those vars are absent at build time.

When `isAuthConfigured()` is false:
- The upload control in the UI is hidden/disabled (no attempt to call the storage client).
- `saveImagePath` is never called (no upload path opens to begin with).
- Signed-URL generation in the server layer returns `null` for all items regardless of
  `image_path`.
- Cards fall back to the current text-only layout.

This means the hermetic gauntlet (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`) runs
with zero environment variables and zero storage calls. Tests mock the storage client using the
same injection pattern as the Anthropic client and the database.

No new npm dependency: `@supabase/supabase-js` is already present.

### H — `user_id` invariant fully preserved

Every object in `item-images` lives under the path `<user_id>/<item_id>/`. Storage RLS (§B) and
the server-action path check (§C) together ensure no user can read, write, or delete another
user's objects. The `user_id` invariant (architecture rule #4, planted in Phase 1) extends to file
storage with the same ownership posture as the DB rows.

---

## Alternatives rejected

### Public bucket

A public Supabase Storage bucket would make objects accessible by URL without a signed URL or a
valid session — essentially world-readable once the object URL is known. Gear photos are personal
(closet contents, item condition, user preferences revealed by what they own). The signed-URL
approach costs negligible server time for a personal app at low request rates and provides the
correct privacy posture. Rejected outright.

### Server-action upload (route through Next.js server)

Send the file bytes as a `FormData` body to a Next.js server action, which then re-uploads to
Supabase Storage. This would centralize the upload path but:

- Hits the Next.js `bodySizeLimit` (default 4 MB) for typical gear photos (2–8 MB from phone
  cameras). Raising the limit is possible but non-obvious and wastes server memory.
- Adds a full round-trip through the Vercel function layer, increasing latency and egress cost.
- Provides no security benefit — the server action still needs to call Supabase Storage, so the
  service-role secret is still used server-side either way.

The client-direct upload with a lightweight server-action path-save (§C) achieves the same
security properties without the body-size and latency issues. Rejected.

### Vision enrichment now (photo as a classification claim source)

Extract classification claims from the uploaded image by passing it to a multimodal LLM call.
Deferred, not rejected outright. The reason is not capability — the Anthropic SDK already supports
vision input — but evidence quality and resolver readiness:

- Image-derived facet values would be low-confidence inferences, structurally weaker than LLM
  inference from a product name (which already has access to brand, model, and marketing copy).
  Adding a new source at or below `'inferred'` in the hierarchy adds noise more than signal at
  this stage.
- The evidence resolver (`item_evidence` table, ADR-0014) is the designed-for home for
  vision-derived claims. It is being built as part of the evidence-architecture migration (ADR-0012
  phase 3). Vision enrichment is a cleaner addition once that resolver is live.
- The user directed display-only explicitly. This deferral is a deliberate design-level choice.

When vision enrichment is added, it slots in as a new `Source` variant (e.g. `'vision_inferred'`)
feeding rows into `item_evidence`, resolved by the existing `resolveFacet()` function. No
structural change to the resolver or the schema is needed — the extension point already exists.

### Storing the signed URL in the database

Cache the signed URL itself in a database column so every page load does not need a Supabase
Storage API call. Rejected: signed URLs are time-limited; a cached URL goes stale after the TTL
and serves a 403. The correct pattern is to generate fresh signed URLs at page-load time from the
stored object path. At the low request rates of a personal gear manager, the per-request signed-
URL generation is negligible.

---

## Consequences

### What improves

**Richer closet cards and item detail.** A primary photo makes items visually distinctive. A closet
with five similar black midlayers becomes navigable at a glance; the spec sheet gains a reference
image to anchor the facet data. This is a first-class UX improvement for any user with a moderately
large closet.

**Privacy posture is correct from day one.** Private bucket + signed URLs + Storage RLS means no
photo is accessible without a valid authenticated session and a fresh signed URL. No risk of gear
inventory leaking through a guessable URL or an accidental public-ACL on an object.

**Clean future extension: vision enrichment.** The storage and display machinery is in place. When
vision enrichment is prioritized, the upload already exists; adding a server-side LLM vision call
at upload time (or as an on-demand re-analysis trigger) is a contained change. The extension point
in the resolver (`item_evidence` rows with `source:'vision_inferred'`) is designed-for.

### New operational surface to provision

Before the feature is live, the following must be provisioned in the Supabase project (these are
infrastructure steps, not code):

1. Create the `item-images` private bucket (Supabase dashboard → Storage or via SQL
   `storage.create_bucket`).
2. Apply the four Storage RLS policies (§B) via the Supabase dashboard or via a migration SQL file
   that uses the `storage` schema.
3. Configure bucket-level MIME type allowlist and size cap as defence-in-depth (Supabase bucket
   metadata settings).

The `items.image_path` column is added via migration 0007 (`pnpm db:generate` + `pnpm db:migrate`
or the Management API migrator for the cloud sandbox).

### Hermetic gauntlet is fully preserved

The storage client is never instantiated in `src/core/`, and the upload control is hidden when
`isAuthConfigured()` is false. The four gauntlet commands (`pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm build`) continue to pass with zero environment variables. Tests mock the
storage client via injection. No new npm package.

### One image per item in v1

The schema (`items.image_path` as a single nullable text column) and the UI (one upload slot) are
deliberately minimal. The path scheme `<user_id>/<item_id>/` already supports multiple objects;
a gallery view would require an `item_images` join table or a `text[]` column. That enhancement
is deferred and requires its own design decision before implementation.

### `user_id` invariant extended to storage

Every Storage object is owned by its creator by path prefix and by RLS policy. `GUEST_USER_ID`
(ADR-0016) never reaches the upload flow: the upload control is only shown to authenticated users
(`requireUserId()` guards `saveImagePath`), and Storage RLS rejects any INSERT not matching the
authenticated `auth.uid()`. Guest read-only browsing (ADR-0016) renders items from `SEED_CORPUS`;
those items carry no `image_path`, so no signed-URL call is made for guest sessions.

---

## Relationship to prior ADRs and design documents

- **ADR-0009** — the scope unlock that moved image/photo enrichment from a hard block to an
  unlocked backlog. This ADR is the required gate that ADR-0009 described ("each still requires
  its own `DESIGN.md` update + ADR(s) + the dependency/infra decision before implementation").
- **ADR-0008** — established Supabase Auth, `auth.uid()`, and the `isAuthConfigured()` / `requireUserId()`
  helpers. Storage RLS uses the same `auth.uid()` ownership posture. The `NEXT_PUBLIC_SUPABASE_*`
  vars that gate auth also gate the storage upload control.
- **ADR-0014** — the evidence store (`item_evidence` table, claims-based LLM). When vision
  enrichment is added, vision-derived claims will be rows in `item_evidence` with
  `source:'vision_inferred'`, resolved by the existing `resolveFacet()` function. The extension
  point is already designed-for; this ADR does not build it.
- **ADR-0016** — the demo guest funnel (`GUEST_USER_ID`, `getUserIdOrGuest()`). Guest sessions
  serve the `SEED_CORPUS` which carries no `image_path`; the upload control is hidden from guests
  (`requireUserId()` guards the write path). No guest traffic reaches Storage.
- **DESIGN.md §18** — documents the item photo contract (bucket, path scheme, RLS, upload flow,
  display flow, schema, hermetic gate, vision-enrichment extension point).
