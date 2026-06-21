"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
// services used indirectly via app-service
import {
  classifyToDraft,
  confirmDraft,
  deleteItem,
  updateItemClassification,
  setInventory,
  planAndSave,
  parseDescription,
  getItem,
  replanTrip,
} from "@/server/app-service";
import { defaultConditions, PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE } from "@/core/conditions";
import { safeParseClassification } from "@/core/classification";
import {
  applyUserCorrections,
  EDITABLE_UNIVERSAL,
  EDITABLE_GROUPS,
  EDITABLE_MULTILABEL,
} from "@/core/corrections";
import { requireUserId } from "@/lib/auth";

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pick<T extends readonly string[]>(v: FormDataEntryValue | null, allowed: T, def: T[number]): T[number] {
  const s = String(v ?? "");
  return (allowed as readonly string[]).includes(s) ? (s as T[number]) : def;
}

export async function replanTripAction(formData: FormData) {
  "use server";
  const userId = await requireUserId();
  const id = String(formData.get("id"));
  await replanTrip(id, userId);
  revalidatePath(`/trips/${id}`);
}

export async function addItemAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim() || undefined;
  const inInventory = formData.get("inInventory") != null;
  if (!name) redirect("/items/new?error=" + encodeURIComponent("Please enter an item name."));

  let itemId: string;
  try {
    const { item } = await classifyToDraft(name, text, inInventory, userId);
    itemId = item.id;
  } catch (e) {
    redirect("/items/new?error=" + encodeURIComponent((e as Error).message) + "&name=" + encodeURIComponent(name));
  }
  revalidatePath("/");
  redirect(`/items/${itemId}/review`);
}

export async function confirmItemAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  await confirmDraft(id, userId);
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
  redirect(`/items/${id}`);
}

export async function discardDraftAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  await deleteItem(id, userId);
  revalidatePath("/");
  redirect("/items/new");
}

export async function updateFacetsAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const item = await getItem(id, userId);
  if (!item) redirect("/");

  // Collect all scalar facet values (universal + group) by path.
  const values: Record<string, string | string[]> = {};
  for (const f of [...EDITABLE_UNIVERSAL, ...EDITABLE_GROUPS]) {
    const v = formData.get(f.path);
    if (v !== null) values[f.path] = String(v);
  }
  // Collect multi-label arrays.
  for (const m of EDITABLE_MULTILABEL) {
    values[m.path] = formData.getAll(m.path).map(String);
  }

  const next = applyUserCorrections(item.classification, values);
  const parsed = safeParseClassification(next);
  if (!parsed.success) {
    redirect(`/items/${id}${item.draft ? "/review" : ""}?facetError=1`);
  }

  await updateItemClassification(id, parsed.data, userId);
  revalidatePath(`/items/${id}`);
  revalidatePath(`/items/${id}/review`);
  revalidatePath("/");
  redirect(item.draft ? `/items/${id}/review` : `/items/${id}`);
}

export async function setInventoryAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const inInventory = String(formData.get("inInventory") ?? "") === "true";
  await setInventory(id, inInventory, userId);
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
}

export async function deleteItemAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  await deleteItem(id, userId);
  revalidatePath("/");
  redirect("/");
}

export async function planFromDescriptionAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim() || "Untitled trip";
  const description = String(formData.get("description") ?? "").trim();
  if (!description) redirect("/plan?error=" + encodeURIComponent("Please enter a trip description."));

  const conditions = await parseDescription(description);
  const trip = await planAndSave(name, conditions, description, userId);
  revalidatePath("/trips");
  redirect(`/trips/${trip.id}`);
}

export async function planTripAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim() || "Untitled trip";
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const conditions = defaultConditions({
    temp_min_c: numOrNull(formData.get("temp_min_c")),
    temp_max_c: numOrNull(formData.get("temp_max_c")),
    precipitation: pick(formData.get("precipitation"), PRECIPITATION, "none"),
    wind: pick(formData.get("wind"), WIND, "calm"),
    sun: pick(formData.get("sun"), SUN, "moderate"),
    exertion: pick(formData.get("exertion"), EXERTION, "moderate"),
    duration: pick(formData.get("duration"), DURATION, "day"),
    exposure: pick(formData.get("exposure"), EXPOSURE, "sheltered"),
    activities: String(formData.get("activities") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  const trip = await planAndSave(name, conditions, description, userId);
  revalidatePath("/trips");
  redirect(`/trips/${trip.id}`);
}

/** Sign out the current user and redirect to /login. */
export async function signOutAction() {
  "use server";
  const { isAuthConfigured } = await import("@/lib/auth");
  if (isAuthConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
