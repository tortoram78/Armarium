// Tests for the SERVER rate-limit guard (src/server/ratelimit-guard.ts). The guard owns the per-op limiter
// instances and reads the clock with Date.now() internally, so:
//   - checkRateLimit budget behaviour is exercised against the REAL module-scope limiters (burst-then-deny
//     within a window — the buckets refill slowly enough that a tight loop never crosses a refill tick), and
//     independence across ops is asserted by exhausting one op while another stays open.
//   - resolveRateKey's identity precedence (userId → forwarded IP → "anon") is asserted by mocking
//     @/lib/auth (getCurrentUserId + GUEST_USER_ID) and next/headers.
// Pure limiter MECHANICS (refill math, retryAfterMs, skew) are covered hermetically in ratelimit.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable mock state the doubles below read, reset per test. (Plain `let`, NOT a const referenced inside
// the hoisted vi.mock factory — vitest hoists vi.mock above const initializers, so a const used in the
// factory would throw "cannot access before initialization". The guest id literal is inlined in the factory.)
const GUEST_USER_ID = "00000000-0000-0000-0000-000000000999";
let mockUserId: string | null = "user-default";
let mockXff: string | null = null;

vi.mock("@/lib/auth", () => ({
  getCurrentUserId: async () => mockUserId,
  GUEST_USER_ID: "00000000-0000-0000-0000-000000000999",
}));

vi.mock("next/headers", () => ({
  headers: () => ({ get: (name: string) => (name === "x-forwarded-for" ? mockXff : null) }),
}));

import { checkRateLimit, resolveRateKey, type RateLimitOp } from "@/server/ratelimit-guard";

beforeEach(() => {
  mockUserId = "user-default";
  mockXff = null;
});

// Unique keys per test so the module-scope buckets (shared across the file) never collide.
let n = 0;
const freshKey = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2)}`;

describe("checkRateLimit — per-op budgets", () => {
  // classify budget is capacity 10 (refill 10/min ≈ 0.0028 tokens/ms) — a tight loop stays inside one window.
  it("allows up to the classify budget then rejects", () => {
    const key = freshKey("classify");
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("classify", key).allowed).toBe(true);
    }
    const denied = checkRateLimit("classify", key);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("enforces the tighter enrich budget (5) sooner than classify (10) for the same key", () => {
    const key = freshKey("enrich");
    for (let i = 0; i < 5; i++) expect(checkRateLimit("enrich", key).allowed).toBe(true);
    expect(checkRateLimit("enrich", key).allowed).toBe(false);
  });

  it("gives each op an independent budget — exhausting one leaves the others open", () => {
    const key = freshKey("shared");
    // Drain classify (10) fully.
    for (let i = 0; i < 10; i++) checkRateLimit("classify", key);
    expect(checkRateLimit("classify", key).allowed).toBe(false);
    // The same key is still fresh for every other op (separate limiter instances).
    expect(checkRateLimit("parse", key).allowed).toBe(true);
    expect(checkRateLimit("enrich", key).allowed).toBe(true);
    expect(checkRateLimit("weather", key).allowed).toBe(true);
  });

  it("keeps distinct keys independent within the same op", () => {
    const a = freshKey("a");
    const b = freshKey("b");
    for (let i = 0; i < 10; i++) checkRateLimit("classify", a);
    expect(checkRateLimit("classify", a).allowed).toBe(false); // a exhausted
    expect(checkRateLimit("classify", b).allowed).toBe(true); // b untouched
  });
});

describe("resolveRateKey — identity precedence", () => {
  it("prefers the authenticated user id", async () => {
    mockUserId = "alice";
    mockXff = "1.2.3.4";
    expect(await resolveRateKey()).toBe("user:alice");
  });

  it("falls back to the first forwarded IP when there is no user id", async () => {
    mockUserId = null;
    mockXff = "9.9.9.9, 10.0.0.1, 172.16.0.1"; // Vercel: client first, then proxies
    expect(await resolveRateKey()).toBe("ip:9.9.9.9");
  });

  it("falls back to the forwarded IP for a GUEST (shared guest id is not specific enough)", async () => {
    mockUserId = GUEST_USER_ID;
    mockXff = "203.0.113.5";
    expect(await resolveRateKey()).toBe("ip:203.0.113.5");
  });

  it('falls all the way back to "anon" when there is neither a user id nor a forwarded IP', async () => {
    mockUserId = null;
    mockXff = null;
    expect(await resolveRateKey()).toBe("anon");
  });

  it("trims whitespace around the chosen forwarded IP", async () => {
    mockUserId = null;
    mockXff = "  8.8.8.8 , 1.1.1.1";
    expect(await resolveRateKey()).toBe("ip:8.8.8.8");
  });
});

// Type-level smoke: the op union is exactly these four. (Compilation is the assertion.)
const _ops: RateLimitOp[] = ["classify", "parse", "enrich", "weather"];
