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
  renameItem,
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

/** Read a positive-integer form field (Days / party size), or null when absent/invalid. */
function posIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Build a validated `TripConditions` from the structured-form FormData (shared by plan + preview + edit).
 *
 * ADR-0027 Phase 2 — DURABLE trip-length carry: when the user gives an explicit `days` count, fold it into
 * the structured `duration` (the only trip-length carrier the conditions model has, and the one that
 * survives the save/redirect to the trip dossier + preview). 1 day → "day", 2 → "overnight", 3+ →
 * "multiday". A blank `days` leaves the explicit (or default) duration select untouched. `activities` is
 * already a conditions field, so the trip-type quick-select's activities persist here for free.
 */
function conditionsFromFormData(formData: FormData): TripConditions {
  const days = posIntOrNull(formData.get("days"));
  const durationFromDays = days === null ? null : days >= 3 ? "multiday" : days === 2 ? "overnight" : "day";
  return defaultConditions({
    temp_min_c: numOrNull(formData.get("temp_min_c")),
    temp_max_c: numOrNull(formData.get("temp_max_c")),
    precipitation: pick(formData.get("precipitation"), PRECIPITATION, "none"),
    wind: pick(formData.get("wind"), WIND, "calm"),
    sun: pick(formData.get("sun"), SUN, "moderate"),
    exertion: pick(formData.get("exertion"), EXERTION, "moderate"),
    duration: durationFromDays ?? pick(formData.get("duration"), DURATION, "day"),
    exposure: pick(formData.get("exposure"), EXPOSURE, "sheltered"),
    activities: String(formData.get("activities") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
}

/**
 * Read the ADR-0027 Phase 2 trip-input extras into engine `PackingOpts`. These are LIVE-ONLY: there is no
 * trip-schema column for explicit days/party, so they shape only the immediate plan and are NOT persisted
 * (a saved trip re-plans from its stored conditions alone). `days` is also folded into `conditions.duration`
 * by `conditionsFromFormData` so trip length still survives the save; `partySize` has no durable carrier and
 * is therefore genuinely live-only. `activities` rides the conditions, so it is omitted here.
 */
function packingOptsFromFormData(formData: FormData): { days?: number; partySize?: number } {
  const days = posIntOrNull(formData.get("days"));
  const partySize = posIntOrNull(formData.get("partySize"));
  return {
    ...(days !== null ? { days } : {}),
    ...(partySize !== null ? { partySize } : {}),
  };
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
  // The trip-type quick-select's `activities` + the (days-folded) `duration` live in `conditions` and are
  // persisted by `planAndSave` (durable). Explicit `days`/`partySize` are LIVE-ONLY (no trip-schema column,
  // ADR-0027 Phase 2): the saved trip dossier re-derives its packing plan from stored conditions alone, so
  // there is no opts to thread here — `partySize` deliberately does not survive the save.
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
  // ADR-0027 Phase 2: the trip-type's activities + the (days-folded) duration ride inside `conditions`, so
  // they survive into the preview render. `partySize` has no conditions carrier; carry it as a query hint
  // so the preview can scale consumables for it (read defensively there, defaulting to solo).
  const opts = packingOptsFromFormData(formData);
  const params = new URLSearchParams({ conditions: encodeConditions(conditions) });
  if (opts.partySize) params.set("partySize", String(opts.partySize));
  if (opts.days) params.set("days", String(opts.days));
  redirect(`/plan/preview?${params.toString()}`);
}

// ---- closet-as-database: record-only capture + inventory edit (ADR-0021/0022) ----

/**
 * Instant record-only capture — no LLM call. Reads `name` from the form; if empty, redirects home.
 * Rate-limited on the "classify" budget (shares the same token bucket as classify — it's a write
 * path but much cheaper; reuse the key to prevent unbounded append spam). On success the item
 * appears immediately in the closet (non-draft, owned).
 *
 * Duplicate check (ADR-0022 §Phase 3): before creating, look for a likely-already-owned item. If
 * found and no `force` flag, redirect home with a ?dup banner so the user can bump quantity, view
 * the original, or add anyway. With `force=1` (or no dup), create as normal.
 */
export async function recordOwnershipAction(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/?error=" + encodeURIComponent("Enter a name for the item."));
  }
  const force = String(formData.get("force") ?? "") === "1";
  const key = await resolveRateKey();
  if (!checkRateLimit("classify", key).allowed) {
    redirect("/?error=" + encodeURIComponent(RATE_LIMITED_MSG));
  }

  // Duplicate guard — skip when force=1 (user chose "add anyway")
  if (!force) {
    const dup = await findDuplicate(name, userId);
    if (dup) {
      redirect(`/?dup=${encodeURIComponent(name)}&dupId=${encodeURIComponent(dup.id)}`);
    }
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

// ---- closet browse curation (ADR-0022 Phase 2) ----

const RenameItemInput = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
});

/**
 * Inline rename — updates items.name AND classification.name in sync.
 * Write-gated; redirects back to the item detail on success.
 */
export async function renameItemAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = RenameItemInput.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    const id = String(formData.get("id") ?? "");
    redirect(`/items/${id}?renameError=1`);
  }
  await renameItem(parsed.data.id, parsed.data.name, userId);
  revalidatePath("/");
  revalidatePath(`/items/${parsed.data.id}`);
  redirect(`/items/${parsed.data.id}`);
}

