# ADR-0033 — Read-only shared-trip link (the "ship AND share" wedge)

**Status:** Accepted (v1-readiness audit: the minimum shareable artifact)
**Date:** 2026-06-29
**Migration:** `drizzle/0011_trip_share_token.sql` — applied to the Armarium Supabase project via the
Management API (recorded as migration `trip_share_token`).

---

## Context

Nothing in Armarium was shareable — defeating the owner's "proud to ship AND share" bar. The natural
advocacy unit is a planned trip: a packing checklist computed over the user's REAL gear (the wedge no
generic packing tool has). The challenge: share it without exposing the owner's closet or other trips,
and without breaking the dual-layer tenant isolation (every `trips` row is `user_id`-scoped; the app
connects as the RLS-bypassing owner role, so the app-layer `WHERE user_id` is the SOLE live isolation).

## Decision

A read-only, **token-addressed** public page.

- **Schema:** `trips.share_token text unique` (null = not shared).
- **Capability = the token.** `setTripShareToken(userId, id, token)` is USER-SCOPED (only the owner can
  enable). `getTripByShareToken(token)` is deliberately NOT user-scoped — the unguessable 144-bit
  base64url token IS the capability. The cross-tenant tripwire registers both: the setter as user-scoped,
  the getter as public-by-design (documented like `putDraft`), with an explicit isolation test proving B
  cannot enable sharing on A's trip and that only the exact token resolves it.
- **Public surface:** `enableTripShare(id, userId)` mints an idempotent token (stable link). The public
  `/t/[token]` route resolves the trip and recomputes its `PackingPlan` over the OWNER's closet,
  **read-only** — the viewer sees the owner's picks + gaps for THIS trip, never a browsable closet or
  other trips. `/t` is added to the middleware public-paths. A bad/expired token → 404.
- **UX:** the trip dossier shows a "Create share link" control (server action `shareTripAction`); once
  shared, a `ShareLink` client component renders the absolute URL + a copy button. The public page ends
  with a "plan your own trip" CTA to convert a viewer.

## Consequences
- **The wedge is now shareable:** a friend opens `/t/<token>` → sees a real gear-aware packing list →
  CTA to build their own. The "and share" half of the bar is met with the minimum surface.
- **Isolation intact:** the token gates access; the owner's wider data is never exposed; the app-layer
  user scope on every other method is unchanged (697 tests, incl. the new cross-tenant share test).
- **Deploy-side verified:** the migration is applied + recorded on the live Supabase project (the column
  exists; the UNIQUE constraint references it). The memory repo mirrors the contract for dev/CI/tests.

## Deferred (small follow-ups)
- **OG/social image** (`/t/[token]/opengraph-image.tsx`) so the link unfurls with the trip name +
  "N items · X in closet" — the "wow" in iMessage/Slack. Functional sharing ships now; the unfurl
  preview is a quick additive pass.
- A "stop sharing" control (clear the token) — the setter already accepts `null`; only the UI affordance
  is pending.
- Share-a-closet (vs a single trip) remains explicitly post-v1.
