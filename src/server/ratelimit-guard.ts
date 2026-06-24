// The SERVER rate-limit guard (ops-hardening wave B1). It owns the module-scope limiter INSTANCES — one
// per op — and supplies the clock (`Date.now()`), so the pure core limiter (src/core/ratelimit.ts) stays
// a stateless factory. Lives in src/server (NOT core): module-scope mutable maps + Date.now are fine here,
// disallowed in core. No env is read at import time; no new dependency.
//
// BEST-EFFORT, PER-INSTANCE (ADR-0017). Each serverless instance holds its own buckets in memory: a cold
// start resets them, and on multi-instance Vercel the budget is per-instance, NOT a true global ceiling.
// This is a cheap abuse brake (one user hammering one warm instance), deliberately not a billing-grade
// quota. A real global budget would need a shared store (Redis/Postgres) — out of scope for this wave.

import { createRateLimiter, type RateLimiter } from "@/core/ratelimit";
import { getCurrentUserId, GUEST_USER_ID } from "@/lib/auth";

/** The rate-limited operations. Each maps to its own limiter with an independent budget. */
export type RateLimitOp = "classify" | "parse" | "enrich" | "weather";

/**
 * Per-op budgets, expressed as a token bucket: `capacity` is the max burst, `refillPerSec` the steady
 * rate. Tuned for one human's interactive use, generous enough not to bite normal flows but tight enough
 * to brake a script. These are the tunable knobs for this wave — adjust here, not at the call sites.
 *
 *   classify ~10/min  — add-by-name → classify is the most LLM-spendy path; cap bursts of additions.
 *   parse    ~10/min  — NL trip parsing; same order as classify.
 *   enrich   ~5/min   — manufacturer-URL fetch; tighter (each is an outbound network call).
 *   weather  ~15/min  — weather lookups are cheap/cacheable; the loosest budget.
 *
 * refillPerSec = perMinute / 60, so the steady rate matches the "~N/min" and capacity = perMinute allows
 * a full minute's worth as an opening burst.
 */
const BUDGETS: Record<RateLimitOp, { capacity: number; refillPerSec: number }> = {
  classify: { capacity: 10, refillPerSec: 10 / 60 },
  parse: { capacity: 10, refillPerSec: 10 / 60 },
  enrich: { capacity: 5, refillPerSec: 5 / 60 },
  weather: { capacity: 15, refillPerSec: 15 / 60 },
};

// One limiter instance per op, created at module load (pure factory call — no env, no i/o). The map is the
// per-instance state the header comment warns about: it lives as long as this serverless instance does.
const LIMITERS: Record<RateLimitOp, RateLimiter> = {
  classify: createRateLimiter(BUDGETS.classify),
  parse: createRateLimiter(BUDGETS.parse),
  enrich: createRateLimiter(BUDGETS.enrich),
  weather: createRateLimiter(BUDGETS.weather),
};

/** The constant key for a request we cannot attribute to a user or an IP — all such traffic shares it. */
const ANON_KEY = "anon";

/**
 * Resolve the rate-limit KEY for the current request, most-specific first:
 *   1. `getCurrentUserId()` — the authenticated (or dev-default) user id.
 *   2. the first `x-forwarded-for` IP (Vercel's client IP), via `next/headers`.
 *   3. the constant `"anon"`.
 *
 * GUEST CAVEAT: when auth is configured but there is no session, every guest shares the SINGLE
 * GUEST_USER_ID (see auth.ts). So for guests step 1 collapses all of them onto one key — the
 * `x-forwarded-for` fallback is what actually separates one guest from another. We therefore prefer the
 * IP over the shared guest id by treating GUEST_USER_ID as "not specific enough" and falling through to
 * the IP. (Authenticated users keep their own per-user key.)
 */
export async function resolveRateKey(): Promise<string> {
  const userId = await getCurrentUserId();
  if (userId && userId !== GUEST_USER_ID) return `user:${userId}`;

  const ip = await forwardedClientIp();
  if (ip) return `ip:${ip}`;

  return ANON_KEY;
}

/**
 * Spend one token for `op` against `key` at the current wall clock (`Date.now()`). Returns the core
 * limiter's verdict `{ allowed, retryAfterMs }`. The clock is read HERE (server), not in core, so the core
 * limiter remains injectable/testable; assert limiter mechanics against the core limiter directly.
 */
export function checkRateLimit(op: RateLimitOp, key: string): { allowed: boolean; retryAfterMs: number } {
  return LIMITERS[op].check(key, Date.now());
}

// ---------------------------------------------------------------------------------------------------
// Internals. The IP read dynamically imports next/headers so this module stays importable outside a
// request context (and tests can mock it without a live request). GUEST_USER_ID is imported from auth.ts
// (a fixed constant there) rather than the server services module, keeping the dependency surface small.
// ---------------------------------------------------------------------------------------------------

/** First IP in `x-forwarded-for` (Vercel sets `client, proxy1, ...`), or null outside a request context. */
async function forwardedClientIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const xff = headers().get("x-forwarded-for");
    if (!xff) return null;
    const first = xff.split(",")[0]?.trim();
    return first ? first : null;
  } catch {
    // Outside a request scope (e.g. a unit test that didn't mock headers) → no IP; caller falls to "anon".
    return null;
  }
}