import {
  searchCloset, findDuplicate, recordOwnershipBatch, enrichItem, isItemGear,
  setItemTags,
  createCollection, renameCollection, deleteCollection,
  addItemToCollection, removeItemFromCollection,
  searchCatalog, addFromCatalog,
  type CatalogSuggestion,
} from "@/server/app-service";
import { type GroupingKey } from "@/core/closet";

// ---- self-building catalog: add-time autocomplete with specs (ADR-0025 / Phase 5) ----

// Re-export the type so client components can import it from actions.ts without touching app-service.
export type { CatalogSuggestion };

/**
 * Name-search the self-building product catalog for add-time autocomplete. READ gate only —
 * typeahead is read-only (no write) so `getUserIdOrGuest` is correct; no redirect. Returns []
 * for empty/short query to keep the round-trip count low.
 */
export async function searchCatalogAction(formData: FormData): Promise<CatalogSuggestion[]> {
  const { userId } = await getUserIdOrGuest();
  const q = String(formData.get("q") ?? "").trim();
  if (!q || q.length < 2) return [];
  return searchCatalog(q, userId, 6);
}

/**
 * One-tap add from the catalog — inherits the previously-classified specs instead of creating a
 * bare record-only item. Write-gated (`requireUserId`); rate-limited on the "classify" budget
 * (same token bucket as classify — prevents unbounded catalog-copy spam). Redirects to the new
 * item or falls back to "/" if the catalog key is gone.
 */
export async function addFromCatalogAction(formData: FormData) {
  const userId = await requireUserId();
  const key = String(formData.get("key") ?? "").trim();
  if (!key) redirect("/");

  const rateKey = await resolveRateKey();
  if (!checkRateLimit("classify", rateKey).allowed) {
    redirect("/?error=" + encodeURIComponent(RATE_LIMITED_MSG));
  }

  const item = await timeAndLog({ event: "action", action: "addFromCatalog", userId }, async () => {
    const result = await addFromCatalog(key, userId);
    if (result) revalidatePath("/");
    return result;
  });

  redirect(item ? `/items/${item.id}` : "/");
}

/**
 * Load the next page of the flat closet ("All" view) — cursor-keyed, filter-aware.
 * Called client-side via a "Load more" button / IntersectionObserver.
 * Returns serialisable data (no class instances).
 */
