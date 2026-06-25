import { createBrowserClient } from "@supabase/ssr";

/**
 * Whether the browser-side Supabase env is present. The two `NEXT_PUBLIC_*` vars are inlined at BUILD
 * time, so this reflects the build-time config (the hermetic build leaves them absent → false). The
 * photo-upload control reads this to DEGRADE GRACEFULLY: when false it hides the picker entirely rather
 * than constructing a non-functional client.
 */
export function isSupabaseBrowserConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Creates a Supabase browser client.
 * Safe to import when env vars are absent — the client simply won't be functional,
 * but module evaluation never throws.
 *
 * Prefer `getBrowserSupabase()` (below) for new code: it returns null when unconfigured so a caller can
 * degrade. This bare constructor is kept for the auth flows (e.g. update-password) that already assume a
 * configured project.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Returns a Supabase browser client, or null when the browser env is absent (dev / CI / the hermetic
 * build). Use this for the photo upload: a null client means "storage isn't configured" and the UI hides
 * its upload affordance instead of attempting an upload that would throw. The client carries the user's
 * cookie session, so Storage RLS enforces the per-user-folder path at upload time (ADR-0018 §C).
 */
export function getBrowserSupabase(): ReturnType<typeof createBrowserClient> | null {
  if (!isSupabaseBrowserConfigured()) return null;
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
