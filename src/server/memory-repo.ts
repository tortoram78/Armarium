// In-memory GearRepository — makes Armarium fully runnable with NO database (dev, demo, tests, and
// this sandbox). Seeded once per user from the prototype corpus. Swapped for the Postgres repo when
// DATABASE_URL is set (see repository.ts). Process-local and ephemeral by design.

import { randomUUID } from "node:crypto";
import type { GearRepository, StoredItem, StoredTrip, AddItemInput, SaveTripInput } from "@/core/ports";
import { SEED_CORPUS } from "@/core/seed-corpus";

const itemsByUser = new Map<string, StoredItem[]>();
const tripsByUser = new Map<string, StoredTrip[]>();
const seeded = new Set<string>();

function ensureSeeded(userId: string) {
  if (seeded.has(userId)) return;
  seeded.add(userId);
  const now = new Date().toISOString();
  itemsByUser.set(
    userId,
    SEED_CORPUS.map((e) => ({
      id: e.slug,
      userId,
      name: e.classification.name,
      inInventory: e.inInventory,
      rawText: e.input.text,
      classification: structuredClone(e.classification),
      createdAt: now,
    })),
  );
  tripsByUser.set(userId, []);
}

function items(userId: string): StoredItem[] {
  ensureSeeded(userId);
  return itemsByUser.get(userId)!;
}
function trips(userId: string): StoredTrip[] {
  ensureSeeded(userId);
  return tripsByUser.get(userId)!;
}

export const memoryRepository: GearRepository = {
  async listItems(userId) {
    return structuredClone(items(userId));
  },
  async getItem(userId, id) {
    return structuredClone(items(userId).find((i) => i.id === id) ?? null);
  },
  async addItem(userId, input: AddItemInput) {
    const item: StoredItem = {
      id: randomUUID(),
      userId,
      name: input.name,
      inInventory: input.inInventory,
      rawText: input.rawText,
      classification: structuredClone(input.classification),
      createdAt: new Date().toISOString(),
    };
    items(userId).unshift(item);
    return structuredClone(item);
  },
  async updateClassification(userId, id, classification) {
    const found = items(userId).find((i) => i.id === id);
    if (!found) return null;
    found.classification = structuredClone(classification);
    found.name = classification.name;
    return structuredClone(found);
  },
  async setInventory(userId, id, inInventory) {
    const found = items(userId).find((i) => i.id === id);
    if (!found) return null;
    found.inInventory = inInventory;
    return structuredClone(found);
  },
  async deleteItem(userId, id) {
    const list = items(userId);
    const idx = list.findIndex((i) => i.id === id);
    if (idx >= 0) list.splice(idx, 1);
  },

  async listTrips(userId) {
    return structuredClone(trips(userId));
  },
  async getTrip(userId, id) {
    return structuredClone(trips(userId).find((t) => t.id === id) ?? null);
  },
  async saveTrip(userId, input: SaveTripInput) {
    const trip: StoredTrip = {
      id: randomUUID(),
      userId,
      name: input.name,
      description: input.description,
      conditions: input.conditions,
      result: input.result,
      createdAt: new Date().toISOString(),
    };
    trips(userId).unshift(trip);
    return structuredClone(trip);
  },
};
