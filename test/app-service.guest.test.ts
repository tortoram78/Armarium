// Hermetic tests for the demo → "log in to save" funnel FOUNDATION at the SERVICE level
// (src/server/services.ts + src/server/app-service.ts). In-memory repo, no DB, no API key.
//
// The decisive properties:
//   - GUEST_USER_ID is distinct from DEFAULT_USER_ID (no tenant collision).
//   - getInventory(GUEST_USER_ID) yields EXACTLY the SEED_CORPUS in-inventory items (reuses the seed via
//     ensureSeeded — DATA, not a bespoke guest list).
//   - planPreview(GUEST_USER_ID, conditions) returns a RecommendationResult and does NOT persist
//     (getTrips(GUEST_USER_ID) stays empty after).
//   - the repo selector forces a GUEST read onto the in-memory repo EVEN WHEN DATABASE_URL is set, while
//     an authenticated id routes to the Postgres path.
//   - Marcy cross-archetype guard: a guest preview against the seed surfaces the canonical alpine gaps —
//     proving guest planning runs the REAL engine over seed data (no hardcoding).

import { describe, it, expect } from "vitest";
import { getInventory, getTrips, planPreview } from "@/server/app-service";
import { GUEST_USER_ID, DEFAULT_USER_ID, getMemoryRepository, getRepositoryFor, getRepository } from "@/server/services";
import { memoryRepository } from "@/server/memory-repo";
import { INVENTORY_SEED } from "@/core/seed-corpus";
import { MARCY_CONDITIONS } from "@/core/trips";

describe("GUEST_USER_ID vs DEFAULT_USER_ID — no tenant collision", () => {
  it("the guest id is distinct from the dev/default user id", () => {
    expect(GUEST_USER_ID).not.toBe(DEFAULT_USER_ID);
  });
});

describe("getInventory(GUEST_USER_ID) — the seeded sample closet (reuses SEED_CORPUS, not bespoke)", () => {
  it("yields exactly the SEED_CORPUS in-inventory items", async () => {
    const inv = await getInventory(GUEST_USER_ID);
    // The closet = inInventory && !draft. ensureSeeded marks every seed item draft:false, so the guest
    // closet is precisely the in-inventory slice of the corpus.
    const expectedSlugs = INVENTORY_SEED.map((e) => e.slug).sort();
    expect(inv.map((i) => i.id).sort()).toEqual(expectedSlugs);
    expect(inv.length).toBe(INVENTORY_SEED.length);
    // The names match the corpus classifications — the guest reads the SAME data, not a special-cased list.
    const expectedNames = INVENTORY_SEED.map((e) => e.classification.name).sort();
    expect(inv.map((i) => i.name).sort()).toEqual(expectedNames);
    // Every returned item belongs to the guest tenant (user_id isolation holds for the guest read).
    expect(inv.every((i) => i.userId === GUEST_USER_ID)).toBe(true);
  });
});

describe("planPreview — READ-ONLY plan over the guest seed, no persistence", () => {
  it("returns a RecommendationResult and does NOT save a trip", async () => {
    const before = await getTrips(GUEST_USER_ID);
    expect(before).toEqual([]); // a fresh guest has no trips

    const result = await planPreview("Guest preview", MARCY_CONDITIONS, undefined, GUEST_USER_ID);

    // RecommendationResult shape (the contract the UI wave renders).
    expect(result.trip).toBe("Guest preview");
    expect(Array.isArray(result.outcomes)).toBe(true);
    expect(Array.isArray(result.picks)).toBe(true);
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(Array.isArray(result.uncertain)).toBe(true);

    // No persistence — the guest's trip list is still empty after a preview.
    const after = await getTrips(GUEST_USER_ID);
    expect(after).toEqual([]);
  });

  it("MARCY cross-archetype guard: a guest preview surfaces the canonical alpine gaps (real engine, no hardcoding)", async () => {
    const result = await planPreview("Mount Marcy", MARCY_CONDITIONS, undefined, GUEST_USER_ID);
    const gaps = result.gaps.map((g) => g.capability).sort();
    // The same three gaps the canonical Marcy test asserts — produced here by planning over the GUEST's
    // seeded closet through the general engine (conditions → derived requirements → recommend).
    expect(gaps).toEqual(["packable_insulation", "weather_shell", "wicking_base"]);
    // weather_shell is the critical missing capability.
    expect(result.gaps.find((g) => g.capability === "weather_shell")?.severity).toBe("critical");
    // The Terre Planing (a seed item) is still picked for its real strength, sun protection.
    expect(result.picks.some((p) => p.id === "terre-planing")).toBe(true);
  });
});

describe("repo selector — guest reads forced to memory; authenticated routes to the env repo", () => {
  it("getMemoryRepository() is the in-memory singleton", () => {
    expect(getMemoryRepository()).toBe(memoryRepository);
  });

  it("getRepositoryFor(GUEST_USER_ID) is ALWAYS the memory repo (no DATABASE_URL in this gate)", () => {
    expect(getRepositoryFor(GUEST_USER_ID)).toBe(memoryRepository);
  });

  it("getRepositoryFor(non-guest) delegates to the env-selected repository (memory here, Postgres when DATABASE_URL is set)", () => {
    // In the hermetic gate (no DATABASE_URL) the env repo IS the memory repo, so both resolve to it —
    // the routing decision (guest → memory, other → env) is what we assert. The DATABASE_URL-set case is
    // proven in the isolated-module test below.
    expect(getRepositoryFor(DEFAULT_USER_ID)).toBe(getRepository());
  });

  it("guest forced to memory EVEN WHEN DATABASE_URL is set; authenticated id uses Postgres", async () => {
    // Construct the production-shaped state explicitly: DATABASE_URL set BEFORE the module computes its
    // env-selected repo. vi.resetModules + a fresh dynamic import gives services.ts an uncached `repo`.
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://stub:stub@localhost:5432/stub");
    try {
      const services = await import("@/server/services");
      const memrepo = await import("@/server/memory-repo");
      const pg = await import("@/server/postgres-repo");

      // The guest read is forced to memory even though DATABASE_URL is set.
      expect(services.getRepositoryFor(services.GUEST_USER_ID)).toBe(memrepo.memoryRepository);
      // An authenticated id routes to the Postgres repo (lazy — referencing it opens no connection).
      expect(services.getRepositoryFor(services.DEFAULT_USER_ID)).toBe(pg.postgresRepository);
      // And the two are genuinely different backing stores.
      expect(services.getRepositoryFor(services.GUEST_USER_ID)).not.toBe(
        services.getRepositoryFor(services.DEFAULT_USER_ID),
      );
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
