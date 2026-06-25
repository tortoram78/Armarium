"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
// services used indirectly via app-service
import {
  classifyToDraft,
  enrichFromUrlToDraft,
  confirmDraft,
  deleteItem,
  updateItemClassification,
  setInventory,
  planAndSave,
  planPreview,
  parseDescription,
  getItem,
  setItemImagePath,
  replanTrip,
  renameTrip,
  cloneTrip,
  deleteTrip,
  updateTripConditions,
  recordOwnership,
  updateInventory,
} from "@/server/app-service";
import { OWNERSHIP_STATUS, CONDITION, type InventoryMeta } from "@/core/inventory";
import { isItemImageObjectPath } from "@/server/item-images";
import {
  defaultConditions,
  PRECIPITATION,
  WIND,
  SUN,
  EXERTION,
  DURATION,
  EXPOSURE,
  type TripConditions,
} from "@/core/conditions";
import { safeParseClassification } from "@/core/classification";
import {
  applyUserCorrections,
  EDITABLE_UNIVERSAL,
  EDITABLE_GROUPS,
  EDITABLE_MULTILABEL,
} from "@/core/corrections";
import { requireUserId, getUserIdOrGuest } from "@/lib/auth";
import { encodeConditions } from "@/lib/conditions-codec";
import { resolveRateKey, checkRateLimit } from "@/server/ratelimit-guard";
import { timeAndLog } from "@/lib/logger";

/** Friendly user-facing copy for a rate-limit reject on a redirect action. */
const RATE_LIMITED_MSG = "You're going a bit fast — try again in a moment.";

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

/** Build a validated `TripConditions` from the structured-form FormData (shared by plan + preview + edit). */
function conditionsFromFormData(formData: FormData): TripConditions {
  return defaultConditions({
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
}

export async function replanTripAction(formData: FormData) {
  "use server";
  const userId = await requireUserId();
  const id = String(formData.get("id"));
  await replanTrip(id, userId);
  revalidatePath(`/trips/${id}`);
}

// ---- trip CRUD (rename / clone / delete / edit-conditions) ----

const RenameTripInput = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
});

/** Rename a saved trip in place; stays on the dossier. */
export async function renameTripAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = RenameTripInput.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    const id = String(formData.get("id") ?? "");
    redirect(`/trips/${id}?renameError=1`);
  }
  await renameTrip(parsed.data.id, parsed.data.name, userId);
  revalidatePath(`/trips/${parsed.data.id}`);
  revalidatePath("/trips");
  redirect(`/trips/${parsed.data.id}`);
}

const TripIdInput = z.object({ id: z.string().min(1) });

/** Clone name + conditions into a NEW unplanned trip, then open it. */
export async function cloneTripAction(formData: FormData) {
  const userId = await requireUserId();
  const { id } = TripIdInput.parse({ id: formData.get("id") });
  const clone = await cloneTrip(id, userId);
  revalidatePath("/trips");
  redirect(`/trips/${clone.id}`);
}

/** Delete a saved trip and return to the log. */
export async function deleteTripAction(formData: FormData) {
  const userId = await requireUserId();
  const { id } = TripIdInput.parse({ id: formData.get("id") });
  await deleteTrip(id, userId);
  revalidatePath("/trips");
  redirect("/trips");
}

/**
 * Edit a trip's structured conditions. Per the port contract this clears the stale result; the dossier
 * then surfaces the existing "Re-plan" affordance (the trip reads as unplanned until re-planned).
 */
export async function updateTripConditionsAction(formData: FormData) {
  const userId = await requireUserId();
  const { id } = TripIdInput.parse({ id: formData.get("id") });
  const conditions = conditionsFromFormData(formData);
  await updateTripConditions(id, conditions, userId);
  revalidatePath(`/trips/${id}`);
  revalidatePath("/trips");
  redirect(`/trips/${id}`);
}

/** Preserve the user's typed fields across a friendly error redirect so nothing is lost on a retry. */
function preserveAddFields(fields: { name?: string; text?: string; url?: string }): string {
  const p = new URLSearchParams();
  if (fields.name) p.set("name", fields.name);
  if (fields.text) p.set("text", fields.text);
  if (fields.url) p.set("url", fields.url);
  const q = p.toString();
  return q ? "&" + q : "";
}

/**
 * Add an item from ONE pane: a name, known details, and/or a manufacturer link — any combination. The
 * flow is LINK-FIRST with a NAME FALLBACK:
 *   - A link is fetched + parsed for authoritative specs (manufacturer facts out-rank inference).
 *   - If the link yields nothing usable (a bot-walled brand like Patagonia, a non-product page) BUT the
 *     user also typed a name, we fall back to classifying that name — so the item is still added. With no
 *     name to fall back on, we surface the friendly read-failure message.
 *   - No link → classify the name directly.
 * Each spendy path is independently rate-limited; a reject (or a classify error) degrades to a friendly
 * redirect that preserves the typed fields. NEVER a thrown 500.
 */
