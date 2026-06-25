// Cross-tenant isolation guard — the real backstop for a LOW security finding (2026-06-24):
//
//   The app connects to Postgres as the table OWNER role, which BYPASSES RLS unless a table sets
//   FORCE ROW LEVEL SECURITY — and none do. So the RLS policies are DORMANT for the app's own
//   connection (they guard only the public PostgREST/anon surface). The app-layer
//   `WHERE user_id = $userId` (or a userId-keyed parent-item check) is therefore the SOLE LIVE tenant
//   isolation, with NO DB backstop. There is no current leak — every live method already filters by
//   userId — but a future method added without a userId predicate would silently leak.
//
// This test is that backstop. It seeds user A with items + a trip + item_evidence + a per-user cache
// override, then asserts user B CANNOT read or mutate ANY of A's data through ANY method of the
// GearRepository or the ClassificationCacheRepository. The hermetic gate runs against the MEMORY
// impls, which carry the SAME app-layer isolation contract as the Postgres impls (the parent-item
// EXISTS gate, the userId-keyed override map). Its PURPOSE: adding a future method that forgets the
// userId predicate breaks the EVERY-METHOD coverage list below.
//
// IMPORTANT modelling note: the memory repo pre-seeds every user with the SEED_CORPUS, whose items
// share the same ids (slugs) ACROSS users by design — each user gets their own copy of those rows.
// A shared-slug id is not an isolation probe. To probe cross-tenant access we use items/trips that A
// CREATES at runtime (fresh randomUUID ids unique to A); user B must never reach those.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { memoryRepository as repo } from "@/server/memory-repo";
import { memoryCache as cache } from "@/server/memory-cache";
import { normalizeCacheKey } from "@/core/cache";
import { defaultConditions } from "@/core/conditions";
import type { EvidenceClaim, GearRepository } from "@/core/ports";
import type { ItemClassification } from "@/core/classification";
import type { RecommendationResult } from "@/core/recommend";
import { SEED_CORPUS } from "@/core/seed-corpus";

// A unique user id per test keeps the process-local store isolated (the repo seeds each user once).
const freshUser = () => randomUUID();

const SAMPLE_CLASSIFICATION: ItemClassification = SEED_CORPUS[0]!.classification;
const SAMPLE_RESULT = { picks: [], gaps: [] } as unknown as RecommendationResult;

const A_CLAIMS: EvidenceClaim[] = [
  {
    facetKey: "waterproofness",
    value: "waterproof",
    confidence: "high",
    source: "manufacturer",
    evidence: "A-owned claim",
    observedAt: "2026-06-24T00:00:00.000Z",
  },
];

/** A throwaway classification with a chosen name, derived from a real seed entry so it validates. */
function fixtureClassification(name: string): ItemClassification {
  const c = structuredClone(SEED_CORPUS[0]!.classification);
  c.name = name;
  return c;
}

/**
 * Seed user A with one runtime-created item (fresh id), its evidence, and one runtime-created trip.
 * Returns the ids B must never reach. (Both also exist as a sanity check for A's own access.)
 */
async function seedUserA(userA: string) {
  const item = await repo.addItem(userA, {
    name: "A-private-item",
    inInventory: true,
    classification: SAMPLE_CLASSIFICATION,
  });
  await repo.replaceItemEvidence(userA, item.id, A_CLAIMS);
  const trip = await repo.saveTrip(userA, {
    name: "A-private-trip",
    conditions: defaultConditions({ wind: "calm" }),
    result: SAMPLE_RESULT,
  });
  return { itemId: item.id, tripId: trip.id };
}

