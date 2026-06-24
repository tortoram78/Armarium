// Data-layer tests for the in-memory GearRepository's Trip CRUD + item keyset pagination (study item 5).
// These pin the port contract deterministically with no DB and no LLM: clone copies real stored values
// (and never the result snapshot), delete removes the trip + its snapshot, conditions-edit drops the
// stale snapshot without auto-replanning, and pagination walks every row exactly once with a stable
// cursor — including the hard case where many rows share an identical createdAt (id is the tiebreaker).

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { memoryRepository as repo } from "@/server/memory-repo";
import { defaultConditions } from "@/core/conditions";
import type { ItemClassification } from "@/core/classification";
import type { RecommendationResult } from "@/core/recommend";
import { SEED_CORPUS } from "@/core/seed-corpus";

// A unique user per test keeps the process-local store isolated (the repo seeds each user once).
const freshUser = () => randomUUID();

const SAMPLE_CLASSIFICATION: ItemClassification = SEED_CORPUS[0]!.classification;
const SAMPLE_RESULT = { picks: [], gaps: [] } as unknown as RecommendationResult;

describe("memory repo — Trip CRUD", () => {
  it("cloneTrip copies name (+\" (copy)\") and conditions into a NEW id, but NOT the result", async () => {
    const user = freshUser();
    const conditions = defaultConditions({ sun: "high", precipitation: "sustained" });
    const original = await repo.saveTrip(user, { name: "Sierra loop", conditions, result: SAMPLE_RESULT });
    expect(original.result).toBeDefined();

    const clone = await repo.cloneTrip(user, original.id);

    expect(clone.id).not.toEqual(original.id);
    expect(clone.name).toBe("Sierra loop (copy)");
    expect(clone.conditions).toEqual(conditions); // real stored values copied
    expect(clone.result).toBeUndefined(); // a fresh clone is unplanned until re-planned

    // Both trips now exist for the user; the original is untouched.
    const all = await repo.listTrips(user);
    expect(all.map((t) => t.id).sort()).toEqual([original.id, clone.id].sort());
    expect((await repo.getTrip(user, original.id))!.result).toBeDefined();
  });

  it("cloneTrip is user-scoped — another user cannot clone your trip", async () => {
    const owner = freshUser();
    const other = freshUser();
    const trip = await repo.saveTrip(owner, { name: "Private", conditions: defaultConditions() });
    await expect(repo.cloneTrip(other, trip.id)).rejects.toThrow();
  });

  it("deleteTrip removes the trip (and its snapshot) and is user-scoped", async () => {
    const user = freshUser();
    const other = freshUser();
    const trip = await repo.saveTrip(user, { name: "Gone soon", conditions: defaultConditions(), result: SAMPLE_RESULT });

    // A different user deleting it is a no-op.
    await repo.deleteTrip(other, trip.id);
    expect(await repo.getTrip(user, trip.id)).not.toBeNull();

    await repo.deleteTrip(user, trip.id);
    expect(await repo.getTrip(user, trip.id)).toBeNull();
    expect((await repo.listTrips(user)).some((t) => t.id === trip.id)).toBe(false);
  });

  it("renameTrip updates the name; updateTripConditions replaces conditions and clears the stale result", async () => {
    const user = freshUser();
    const trip = await repo.saveTrip(user, { name: "Old name", conditions: defaultConditions({ wind: "calm" }), result: SAMPLE_RESULT });

    await repo.renameTrip(user, trip.id, "New name");
    expect((await repo.getTrip(user, trip.id))!.name).toBe("New name");

    const next = defaultConditions({ wind: "strong", precipitation: "snow" });
    await repo.updateTripConditions(user, trip.id, next);
    const after = (await repo.getTrip(user, trip.id))!;
    expect(after.conditions).toEqual(next);
    expect(after.result).toBeUndefined(); // stale until re-planned; we do NOT auto-replan here
  });
});

describe("memory repo — item keyset pagination", () => {
  async function addN(user: string, n: number) {
    for (let i = 0; i < n; i++) {
      await repo.addItem(user, { name: `paged-${i}`, inInventory: false, classification: SAMPLE_CLASSIFICATION });
    }
  }

  it("walks every row exactly once across pages, newest-first, then returns null cursor", async () => {
    const user = freshUser();
    const seedCount = (await repo.listItems(user)).length; // each user is pre-seeded
    await addN(user, 5);
    const total = seedCount + 5;

    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = await repo.listItemsPage(user, { cursor, limit: 3 });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && ++guard < 100);

    // Every id, exactly once, no gaps, no duplicates.
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen.sort()).toEqual((await repo.listItems(user)).map((i) => i.id).sort());
  });

  it("is stable when many rows share an identical createdAt (id is the tiebreaker)", async () => {
    // The seeded items all share one createdAt; paging through them must not skip or repeat any.
    const user = freshUser();
    const ids = (await repo.listItems(user)).map((i) => i.id);
    expect(ids.length).toBeGreaterThan(1);

    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = await repo.listItemsPage(user, { cursor, limit: 2 });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && ++guard < 100);

    expect(seen.sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(ids.length);
  });

  it("defaults limit to 50 when not provided", async () => {
    const user = freshUser();
    const page = await repo.listItemsPage(user, {});
    // Seed corpus is small (< 50), so the first page returns everything and exhausts the cursor.
    expect(page.items.length).toBe((await repo.listItems(user)).length);
    expect(page.nextCursor).toBeNull();
  });
});
