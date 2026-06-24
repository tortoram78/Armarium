// Hermetic tests for the pure token-bucket rate limiter. The clock is INJECTED (a `now` epoch-ms passed
// to every `check`) — no Date.now, no timers — so the window/refill behaviour is fully deterministic.

import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/core/ratelimit";

describe("createRateLimiter — token bucket", () => {
  it("allows up to capacity within a window, then rejects", () => {
    const rl = createRateLimiter({ capacity: 3, refillPerSec: 1 });
    const t0 = 1_000_000;
    expect(rl.check("k", t0).allowed).toBe(true);
    expect(rl.check("k", t0).allowed).toBe(true);
    expect(rl.check("k", t0).allowed).toBe(true);
    const denied = rl.check("k", t0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills after the injected clock advances", () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSec: 1 });
    const t0 = 0;
    expect(rl.check("k", t0).allowed).toBe(true);
    expect(rl.check("k", t0).allowed).toBe(true);
    expect(rl.check("k", t0).allowed).toBe(false); // bucket empty

    // refillPerSec=1 → one token regained after 1000ms.
    expect(rl.check("k", t0 + 999).allowed).toBe(false); // not quite a full token yet
    expect(rl.check("k", t0 + 1000).allowed).toBe(true); // exactly one token refilled
    expect(rl.check("k", t0 + 1000).allowed).toBe(false); // and spent
  });

  it("never exceeds capacity no matter how long the clock advances", () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSec: 5 });
    const t0 = 0;
    // Idle for an hour: the bucket caps at `capacity`, not capacity + elapsed*rate.
    expect(rl.check("k", t0 + 3_600_000).allowed).toBe(true);
    expect(rl.check("k", t0 + 3_600_000).allowed).toBe(true);
    expect(rl.check("k", t0 + 3_600_000).allowed).toBe(false);
  });

  it("keeps independent keys from interfering", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 1 });
    const t0 = 500;
    expect(rl.check("alice", t0).allowed).toBe(true);
    expect(rl.check("alice", t0).allowed).toBe(false); // alice exhausted
    expect(rl.check("bob", t0).allowed).toBe(true); // bob has his own full bucket
  });

  it("treats two limiters with different budgets as independent", () => {
    const tight = createRateLimiter({ capacity: 1, refillPerSec: 1 });
    const loose = createRateLimiter({ capacity: 5, refillPerSec: 1 });
    const t0 = 0;
    expect(tight.check("k", t0).allowed).toBe(true);
    expect(tight.check("k", t0).allowed).toBe(false);
    // The loose limiter shares no state — same key, still allowed.
    for (let i = 0; i < 5; i++) expect(loose.check("k", t0).allowed).toBe(true);
    expect(loose.check("k", t0).allowed).toBe(false);
  });

  it("reports a sane retryAfterMs that lands when a token is actually available", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 2 }); // a token every 500ms
    const t0 = 10_000;
    expect(rl.check("k", t0).allowed).toBe(true);
    const denied = rl.check("k", t0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(500); // 1 token / 2 per sec = 500ms
    // Waiting exactly retryAfterMs lets the next check through.
    expect(rl.check("k", t0 + denied.retryAfterMs).allowed).toBe(true);
  });

  it("clamps a backwards clock (skew) to no refill rather than draining time", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 1 });
    const t0 = 5_000;
    expect(rl.check("k", t0).allowed).toBe(true);
    // Clock goes backwards: must not credit negative elapsed time, must not grant a token.
    expect(rl.check("k", t0 - 1_000).allowed).toBe(false);
  });

  it("reset() drops a key's bucket so it starts full again", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 1 });
    const t0 = 0;
    expect(rl.check("k", t0).allowed).toBe(true);
    expect(rl.check("k", t0).allowed).toBe(false);
    rl.reset("k");
    expect(rl.check("k", t0).allowed).toBe(true); // fresh full bucket
  });

  it("rejects an invalid config", () => {
    expect(() => createRateLimiter({ capacity: 0, refillPerSec: 1 })).toThrow();
    expect(() => createRateLimiter({ capacity: 1, refillPerSec: 0 })).toThrow();
  });
});
