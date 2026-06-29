// The SERVER rate-limit guard (ops-hardening wave B1). It owns the module-scope limiter INSTANCES — one
// per op — and supplies the clock (`Date.now()`), so the pure core limiter (src/core/ratelimit.ts) stays
// a stateless factory. Lives in src/server (NOT core): module-scope mutable maps + Date.now are fine here,
// disallowed in core. No env is read at import time; no static new dependency.
//
// TWO TIERS:
//   1. IN-MEMORY (always on, default). Best-effort, PER-INSTANCE (ADR-0017): each serverless instance holds
//      its own buckets in memory; a cold start resets them, and on multi-instance Vercel the budget is
//      per-instance, NOT a true global ceiling. A cheap abuse brake (one user hammering one warm instance).
//   2. DISTRIBUTED (opt-in, env-detected). When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set,
//      `checkRateLimitAsync` backs the budget with Upstash Redis for a TRUE cross-instance ceiling. The
//      @upstash/* packages are loaded by a DYNAMIC, non-literal import so TypeScript never tries to resolve
//      them at build time and the hermetic gate stays dependency-free. If the packages are not installed at
//      runtime, or any Upstash call fails, we DEGRADE GRACEFULLY to the in-memory limiter — never throw.
//
//   DEPLOY-GATED: the distributed tier only activates when you both (a) set the UPSTASH_* env vars AND
//   (b) `pnpm add @upstash/ratelimit @upstash/redis` on that deploy. Absent either, behavior is the exact
//   in-memory token-bucket below — so the hermetic gate and keyless/Upstash-less deploys are unchanged.

import { createRateLimiter, type RateLimiter } from "@/core/ratelimit";
import { getCurrentUserId, GUEST_USER_ID } from "@/lib/auth";

/** The rate-limited operations. Each maps to its own limiter with an independent budget. */
export type RateLimitOp = "classify" | "parse" | "enrich" | "weather" | "signup";

/**
 * Per-op budgets, expressed as a token bucket: `capacity` is the max burst, `refillPerSec` the steady
 * rate. Tuned for one human's interactive use, generous enough not to bite normal flows but tight enough
 * to brake a script. These are the tunable knobs for this wave — adjust here, not at the call sites.
 *
 *   classify ~10/min  — add-by-name → classify is the most LLM-spendy path; cap bursts of additions.
 *   parse    ~10/min  — NL trip parsing; same order as classify.
 *   enrich   ~5/min   — manufacturer-URL fetch; tighter (each is an outbound network call).
 *   weather  ~15/min  — weather lookups are cheap/cacheable; the loosest budget.
 *   signup   ~5/min   — account creation; tight, per-IP, to brake scripted mass-signup abuse.
 *
 * refillPerSec = perMinute / 60, so the steady rate matches the "~N/min" and capacity = perMinute allows
 * a full minute's worth as an opening burst.
 */
const BUDGETS: Record<RateLimitOp, { capacity: number; refillPerSec: number }> = {
  classify: { capacity: 10, refillPerSec: 10 / 60 },
  parse: { capacity: 10, refillPerSec: 10 / 60 },
  enrich: { capacity: 5, refillPerSec: 5 / 60 },
  weather: { capacity: 15, refillPerSec: 15 / 60 },
  signup: { capacity: 5, refillPerSec: 5 / 60 },
};

