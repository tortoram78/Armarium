# ADR-0017 — Ops hardening: in-process rate limiter, structured console logging, error boundaries

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 3 (pre-deploy hardening, cross-cutting)

---

## Context

Phase 3 steps 1–3 (real auth, manufacturer URL enrichment, weather auto-conditions) are in delivery.
Before the first production deployment that reaches real users, three operational gaps need closing:

1. **No rate limiting on expensive server actions.** The server actions that call the Anthropic API
   (`classify`, `tripParse`) and the URL-enrichment fetch (`urlEnrich`) are invocable in a tight
   loop by any visitor. Without a limit, a single guest or authenticated user can exhaust the
   project's Anthropic API budget or trigger Anthropic's own rate-limit errors before any other
   user gets a response. The demo guest funnel (ADR-0016) makes classify/tripParse reachable by
   unauthenticated visitors — including any IP — so the risk surface is wider than it was behind
   the one-password gate.

2. **No structured operational visibility.** Every server action is a black box today. There is no
   record of action latency, per-user call volume, LLM token consumption (input/output tokens), or
   error rates. The Anthropic SDK response has always carried a `usage` object (input tokens,
   output tokens, model), but the composition root (`src/server/services.ts`) discards it. Operators
   cannot track cost, identify abuse, or detect model-drift signals without at least minimal logging.

3. **Unhandled throws reach the user as raw 500 pages.** The App Router does not automatically
   catch server-component or server-action errors. An unexpected throw — from a transient network
   error, an Anthropic timeout, a DB connectivity issue — currently renders a raw Next.js error
   page (or a blank white screen in production). The user has no way to recover without a hard
   reload, and the operator has no signal that the failure happened.

### Constraints that are non-negotiable

- **Zero new dependencies / zero new infrastructure.** The one hard constraint is that this bundle
  adds no new npm packages and no new external services. Any approach requiring a new dependency
  (Upstash, Redis, Vercel KV, Sentry, Datadog, etc.) is deferred to a future ADR. Standard Node.js
  built-ins and the existing Anthropic SDK response shape are the only materials.
