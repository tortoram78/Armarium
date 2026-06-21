# Armarium — Vercel + Supabase deploy runbook

This document covers the deployment path for Phase 2 (complete) and Phase 3 step 1 (real auth +
multi-user). It is deliberately concrete — exact variable names, exact command sequences, and explicit
notes on what each variable controls.

---

## Environment variables

| Variable | Required | Default / behaviour when absent |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | For auth + session | Absent: app runs open with `DEFAULT_USER_ID` (dev mode) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For auth + session | Absent: app runs open with `DEFAULT_USER_ID` (dev mode) |
| `DATABASE_URL` | For persistence | Absent: in-memory repository (ephemeral, no DB needed) |
| `ANTHROPIC_API_KEY` | For live classification + NL parsing | Absent: offline heuristic / corpus |
| `SUPABASE_ACCESS_TOKEN` | For Management API migration (sandbox) | Only needed by `scripts/db-mgmt-migrate.mjs` |
| `SUPABASE_PROJECT_REF` | For Management API migration (sandbox) | Only needed by `scripts/db-mgmt-migrate.mjs` |

**Where to set them:**
- **Vercel:** Project Settings > Environment Variables. Scope to Production / Preview / Development
  as appropriate. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, and
  `ANTHROPIC_API_KEY` should be Production + Preview.
- **Local dev:** `.env.local` at the repo root (gitignored by `.gitignore`). Never commit secrets.
  Format: one `KEY=value` per line; Next.js loads this file automatically.

### What each variable does

**`NEXT_PUBLIC_SUPABASE_URL`** and **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**

These two variables control whether Supabase Auth is active. The helper `isAuthConfigured()` returns
true only when both are present. When both are set:

- App Router middleware uses `@supabase/ssr` to read and refresh the session cookie on every request.
- `requireUserId()` in server actions and route handlers returns the authenticated user's UUID from
  the session, or redirects to sign-in if no valid session exists.
- Signup, sign-in, and sign-out routes use the Supabase Auth API.

When either variable is absent (local dev, CI, in-memory demo):

- `isAuthConfigured()` returns false.
- `getCurrentUserId()` and `requireUserId()` return `DEFAULT_USER_ID` (a fixed UUID, the same value
  used in Phase 2).
- No Supabase SDK calls are made; the app runs open with no auth gate.
- All `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` commands pass without these
  variables — do not add them to CI unless a step explicitly requires a live Supabase session.

The `NEXT_PUBLIC_` prefix means these values are embedded in the browser bundle. They are publishable
(the anon key is safe in the browser) but must not be confused with the secret service-role key.
Never put a Supabase service-role key in a `NEXT_PUBLIC_` variable.

**`DATABASE_URL`** (Postgres connection string, e.g. `postgresql://user:pw@host:5432/db`)

