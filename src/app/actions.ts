"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRepository, getClassifier, DEFAULT_USER_ID } from "@/server/services";
import { planAndSave } from "@/server/app-service";
import { defaultConditions, PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE } from "@/core/conditions";
import { SESSION_COOKIE } from "@/lib/auth";

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

export async function addItemAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim() || undefined;
  const inInventory = formData.get("inInventory") != null;
  if (!name) redirect("/items/new?error=" + encodeURIComponent("Please enter an item name."));

  const { classify } = getClassifier();
  let itemId: string;
  try {
    const classification = await classify({ name, text });
    const item = await getRepository().addItem(DEFAULT_USER_ID, { name, inInventory, rawText: text, classification });
    itemId = item.id;
  } catch (e) {
    redirect("/items/new?error=" + encodeURIComponent((e as Error).message) + "&name=" + encodeURIComponent(name));
  }
  revalidatePath("/");
  redirect(`/items/${itemId}`);
}

export async function setInventoryAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const inInventory = String(formData.get("inInventory") ?? "") === "true";
  await getRepository().setInventory(DEFAULT_USER_ID, id, inInventory);
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
}

export async function deleteItemAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await getRepository().deleteItem(DEFAULT_USER_ID, id);
  revalidatePath("/");
  redirect("/");
}

export async function planTripAction(formData: FormData) {
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
  const trip = await planAndSave(name, conditions, description);
  revalidatePath("/trips");
  redirect(`/trips/${trip.id}`);
}

export async function loginAction(formData: FormData) {
  const pw = String(formData.get("password") ?? "");
  if (process.env.APP_PASSWORD && pw === process.env.APP_PASSWORD) {
    cookies().set(SESSION_COOKIE, "ok", { httpOnly: true, sameSite: "lax", path: "/" });
    redirect("/");
  }
  redirect("/login?error=1");
}

export async function logoutAction() {
  cookies().delete(SESSION_COOKIE);
  redirect("/login");
}
