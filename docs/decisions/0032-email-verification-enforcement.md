# ADR-0032 — Email-verification enforcement

**Status:** Accepted
**Date:** 2026-06-26
**Phase:** Closet-first pivot, security hardening (the half of workstream D the parallel batch left out).

---

## Context

The product study flagged: "any email can sign up unverified today." The signup flow already shows a
"check your email to confirm" message and (with Supabase's "Confirm email" setting ON) creates no session
until confirmation — so the *happy path* was fine. The GAP was **enforcement**: `getCurrentUserId()`
returned `user?.id` without ever checking `email_confirmed_at`. So if the Supabase toggle were OFF (or
drifted), or a session existed for an unconfirmed account, that account got full app access.

## Decision

App-layer, defense-in-depth enforcement — gated behind `isAuthConfigured()` so the dev/hermetic
passthrough is byte-for-byte unchanged:

1. **The gate.** `isEmailVerified(user)` = `Boolean(email_confirmed_at || confirmed_at)` (email/password
   sets `email_confirmed_at` on confirm; OAuth arrives pre-confirmed). `getCurrentUserId()` now returns
   the id ONLY for a verified account — an unconfirmed account reads as "no user", so `requireUserId()`
   and `getUserIdOrGuest()` gate it out exactly like no session. This holds **even if Supabase's "Confirm
   email" setting is off** — the app does not trust the provider config alone.
2. **The wall.** `src/middleware.ts`: a signed-in but unconfirmed account (`user && !isEmailVerified(user)`)
   is redirected to `/verify-email` for any non-public route, carrying the refreshed session cookies (the
   same Set-Cookie preservation the `/login` redirect uses, to avoid the mobile-Safari refresh loop). This
   runs before the guest clauses because an unconfirmed user HAS a session.
3. **The surface.** New public `/verify-email` page: shows the pending email, a **resend** confirmation
   action (rate-limited on the per-IP `signup` budget — the ADR-0030/parallel-batch limiter), a sign-out
   ("wrong account?"), and a "continue" link. `getSessionUser()` is a new raw, **ungated** identity
   accessor (returns the unconfirmed user's email so the page can resend) — distinct from the verification-
   gated `getCurrentUserId()`.

Dual-layer by design (middleware redirect + action-level `requireUserId` gate), matching the existing
auth posture (app-layer WHERE + RLS).

## Consequences
- **Unconfirmed accounts cannot use the app** — they are funneled to `/verify-email` until they confirm.
  Existing unconfirmed accounts (from a period when confirmation may have been off) are also caught and
  must confirm — the intended security outcome.
- **Hermetic gate unchanged:** with no Supabase env, `isAuthConfigured()` is false → `getSessionUser()`
  returns the fixed dev user as verified, `getCurrentUserId()` returns it, middleware passes through,
  `/verify-email` redirects home. `test/auth-email-verify.test.ts` asserts this explicitly so the
  enforcement can never silently break the offline app.
- **Flipped a guarding test:** `test/auth.guest.test.ts` mocked a session with no confirmation timestamp
  and asserted the OLD "session = authed" contract. Updated to the new contract — a CONFIRMED session
  resolves to the real id; an UNCONFIRMED one is gated to guest / redirected — plus new unconfirmed cases.
  679 tests green.

## Deploy-gated activation
- Enable **"Confirm email"** in Supabase Auth settings, and ensure the confirmation email template + the
  project **Site URL / redirect** are configured (the default hosted-verify link is used; there is no app
  `/auth/confirm` PKCE route — not introduced here to avoid an email-template change).
- The enforcement itself is live in code regardless of the toggle (that is the defense-in-depth point);
  runtime behavior must be verified on a Supabase-connected env (the sandbox has no auth configured).

## Alternatives considered
- **Rely on the Supabase "Confirm email" toggle alone** — rejected: a single config switch with no app-
  side backstop is exactly the drift risk the gap describes.
- **Add an `/auth/confirm` PKCE route + `verifyOtp`** — cleaner long-term, but requires changing the
  Supabase email template to a token_hash link. Deferred; the default hosted-verify flow works today.