The client is a lazy singleton in `src/db/client.ts` — the connection is opened on the first query,
never at module load. This means:

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` all pass with no `DATABASE_URL`
  set. Do not add this to CI unless you are running migration/seed steps.
- When absent at runtime, `getRepository()` in `src/server/services.ts` returns the in-memory
  `memoryRepository`. Data is ephemeral (lost on cold start / restart); useful for demos and
  local dev without a database.
- When set, `getRepository()` returns `postgresRepository` which reads all items from the
  `classification` jsonb column as the lossless source of truth.

Supabase provides the connection string under Project Settings > Database > Connection string
(use the "URI" format). For serverless, use the **pooled** connection string (port 6543) with
`?pgbouncer=true&connection_limit=1` appended to avoid connection exhaustion.

**`ANTHROPIC_API_KEY`**

When set, `getClassifier()` wires the live Anthropic classification pipeline
(`src/core/classify/classify.ts`) using model `MODEL_ID` (currently `claude-sonnet-4-6`,
defined in `src/core/config.ts`). `getTripParser()` wires the live NL trip parser
(`parseTripConditions`).

When absent:
- Classification falls back to `classifyOffline` — the pre-validated seed corpus recognises
  only prototype items; any unknown item causes `classifyOffline` to throw an error directing
  the user to set `ANTHROPIC_API_KEY`. No default or fabricated classification is returned.
- NL trip parsing falls back to `parseConditionsHeuristic` — a deterministic keyword-to-enum
  map. Conservative: unrecognised text yields mild defaults; the user can always use the
  structured conditions form.
- The `/items/new` and `/plan` pages display a visible notice that the offline mode is active.

**`SUPABASE_ACCESS_TOKEN`** and **`SUPABASE_PROJECT_REF`**

These variables are used only by `scripts/db-mgmt-migrate.mjs` — the Management API migrator for
environments where a raw Postgres connection is not reachable (see "Sandbox / Management API
migration" section below). They are not read by the application at runtime and do not need to be
set in Vercel production deployments. Set them only when running the Management API migrator from
the cloud sandbox.

- `SUPABASE_ACCESS_TOKEN`: a personal access token from supabase.com/account/tokens (not a project
  service key).
- `SUPABASE_PROJECT_REF`: the project reference string from the Supabase dashboard URL
  (`https://supabase.com/dashboard/project/<ref>`).

---

## Build and CI — no secrets needed

```bash
pnpm install
pnpm typecheck   # zero errors required
pnpm lint        # zero warnings/errors required
pnpm test        # vitest, offline, no DB / API key / Supabase credentials
pnpm build       # hard gate — must pass before any deploy
```

None of these commands need `DATABASE_URL`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, or
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. CI should run without them. Never add secrets to CI environment
unless a step explicitly requires a live DB, API call, or auth session.

---

## Supabase setup