// One limiter instance per op, created at module load (pure factory call — no env, no i/o). The map is the
// per-instance state the header comment warns about: it lives as long as this serverless instance does.
const LIMITERS: Record<RateLimitOp, RateLimiter> = {
  classify: createRateLimiter(BUDGETS.classify),
  parse: createRateLimiter(BUDGETS.parse),
  enrich: createRateLimiter(BUDGETS.enrich),
  weather: createRateLimiter(BUDGETS.weather),
  signup: createRateLimiter(BUDGETS.signup),
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

/**
 * Async rate-limit check. When Upstash is configured (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
 * AND the @upstash/* packages are installed at runtime, this enforces a TRUE cross-instance ceiling via
 * Redis. Otherwise — and on ANY Upstash error — it falls back to the in-memory `checkRateLimit` above, so
 * the result shape and verdict semantics are identical (`{ allowed, retryAfterMs }`). Never throws.
 *
 * Use this at NEW call sites that want the distributed ceiling (e.g. the signup throttle). The existing
 * synchronous call sites in actions.ts keep using `checkRateLimit` unchanged — both share the same
 * per-instance buckets, so a deploy without Upstash behaves exactly as before.
 */
export async function checkRateLimitAsync(
  op: RateLimitOp,
  key: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const distributed = await tryUpstashCheck(op, key);
  if (distributed) return distributed;
  // No Upstash (unconfigured, not installed, or it errored) → the unchanged in-memory token bucket.
  return checkRateLimit(op, key);
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

// ---------------------------------------------------------------------------------------------------
// Upstash (distributed) backend. Entirely OPTIONAL and lazy: nothing here runs unless the UPSTASH_* env
// vars are present, and even then it loads @upstash/* via a DYNAMIC, NON-LITERAL import so the bundler /
// TypeScript never resolves the module at build time. If the packages are not installed at runtime — or
// any step throws — we return null and the caller degrades to the in-memory limiter. NEVER throws.
//
// DEPLOY-GATED: on the Upstash-enabled deploy you must `pnpm add @upstash/ratelimit @upstash/redis` AND
// set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. Without both, this is inert.
// ---------------------------------------------------------------------------------------------------

/** One Upstash `Ratelimit` instance per op, memoized. `false` = construction failed/unavailable (skip). */
type UpstashLimiter = { limit: (id: string) => Promise<{ success: boolean; reset: number }> };
const upstashLimiters = new Map<RateLimitOp, UpstashLimiter | false>();
let upstashRedis: unknown | undefined; // undefined = not yet attempted; null = unavailable.

/** True only when both Upstash REST env vars are set (the activation switch). Read at call time, not import. */
function isUpstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Attempt a distributed check. Returns the verdict when Upstash handled it, or null to signal "fall back to
 * in-memory" (unconfigured, packages missing, or an error). Maps Upstash's `{ success, reset(epoch-ms) }`
 * onto our `{ allowed, retryAfterMs }` shape so callers can't tell the two backends apart.
 */
async function tryUpstashCheck(
  op: RateLimitOp,
  key: string,
): Promise<{ allowed: boolean; retryAfterMs: number } | null> {
  if (!isUpstashConfigured()) return null;
  try {
    const limiter = await getUpstashLimiter(op);
    if (!limiter) return null;
    const { success, reset } = await limiter.limit(key);
    const retryAfterMs = success ? 0 : Math.max(0, reset - Date.now());
    return { allowed: success, retryAfterMs };
  } catch {
    // Any Upstash/network failure must not break the request — degrade to the in-memory limiter.
    return null;
  }
}

/** Lazily build (and memoize) the Upstash limiter for one op. Returns false if Upstash is unavailable. */
async function getUpstashLimiter(op: RateLimitOp): Promise<UpstashLimiter | null> {
  const cached = upstashLimiters.get(op);
  if (cached !== undefined) return cached || null;

  const redis = await getUpstashRedis();
  const Ratelimit = await loadRatelimitCtor();
  if (!redis || !Ratelimit) {
    upstashLimiters.set(op, false);
    return null;
  }

  try {
    // Sliding-window: `capacity` requests per 60s — the steady-state ceiling matching the in-memory "~N/min".
    const { capacity } = BUDGETS[op];
    const limiter = new (Ratelimit as new (cfg: unknown) => UpstashLimiter)({
      redis,
      limiter: (Ratelimit as { slidingWindow: (n: number, w: string) => unknown }).slidingWindow(
        capacity,
        "60 s",
      ),
      prefix: `armarium:rl:${op}`,
      analytics: false,
    });
    upstashLimiters.set(op, limiter);
    return limiter;
  } catch {
    upstashLimiters.set(op, false);
    return null;
  }
}

/** Build (and memoize) the Redis client from env. Returns null if @upstash/redis is missing or misconfigured. */
async function getUpstashRedis(): Promise<unknown | null> {
  if (upstashRedis !== undefined) return upstashRedis;
  try {
    // Non-literal specifier so TS/webpack do not try to resolve the (uninstalled-by-default) package at build.
    const spec = "@upstash/redis";
    const mod = (await import(/* webpackIgnore: true */ spec as string)) as {
      Redis?: new (cfg: unknown) => unknown;
    };
    if (!mod?.Redis) {
      upstashRedis = null;
      return null;
    }
    upstashRedis = new mod.Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return upstashRedis;
  } catch {
    upstashRedis = null;
    return null;
  }
}

/** Dynamically load the @upstash/ratelimit `Ratelimit` constructor, or null if the package isn't installed. */
async function loadRatelimitCtor(): Promise<unknown | null> {
  try {
    const spec = "@upstash/ratelimit";
    const mod = (await import(/* webpackIgnore: true */ spec as string)) as { Ratelimit?: unknown };
    return mod?.Ratelimit ?? null;
  } catch {
    return null;
  }
}
