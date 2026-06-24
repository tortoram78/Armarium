# ADR-0016 — Demo guest funnel: seeded sample closet + "log in to save" wall

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 3 step 1 (addendum to ADR-0008 auth delivery)

---

## Context

ADR-0008 delivered Supabase Auth, cookie sessions, and the dual-layer enforcement model. The
immediate consequence of real auth is that every surface hard-redirects unauthenticated visitors
to `/login` — a first-time visitor lands on the sign-in page with no chance to evaluate the tool
before committing an account. This is a conversion anti-pattern for a personal gear manager: the
value proposition (browse your closet, run the planner, see packing advice) can only be understood
by experiencing the tool.

### What is true today (when auth is configured)

- `requireUserId()` is called on every route and server action.
- An unauthenticated visitor is redirected to `/login` immediately on the first request.
- There is nothing to try before signing up.

### What the funnel narrowly enables

A guest (unauthenticated visitor when `isAuthConfigured()` returns true) can:

- Browse a seeded sample closet (the `SEED_CORPUS` auto-seeded under a reserved `GUEST_USER_ID`).
- View item detail pages from that sample closet.
- Open the plan form and enter trip conditions.
- See a packing recommendation preview (the real `planTrip` engine run against the sample closet).

A guest cannot:

- Add, edit, or delete items.
- Enrich items.
- Save, rename, clone, or delete trips.
- Perform any operation that reaches `requireUserId()`.

Every write surface remains behind `requireUserId()`. The narrowing is read-only: the existing
write gates are unchanged; the guest funnel merely relaxes the hard-redirect on the surfaces
listed above.

### Design constraints

Three constraints from existing ADRs are non-negotiable:

