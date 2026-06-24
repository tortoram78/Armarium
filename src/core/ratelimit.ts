// Pure, dependency-free in-process rate limiter (ops-hardening bundle). A token-bucket keyed by an
// opaque string, with an INJECTABLE clock — `check(key, now)` takes the current time in epoch-ms as a
// parameter, so the limiter is hermetically testable with no Date.now and no timers. This is a PURE
// FACTORY: it holds no module-scope mutable state. The SERVER adapter owns limiter instances (and their
// lifetime) and supplies the clock; core stays free of env, console, networking, and Next/DB imports.

/** Limiter configuration. A bucket holds at most `capacity` tokens and regains `refillPerSec` per second. */
export interface RateLimiterConfig {
  /** Max tokens (= max burst). Must be > 0. */
  capacity: number;
  /** Tokens regained per second (the steady-state rate). Must be > 0. */
  refillPerSec: number;
}

/** The verdict for one `check`. `retryAfterMs` is 0 when allowed; otherwise the wait until one token frees. */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  /**
   * Spend one token for `key` at time `now` (epoch-ms). Returns `{ allowed, retryAfterMs }`. When denied,
   * `retryAfterMs` is the time until the bucket holds ≥1 token (rounded up). A non-monotonic `now` (a clock
   * that goes backwards) never refills — elapsed time is clamped at 0 — so it is safe under clock skew.
   */
  check(key: string, now: number): RateLimitResult;
  /** Drop a key's bucket (e.g. on eviction). Absent keys are a no-op. */
  reset(key: string): void;
}

interface Bucket {
  /** Fractional tokens available. */
  tokens: number;
  /** Epoch-ms of the last refill computation. */
  updatedAt: number;
}

/**
 * Create a token-bucket rate limiter. Buckets are created lazily on first use of a key and start FULL
 * (`capacity` tokens), so a key's first `capacity` checks within a window are allowed, then denied until
 * the clock advances enough to refill. Independent keys hold independent buckets; two limiters built from
 * this factory share no state. The returned object owns its own bucket map but exposes no module-level
 * mutable state — instance lifetime is the caller's concern.
 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  if (!(config.capacity > 0)) throw new Error("rate limiter capacity must be > 0");
  if (!(config.refillPerSec > 0)) throw new Error("rate limiter refillPerSec must be > 0");
  const { capacity, refillPerSec } = config;
  const buckets = new Map<string, Bucket>();

  function refill(bucket: Bucket, now: number): void {
    const elapsedMs = Math.max(0, now - bucket.updatedAt);
    if (elapsedMs > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + (elapsedMs / 1000) * refillPerSec);
      bucket.updatedAt = now;
    }
  }

  return {
    check(key, now) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, updatedAt: now };
        buckets.set(key, bucket);
      }
      refill(bucket, now);

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, retryAfterMs: 0 };
      }
      // Tokens needed to reach 1, converted to ms at the refill rate, rounded up to a whole ms.
      const deficit = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil((deficit / refillPerSec) * 1000);
      return { allowed: false, retryAfterMs };
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}
