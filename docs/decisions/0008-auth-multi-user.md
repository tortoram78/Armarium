# 0008 — Real auth + multi-user: Supabase Auth, cookie sessions, RLS enforcement model

**Status:** Accepted
**Date:** 2026-06-21
**Phase:** Phase 3 step 1

---

## Context

Phase 2 shipped a one-password gate (`APP_PASSWORD` env var, `src/middleware.ts`) and a single fixed
`ARMARIUM_USER_ID` backing all rows. This was the explicit v0 stance: architecture rule #4 ("user_id
from day one") planted `user_id` on every user-owned table so the schema would be ready; rule #4 also
explicitly deferred real auth to Phase 3.

With Phase 3 approved (2026-06-20), the gate must be replaced with proper authentication. Three
constraints carry forward:

1. **The gauntlet must remain secret-free.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
   `pnpm build` must pass with no Supabase credentials present, exactly as they do today without
   `DATABASE_URL` or `ANTHROPIC_API_KEY`.
2. **The public Supabase endpoint is a real attack surface.** Supabase exposes a public PostgREST
   API authenticated by the `anon` (publishable) key, which ships to the browser via
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Any row reachable through that key without RLS is reachable by
   any authenticated user, including users of other Supabase projects that present a valid JWT.
3. **Migrations cannot use a raw Postgres connection in the cloud sandbox.** The cloud development
   environment's HTTP/HTTPS proxy blocks outbound TCP on ports 5432 (Postgres) and 6543 (PgBouncer).
   `drizzle-kit migrate` therefore cannot reach Supabase from inside the sandbox. A Management-API-
   based migrator (`scripts/db-mgmt-migrate.mjs`) applies migration SQL over HTTPS instead. From a
   DB-connected environment (Vercel, local with a real network path), `pnpm db:migrate` works
   normally.

---

## Decisions

### A — Auth provider: Supabase Auth, email+password to start; OAuth-ready but deferred

**Decision:** use Supabase Auth with email+password as the only sign-in method for Phase 3 step 1.

Supabase Auth is the natural choice: the project already runs on Supabase Postgres, and Supabase Auth
integrates with Postgres RLS through the `auth.uid()` function — the same project, the same JWT
audience, no additional service. Email+password is native to Supabase, requires zero external
configuration, and is fully testable in any environment (including the cloud sandbox with a real
Supabase project).

