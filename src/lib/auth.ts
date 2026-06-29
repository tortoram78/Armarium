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
 * The reserved GUEST identity for the demo → "log in to save" funnel.
 *
 * A FIXED, in-memory-ONLY UUID, deliberately DISTINCT from DEFAULT_USER_ID. It exists ONLY when auth is
 * configured AND no session is present, so a logged-out visitor can browse + plan against the sample
 * closet. It is NEVER written to Postgres and NEVER performs a write: ALL writes stay behind
 * `requireUserId()` (which still redirects to /login). The guest closet is the SEED_CORPUS, auto-seeded
 * into the in-memory repo (DATA, not special-case logic). The server layer (services.ts) forces every
 * guest READ onto the memory repository so this id can never touch the database (rule #4 — user_id
 * isolation: a guest is not a Postgres tenant).
 *
 * Re-exported from src/server/services.ts so all server modules share this one constant.
 */
export const GUEST_USER_ID = "00000000-0000-0000-0000-000000000999";

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
 * True iff the account's email is confirmed. Email/password sign-ups set `email_confirmed_at` ONLY after
 * the user clicks the confirmation link; OAuth/provider identities arrive pre-confirmed (`confirmed_at`).
 * An unconfirmed account is NOT granted app access (see getCurrentUserId) — this is the app-layer
 * enforcement that holds even if Supabase's "Confirm email" toggle is off or drifts (defense-in-depth).
 */
export function isEmailVerified(
  user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null | undefined,
): boolean {
  return Boolean(user && (user.email_confirmed_at || user.confirmed_at));
}

export interface SessionUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * The raw session identity, UNGATED by email verification — used by the /verify-email surface, which must
 * read an unconfirmed user's email to resend the confirmation link. Dev/passthrough (auth unconfigured)
 * returns the fixed dev user, treated as verified. Returns null when configured and there is no session.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isAuthConfigured()) {
    return { id: DEFAULT_USER_ID, email: null, emailVerified: true };
  }
  const { createClient } = await import("@/lib/supabase/server");
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null, emailVerified: isEmailVerified(user) };
}

/**
 * Returns the authenticated user's UUID, or null if not authenticated.
 * When auth is not configured (dev/in-memory mode) always returns DEFAULT_USER_ID.
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (!isAuthConfigured()) {
    return DEFAULT_USER_ID;
  }
  // ENFORCE email verification: an unconfirmed account reads as "no user", so requireUserId() /
  // getUserIdOrGuest() gate it out and middleware funnels it to /verify-email. Defense-in-depth — this
  // app-layer check holds even if the Supabase "Confirm email" setting is disabled.
  const u = await getSessionUser();
  return u && u.emailVerified ? u.id : null;
}

/**
 * Resolve the identity for a READ-ONLY browse/plan request — the demo → "log in to save" funnel.
 *
 * Three states, constructed explicitly (NOT inferred from runtime env in tests — isAuthConfigured()
 * reads NEXT_PUBLIC_* which are inlined at BUILD time):
 *   - auth NOT configured (dev/CI/hermetic gate) → { DEFAULT_USER_ID, isGuest: false }  (passthrough
 *     unchanged — the single fixed dev user, exactly as before this funnel).
 *   - configured + a real session                → { realUserId, isGuest: false }.
 *   - configured + NO session                    → { GUEST_USER_ID, isGuest: true }      (logged-out
 *     visitor browsing the sample closet).
 *
 * This is the gate for READS only. It NEVER redirects. `requireUserId()` is unchanged and remains the
 * gate for ALL writes (still redirects to /login). A caller that resolves `isGuest: true` must offer
 * read/plan, never persist — the write path goes through `requireUserId()`, which redirects a guest.
 */
export async function getUserIdOrGuest(): Promise<{
  userId: string;
  isGuest: boolean;
}> {
  if (!isAuthConfigured()) {
    // Dev/passthrough: no auth, single fixed user. Identical to pre-funnel behaviour.
    return { userId: DEFAULT_USER_ID, isGuest: false };
  }
  const userId = await getCurrentUserId();
  if (userId) {
    return { userId, isGuest: false };
  }
  // Configured but no session → a guest browsing the in-memory sample closet.
  return { userId: GUEST_USER_ID, isGuest: true };
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
