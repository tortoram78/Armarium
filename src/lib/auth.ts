/**
 * Auth helpers — Supabase Auth (Phase 3) with a graceful dev-mode fallback.
 *
 * When NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are absent
 * (local dev / CI / build), the app runs without a gate and every call returns
 * the default dev user id — identical to the v0 in-memory behaviour.
 *
 * Structure: OAuth can be added later as a small additive change to the same
 * Supabase client — no architectural changes required.
 *
 * IMPORTANT: Do NOT import from src/server/services.ts here — that module pulls
 * in @anthropic-ai/sdk which uses node: builtins, and auth.ts is used from
 * the layout (server component) which would leak those into the client bundle.
 * Instead read the same env var that services.ts reads.
 */

import { redirect } from "next/navigation";

/**
 * Same default as services.ts DEFAULT_USER_ID — kept in sync by convention.
 * This avoids importing the server-only services module into auth.ts.
 */
const DEFAULT_USER_ID =
  process.env.ARMARIUM_USER_ID ?? "00000000-0000-0000-0000-000000000001";

/**
 * True iff both Supabase env vars are present. When false the app runs in
 * dev/passthrough mode — no auth gate, single fixed user.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Returns the authenticated user's UUID, or null if not authenticated.
 * When auth is not configured (dev/in-memory mode) always returns DEFAULT_USER_ID.
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (!isAuthConfigured()) {
    return DEFAULT_USER_ID;
  }
  // Dynamic import keeps the supabase client (and next/headers) out of the
  // module graph when auth is unconfigured, ensuring build/typecheck stay clean.
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Returns the authenticated user's UUID, or redirects to /login.
 * When auth is not configured (dev/in-memory mode) always returns DEFAULT_USER_ID.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/login");
  }
  return userId;
}
