// The display-only photo path (ADR-0018) is part of the StoredItem read shape. These pin that the repo
// surfaces `imagePath` (defaulting to null when no photo) so the closet/item UI wave can sign it — no DB,
// no LLM. The Postgres repo reconstructs the same field from the `image_path` column (rowToStoredItem).

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { memoryRepository as repo } from "@/server/memory-repo";
import { SEED_CORPUS } from "@/core/seed-corpus";
import type { ItemClassification } from "@/core/classification";

const freshUser = () => randomUUID();
const SAMPLE: ItemClassification = SEED_CORPUS[0]!.classification;

describe("memory repo — item imagePath read shape (ADR-0018)", () => {
  it("a newly added item exposes imagePath === null (photo attached by a later upload wave)", async () => {
    const user = freshUser();
    const item = await repo.addItem(user, { name: "no-photo-yet", inInventory: true, classification: SAMPLE });
    expect(item.imagePath).toBeNull();

    // It survives the read path too (getItem / listItems), so the UI can sign it.
    const fetched = await repo.getItem(user, item.id);
    expect(fetched?.imagePath).toBeNull();
    const listed = (await repo.listItems(user)).find((i) => i.id === item.id);
    expect(listed?.imagePath).toBeNull();
  });

  it("seeded corpus items expose imagePath === null (the seed carries no photos)", async () => {
    const user = freshUser();
    const items = await repo.listItems(user);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.imagePath ?? null).toBeNull();
  });
});

describe("memory repo — setItemImagePath write (ADR-0018)", () => {
  it("sets, surfaces on read, and clears (null) the item's photo path", async () => {
    const user = freshUser();
    const item = await repo.addItem(user, { name: "photo-target", inInventory: true, classification: SAMPLE });
    const path = `${user}/${item.id}/abc.jpg`;

    const set = await repo.setItemImagePath(user, item.id, path);
    expect(set?.imagePath).toBe(path);
    // It survives the read path so a freshly-uploaded photo renders on the next page load.
    expect((await repo.getItem(user, item.id))?.imagePath).toBe(path);

    // Clearing (Remove photo) nulls the column.
    const cleared = await repo.setItemImagePath(user, item.id, null);
    expect(cleared?.imagePath).toBeNull();
    expect((await repo.getItem(user, item.id))?.imagePath).toBeNull();
  });

  it("is a no-op (null) for an unknown item id", async () => {
    const user = freshUser();
    expect(await repo.setItemImagePath(user, "does-not-exist", "x/y/z.jpg")).toBeNull();
  });

  it("USER-SCOPING: user B cannot set user A's item photo path", async () => {
    const userA = freshUser();
    const userB = freshUser();
    const item = await repo.addItem(userA, { name: "A-photo", inInventory: true, classification: SAMPLE });

    // B's attempt returns null and never mutates A's row.
    expect(await repo.setItemImagePath(userB, item.id, `${userB}/${item.id}/intruder.jpg`)).toBeNull();
    expect((await repo.getItem(userA, item.id))?.imagePath ?? null).toBeNull();
  });
});
