// Hermetic tests for the demo → "log in to save" funnel FOUNDATION (src/lib/auth.ts).
//
// The decisive properties:
//   - getUserIdOrGuest resolves the 3 states EXPLICITLY (we construct configured/unconfigured +
//     session/no-session by stubbing env + mocking the supabase getUser — NOT by relying on the
//     ambient runtime env, since isAuthConfigured() reads NEXT_PUBLIC_* which are inlined at build).
//   - GUEST_USER_ID is a fixed, in-memory-only UUID DISTINCT from DEFAULT_USER_ID.
//   - requireUserId()/getUserIdOrGuest() now ENFORCE email verification (ADR-0032): a configured session
//     whose email is unconfirmed is treated as not-authenticated (requireUserId → /login; getUserIdOrGuest
//     → guest), exactly like no session. Only a CONFIRMED session resolves to the real user id.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the supabase server client so getCurrentUserId()'s dynamic import is intercepted. The mock's
// getUser return is swapped per-test via the mutable `mockUser` ref below.
let mockUser: { id: string; email_confirmed_at?: string | null; confirmed_at?: string | null } | null = null;
const CONFIRMED = "2026-01-01T00:00:00Z"; // a confirmation timestamp → isEmailVerified true (ADR-0032)
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await
      getUser: async () => ({ data: { user: mockUser }, error: null }),
    },
  }),
}));

// next/navigation's redirect throws (it never returns) — stub it so we can assert requireUserId redirects
// without a real router.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  getUserIdOrGuest,
  requireUserId,
  GUEST_USER_ID,
} from "@/lib/auth";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

function configureAuth() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "stub-anon-key");
}
function unconfigureAuth() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
}

beforeEach(() => {
  mockUser = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GUEST_USER_ID — reserved, fixed, distinct from the dev user", () => {
  it("is a fixed UUID DISTINCT from DEFAULT_USER_ID", () => {
    expect(GUEST_USER_ID).toBe("00000000-0000-0000-0000-000000000999");
    expect(GUEST_USER_ID).not.toBe(DEFAULT_USER_ID);
    // valid UUID shape (so it is a legal user_id wherever one is expected)
    expect(GUEST_USER_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("getUserIdOrGuest — the 3 explicit states", () => {
  it("auth NOT configured → dev passthrough { DEFAULT_USER_ID, isGuest:false }", async () => {
    unconfigureAuth();
    const r = await getUserIdOrGuest();
    expect(r).toEqual({ userId: DEFAULT_USER_ID, isGuest: false });
  });

  it("configured + a CONFIRMED session → { realUserId, isGuest:false }", async () => {
    configureAuth();
    mockUser = { id: "11111111-2222-3333-4444-555555555555", email_confirmed_at: CONFIRMED };
    const r = await getUserIdOrGuest();
    expect(r).toEqual({ userId: "11111111-2222-3333-4444-555555555555", isGuest: false });
    expect(r.isGuest).toBe(false);
  });

  it("configured + an UNCONFIRMED session → treated as guest (ADR-0032 email-verification gate)", async () => {
    configureAuth();
    mockUser = { id: "11111111-2222-3333-4444-555555555555", email_confirmed_at: null };
    const r = await getUserIdOrGuest();
    expect(r).toEqual({ userId: GUEST_USER_ID, isGuest: true });
  });

  it("configured + NO session → { GUEST_USER_ID, isGuest:true }", async () => {
    configureAuth();
    mockUser = null;
    const r = await getUserIdOrGuest();
    expect(r).toEqual({ userId: GUEST_USER_ID, isGuest: true });
    expect(r.userId).toBe(GUEST_USER_ID);
  });
});

describe("requireUserId — UNCHANGED: the gate for writes", () => {
  it("dev passthrough returns DEFAULT_USER_ID (no redirect)", async () => {
    unconfigureAuth();
    await expect(requireUserId()).resolves.toBe(DEFAULT_USER_ID);
  });

  it("configured + a CONFIRMED session returns the real id (no redirect)", async () => {
    configureAuth();
    mockUser = { id: "99999999-8888-7777-6666-555555555555", confirmed_at: CONFIRMED };
    await expect(requireUserId()).resolves.toBe("99999999-8888-7777-6666-555555555555");
  });

  it("configured + an UNCONFIRMED session REDIRECTS to /login (ADR-0032 email-verification gate)", async () => {
    configureAuth();
    mockUser = { id: "99999999-8888-7777-6666-555555555555", email_confirmed_at: null };
    // An unconfirmed account is not authenticated for writes — gated out exactly like no session.
    await expect(requireUserId()).rejects.toThrow("REDIRECT:/login");
  });

  it("configured + NO session REDIRECTS to /login (it never falls back to a guest)", async () => {
    configureAuth();
    mockUser = null;
    // requireUserId must NOT return GUEST_USER_ID — writes stay gated; a guest is redirected to /login.
    await expect(requireUserId()).rejects.toThrow("REDIRECT:/login");
  });
});
