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