export async function loadMoreClosetAction(formData: FormData): Promise<{
  items: {
    id: string;
    name: string;
    badges: string[];
    needsVerify: boolean;
    imageUrl: null; // photos require a separate signed-URL round-trip; load-more omits them
    ownershipStatus: string;
    quantity: number;
    condition: string | null;
    isRecordOnly: boolean;
    isGear: boolean;
  }[];
  nextCursor: string | null;
}> {
  const { userId } = await getUserIdOrGuest();
  const cursor = String(formData.get("cursor") ?? "").trim() || undefined;
  const search = String(formData.get("search") ?? "").trim() || undefined;
  const statusRaw = String(formData.get("status") ?? "").trim();
  const conditionRaw = String(formData.get("condition") ?? "").trim();
  const sortRaw = String(formData.get("sort") ?? "").trim();

  const status = (OWNERSHIP_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as (typeof OWNERSHIP_STATUS)[number])
    : undefined;
  const condition = (CONDITION as readonly string[]).includes(conditionRaw)
    ? (conditionRaw as (typeof CONDITION)[number])
    : undefined;
  const sort = sortRaw === "name" ? "name" : "newest";

  const { deriveDisplayTags } = await import("@/core/tags");
  const { isItemGear } = await import("@/server/app-service");

  const { items, nextCursor } = await searchCloset(
    "capability" as GroupingKey,
    { search, status, condition, sort, cursor, limit: 36 },
    userId,
  );

  return {
    items: items.map((it) => {
      const tags = deriveDisplayTags(it.classification.universal);
      return {
        id: it.id,
        name: it.name,
        badges: tags.slice(0, 4).map((t) => t.label),
        needsVerify:
          it.classification.universal.warmth.value === null &&
          it.classification.universal.technical_vs_lifestyle.value === null,
        imageUrl: null,
        ownershipStatus: it.inventory.ownershipStatus,
        quantity: it.inventory.quantity,
        condition: it.inventory.condition,
        isRecordOnly: it.inventory.domains.length === 0 && tags.length === 0,
        isGear: isItemGear(it),
      };
    }),
    nextCursor,
  };
}

const BulkUpdateInput = z.object({
  ids: z.array(z.string().min(1)).min(1),
  op: z.enum(["set_status", "delete"]),
  status: z.enum(OWNERSHIP_STATUS).optional(),
});

/**
 * Bulk action on a set of closet items — set ownership status or delete.
 * Write-gated; revalidates "/" after each item so the closet refreshes.
 */
export async function bulkUpdateClosetAction(formData: FormData) {
  const userId = await requireUserId();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const op = String(formData.get("op") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();

  const parsed = BulkUpdateInput.safeParse({
    ids,
    op,
    status: statusRaw || undefined,
  });
  if (!parsed.success) redirect("/?bulkError=1");

  const { op: operation, ids: validIds, status } = parsed.data;
  for (const id of validIds) {
    if (operation === "delete") {
      await deleteItem(id, userId);
    } else if (operation === "set_status" && status) {
      await updateInventory(id, { ownershipStatus: status }, userId);
    }
  }
  revalidatePath("/");
}

// ---- capture at scale: batch add + async enrichment + dedupe (ADR-0022 §Phase 3) ----

/**
 * Batch record-only capture from a pasted list (ADR-0022 §Phase 3). Splits the textarea on newlines,
 * dedupes identical lines within the paste, rate-limits lightly (reuse "classify" budget), calls
 * `recordOwnershipBatch` for the instant write (no LLM), then redirects to the `?ids=` streaming
 * view where the browser enriches each item client-side.
 */
export async function recordOwnershipBatchAction(formData: FormData) {
  const userId = await requireUserId();
  const raw = String(formData.get("names") ?? "").trim();
  if (!raw) {
    redirect("/items/batch?error=" + encodeURIComponent("Paste at least one item name."));
  }

  // Split, trim, drop blanks, dedupe WITHIN the paste (preserve first occurrence order).
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const l of lines) {
    const key = l.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(l); }
  }
  if (unique.length === 0) {
    redirect("/items/batch?error=" + encodeURIComponent("No item names found — paste one per line."));
  }

  const rateKey = await resolveRateKey();
  if (!checkRateLimit("classify", rateKey).allowed) {
    redirect("/items/batch?error=" + encodeURIComponent(RATE_LIMITED_MSG));
  }

  const created = await timeAndLog({ event: "action", action: "recordOwnershipBatch", userId }, async () => {
    const items = await recordOwnershipBatch(unique, userId);
    revalidatePath("/");
    return items;
  });

  const ids = created.map((i) => i.id).join(",");
  redirect(`/items/batch?ids=${encodeURIComponent(ids)}`);
}