export async function addItemAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim() || undefined;
  const url = String(formData.get("url") ?? "").trim();
  const inInventory = formData.get("inInventory") != null;

  // One pane, three inputs — but we need at least a name or a link to do anything.
  if (!name && !url) {
    redirect("/items/new?error=" + encodeURIComponent("Enter a product name or paste a link (or both)."));
  }
  const rateKey = await resolveRateKey();
  const preserve = preserveAddFields({ name, text, url });

  // ── LINK provided → authoritative enrichment first (tightest rate budget: the outbound fetch). ──
  if (url) {
    if (!checkRateLimit("enrich", rateKey).allowed) {
      redirect("/items/new?error=" + encodeURIComponent(RATE_LIMITED_MSG) + preserve);
    }
    // dest is computed inside the logged span; redirect() fires AFTER (NEXT_REDIRECT would otherwise log
    // as a spurious error). A null dest signals "fall back to the name classifier below".
    const dest = await timeAndLog({ event: "action", action: "enrichFromUrl", userId }, async () => {
      const result = await enrichFromUrlToDraft(userId, url, {}, inInventory);
      if (result.ok) {
        revalidatePath("/");
        return `/items/${result.draftId}/review`;
      }
      if (name) return null; // fall through to classify the typed name (walled-brand rescue)
      return "/items/new?error=" + encodeURIComponent(friendlyEnrichError(result.reason)) + preserve;
    });
    if (dest) redirect(dest);
    // dest === null: the link failed but we have a name — fall through to the classifier.
  }

  // ── NAME path (no link, or the link failed and we have a name). Rate-limit the classify path. ──
  if (!checkRateLimit("classify", rateKey).allowed) {
    redirect("/items/new?error=" + encodeURIComponent(RATE_LIMITED_MSG) + preserve);
  }
  const dest = await timeAndLog({ event: "action", action: "addItem", userId }, async () => {
    try {
      const { item } = await classifyToDraft(name, text, inInventory, userId);
      revalidatePath("/");
      return `/items/${item.id}/review`;
    } catch (e) {
      return "/items/new?error=" + encodeURIComponent((e as Error).message) + preserve;
    }
  });
  redirect(dest);
}

const SUPPORTED_MFR_HINT =
  "We can only pull from supported manufacturers right now (Patagonia, Arc'teryx, REI, The North Face, Black Diamond, Marmot).";
const GENERIC_ENRICH_HINT = "Couldn't read that page automatically — try adding it by name.";
const NO_SIGNAL_HINT =
  "We loaded that page but couldn't find any product details to import — add the item by name instead.";

/**
 * Map an `enrichFromUrlToDraft` failure reason to a friendly, user-facing message. The reason is prefixed:
 * `url-shape:` (non-allowlisted / malformed URL) → unsupported manufacturer; `no-signal:` (page reached
 * but no machine-readable product data — bot-challenge / JS-only catalog / non-product page) → a distinct
 * "reached it but nothing to import" message; everything else (`private-ip:`/`http:`/`content-type:`/
 * `size:`/`timeout:`/`network:`/`redirect:`/`dns:`/`read:`) is an opaque read failure → add-by-name.
 */
function friendlyEnrichError(reason: string): string {
  if (reason.startsWith("url-shape:")) return SUPPORTED_MFR_HINT;
  if (reason.startsWith("no-signal:")) return NO_SIGNAL_HINT;
  return GENERIC_ENRICH_HINT;
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

// ---- item photo (display-only — ADR-0018) ----

const SetItemImageInput = z.object({
  id: z.string().min(1),
  // The bucket-relative object key the browser just uploaded to (buildItemImageObjectPath output):
  // <user_id>/<item_id>/<uuid>.<ext>. Bounded so a junk/oversized value can't be persisted.
  path: z.string().trim().min(1).max(512),
});

/**
 * Persist the object path of a photo the BROWSER uploaded client-direct to the private `item-images`
 * bucket (ADR-0018 §C). Write-gated: `requireUserId()` bounces a guest to /login BEFORE any write — a
 * guest can never attach a photo (the upload control is also hidden for them). Defence-in-depth: the
 * supplied path MUST begin with `<userId>/<itemId>/` — the same prefix Storage RLS keyed the upload to —
 * so a forged path for another user's folder (or another item) is rejected and never written. The repo
 * write is itself user-scoped (a non-owned item is a no-op). Photo is decoration, never a facet input.
 */
export async function setItemImageAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = SetItemImageInput.safeParse({
    id: formData.get("id"),
    path: formData.get("path"),
  });
  if (!parsed.success) {
    const id = String(formData.get("id") ?? "");
    redirect(`/items/${id}?imageError=1`);
  }
  const { id, path } = parsed.data;

  // Validate the FULL canonical shape, not just the prefix — the bytes upload CLIENT-DIRECT, so `path` is
  // client-controlled. `isItemImageObjectPath` rejects another user's/item's folder, `..` traversal,
  // extra separators, null bytes, and non-image extensions before persisting (it's the read-side owner of
  // the same scheme `buildItemImageObjectPath` writes). Storage RLS is the primary per-user boundary; this
  // keeps `items.image_path` canonical for any later cleanup/migration.
  if (!isItemImageObjectPath(path, userId, id)) {
    redirect(`/items/${id}?imageError=1`);
  }

  // Persist defensively: a transient repo failure must surface as a friendly error redirect (which
  // remounts the uploader and clears its busy spinner), never a thrown 500 that leaves the client stuck
  // on "Uploading…". The redirect()s below throw NEXT_REDIRECT by design — only the DB call is guarded.
  try {
    await setItemImagePath(id, path, userId);
  } catch {
    redirect(`/items/${id}?imageError=1`);
  }
  revalidatePath(`/items/${id}`);
  revalidatePath("/");
  redirect(`/items/${id}`);
}