- **The hermetic gauntlet must stay env-free.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm build` must pass with zero environment variables set. The rate limiter, logger, and error
  boundaries must not import the DB client, the Anthropic client, or any `next/*` module at the
  `src/core/` level.
- **No weather-degradation clause in this ADR.** The weather subsystem's degradation contract is
  owned by the weather owner (ADR-0015 §16.5). This ADR covers classify, tripParse, and
  urlEnrich only.

---

## Decision

### Part 1 — Rate limiting: dependency-free in-process token bucket

#### What is built

A token-bucket rate limiter in `src/core/ratelimit.ts` — pure TypeScript, no external dep, no
`next/*` imports. A server adapter in `src/server/ratelimit-adapter.ts` holds per-operation
`RateLimiter` instances keyed by identity (userId or IP fallback) and wires them into the relevant
server actions.

The limiter accepts an injected clock (`() => number`, defaulting to `Date.now`) so unit tests can
drive time forward without real delays. This preserves the hermetic gauntlet: the limiter can be
constructed and tested offline with no environment variables and no I/O.

#### Identity resolution

Each server action resolves the limiter identity as follows:
- When `requireUserId()` or `getUserIdOrGuest()` returns a real authenticated userId: key on
  `userId`.
- When the caller is a guest (`isGuest: true` from `getUserIdOrGuest()`): key on the request IP
  address (from the `x-forwarded-for` header, falling back to a fixed `"guest"` sentinel). This is
  the IP-fallback documented in ADR-0016 §B. Guests can reach classify and tripParse through the
  demo funnel, so IP-fallback is the realistic identity anchor.
- `urlEnrich` requires `requireUserId()` (it is a write-adjacent action), so it is always keyed on
  userId.

#### Default budgets (tunable constants)

The following per-identity-per-minute budgets are the chosen defaults, declared as named constants
in `src/server/ratelimit-adapter.ts`. They are tunable without touching the core limiter:

| Operation | Constant | Default budget |
|-----------|----------|----------------|
| `classify` (LLM call per item add) | `CLASSIFY_RATE_LIMIT` | 10 requests / minute |
| `tripParse` (LLM call per trip plan) | `TRIP_PARSE_RATE_LIMIT` | 10 requests / minute |
| `urlEnrich` (SSRF-gated fetch + LLM) | `URL_ENRICH_RATE_LIMIT` | 5 requests / minute |

These numbers reflect the expected human-paced usage of a personal gear manager (a user adding ten
items or planning ten trips in a single minute is already beyond normal use). They are not a hard
global budget — see the "best-effort" caveat below.

#### Best-effort caveat (explicitly acknowledged — NOT a global enforcer)

This limiter is **per-process, in-memory, and per-instance**. On Vercel's multi-instance
serverless model, each function instance holds its own bucket state. A cold start resets all
buckets. A request routed to instance A is not counted against the bucket on instance B.

This means the limiter does NOT enforce a true global per-user call budget across the deployment.
It is explicitly designed as a best-effort abuse speed-bump adequate for the current scale
(a personal gear manager at v0 volume, not a high-traffic SaaS). At human-paced usage rates the
limiter will catch obvious abuse (rapid automated requests to a single instance) without false-
positives for normal use.

A production-grade shared limiter — Upstash Rate Limit, Vercel KV, or a Redis-backed counter —
is the documented future upgrade. It is NOT built here. It requires an explicit infra decision
(the "ask first" rule applies) and its own ADR before implementation.

When a request exceeds the limit the server action returns an `{ ok: false, reason: "rate_limited" }`
response (not a thrown error), which the UI surfaces as an inline message. The client does not
receive an unhandled 500.

### Part 2 — Structured logging: console-emitted single-line JSON

#### What is built

Each server action emits a single structured JSON log line on completion, captured by
`console.log`. Vercel's build and runtime log aggregation captures `console` output from server
functions; no external sink is required for v0.

Two log shapes are defined and emitted:

**Action log** (one per server action invocation):
```ts
{
  event: "action",
  action: string,       // "classify" | "tripParse" | "urlEnrich"
  userId: string,       // UUID or "guest:<ip>"
  ok: boolean,
  reason?: string,      // present when ok:false — "rate_limited" | "validation_error" | "llm_error" | "fetch_error" | "unknown"
  durationMs: number    // wall time from action entry to log emit
}
```

**LLM usage log** (one per Anthropic API call, emitted at the composition root):
```ts
{
  event: "llm_usage",
  action: string,       // which server action triggered the call
  userId: string,
  model: string,        // the MODEL_ID constant value
  inputTokens: number,
  outputTokens: number,
  durationMs: number    // time for the LLM call only
}
```

The `usage` object in the Anthropic SDK response (`response.usage.input_tokens`,
`response.usage.output_tokens`) has always been available; it is now captured at the composition
root (`src/server/services.ts`) and emitted before the result is returned to the caller.

#### Architecture placement

The action log is emitted by a thin logging wrapper at the server action boundary (in
`src/app/actions.ts` or per-route action files). The LLM usage log is emitted from the injected
Anthropic client wrapper in `src/server/services.ts` — the single place where all LLM calls
are made. This is consistent with the existing pattern of `src/core/` being pure and free of I/O;
the logger itself (`src/core/logger.ts`) is a pure function that formats the JSON string —
`console.log` is called by the server layer, never by core.

#### Deferred: external sink and Postgres table

**Sentry / external error sink** — deferred. Adds a new npm dependency and requires an `ask-first`
decision. If structured logging reveals error patterns worth tracking in a dashboard, Sentry is
the documented first candidate.

**Postgres `llm_usage` table** — explicitly NOT built. Persisting token counts in a new table
requires a Drizzle migration, a repository method, and ongoing table maintenance. For v0, Vercel
captures `console.log` output from every serverless function invocation and makes it queryable in
the Vercel dashboard (Log Drains can also forward to an external sink when needed). Console-JSON
is sufficient. A `llm_usage` table is the documented next step if query-time analytics over usage
data become necessary.

### Part 3 — Error boundaries and graceful degradation

#### What is built

**App Router error surfaces:**

- `src/app/error.tsx` — a route-segment error boundary rendered by Next.js when any Server
  Component or Client Component in the route segment throws an unhandled error. Displays a
  user-readable message ("Something went wrong") with a "Try again" button (calls the
  `reset()` function the error boundary receives). This is a `"use client"` component per
  Next.js requirements; the reset button uses `onClick`, not a server form.
- `src/app/global-error.tsx` — the root-level error boundary, rendered when the top-level layout
  itself throws. Covers catastrophic failures that the segment-level boundary cannot catch (e.g.
  a throw in the root layout). Must be `"use client"` and must include its own `<html>/<body>`
  tags (the normal layout is bypassed).

Both boundaries log the error via `console.error` (single-line JSON; same format as the action
log but with `event: "error"` and an `errorMessage` field) before rendering the recovery UI.

**LLM and enrichment path degradation:**

The classify and tripParse paths already have an offline fallback (the offline classifier and
`parseConditionsHeuristic`). This ADR tightens the contract: any unexpected throw from the
Anthropic client (network timeout, 5xx from Anthropic, SDK deserialization error) is caught at
the composition root (`src/server/services.ts`) and mapped to:

- For `classify`: an `{ ok: false, reason: "llm_error", classification: offlineClassify(name) }`
  result — the offline classifier result is returned as a fallback, clearly marked as inferred
  with confidence `low` on all facets. The user sees the draft and can correct it; the review
  step is the safety valve.
- For `tripParse`: an `{ ok: false, reason: "llm_error", conditions: heuristicConditions }`
  result — `parseConditionsHeuristic` provides a best-effort parse; the user sees the conditions
  and can adjust via the structured form.
- For `urlEnrich`: an `{ ok: false, reason: "fetch_error" | "parse_error" | "llm_error" }`
  result with an empty partial overlay. The item retains its existing classification; no facts
  are written. The UI surfaces the error inline with a retry option.

**What is NOT in scope for this ADR:**

- Weather degradation (`forecastToConditions` failure path, Open-Meteo unreachability): that
  contract is already specified in ADR-0015 §16.5 (failed/missing forecast → leave conditions
  for manual entry) and is owned by the weather feature owner.
- Not-found (404) polish: a dedicated `src/app/not-found.tsx` surface is a distinct UI task.
- A global "maintenance mode" banner or circuit breaker: out of scope for v0.

---

## Alternatives rejected

### Shared rate limiter: Upstash Rate Limit, Vercel KV, or Redis

A shared limiter (Upstash, Vercel KV, or a Redis-backed store) would enforce a true global per-
user budget across all Vercel function instances. Rejected for this iteration:

- **New infrastructure.** Every option (Upstash, Vercel KV, Redis) introduces a new external
  service. This requires an "ask first" decision under the explicit CLAUDE.md constraint ("add a
  dependency or introduce new infrastructure: still ask first"). This ADR holds the zero-new-
  infra line.
- **Over-engineering for the current scale.** At v0 volume (personal gear manager, Phase 3
  rollout to a handful of real users), the per-instance token bucket is adequate. The risk of a
  truly adversarial distributed burst (identical user hitting different instances simultaneously
  in volume) is negligible at this stage.

This upgrade is explicitly designed-for but NOT built. When traffic grows or the project moves
to a higher-volume deployment, a shared limiter is the obvious next step and its own ADR will
authorize the infra decision.

### Sentry (external error tracking)

Sentry provides rich error aggregation, stack traces, release tracking, and alerting. Rejected for
this iteration:

- Requires a new npm dependency (`@sentry/nextjs`) and Sentry project credentials as environment
  variables — both trigger the "ask first" rule.
- The console-JSON logging approach captures the same essential signal (error event, userId,
  durationMs, action) in the Vercel log. Vercel's built-in log stream provides adequate
  visibility for v0.

Sentry is the documented first candidate if the console-JSON approach proves insufficient.

### Postgres `llm_usage` table

A dedicated `llm_usage` table would make token counts queryable with SQL and support per-user
cost attribution and trend analysis. Rejected for v0:

- Requires a new Drizzle migration, a new repository method (touching `schema-db-owner`'s domain),
  and a write on every LLM call. Every LLM call becomes a two-write transaction (the item/trip
  write + the usage write), increasing DB load and the surface area for transaction failures.
- Vercel captures `console.log` output for all serverless function invocations and makes it
  available in the Vercel dashboard + Log Drains. This covers the v0 observability requirement
  without schema changes.

The `llm_usage` table is the documented next step if SQL-query analytics over usage become
necessary (e.g. per-user cost breakdown for a multi-tenant billing model).

### No rate limiting at all

Leave the LLM and enrichment server actions unguarded and rely on Anthropic's own rate-limit
responses (HTTP 429) as the backstop. Rejected:

- An Anthropic 429 surfaces as an unhandled error to the end user (a raw failure screen) unless
  caught and mapped to a graceful response — which requires the error-handling in Part 3 anyway.
- API budget is consumed before any 429 fires. A single automated client can exhaust a monthly
  budget in minutes; a 429 from Anthropic does not recover the already-consumed tokens.
- The demo guest funnel (ADR-0016) widens the unauthenticated attack surface specifically because
  guests can call classify and tripParse. A speed-bump that costs nothing to implement is worth
  adding.

---

## Consequences

### Positive

**Operator visibility.** Every server action invocation emits a structured JSON line with action
name, identity, ok/fail, reason, and duration. Every LLM call emits input/output token counts and
the model ID. Operators can query Vercel logs to answer "how many classify calls in the last hour?",
"what did the last 10 LLM calls cost?", and "what errors is `urlEnrich` returning?" without any
external tooling.

**API budget protection (best-effort).** Human-paced callers are never rate-limited. A rapid
automated burst (more than 10 classify or tripParse calls in a minute, or more than 5 urlEnrich
calls in a minute, from the same identity) is throttled with a graceful `{ ok: false, reason:
"rate_limited" }` response — not a 500. The Anthropic API key is protected from obvious abuse.

**User-facing failure recovery.** An unexpected throw no longer crashes the page to a raw 500.
The route-segment error boundary renders a retry screen; the global-error boundary catches the
rest. LLM/enrichment failures degrade to the offline classifier or an empty overlay — the user
can continue using the app and correct later through the review flow.

**No new dependencies; no new infrastructure.** The hermetic gauntlet is unaffected. `pnpm
typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass with zero environment variables. The
core limiter and core logger are pure modules (`src/core/`) with no I/O and no `next/*` imports.

### Known limitations and documented next steps

**The limiter is per-instance, not global.** The caveat is explicit above. For v0 volume this is
adequate. A shared limiter (Upstash / Vercel KV) is the documented upgrade path and requires its
own infra-decision ADR.

**Console logging is not queryable with SQL.** Vercel log search and Log Drains are the v0
tools. If per-user cost attribution or trend analysis over token usage is needed, a `llm_usage`
table is the documented next step.

**Error boundaries cover throws, not `ok: false` responses.** Server actions that return
`{ ok: false, ... }` are handled inline by the calling UI component; the error boundary only
fires on unhandled exceptions. Both paths are covered, but they are distinct surfaces.

**The injected clock in the rate limiter must be used in all tests.** Tests that drive time-
dependent behavior must pass the clock as a constructor argument; tests that import the adapter
without a clock use `Date.now` (real time) and should not assert on rate-limit bucket state.

---

## Relationship to prior ADRs and design documents

- **ADR-0011** (URL enrichment) — `urlEnrich` is one of the three rate-limited operations. The
  SSRF gate (ADR-0011 §B) remains the primary security control; the rate limiter is additive.
- **ADR-0015** (weather auto-conditions) — weather degradation is explicitly out of scope here;
  it is already specified in ADR-0015 §16.5. This ADR does not add a weather-specific degrade
  contract.
- **ADR-0016** (demo guest funnel) — guests can reach `classify` and `tripParse`; IP-fallback is
  the identity anchor for guest rate limiting. This consequence of ADR-0016 motivates the
  IP-fallback path documented in Part 1.
- **`docs/roadmap.md`** — the "Observability" and "Rate-limiting" items in the near-term backlog
  are resolved by this ADR. The documented future upgrades (shared limiter, Sentry, `llm_usage`
  table) become the next entries on the ops line.
- **DESIGN.md §17** — documents the limiter budgets, the log field contracts, and the
  LLM/enrichment degrade-to-unknown contract. Added as part of this ADR.
