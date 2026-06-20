// Application service — the thin layer the UI (pages, actions) calls. Ties the repository to the pure
// core (resolve, group, plan). Pages never import core reasoning directly; they go through here.

import { getRepository, getClassifier, getTripParser, DEFAULT_USER_ID } from "./services";
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

/** Classify a named item and store it as a DRAFT (not yet in the closet) for review. */
export async function classifyToDraft(
  name: string,
  text: string | undefined,
  inInventory: boolean,
  userId = DEFAULT_USER_ID,
): Promise<{ item: StoredItem; mode: AddMode }> {
  const { classify, mode } = getClassifier();
  const classification = await classify({ name, text });
  const item = await getRepository().addItem(userId, { name, inInventory, draft: true, rawText: text, classification });
  return { item, mode };
}

/** Promote a reviewed draft into the closet. */
export async function confirmDraft(id: string, userId = DEFAULT_USER_ID): Promise<StoredItem | null> {
  return getRepository().setDraft(userId, id, false);
}

export async function updateItemClassification(
  id: string,
  classification: ItemClassification,
  userId = DEFAULT_USER_ID,
): Promise<StoredItem | null> {
  return getRepository().updateClassification(userId, id, classification);
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