/**
 * Remove an item's photo: null the `image_path` column (ADR-0018 v1 — the column is the source of truth
 * for display; the stored object is left in place, a deferred cleanup). Write-gated behind
 * `requireUserId()`; user-scoped in the repo (a non-owned item is a no-op).
 */
export async function removeItemImageAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/");
  await setItemImagePath(id, null, userId);
  revalidatePath(`/items/${id}`);
  revalidatePath("/");
  redirect(`/items/${id}`);
}

export async function planFromDescriptionAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim() || "Untitled trip";
  const description = String(formData.get("description") ?? "").trim();
  if (!description) redirect("/plan?error=" + encodeURIComponent("Please enter a trip description."));

  // Rate-limit the NL trip-parse (LLM-spendy). Reject → friendly redirect back to the planner form.
  const key = await resolveRateKey();
  if (!checkRateLimit("parse", key).allowed) {
    redirect("/plan?error=" + encodeURIComponent(RATE_LIMITED_MSG));
  }

  // Compute the destination inside the logged span, redirect() after (see addItemAction note).
  const dest = await timeAndLog({ event: "action", action: "planFromDescription", userId }, async () => {
    const conditions = await parseDescription(description);
    const trip = await planAndSave(name, conditions, description, userId);
    revalidatePath("/trips");
    return `/trips/${trip.id}`;
  });
  redirect(dest);
}

/**
 * Result of an auto-conditions lookup. `ok:false` is the first-class manual-entry fallback signal:
 * an unknown location, an out-of-horizon date window, or any provider/network failure all degrade to
 * it. The UI leaves the conditions form untouched and the user enters conditions by hand. This action
 * NEVER throws (the weather fetcher already fails to `null`); the try/catch is belt-and-suspenders so a
 * transient hiccup can never surface a 500 in the planner.
 */
export type WeatherConditionsResult =
  | { ok: true; conditions: TripConditions; locationLabel: string }
  | { ok: false };

/**
 * Pull a forecast for a free-text location + ISO date window and derive a starting `TripConditions`.
 * The returned conditions PRE-FILL the planner's structured fields; every field stays user-editable
 * (override-always — the forecast is a starting point, never a lock). On any failure → `{ ok:false }`,
 * the manual-entry fallback. Heavy lifting lives in the already-built fetcher + pure mapping; this is a
 * thin action.
 */
export async function getWeatherConditionsAction(formData: FormData): Promise<WeatherConditionsResult> {
  // READ gate, not the write gate: a forecast pull performs NO write (it only derives conditions to
  // prefill the form), so a guest planning a trip can use it. `getUserIdOrGuest` never redirects; the
  // save wall stays in planTripAction/planAndSave (still requireUserId). No DB or user data is touched.
  const { userId } = await getUserIdOrGuest();
  try {
    // Rate-limit the forecast pull (loosest budget; cheap/cacheable). A reject degrades to the manual-
    // entry fallback `{ ok:false }` — the same first-class signal as an unknown location or a provider
    // failure (the user just enters conditions by hand). NEVER a 500.
    const key = await resolveRateKey();
    if (!checkRateLimit("weather", key).allowed) return { ok: false };

    // timeAndLog sits INSIDE the try so its re-throw is still caught below — the never-throws contract
    // holds. One request/outcome/duration line is emitted for the lookup either way.
    return await timeAndLog<WeatherConditionsResult>(
      { event: "action", action: "getWeatherConditions", userId },
      async () => {
        const location = String(formData.get("location") ?? "").trim();
        const startDate = String(formData.get("startDate") ?? "").trim();
        const endDate = String(formData.get("endDate") ?? "").trim();
        if (!location || !startDate || !endDate) return { ok: false };

        const { getForecast } = await import("@/server/weather-fetcher");
        const { forecastToConditions } = await import("@/core/weather");
        const forecast = await getForecast(location, startDate, endDate);
        if (!forecast) return { ok: false };

        return {
          ok: true,
          conditions: forecastToConditions(forecast),
          locationLabel: forecast.location.locationLabel,
        };
      },
    );
  } catch {
    return { ok: false };
  }
}