**Why OAuth is deferred:** OAuth providers (Google, GitHub, etc.) require external OAuth app
registration (client ID + secret pasted into the Supabase dashboard), a deployed redirect domain
(Supabase's redirect URL must point at a live HTTPS endpoint), and a redirect flow that cannot be
verified in the cloud sandbox. OAuth is an additive change: once a deployed redirect URL is available,
adding it is one `signInWithOAuth` call plus provider console configuration in the Supabase dashboard.
None of the schema, RLS, or session infrastructure built in step 1 changes.

**Email verification is deferred.** Signup auto-confirm is used initially (no SMTP configured).
Real email confirmation — where a user must click a link before their account is active — is a
follow-up once SMTP is set up in the Supabase project. This is a known limitation: in the interim,
any email address can be used at signup without verification.

### B — Session model: cookie-based via `@supabase/ssr`, refreshed in middleware

**Decision:** use `@supabase/ssr` to create a cookie-based Supabase client in App Router middleware.
The middleware reads and writes the session cookies on every request, refreshing the access token
when it is close to expiry. Server Components and Route Handlers receive a pre-refreshed client.

The `@supabase/ssr` package is Supabase's supported adapter for environments that manage their own
cookie store — it is the documented pattern for Next.js App Router. It handles token refresh
transparently without client-side JavaScript managing session state.

### C — Enforcement model: dual-layer (app-layer `user_id` filtering + RLS on the public API surface)

This is the load-bearing decision. The application touches the database through two distinct paths,
and each requires different enforcement:

**Path 1 — App server traffic (Drizzle + postgres.js, `postgres` / owner role).** The Drizzle ORM
connection uses the Postgres owner (`postgres`) role or a service-role connection string. This role
**bypasses RLS by design** — it is the superuser-equivalent connection that the application uses for
all reads and writes. Enforcement here is the app-layer `WHERE user_id = $userId` clause that is
already on every query (`src/server/postgres-repo.ts`). The `userId` value flows from
`getCurrentUserId()` → the `userId` parameter already present on every `app-service.ts` function.
This is the primary enforcement mechanism for normal application traffic.

**Path 2 — Public PostgREST API (Supabase anon/service key, RLS applies).** Supabase exposes
every table through a public REST endpoint (`https://<project>.supabase.co/rest/v1/`) authenticated
by the `NEXT_PUBLIC_SUPABASE_ANON_KEY`. This key ships to the browser. Without RLS, any holder of
this key can read or write any row on any user-owned table. RLS is therefore mandatory on every
user-owned table to prevent cross-user data exposure through the public API surface, regardless of
whether the application uses that API directly.

**RLS policy structure:**

- `items`, `trips`, `pending_facets`: row-level policy `(select auth.uid()) = user_id` on SELECT,
  INSERT, UPDATE, and DELETE. These tables are user-owned; no row is visible or writable by any other
  user's JWT.
- `item_insulation`, `item_sleep`, `item_shell`, `item_carry`, `item_footwear`, `item_treatments`,
  `item_material_links` (the subtype and link tables whose `item_id` FK references `items`): gated
  indirectly via their parent item. Policies join to the parent `items` row and assert
  `(select auth.uid()) = items.user_id`.
- `materials`, `treatments` (the shared reference libraries): readable by the `authenticated` role
  (any logged-in user may read them); not user-owned; no `user_id` column. INSERT/UPDATE restricted
  to the service role (application server, seed script).
- `classification_cache`: owner/service-role connection only. This table is intentionally a shared
  knowledge base (a user correction to a named item improves the cache for all users — see ADR-0007);
  it carries no `user_id` and should not be accessible through the public anon key at all. Policy:
  enable RLS, grant no public-role access, restrict all writes to the service role.

**Why both layers are real, neither is redundant:**
The app-layer `user_id` filter (Path 1) is the effective guard for all application traffic because
the Drizzle connection bypasses RLS. RLS (Path 2) guards the public PostgREST surface that the
anon key exposes; without it, the public key is a full data-exfiltration vector. Removing either
layer leaves a real exposure. Both must be in place.

### D — Dev fallback: open mode when Supabase env is absent

**Decision:** when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are both absent,
the application runs in open dev mode with a fixed `DEFAULT_USER_ID` (the same UUID used in Phase 2).
No session, no gate. This keeps the gauntlet (typecheck / lint / build / test) secret-free and keeps
local in-memory development working without any external service.

Three helper functions govern this at the application boundary:

- `isAuthConfigured()` — returns true when both Supabase env vars are present; false otherwise.
- `getCurrentUserId()` — returns the authenticated user's UUID when auth is configured and a valid
  session exists; returns `DEFAULT_USER_ID` otherwise (open dev mode).
- `requireUserId()` — same as `getCurrentUserId()` but throws (or redirects to sign-in) if auth is
  configured and no valid session is present. Used in server actions and route handlers that must
  not proceed without an authenticated identity.

These three helpers are the only application-visible interface to the auth layer. All other code
receives a plain `userId: string` (UUID) and does not know whether it came from a real session or
the dev fallback.

---

## Alternatives considered

**Auth provider — Auth.js (formerly NextAuth.js).** Auth.js is framework-agnostic and supports many
providers, but it does not integrate with Postgres RLS through `auth.uid()` — the JWT audience and
claim structure differ, so Supabase RLS policies would need to be written against a custom claim
rather than the built-in `auth.uid()`. This means losing the native Supabase-Auth/RLS pairing and
adding an extra JWT-claim mapping layer. Rejected: the integration cost outweighs Auth.js's
provider breadth when the project is already on Supabase.

**Auth provider — Clerk.** Clerk provides a polished hosted auth UI and supports Postgres JWT
integration, but it requires Supabase to be configured to accept Clerk JWTs (a custom JWT secret
in the Supabase dashboard) and adds Clerk as a second external service. Rejected: two external
auth services for a personal gear app is unnecessary complexity; Supabase Auth is sufficient.

**Session model — JWT stored in localStorage.** Rejected: exposes the token to XSS; `httpOnly`
cookies are the standard mitigation. `@supabase/ssr` uses cookies by design.

**RLS only (no app-layer `user_id` filter).** Rejected: the Drizzle connection uses the owner role,
which bypasses RLS. Relying on RLS alone for app-layer enforcement would mean queries over the owner
connection return rows across all users — a silent cross-user data leak. App-layer filtering is
mandatory for the owner-role connection path.

**App-layer filtering only (no RLS).** Rejected: leaves the public PostgREST endpoint, reachable
with just the anon key, able to read or write any row. The anon key ships to the browser;
unprotected rows are exposed to any user with access to that key.

**OAuth at launch.** Rejected for this step: requires a deployed redirect domain and external OAuth
app registration, neither of which can be validated in the cloud sandbox. Email+password meets the
same functional goal (authenticated, per-user isolation) with zero external setup. OAuth is deferred,
not abandoned — it slots in as a small additive change when a deployed redirect URL is available.

**Email verification at launch.** Rejected for this step: requires SMTP configuration in the
Supabase project (a provider URL, username, password). Without SMTP, email confirmation silently
fails or the user never receives the link. Signup auto-confirm ships first; real email confirmation
follows once SMTP is configured. The limitation is documented explicitly.

---

## Consequences

- The one-password `APP_PASSWORD` gate and the fixed `ARMARIUM_USER_ID` env vars are superseded.
  They can be removed from middleware and services once the Supabase Auth flow is live and tested.
  `deploy.md` reflects this.
- The `user_id` column on every user-owned table (already present — architecture rule #4) is now
  tied to a real identity: the `auth.uid()` UUID that Supabase Auth assigns on signup. No schema
  migration is required to add `user_id`; RLS policy migrations are needed to add the policies.
- Existing seeded data (rows with `DEFAULT_USER_ID`) is not automatically migrated to a new auth
  UUID. When switching from open dev mode to a real auth session, a one-time data-migration step
  is needed to re-attribute existing rows to the new user's UUID. This is a known operational step,
  not a regression.
- Session refresh in middleware adds one Supabase network call per request on the hot path. The
  refresh is skipped when the token is still valid (Supabase's SDK handles this); the overhead is
  negligible for a personal app at low request rates.
- OAuth and email verification remain deferred but fully unblocked by this step. No rework is
  required to enable them later — both are additive to the email+password foundation built here.
- All Phase 3 steps 2–4 (manufacturer URL enrichment, weather auto-conditions, catalog gap-fill)
  depend on real auth being in place so that enrichment and suggestions can be attributed to a
  verified user. Step 1 is therefore the foundation for the remainder of Phase 3.
