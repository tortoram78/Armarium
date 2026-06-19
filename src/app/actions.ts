"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
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
} from "@/server/app-service";
import { defaultConditions, PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE } from "@/core/conditions";
import { safeParseClassification } from "@/core/classification";
import { UNKNOWN_SOFT } from "@/core/evidence";
import {
  WATERPROOFNESS, WIND_RESISTANCE, BREATHABILITY, MOISTURE_MANAGEMENT, DRY_SPEED,
  WARMTH_WHEN_WET, WARMTH, PACKABILITY, TECH_LIFESTYLE,
  LAYERING_ROLE, FUNCTION_PURPOSE, BODY_ZONE, ACTIVITY_FIT, CONDITIONS_FIT,
} from "@/core/facets/levels";
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

  let itemId: string;
  try {
    const { item } = await classifyToDraft(name, text, inInventory);
    itemId = item.id;
  } catch (e) {
    redirect("/items/new?error=" + encodeURIComponent((e as Error).message) + "&name=" + encodeURIComponent(name));
  }
  revalidatePath("/");
  redirect(`/items/${itemId}/review`);
}

export async function confirmItemAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await confirmDraft(id);
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
  redirect(`/items/${id}`);
}

export async function discardDraftAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await deleteItem(id);
  revalidatePath("/");
  redirect("/items/new");
}

export async function updateFacetsAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const item = await getItem(id);
  if (!item) redirect("/");

  const c = item.classification;

  // Helper: build an Evidence envelope from form field (or UNKNOWN_SOFT if blank/"unknown").
  function softFacet<T extends string>(name: string, allowed: readonly T[]) {
    const v = String(formData.get(name) ?? "").trim();
    if (!v || v === "unknown" || !(allowed as readonly string[]).includes(v)) return UNKNOWN_SOFT;
    return { value: v as T, confidence: "high" as const, source: "user" as const, evidence: "user correction" };
  }

  // Helper: build a multi-label array from checkboxes.
  function multiLabel<T extends string>(name: string, allowed: readonly T[]): T[] {
    const vals = formData.getAll(name).map((v) => String(v).trim());
    return vals.filter((v): v is T => (allowed as readonly string[]).includes(v));
  }

  const updated = {
    ...c,
    universal: {
      ...c.universal,
      waterproofness: softFacet("waterproofness", WATERPROOFNESS),
      wind_resistance: softFacet("wind_resistance", WIND_RESISTANCE),
      breathability: softFacet("breathability", BREATHABILITY),
      moisture_management: softFacet("moisture_management", MOISTURE_MANAGEMENT),
      dry_speed: softFacet("dry_speed", DRY_SPEED),
      warmth_when_wet: softFacet("warmth_when_wet", WARMTH_WHEN_WET),
      warmth: softFacet("warmth", WARMTH),
      packability: softFacet("packability", PACKABILITY),
      technical_vs_lifestyle: softFacet("technical_vs_lifestyle", TECH_LIFESTYLE),
    },
    multilabel: {
      ...c.multilabel,
      layering_role: multiLabel("layering_role", LAYERING_ROLE),
      function_purpose: multiLabel("function_purpose", FUNCTION_PURPOSE),
      body_zone_covered: multiLabel("body_zone_covered", BODY_ZONE),
      activity_fit: multiLabel("activity_fit", ACTIVITY_FIT),
      conditions_fit: multiLabel("conditions_fit", CONDITIONS_FIT),
    },
  };

  const parsed = safeParseClassification(updated);
  if (!parsed.success) {
    // Re-render review/detail with error — redirect preserves the user's page.
    const back = item.draft ? `/items/${id}/review` : `/items/${id}`;
    redirect(back + "?facetError=" + encodeURIComponent("Validation failed: " + parsed.error.issues[0]?.message));
  }

  await updateItemClassification(id, parsed.data);
  revalidatePath(`/items/${id}`);
  revalidatePath(`/items/${id}/review`);
  revalidatePath("/");
  const back = item.draft ? `/items/${id}/review` : `/items/${id}`;
  redirect(back);
}

export async function setInventoryAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const inInventory = String(formData.get("inInventory") ?? "") === "true";
  await setInventory(id, inInventory);
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
}

export async function deleteItemAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await deleteItem(id);
  revalidatePath("/");
  redirect("/");
}

export async function planFromDescriptionAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Untitled trip";
  const description = String(formData.get("description") ?? "").trim();
  if (!description) redirect("/plan?error=" + encodeURIComponent("Please enter a trip description."));

  const conditions = await parseDescription(description);
  const trip = await planAndSave(name, conditions, description);
  revalidatePath("/trips");
  redirect(`/trips/${trip.id}`);
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