/**
 * Enrich a single existing item in place — the async per-item call the batch streaming view fires
 * from the browser. Rate-limited on the "classify" budget. Returns a serialisable result object
 * (no redirect) so the client component can update per-row state.
 *
 * Returns `{ ok:true, id, classified, badges }` on success, or `{ ok:false, reason }` on
 * rate-limit or missing item. Never throws (degrades safely).
 */
export async function enrichItemAction(formData: FormData): Promise<
  | { ok: true; id: string; classified: boolean; badges: string[] }
  | { ok: false; reason: string }
> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, reason: "missing_id" };

  const rateKey = await resolveRateKey();
  if (!checkRateLimit("classify", rateKey).allowed) {
    return { ok: false, reason: "rate_limited" };
  }

  try {
    const updated = await timeAndLog({ event: "action", action: "enrichItem", userId }, async () => {
      return enrichItem(id, userId);
    });
    if (!updated) return { ok: false, reason: "not_found" };

    const { deriveDisplayTags } = await import("@/core/tags");
    const badges = deriveDisplayTags(updated.classification.universal)
      .slice(0, 4)
      .map((t) => t.label);
    return { ok: true, id, classified: isItemGear(updated), badges };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Classify a record-only item in place (the "Classify now" affordance on the item detail page).
 * Equivalent to enrichItemAction but redirect-based: after enrichment, revalidates the item and
 * the closet, then redirects back to the item detail. Rate-limited on "classify" budget.
 */
export async function classifyNowAction(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/");

  // "Auto-fill from name" runs the EXPENSIVE web-search enrichment (ADR-0030), so it spends the tighter
  // "enrich" budget (outbound network) rather than the looser "classify" one — even though enrichItem also
  // runs the classifier. The automatic batch path (enrichItemAction) stays on "classify" + no web search.
  const rateKey = await resolveRateKey();
  if (!checkRateLimit("enrich", rateKey).allowed) {
    redirect(`/items/${id}?error=` + encodeURIComponent(RATE_LIMITED_MSG));
  }

  // enrichItem is degrade-safe (never throws on a classify failure), but guard belt-and-suspenders so a
  // transient DB/runtime error can never 500 ("brick") the page — return to the unchanged item, which the
  // user can retry. (redirect() throws NEXT_REDIRECT by design, AFTER this guarded block.)
  try {
    await timeAndLog({ event: "action", action: "classifyNow", userId }, async () => {
      await enrichItem(id, userId, {}, { webSearch: true });
    });
  } catch {
    redirect(`/items/${id}`);
  }
  revalidatePath(`/items/${id}`);
  revalidatePath("/");
  redirect(`/items/${id}`);
}

/**
 * Typeahead suggestion — returns up to 6 {id,name} matches from the user's closet. Lightweight:
 * reuses searchCloset (name filter) and returns only the id + name (no facets). Called client-side
 * (debounced) for the quick-add combobox.
 */
export async function suggestItemsAction(formData: FormData): Promise<{ id: string; name: string }[]> {
  const { userId } = await getUserIdOrGuest();
  const q = String(formData.get("q") ?? "").trim();
  if (!q || q.length < 2) return [];
  const { items } = await searchCloset("capability" as GroupingKey, { search: q, limit: 6 }, userId);
  return items.map((i) => ({ id: i.id, name: i.name }));
}

// ---- curation + portability: tags, collections, export (ADR-0024 / Phase 4) ----

const SetItemTagsInput = z.object({
  id: z.string().min(1),
  tags: z.string().max(1000), // raw comma/space separated string
});

/**
 * Set free-form user tags on an item. Accepts a raw comma/space-separated string; normalization
 * (trim/dedupe/lowercase) is done in core via `normalizeTags`. Write-gated; revalidates the item
 * detail and the closet so tag chips update immediately.
 */
export async function setItemTagsAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = SetItemTagsInput.safeParse({
    id: formData.get("id"),
    tags: formData.get("tags") ?? "",
  });
  if (!parsed.success) {
    const id = String(formData.get("id") ?? "");
    redirect(`/items/${id}?tagsError=1`);
  }
  const { id, tags } = parsed.data;
  try {
    await setItemTags(id, tags, userId);
  } catch {
    redirect(`/items/${id}?tagsError=1`);
  }
  revalidatePath(`/items/${id}`);
  revalidatePath("/");
  redirect(`/items/${id}`);
}

const CreateCollectionInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
});

/** Create a new collection; redirects to the new collection's page. */
export async function createCollectionAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = CreateCollectionInput.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    redirect("/collections?error=" + encodeURIComponent("Collection name is required."));
  }
  let col;
  try {
    col = await createCollection(parsed.data.name, userId);
  } catch {
    redirect("/collections?error=" + encodeURIComponent("Could not create collection — try again."));
  }
  revalidatePath("/collections");
  redirect(`/collections/${col.id}`);
}

const RenameCollectionInput = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
});

/** Rename a collection; stays on the collections list. */
export async function renameCollectionAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = RenameCollectionInput.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    redirect("/collections?renameError=1");
  }
  try {
    await renameCollection(parsed.data.id, parsed.data.name, userId);
  } catch {
    redirect("/collections?renameError=1");
  }
  revalidatePath("/collections");
  redirect("/collections");
}

const CollectionIdInput = z.object({ id: z.string().min(1) });

/** Delete a collection (cascade removes memberships; items themselves are untouched). */
export async function deleteCollectionAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = CollectionIdInput.safeParse({ id: formData.get("id") });
  if (!parsed.success) redirect("/collections");
  try {
    await deleteCollection(parsed.data.id, userId);
  } catch {
    redirect("/collections?deleteError=1");
  }
  revalidatePath("/collections");
  redirect("/collections");
}

const CollectionItemInput = z.object({
  collectionId: z.string().min(1),
  itemId: z.string().min(1),
});

/** Add an item to a collection. Idempotent. Returns a JSON-serialisable result (no redirect) so the
 *  client component can update checked state without a full reload. */
export async function addItemToCollectionAction(formData: FormData): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const parsed = CollectionItemInput.safeParse({
    collectionId: formData.get("collectionId"),
    itemId: formData.get("itemId"),
  });
  if (!parsed.success) return { ok: false };
  try {
    await addItemToCollection(parsed.data.collectionId, parsed.data.itemId, userId);
    revalidatePath(`/items/${parsed.data.itemId}`);
    revalidatePath(`/collections/${parsed.data.collectionId}`);
    revalidatePath("/collections");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Remove an item from a collection. Returns a JSON-serialisable result. */
export async function removeItemFromCollectionAction(formData: FormData): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const parsed = CollectionItemInput.safeParse({
    collectionId: formData.get("collectionId"),
    itemId: formData.get("itemId"),
  });
  if (!parsed.success) return { ok: false };
  try {
    await removeItemFromCollection(parsed.data.collectionId, parsed.data.itemId, userId);
    revalidatePath(`/items/${parsed.data.itemId}`);
    revalidatePath(`/collections/${parsed.data.collectionId}`);
    revalidatePath("/collections");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Remove an item from a collection via a redirect-based form (used in collection detail page). */
export async function removeItemFromCollectionRedirectAction(formData: FormData) {
  const userId = await requireUserId();
  const parsed = CollectionItemInput.safeParse({
    collectionId: formData.get("collectionId"),
    itemId: formData.get("itemId"),
  });
  if (!parsed.success) return;
  try {
    await removeItemFromCollection(parsed.data.collectionId, parsed.data.itemId, userId);
  } catch {
    // no-op: silently ignore
  }
  revalidatePath(`/collections/${parsed.data.collectionId}`);
  revalidatePath("/collections");
  redirect(`/collections/${parsed.data.collectionId}`);
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