1. Create a new Supabase project at [supabase.com](https://supabase.com).
2. Under Project Settings > API, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon (public) key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Under Project Settings > Database > Connection string > URI (port 6543), copy the pooled
   connection string and append `?pgbouncer=true&connection_limit=1`. Set this as `DATABASE_URL`.
4. Under Authentication > Providers, enable **Email** (enabled by default). For Phase 3 step 1,
   leave "Confirm email" disabled (signup auto-confirm) until SMTP is configured.

---

## Database migration

Migration SQL was generated by `drizzle-kit` (`pnpm db:generate`) and committed to `drizzle/`.
You do not need to regenerate migrations on a fresh deploy — the SQL files are already present.
Run `pnpm db:generate` only when the Drizzle schema (`src/db/schema.ts`) changes.

### Standard migration (DB-connected environment)

From any environment with a direct or pooled Postgres connection (Vercel, local with real network):

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

This runs `drizzle-kit migrate` and applies all pending migration files in order. Drizzle tracks
applied migrations in a `__drizzle_migrations` table.

### Sandbox / Management API migration

The cloud development sandbox's HTTP/HTTPS proxy blocks outbound TCP on ports 5432 and 6543, so
`drizzle-kit migrate` cannot reach Supabase from inside the sandbox. Use the Management API
migrator instead:

```bash
SUPABASE_ACCESS_TOKEN="sbp_..." SUPABASE_PROJECT_REF="<ref>" node scripts/db-mgmt-migrate.mjs
```

This script reads the same migration files from `drizzle/` and applies them over the Supabase
Management API (HTTPS). It is functionally equivalent to `pnpm db:migrate` for the sandbox
environment. It requires a personal access token and project reference, not a database password.

### RLS policy migration (Phase 3 step 1)

Phase 3 step 1 adds a migration that enables RLS on user-owned tables and creates the enforcement
policies (see DESIGN.md §13 for the policy table). This migration is applied by the same
`pnpm db:migrate` or Management API migrator command alongside the schema migrations — no separate
step is needed.

---

## Seed (optional)

The seed script populates the prototype gear corpus for a configured user. It is optional — the app
works with an empty database.

```bash
# Offline seed (uses pre-validated corpus; no LLM calls):
DATABASE_URL="postgresql://..." pnpm db:seed

# Live seed (classifies each item with the real LLM; higher fidelity):
DATABASE_URL="postgresql://..." ANTHROPIC_API_KEY="sk-ant-..." pnpm db:seed
```

The seed script exits immediately with an error if `DATABASE_URL` is not set. It checks for
existing items first and skips seeding entirely if the `items` table is non-empty. To re-seed
from scratch, truncate the `items` table first, then re-run.

**User attribution in Phase 3:** the seed script uses `DEFAULT_USER_ID` (the fixed UUID from Phase 2)
unless overridden. Seeded rows are not automatically re-attributed to a real auth UUID when you first
sign in. If you seed before creating a Supabase Auth account, a one-time update is needed to set
`user_id` on those rows to the new account's UUID.

---

## Vercel deploy

1. Connect the repository to a Vercel project (Import > select repo).
2. Framework preset: **Next.js** (detected automatically).
3. Build command: `pnpm build` (or leave as default — Vercel auto-detects `pnpm`).
4. Output directory: `.next` (default).
5. Set environment variables (Project Settings > Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL` — Production + Preview
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Production + Preview
   - `DATABASE_URL` — Production + Preview
   - `ANTHROPIC_API_KEY` — Production + Preview
6. Deploy. Vercel builds from `pnpm build`; the build passes with no credentials because all
   clients are lazy. The running serverless functions connect to Supabase and Postgres on first
   request.
7. After the first successful deploy, run the migration command against your Supabase database if
   you haven't already. Migrations are not run automatically on deploy.

### Branch / preview deploys

Vercel creates a preview deploy for each branch/PR. If `DATABASE_URL` is scoped to Preview, the
preview will use Postgres. If you prefer, scope `DATABASE_URL` to Production only and let previews
run in ephemeral in-memory mode (no DB, data lost between requests). Either way, set
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Preview if you want auth active
in preview environments; omit them to run preview in open dev mode.

---

## Security notes

- **Secrets never go into git.** `.env.local` is gitignored. Vercel env vars are injected at
  build/runtime and never appear in the repository.
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY` is a publishable key**, not a secret — it is intentionally
  embedded in the browser bundle. It allows public unauthenticated access to the Supabase PostgREST
  endpoint, which is why **RLS is mandatory** on every user-owned table. With RLS in place, the anon
  key can only read rows the authenticated JWT is authorized to see. Without RLS, the anon key is a
  full data-exfiltration vector. Never disable RLS on user-owned tables.
- **Never put a Supabase service-role key in a `NEXT_PUBLIC_` variable.** The service role bypasses
  RLS; exposing it in the browser bundle would give any visitor full database access.
- **One-password gate is superseded.** `APP_PASSWORD` and `ARMARIUM_USER_ID` are no longer used.
  The `user_id` on every row is now tied to a real Supabase Auth identity (`auth.uid()`). The
  `DEFAULT_USER_ID` fallback applies **only** when `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent (dev mode with no Supabase project configured).
- **No LLM output reaches the DB unvalidated.** Classification results are Zod-validated before
  any insert; NL trip conditions are Zod-validated before `deriveRequirements` is called. See
  ADR-0004 and ADR-0006 for the contract.

---

## Local dev (no Supabase)

```bash
pnpm install
pnpm dev         # starts Next.js dev server on http://localhost:3000
```

Without `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` the app runs open in dev
mode: no sign-in required, all requests use `DEFAULT_USER_ID`. Without `DATABASE_URL` the app uses
the in-memory repository. Without `ANTHROPIC_API_KEY` the app uses the offline classifier and
heuristic parser. No external services are required to run locally.

To develop against a real Supabase project locally, add `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
```

Then run migrations (`pnpm db:migrate`) and optionally seed (`pnpm db:seed`) before starting the
dev server.
