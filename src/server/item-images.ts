// Item-photo storage helpers (display-only — Phase 3 / ADR-0018).
//
// SCOPE: the READ/SIGN half + the canonical object-path scheme ONLY. The upload server action and the
// upload/display UI are a LATER wave — they are deliberately NOT here. This module is pure-ish server
// infra (no React, no next/* client) so it can be imported from a server action without side effects.
//
// PRIVATE bucket model: `item-images` is a PRIVATE Supabase Storage bucket (public=false — see
// drizzle/0007_item_images_storage.out-of-band.sql). Objects therefore have NO public URL; the closet
// grid and item page render a photo via a SHORT-LIVED SIGNED URL minted on demand by the service-role
// storage client below.
//
// LAZY CLIENT (matches src/server/db.ts + the postgres repos): the Supabase client is constructed on
// FIRST sign, never at import time. Importing this module reads NO env and opens NO connection, so the
// hermetic gate (typecheck/lint/test/build with zero env) stays green. When the Supabase env is absent
// (local dev / CI / build) every sign DEGRADES TO null — the UI then shows its no-photo placeholder.
//
// SERVICE-ROLE: signing a private object requires elevated credentials, so we use the SERVICE_ROLE key
// (SERVER-ONLY — never NEXT_PUBLIC). It bypasses storage RLS (like the table-owner bypass on the DB
// side); the per-user-folder storage RLS in the out-of-band SQL guards only the public/authenticated
// PostgREST storage surface. App reads stay user-scoped because image_path is only ever read from the
// user's own item row (WHERE user_id = $userId in the repo).

import { randomUUID } from "node:crypto";

/** The single source of truth for the bucket id. Must match drizzle/0007_item_images_storage.out-of-band.sql. */
export const ITEM_IMAGES_BUCKET = "item-images";

/** Signed-URL lifetime. Short-lived (1h) — long enough to render a page, short enough to not be a durable link. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Minimal structural type for the slice of the Supabase storage client we use. Avoids depending on the
// SDK's exported types at module scope (keeps the import surface tiny) while staying fully typed.
interface StorageSigner {
  from(bucket: string): {
    createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    createSignedUrls(
      paths: string[],
      expiresIn: number,
    ): Promise<{ data: Array<{ path: string | null; signedUrl: string; error: string | null }> | null; error: unknown }>;
  };
}
interface ServiceClient {
  storage: StorageSigner;
}

// Lazy singleton — constructed on first sign, never at import (see module header). null once we've
// determined the env is absent so we don't re-check every call.
let _client: ServiceClient | null = null;
let _resolved = false;

/**
 * Returns the lazily-constructed service-role Supabase client, or null when the storage env is absent
 * (so callers degrade cleanly). Reads env HERE, on first call — never at import time.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL (the project URL is not secret) + SUPABASE_SERVICE_ROLE_KEY (the
 * SERVER-ONLY service-role key). If either is missing we stay unconfigured and every sign yields null.
 */
async function getServiceClient(): Promise<ServiceClient | null> {
  if (_resolved) return _client;
  _resolved = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    _client = null;
    return null;
  }

  // Dynamic import so the SDK is pulled into the graph only when storage is actually configured and used
  // — importing THIS module stays free of the supabase-js dependency for the no-env gate.
  const { createClient } = await import("@supabase/supabase-js");
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ServiceClient;
  return _client;
}

/**
 * Mint a short-lived signed URL for a private item photo.
 *
 * Returns null when:
 *   - `imagePath` is null (the item simply has no photo), OR
 *   - Supabase storage is not configured (no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY —
 *     dev / CI / the hermetic gate), OR
 *   - the storage API errors (a deleted/renamed object, a transient failure).
 * Never throws — a missing photo is a degraded render, not an error (consistent with unknown-is-first-class).
 */
export async function getSignedItemImageUrl(imagePath: string | null): Promise<string | null> {
  if (!imagePath) return null;
  const client = await getServiceClient();
  if (!client) return null;
  try {
    const { data, error } = await client.storage
      .from(ITEM_IMAGES_BUCKET)
      .createSignedUrl(imagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Batch variant for the closet grid: sign many paths in one round-trip, returning a Map keyed by the
 * INPUT path → signed URL (or null). A null/absent input path is preserved as a null entry; an
 * unconfigured environment yields all-null. Never throws.
 *
 * The returned Map is keyed by the bucket-relative object path (the `imagePath` you passed in), so a
 * caller can look up `urls.get(item.imagePath)` directly.
 */
export async function getSignedItemImageUrls(
  paths: ReadonlyArray<string | null>,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const real = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (real.length === 0) return result;

  const client = await getServiceClient();
  if (!client) {
    for (const p of real) result.set(p, null);
    return result;
  }

  try {
    const { data, error } = await client.storage
      .from(ITEM_IMAGES_BUCKET)
      .createSignedUrls(real, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      for (const p of real) result.set(p, null);
      return result;
    }
    for (const entry of data) {
      if (entry.path) result.set(entry.path, entry.error ? null : entry.signedUrl);
    }
    // Any path the API didn't return a row for resolves to null.
    for (const p of real) if (!result.has(p)) result.set(p, null);
    return result;
  } catch {
    for (const p of real) result.set(p, null);
    return result;
  }
}

/**
 * Build the canonical object path for an item photo: `<user_id>/<item_id>/<uuid>.<ext>`.
 *
 * This is the SINGLE place the storage path scheme is constructed — the upload action (a later wave) and
 * the path-store both call this so the column value and the per-user-folder storage RLS (which keys the
 * FIRST segment to the owner's uid — see drizzle/0007_item_images_storage.out-of-band.sql) never drift.
 *
 * The `<user_id>` first segment is what the storage RLS matches against auth.uid(); the random `<uuid>`
 * filename avoids collisions and makes re-uploads cache-bust. `ext` is normalized (lowercased, leading
 * dot + non-alphanumerics stripped) and defaults to "jpg".
 */
export function buildItemImageObjectPath(userId: string, itemId: string, ext = "jpg"): string {
  const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${userId}/${itemId}/${randomUUID()}.${clean}`;
}
