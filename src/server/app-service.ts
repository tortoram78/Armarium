// Application service — the thin layer the UI (pages, actions) calls. Ties the repository to the pure
// core (resolve, group, plan). Pages never import core reasoning directly; they go through here.

import { getRepository, DEFAULT_USER_ID } from "./services";
import { resolveFromClassification, type ResolvedItem } from "@/core/resolved";
import { groupCloset, type GroupingKey } from "@/core/closet";
import { planTrip } from "@/core/recommend/plan";
import type { TripConditions } from "@/core/conditions";
import type { StoredItem } from "@/core/ports";

export function resolveItem(i: StoredItem): ResolvedItem {
  return resolveFromClassification(i.id, i.classification);
}

export async function getAllItems(userId = DEFAULT_USER_ID): Promise<StoredItem[]> {
  return getRepository().listItems(userId);
}

export async function getInventory(userId = DEFAULT_USER_ID): Promise<StoredItem[]> {
  return (await getRepository().listItems(userId)).filter((i) => i.inInventory);
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