describe("cross-tenant guard — user B cannot reach user A's data through any method", () => {
  // ---- item READ methods ----

  it("getItem(B, A-itemId) → null", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);

    expect(await repo.getItem(userB, itemId)).toBeNull();
    // sanity: A can read its own item
    expect((await repo.getItem(userA, itemId))?.id).toBe(itemId);
  });

  it("listItems(B) and listItemsPage(B) exclude A's item", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);

    const bList = await repo.listItems(userB);
    expect(bList.some((i) => i.id === itemId)).toBe(false);

    // Walk every page B can see; A's item must never appear.
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = await repo.listItemsPage(userB, { cursor, limit: 5 });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && ++guard < 100);
    expect(seen.some((id) => id === itemId)).toBe(false);

    // sanity: A's own listing includes it.
    expect((await repo.listItems(userA)).some((i) => i.id === itemId)).toBe(true);
  });

  it("getItemEvidence(B, A-itemId) → empty (parent-item gate)", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);

    expect(await repo.getItemEvidence(userB, itemId)).toEqual([]);
    // sanity: A reads its own evidence.
    expect((await repo.getItemEvidence(userA, itemId)).length).toBe(A_CLAIMS.length);
  });

  // ---- item MUTATION methods (must be no-op / not-found for B; A's row unchanged) ----

  it("updateClassification(B, A-itemId) → null and does NOT mutate A's row", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);

    const intruder = fixtureClassification("HIJACKED");
    expect(await repo.updateClassification(userB, itemId, intruder)).toBeNull();

    const aAfter = await repo.getItem(userA, itemId);
    expect(aAfter!.classification.name).not.toBe("HIJACKED");
    expect(aAfter!.name).not.toBe("HIJACKED");
  });

  it("setInventory(B, A-itemId) → null and does NOT mutate A's row", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);
    const before = (await repo.getItem(userA, itemId))!.inInventory;

    expect(await repo.setInventory(userB, itemId, !before)).toBeNull();
    expect((await repo.getItem(userA, itemId))!.inInventory).toBe(before);
  });

  it("setDraft(B, A-itemId) → null and does NOT mutate A's row", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);
    const before = (await repo.getItem(userA, itemId))!.draft;

    expect(await repo.setDraft(userB, itemId, !before)).toBeNull();
    expect((await repo.getItem(userA, itemId))!.draft).toBe(before);
  });

  it("deleteItem(B, A-itemId) is a no-op — A's row survives", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);

    await repo.deleteItem(userB, itemId);
    expect(await repo.getItem(userA, itemId)).not.toBeNull();
  });

  it("setItemImagePath(B, A-itemId) → null and does NOT set A's photo path (ADR-0018)", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);
    const before = (await repo.getItem(userA, itemId))!.imagePath ?? null;

    // B attempting to attach a photo to A's item must be a no-op returning null.
    expect(await repo.setItemImagePath(userB, itemId, `${userB}/${itemId}/intruder.jpg`)).toBeNull();
    expect((await repo.getItem(userA, itemId))!.imagePath ?? null).toBe(before);
    // sanity: A can set + clear its own item's photo path.
    const set = await repo.setItemImagePath(userA, itemId, `${userA}/${itemId}/own.jpg`);
    expect(set!.imagePath).toBe(`${userA}/${itemId}/own.jpg`);
    expect((await repo.setItemImagePath(userA, itemId, null))!.imagePath).toBeNull();
  });

  it("replaceItemEvidence(B, A-itemId, …) does NOT write/clear A's evidence", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { itemId } = await seedUserA(userA);

    await repo.replaceItemEvidence(userB, itemId, [
      { facetKey: "warmth", value: "hot", confidence: "high", source: "user", evidence: "B intruder write" },
    ]);

    const aEvidence = await repo.getItemEvidence(userA, itemId);
    expect(aEvidence.length).toBe(A_CLAIMS.length);
    expect(aEvidence.some((r) => r.evidence === "B intruder write")).toBe(false);
  });

  // ---- trip READ methods ----

  it("getTrip(B, A-tripId) → null; listTrips(B) excludes A's trip", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { tripId } = await seedUserA(userA);

    expect(await repo.getTrip(userB, tripId)).toBeNull();
    expect((await repo.listTrips(userB)).some((t) => t.id === tripId)).toBe(false);
    // sanity: A can read its own trip.
    expect((await repo.getTrip(userA, tripId))?.id).toBe(tripId);
  });

  // ---- trip MUTATION methods (must be no-op / not-found for B; A's trip unchanged) ----

  it("updateTripResult(B, A-tripId) → null and does NOT mutate A's trip", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { tripId } = await seedUserA(userA);

    const intruderResult = { picks: ["X"], gaps: ["Y"] } as unknown as RecommendationResult;
    expect(await repo.updateTripResult(userB, tripId, intruderResult)).toBeNull();
    expect((await repo.getTrip(userA, tripId))!.result).toEqual(SAMPLE_RESULT);
  });

  it("renameTrip(B, A-tripId) is a no-op — A's trip name unchanged", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { tripId } = await seedUserA(userA);

    await repo.renameTrip(userB, tripId, "HIJACKED");
    expect((await repo.getTrip(userA, tripId))!.name).toBe("A-private-trip");
  });

  it("updateTripConditions(B, A-tripId) is a no-op — A's conditions/result unchanged", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { tripId } = await seedUserA(userA);
    const before = (await repo.getTrip(userA, tripId))!;

    await repo.updateTripConditions(userB, tripId, defaultConditions({ wind: "strong", precipitation: "snow" }));
    const after = (await repo.getTrip(userA, tripId))!;
    expect(after.conditions).toEqual(before.conditions);
    expect(after.result).toEqual(SAMPLE_RESULT); // not cleared by B's attempt
  });

  it("cloneTrip(B, A-tripId) throws (not found for B) and creates NOTHING for B", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { tripId } = await seedUserA(userA);

    await expect(repo.cloneTrip(userB, tripId)).rejects.toThrow();
    expect(await repo.listTrips(userB)).toEqual([]); // B got no clone
  });

  it("deleteTrip(B, A-tripId) is a no-op — A's trip survives", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const { tripId } = await seedUserA(userA);

    await repo.deleteTrip(userB, tripId);
    expect(await repo.getTrip(userA, tripId)).not.toBeNull();
  });

  // ---- classification cache: a per-user override must never surface for another user ----

  it("cache.lookup(B, key) never returns A's user_override", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const name = `Tenant Override ${randomUUID()}`;
    const key = normalizeCacheKey(name);

    const aOverride = fixtureClassification(name);
    aOverride.universal.warmth = { value: "very_high", confidence: "high", source: "user", evidence: "user A" };
    await cache.putUserOverride(userA, key, name, aOverride);

    // A sees its own override; B (no shared draft for this key) falls through to null.
    const aHit = await cache.lookup(userA, key);
    expect(aHit?.authority).toBe("user");
    expect(aHit?.classification.universal.warmth.value).toBe("very_high");
    expect(await cache.lookup(userB, key)).toBeNull();
  });

  // ---- coverage tripwire ---------------------------------------------------------------------------
  // EVERY method of the GearRepository port is enumerated above. This list is asserted against the
  // live object's keys so adding a new repo method WITHOUT a cross-tenant assertion here fails the
  // suite — forcing the author to prove the new method carries a userId predicate. (putDraft is a
  // GLOBAL low-authority write with no per-user scope by design, so it is intentionally not a
  // cross-tenant method; lookup/putUserOverride ARE covered above.)

  it("covers every GearRepository method (tripwire for a future un-scoped method)", () => {
    const covered: Array<keyof GearRepository> = [
      "listItems",
      "listItemsPage",
      "getItem",
      "addItem", // creates A's own row (the probe subject); not a cross-tenant read of B
      "updateClassification",
      "setInventory",
      "setDraft",
      "setItemImagePath",
      "deleteItem",
      "replaceItemEvidence",
      "getItemEvidence",
      "listTrips",
      "getTrip",
      "saveTrip", // creates A's own trip (the probe subject)
      "updateTripResult",
      "renameTrip",
      "updateTripConditions",
      "cloneTrip",
      "deleteTrip",
    ];
    const actual = Object.keys(repo).sort();
    expect([...covered].sort()).toEqual(actual);
  });
});