export async function planTripAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim() || "Untitled trip";
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const conditions = conditionsFromFormData(formData);
  const trip = await planAndSave(name, conditions, description, userId);
  revalidatePath("/trips");
  redirect(`/trips/${trip.id}`);
}

/**
 * GUEST / preview plan — the READ-ONLY counterpart to `planTripAction`. Resolves the identity via the READ
 * gate (`getUserIdOrGuest`, never redirects), builds the SAME `TripConditions` from the form, but does NOT
 * save: it encodes the conditions into the URL and redirects to `/plan/preview`, which re-runs the plan
 * over the (guest sample or the user's own) closet and renders the result behind the save WALL. This action
 * NEVER calls `planAndSave` — no write, no DB. It is also safe for an authenticated user who wants a preview
 * without persisting, but the plan form only wires it for guests (authed users post to planTripAction).
 *
 * Note: this does not call `requireUserId()` by design — it is a read action. The save wall is the
 * /plan/preview "Log in to save" control, which routes to /login (and every actual write stays gated).
 */
export async function planPreviewAction(formData: FormData) {
  await getUserIdOrGuest();
  const conditions = conditionsFromFormData(formData);
  redirect(`/plan/preview?conditions=${encodeConditions(conditions)}`);
}

// ---- closet-as-database: record-only capture + inventory edit (ADR-0021/0022) ----

/**
 * Instant record-only capture — no LLM call. Reads `name` from the form; if empty, redirects home.
 * Rate-limited on the "classify" budget (shares the same token bucket as classify — it's a write
 * path but much cheaper; reuse the key to prevent unbounded append spam). On success the item
 * appears immediately in the closet (non-draft, owned).
 */
export async function recordOwnershipAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/?error=" + encodeURIComponent("Enter a name for the item."));
  }
  const key = await resolveRateKey();
  if (!checkRateLimit("classify", key).allowed) {
    redirect("/?error=" + encodeURIComponent(RATE_LIMITED_MSG));
  }
  await timeAndLog({ event: "action", action: "recordOwnership", userId }, async () => {
    await recordOwnership(name, userId);
    revalidatePath("/");
  });
  redirect("/");
}

/**
 * Patch an item's inventory metadata. Reads all inventory fields from FormData; validates with Zod
 * where natural. Never throws a 500 — any failure degrades to a friendly redirect back to the item.
 */
export async function updateInventoryAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/");

  try {
    // Parse quantity: must be a positive integer.
    const quantityRaw = String(formData.get("quantity") ?? "").trim();
    const quantityParsed = parseInt(quantityRaw, 10);
    const quantity = Number.isFinite(quantityParsed) && quantityParsed >= 1 ? quantityParsed : 1;

    // Parse price: user enters dollars (e.g. "99.99"), store as cents.
    const priceRaw = String(formData.get("pricePaidDollars") ?? "").trim();
    const priceParsed = parseFloat(priceRaw);
    const pricePaidCents =
      Number.isFinite(priceParsed) && priceParsed >= 0 ? Math.round(priceParsed * 100) : null;

    // Trim-or-null helper.
    const ton = (key: string): string | null => {
      const v = String(formData.get(key) ?? "").trim();
      return v || null;
    };

    const patch: Partial<InventoryMeta> = {
      ownershipStatus: pick(formData.get("ownershipStatus"), OWNERSHIP_STATUS, "owned"),
      quantity,
      condition: (() => {
        const v = String(formData.get("condition") ?? "").trim();
        return (CONDITION as readonly string[]).includes(v) ? (v as InventoryMeta["condition"]) : null;
      })(),
      acquiredAt: ton("acquiredAt"),
      pricePaidCents: priceRaw ? pricePaidCents : null,
      acquiredFrom: ton("acquiredFrom"),
      storageLocation: ton("storageLocation"),
      size: ton("size"),
      color: ton("color"),
      userNotes: ton("userNotes"),
    };

    await updateInventory(id, patch, userId);
    revalidatePath(`/items/${id}`);
    revalidatePath("/");
  } catch {
    redirect(`/items/${id}?inventoryError=1`);
  }
  redirect(`/items/${id}`);
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
