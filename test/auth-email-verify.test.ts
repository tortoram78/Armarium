// ADR-0032 — email-verification enforcement. The pure predicate + a guarantee that the dev/passthrough
// path (auth unconfigured, the hermetic gate) is UNAFFECTED — the enforcement must never gate out the
// fixed dev user, or the whole offline app + gauntlet would break.

import { describe, it, expect } from "vitest";
import { isEmailVerified, getSessionUser, getCurrentUserId, isAuthConfigured } from "@/lib/auth";

describe("isEmailVerified (ADR-0032)", () => {
  it("is true only when a confirmation timestamp is present", () => {
    expect(isEmailVerified({ email_confirmed_at: "2026-01-01T00:00:00Z" })).toBe(true);
    expect(isEmailVerified({ confirmed_at: "2026-01-01T00:00:00Z" })).toBe(true);
    expect(isEmailVerified({ email_confirmed_at: null, confirmed_at: null })).toBe(false);
    expect(isEmailVerified({})).toBe(false);
    expect(isEmailVerified(null)).toBe(false);
    expect(isEmailVerified(undefined)).toBe(false);
  });
});

describe("dev/passthrough is unchanged by the verification gate", () => {
  it("auth is unconfigured in the hermetic gate", () => {
    expect(isAuthConfigured()).toBe(false);
  });

  it("the fixed dev user resolves as a verified session — never gated out", async () => {
    const u = await getSessionUser();
    expect(u).not.toBeNull();
    expect(u!.emailVerified).toBe(true);
    const id = await getCurrentUserId();
    expect(id).toBe(u!.id);
    expect(id).not.toBeNull();
  });
});
