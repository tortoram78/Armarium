// Tests the ops-hardening wave B2 wiring in src/app/actions.ts: the rate-limit guard + timeAndLog wrap on
// the four expensive actions. Two invariants per action:
//   1. A rate-limit REJECT degrades gracefully — a friendly redirect (?error=rate-limited copy) for the
//      redirect actions, `{ ok:false }` for the value-returning weather action. NEVER a thrown 500.
//   2. The timeAndLog wrap is observability-only: when the limiter ALLOWS, the action's outcome is
//      unchanged (same redirect target / same value) and the underlying service is still invoked.
//
// We mock the seams the action depends on: identity (@/lib/auth), the guard (@/server/ratelimit-guard),
// the core services (@/server/app-service), and next/navigation+next/cache. `redirect()` is mocked to
// THROW a tagged error carrying its target (matching Next's real control-flow throw) so we can assert the
// destination without a live request. Hermetic — no env, no network.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mutable mock state (reset per test) ----
let allowed = true;

// next/navigation.redirect throws in real Next; mirror that so the action's control flow is faithful and
// the test can capture the target from the thrown marker.
class RedirectError extends Error {
  constructor(public target: string) {
    super("NEXT_REDIRECT");
  }
}
function expectRedirect(fn: () => Promise<unknown>): Promise<string> {
  return fn().then(
    () => {
      throw new Error("expected a redirect, but the action returned normally");
    },
    (e) => {
      if (e instanceof RedirectError) return e.target;
      throw e;
    },
  );
}

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectError(target);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  requireUserId: async () => "user-1",
  getUserIdOrGuest: async () => ({ userId: "user-1", isGuest: false }),
}));

vi.mock("@/server/ratelimit-guard", () => ({
  resolveRateKey: async () => "user:user-1",
  checkRateLimit: () => ({ allowed, retryAfterMs: allowed ? 0 : 5000 }),
}));

// The core services the actions call. Each returns a minimal shape the action reads.
const classifyToDraft = vi.fn(async () => ({ item: { id: "item-9" } }));
const enrichFromUrlToDraft = vi.fn(
  async (): Promise<{ ok: true; draftId: string } | { ok: false; reason: string }> => ({
    ok: true,
    draftId: "draft-7",
  }),
);
const parseDescription = vi.fn(async () => ({ kind: "cond" }));
const planAndSave = vi.fn(async () => ({ id: "trip-3" }));
const getForecast = vi.fn(async () => null);

vi.mock("@/server/app-service", () => ({
  classifyToDraft: (...a: unknown[]) => classifyToDraft(...(a as [])),
  enrichFromUrlToDraft: (...a: unknown[]) => enrichFromUrlToDraft(...(a as [])),
  parseDescription: (...a: unknown[]) => parseDescription(...(a as [])),
  planAndSave: (...a: unknown[]) => planAndSave(...(a as [])),
  // unused-by-these-tests exports the action module imports at top level (kept so the import resolves):
  confirmDraft: vi.fn(),
  deleteItem: vi.fn(),
  updateItemClassification: vi.fn(),
  setInventory: vi.fn(),
  planPreview: vi.fn(),
  getItem: vi.fn(),
  replanTrip: vi.fn(),
  renameTrip: vi.fn(),
  cloneTrip: vi.fn(),
  deleteTrip: vi.fn(),
  updateTripConditions: vi.fn(),
}));

// weather-fetcher is dynamically imported inside the action; mock it so the allowed-path test is hermetic.
vi.mock("@/server/weather-fetcher", () => ({ getForecast: (...a: unknown[]) => getForecast(...(a as [])) }));