1. **No hardcoded buckets or trips (architecture rule #1, ADR-0001).** The sample closet must be
   real data reasoned over by the real engine — not a static list or a hardcoded output.
2. **`user_id` from day one on every user-owned row (architecture rule #4).** The `GUEST_USER_ID`
   must be a well-formed UUID that satisfies the schema invariant without touching Postgres.
3. **The hermetic gauntlet requires zero env (engineering lesson).** Guest mode is a build-time
   and runtime consequence of `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   being present. In a build without those vars, `isAuthConfigured()` is false at build time
   (see the `NEXT_PUBLIC_*` engineering lesson), so the dev passthrough takes effect and guest
   mode is simply never entered. The gauntlet remains secret-free.

---

## Decision

### A — Guest identity: `GUEST_USER_ID`, a reserved constant distinct from `DEFAULT_USER_ID`

A new constant `GUEST_USER_ID` (a fixed UUID, never equal to `DEFAULT_USER_ID`) is the identity
under which all guest activity runs. It is distinct from `DEFAULT_USER_ID` for an explicit reason:
`DEFAULT_USER_ID` is the Phase 2 / dev-passthrough identity used when auth is not configured.
Sharing that UUID with the guest path would conflate two conceptually different modes, make it
impossible to tell whether a row was created in dev mode or by a guest, and pollute the dev
identity with sample-closet data.

`GUEST_USER_ID` is a reserved constant in `src/core/` (pure; no I/O; no `next/*`). It never
reaches Postgres (see §C).

### B — `getUserIdOrGuest()`: a new helper alongside the existing helpers

The existing helpers from ADR-0008 §D are unchanged:

- `isAuthConfigured()` — reads the build-time presence of Supabase env vars.
- `getCurrentUserId()` — real user UUID when session present; `DEFAULT_USER_ID` otherwise.
- `requireUserId()` — same as `getCurrentUserId()` but redirects/throws when auth is configured
  and no session exists. **This helper is unchanged. It remains the gate for ALL writes.**

A fourth helper is added:

- `getUserIdOrGuest()` — returns `{ userId: string; isGuest: boolean }`.
  - When `isAuthConfigured()` is false: returns `{ userId: DEFAULT_USER_ID, isGuest: false }`.
  - When `isAuthConfigured()` is true and a valid session exists: returns `{ userId: <auth.uid()>, isGuest: false }`.
  - When `isAuthConfigured()` is true and NO valid session exists: returns `{ userId: GUEST_USER_ID, isGuest: true }`.

Read-only surfaces (closet, item detail, plan form, plan preview) call `getUserIdOrGuest()`.
Write surfaces (add item, enrich, save trip, all trip CRUD) continue to call `requireUserId()`.
No existing call site changes. No existing write gate is touched.

### C — The sample closet: `SEED_CORPUS` seeded under `GUEST_USER_ID` in the in-memory repo

The guest sample closet is the existing `SEED_CORPUS` (the same seed data used for dev/offline
mode), seeded lazily into the in-memory repository under `GUEST_USER_ID`. This is data, not
special-case logic. The sample items occupy real facets; the real `planTrip` engine runs against
them; packing advice emerges from facet reasoning — not from a hardcoded list of picks.

This preserves architecture rule #1: no hardcoded buckets, no hardcoded trip output, no
special-cased items. The guest planner is the real planner on real (seed) data.

**Guest reads are forced onto the in-memory repo even when `DATABASE_URL` is set.**

When `isGuest: true`, the request handler uses the in-memory repository regardless of the
`DATABASE_URL` environment variable. This is the load-bearing isolation guarantee:

- `GUEST_USER_ID` never appears as a `user_id` in Postgres. No guest read reaches the DB.
- No guest write is possible (`requireUserId()` gates all writes and never returns `GUEST_USER_ID`).
- The in-memory repo is ephemeral and scoped to the server process; guest activity leaves no
  durable trace.

This satisfies architecture rule #4 (`user_id` from day one) without violating it: `GUEST_USER_ID`
is a valid UUID that satisfies the schema invariant in-memory, but it is never inserted into any
Postgres table.

### D — Write wall: "log in to save" replaces the redirect

When a guest attempts a write — saving a trip is the primary case — the existing `requireUserId()`
guard redirects to `/login`. The write surface does not silently succeed; it bounces.

The "log in to save" control is the mechanism that makes the wall discoverable without being
punishing:

- On the plan preview page, a guest sees the packing recommendation but the "Save trip" action
  is replaced with a "Log in to save" button.
- Clicking "Log in to save" navigates to `/login?next=/plan&conditions=<encoded>`, where
  `<encoded>` is the entered trip conditions serialized as a URL-safe parameter.
- After sign-in, the plan form is pre-filled from the `conditions` parameter so the user does not
  have to re-enter them.

This is the **conditions-as-prefill** approach. No trip is auto-created on login.

### E — Work survival on login: conditions-as-prefill, NOT auto-planAndSave

An alternative considered was an auto-`planAndSave` bridge: on login, the app detects the
`conditions` param, automatically runs `planTrip`, saves the result, and redirects to the saved
trip. This is deferred (see §Alternatives). The decision here is prefill only: the user sees the
conditions they entered, runs the planner explicitly from the pre-filled form, and saves through
the normal flow. This is one extra click but avoids the complexity and risk of a non-idempotent
on-login side-effect. The deferral is explicit and design-level — the prefill mechanism is the
foundation the bridge would build on if added later.

---

## Alternatives rejected

### Static hardcoded sample list (no real engine)

Show the guest a static HTML mock of a closet and a static "example packing list." This is the
simplest implementation but is the anti-pattern this project exists to avoid (architecture rule #1):
hardcoded buckets and hardcoded trip outputs. It would also misrepresent the product — the guest
would not experience the real `conditions → capabilities` reasoning. Rejected.

### Attribute guest activity to `DEFAULT_USER_ID`

Use the existing `DEFAULT_USER_ID` for guest sessions so no new constant is needed. Rejected
because:

- `DEFAULT_USER_ID` is the dev passthrough identity. Attributing guest activity to it merges two
  conceptually distinct modes.
- In a deployment where `DATABASE_URL` is set, any write that slipped through to `DEFAULT_USER_ID`
  would reach Postgres under the dev identity. The explicit `GUEST_USER_ID` constant makes it
  mechanically impossible to confuse the two paths and easier to audit.
- ADR-0013 rejected attributing unknown rows to `DEFAULT_USER_ID` for the same reason: the correct
  interpretation of "not a real user" is a distinct reserved constant, not a dev placeholder.

### Auto-`planAndSave` on login (the bridge)

On login, detect the `conditions` query parameter, call `planTrip` automatically, persist the
result, and redirect to the saved trip. This preserves the guest's full flow without requiring a
re-submission. Deferred (not rejected outright) because:

- It introduces a non-idempotent side effect on the login redirect. If the login redirect fires
  more than once (e.g. a double-submit, a retry, or a session refresh), duplicate trips are created.
- The conditions string must survive the OAuth/cookie round-trip reliably, which is not trivial
  with the `@supabase/ssr` redirect flow.
- The prefill approach achieves the same UX goal (no re-entry of conditions) with one extra
  explicit click and no implicit server-side action.

The prefill URL parameter is the foundation the bridge would build on. If auto-save on login is
added in a future iteration, the conditions encoding is already there.

### Per-user copies of the seed corpus for each guest session

Eagerly clone the `SEED_CORPUS` into a per-request in-memory store keyed to a per-session guest
UUID, so each guest has an isolated view. Rejected because:

- Storage and initialization cost grows proportionally with concurrent guest sessions.
- The shared read-only in-memory repo seeded under a single `GUEST_USER_ID` is sufficient: guests
  only read; isolation is not needed for reads on a shared immutable data set.
- A per-session UUID would need to be issued, stored, and managed (cookie or header), adding
  complexity for no functional benefit.

---

## Consequences

### Try-before-signup; lower top-of-funnel friction

A visitor can open the app, browse a representative sample closet (the same seed data used in
dev mode), enter trip conditions, and see a real packing recommendation before creating an
account. The value proposition is demonstrated by the real engine, not by a mock.

### The `user_id` invariant is fully preserved

`GUEST_USER_ID` satisfies the schema shape (a valid UUID) in-memory. It never appears in any
Postgres table. No Drizzle query, no RLS policy, no write server action is relaxed for guest
mode. The dual-layer enforcement model from ADR-0008 §C is unchanged.

### All write surfaces remain gated by `requireUserId()` — no behavioral change to writes

The existing write gates are not modified. The only change is that read-only surfaces no longer
immediately redirect unauthenticated visitors; they call `getUserIdOrGuest()` instead of
`requireUserId()`. A guest who navigates directly to a write surface (e.g. `/items/new`) is
redirected to `/login` exactly as before.

### Guest mode only manifests when auth IS configured (build-time env caveat)

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are inlined at build time
(engineering lesson: "`NEXT_PUBLIC_*` env vars are inlined at build time"). `isAuthConfigured()`
reflects the build-time env, not the runtime env. In a build produced without these vars (the
standard dev / gauntlet build), `isAuthConfigured()` is false, the `getUserIdOrGuest()` path
returns `DEFAULT_USER_ID` with `isGuest: false`, and no guest logic runs. The hermetic gauntlet
is unaffected.

In a production Vercel deployment where the Supabase vars are present at build time,
`isAuthConfigured()` is true, and guest mode becomes active for unauthenticated visitors.

### The in-memory repo is the exclusive store for guest reads

When `isGuest: true`, the repo selector bypasses the Postgres repo even if `DATABASE_URL` is
set. This ensures no guest traffic reaches the DB and makes the isolation testable offline: the
gauntlet can verify guest behavior with the in-memory repo and the seed corpus without any
external service.

### Auto-`planAndSave` on login is deferred, not abandoned

The conditions-as-prefill approach leaves the door open for a future auto-save bridge. The
encoded conditions parameter on the login redirect is the foundation that bridge would use.
The deferral is a deliberate design-level choice, not a gap.

### Seed corpus reuse avoids a new data maintenance burden

Using `SEED_CORPUS` as the guest sample closet means the sample items are the same items used in
dev mode, unit tests, and offline classification. No new data set is required. When the seed
corpus is updated (e.g. new representative items added), the guest closet updates automatically.

---

## Relationship to prior ADRs and design documents

- **ADR-0008** — established `isAuthConfigured()`, `getCurrentUserId()`, `requireUserId()`, and
  `DEFAULT_USER_ID`. This ADR adds `getUserIdOrGuest()` and `GUEST_USER_ID` as a narrow extension
  of that model. ADR-0008 is not superseded.
- **DESIGN.md §13** — documents the auth helper contract and `user_id` flow. This ADR extends the
  helper contract with `getUserIdOrGuest()`; §13 should be updated with the new helper signature.
- **ADR-0001** — "no hardcoded buckets or trips." The guest sample closet satisfies this invariant
  because it is the `SEED_CORPUS` reasoned over by the real engine, not a static list.
- **`docs/roadmap.md`** — Phase 3 step 1 (auth) is in delivery. This ADR is an addendum to that
  delivery: the demo funnel is part of the auth-configured product surface.
