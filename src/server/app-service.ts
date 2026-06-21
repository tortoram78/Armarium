// Application service — the thin layer the UI (pages, actions) calls. Ties the repository to the pure
// core (resolve, group, plan). Pages never import core reasoning directly; they go through here.

import { getRepository, getCacheRepository, getClassifier, getTripParser, DEFAULT_USER_ID } from "./services";
import { normalizeCacheKey } from "@/core/cache";
import { MODEL_ID } from "@/core/config";
import { resolveFromClassification, type ResolvedItem } from "@/core/resolved";
import { groupCloset, type GroupingKey } from "@/core/closet";
import { planTrip } from "@/core/recommend/plan";
import type { TripConditions } from "@/core/conditions";
import type { ItemClassification } from "@/core/classification";
import type { StoredItem, StoredTrip } from "@/core/ports";

export function resolveItem(i: StoredItem): ResolvedItem {
  return resolveFromClassification(i.id, i.classification);
}

export async function getAllItems(userId = DEFAULT_USER_ID): Promise<StoredItem[]> {
  return getRepository().listItems(userId);
}

export async function getItem(id: string, userId = DEFAULT_USER_ID): Promise<StoredItem | null> {
  return getRepository().getItem(userId, id);
}

/** The closet = owned, confirmed items. Drafts (awaiting review) are excluded. */
export async function getInventory(userId = DEFAULT_USER_ID): Promise<StoredItem[]> {
  return (await getRepository().listItems(userId)).filter((i) => i.inInventory && !i.draft);
}

export async function getInventoryResolved(userId = DEFAULT_USER_ID): Promise<ResolvedItem[]> {
  return (await getInventory(userId)).map(resolveItem);
}

export async function getCloset(dimension: GroupingKey, userId = DEFAULT_USER_ID) {
  const items = await getInventory(userId);
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const groups = groupCloset(items.map(resolveItem), dimension);
  return { items, byId, groups };
}

export async function planAndSave(
  name: string,
  conditions: TripConditions,
  description: string | undefined,
  userId = DEFAULT_USER_ID,
) {
  const inv = await getInventoryResolved(userId);
  const result = planTrip(inv, name, conditions, description);
  return getRepository().saveTrip(userId, { name, description, conditions, result });
}

// ---- add-by-name (review-before-save) ----

export type AddMode = "live" | "offline";

/**
 * Classify a named item and store it as a DRAFT (not yet in the closet) for review. Checks the
 * self-building knowledge base FIRST: a cache hit reuses a stored classification (no LLM call); a miss
 * classifies live/offline and writes the result back to the cache. The review step still gates it.
 */
export async function classifyToDraft(
  name: string,
  text: string | undefined,
  inInventory: boolean,
  userId = DEFAULT_USER_ID,
): Promise<{ item: StoredItem; mode: AddMode; fromCache: boolean }> {
  const cache = getCacheRepository();
  const key = normalizeCacheKey(name);
  const cached = await cache.getCached(key);

  let classification: ItemClassification;
  if (cached) {
    classification = cached.classification;
  } else {
    const { classify } = getClassifier();
    classification = await classify({ name, text });
    await cache.putCached({ key, name, classification, source: "llm", modelId: MODEL_ID });
  }

  const item = await getRepository().addItem(userId, { name, inInventory, draft: true, rawText: text, classification });
  return { item, mode: classifierMode(), fromCache: Boolean(cached) };
}

/** Promote a reviewed draft into the closet. The confirmation endorses its classification into the KB. */
export async function confirmDraft(id: string, userId = DEFAULT_USER_ID): Promise<StoredItem | null> {
  const item = await getRepository().setDraft(userId, id, false);
  if (item) {
    await getCacheRepository().putCached({
      key: normalizeCacheKey(item.name),
      name: item.name,
      classification: item.classification,
      source: "user",
      modelId: MODEL_ID,
    });
  }
  return item;
}

export async function updateItemClassification(
  id: string,
  classification: ItemClassification,
  userId = DEFAULT_USER_ID,
): Promise<StoredItem | null> {
  const updated = await getRepository().updateClassification(userId, id, classification);
  if (updated) {
    // A user correction is authoritative — feed it back so future adds of this item improve.
    await getCacheRepository().putCached({
      key: normalizeCacheKey(classification.name),
      name: classification.name,
      classification,
      source: "user",
      modelId: MODEL_ID,
    });
  }
  return updated;
}

export async function setInventory(id: string, inInventory: boolean, userId = DEFAULT_USER_ID) {
  return getRepository().setInventory(userId, id, inInventory);
}

export async function deleteItem(id: string, userId = DEFAULT_USER_ID) {
  return getRepository().deleteItem(userId, id);
}

export function classifierMode(): AddMode {
  return getClassifier().mode;
}

// ---- trips ----

/** Parse a free-text trip description into a structured envelope (NL path). */
export async function parseDescription(description: string): Promise<TripConditions> {
  return getTripParser().parse(description);
}

export function tripParserMode(): AddMode {
  return getTripParser().mode;
}

export async function getTrips(userId = DEFAULT_USER_ID): Promise<StoredTrip[]> {
  return getRepository().listTrips(userId);
}

export async function getTrip(id: string, userId = DEFAULT_USER_ID): Promise<StoredTrip | null> {
  return getRepository().getTrip(userId, id);
}

/** Re-run a saved trip against the CURRENT closet (after corrections) and persist the new result. */
export async function replanTrip(id: string, userId = DEFAULT_USER_ID): Promise<StoredTrip | null> {
  const repo = getRepository();
  const trip = await repo.getTrip(userId, id);
  if (!trip) return null;
  const inv = await getInventoryResolved(userId);
  const result = planTrip(inv, trip.name, trip.conditions, trip.description);
  return repo.updateTripResult(userId, id, result);
}