import {
  addItemAction,
  planFromDescriptionAction,
  getWeatherConditionsAction,
} from "@/app/actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  allowed = true;
  classifyToDraft.mockClear();
  enrichFromUrlToDraft.mockClear();
  parseDescription.mockClear();
  planAndSave.mockClear();
  getForecast.mockClear();
  // Quiet the structured log lines timeAndLog emits during the allowed path.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("rate-limit reject — graceful degradation (never a 500)", () => {
  it("addItemAction redirects to /items/new with the friendly rate-limit error and never classifies", async () => {
    allowed = false;
    const target = await expectRedirect(() => addItemAction(fd({ name: "Beta AR" })));
    expect(target.startsWith("/items/new?error=")).toBe(true);
    expect(decodeURIComponent(target)).toContain("going a bit fast");
    expect(classifyToDraft).not.toHaveBeenCalled();
  });

  it("addItemAction with a link redirects with the friendly rate-limit error and never fetches", async () => {
    allowed = false;
    const target = await expectRedirect(() =>
      addItemAction(fd({ url: "https://www.patagonia.com/product/x" })),
    );
    expect(target.startsWith("/items/new?error=")).toBe(true);
    expect(decodeURIComponent(target)).toContain("going a bit fast");
    expect(enrichFromUrlToDraft).not.toHaveBeenCalled();
  });

  it("planFromDescriptionAction redirects to /plan with the friendly rate-limit error and never parses", async () => {
    allowed = false;
    const target = await expectRedirect(() =>
      planFromDescriptionAction(fd({ name: "Trip", description: "cold alpine day" })),
    );
    expect(target.startsWith("/plan?error=")).toBe(true);
    expect(decodeURIComponent(target)).toContain("going a bit fast");
    expect(parseDescription).not.toHaveBeenCalled();
  });

  it("getWeatherConditionsAction returns { ok:false } (manual fallback) and never forecasts", async () => {
    allowed = false;
    const result = await getWeatherConditionsAction(
      fd({ location: "Denver", startDate: "2026-07-01", endDate: "2026-07-03" }),
    );
    expect(result).toEqual({ ok: false });
    expect(getForecast).not.toHaveBeenCalled();
  });
});

describe("rate-limit allowed — timeAndLog wrap is observability-only (outcome unchanged)", () => {
  it("addItemAction still classifies and redirects to the review screen", async () => {
    const target = await expectRedirect(() => addItemAction(fd({ name: "Beta AR" })));
    expect(target).toBe("/items/item-9/review");
    expect(classifyToDraft).toHaveBeenCalledTimes(1);
  });

  it("addItemAction with a link enriches and redirects to the review screen", async () => {
    const target = await expectRedirect(() =>
      addItemAction(fd({ url: "https://www.patagonia.com/product/x" })),
    );
    expect(target).toBe("/items/draft-7/review");
    expect(enrichFromUrlToDraft).toHaveBeenCalledTimes(1);
  });

  it("addItemAction falls back to classifying the typed name when the link yields no signal", async () => {
    // The bot-walled-brand rescue: link returns { ok:false }, but the user also typed a name → classify it.
    enrichFromUrlToDraft.mockResolvedValueOnce({ ok: false as const, reason: "no-signal: nothing to import" });
    const target = await expectRedirect(() =>
      addItemAction(fd({ url: "https://www.patagonia.com/product/x", name: "Patagonia Nano Puff" })),
    );
    expect(target).toBe("/items/item-9/review");
    expect(enrichFromUrlToDraft).toHaveBeenCalledTimes(1);
    expect(classifyToDraft).toHaveBeenCalledTimes(1);
  });

  it("planFromDescriptionAction still parses + saves and redirects to the trip dossier", async () => {
    const target = await expectRedirect(() =>
      planFromDescriptionAction(fd({ name: "Trip", description: "cold alpine day" })),
    );
    expect(target).toBe("/trips/trip-3");
    expect(parseDescription).toHaveBeenCalledTimes(1);
    expect(planAndSave).toHaveBeenCalledTimes(1);
  });

  it("getWeatherConditionsAction runs the lookup (returns the fetcher's { ok:false } here) without throwing", async () => {
    const result = await getWeatherConditionsAction(
      fd({ location: "Denver", startDate: "2026-07-01", endDate: "2026-07-03" }),
    );
    // getForecast mock returns null → action degrades to { ok:false }, but it WAS invoked (limit allowed).
    expect(result).toEqual({ ok: false });
    expect(getForecast).toHaveBeenCalledTimes(1);
  });
});
