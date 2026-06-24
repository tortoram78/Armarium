// Application service — the thin layer the UI (pages, actions) calls. Ties the repository to the pure
// core (resolve, group, plan). Pages never import core reasoning directly; they go through here.

import { getRepository, getCacheRepository, getClassifier, getTripParser, DEFAULT_USER_ID, type Classifier } from "./services";
import { fetchManufacturerHtml, type FetcherDeps } from "./enrich-fetcher";
import { normalizeCacheKey } from "@/core/cache";
import { MODEL_ID } from "@/core/config";
import { resolveFromClassification, type ResolvedItem } from "@/core/resolved";
import { groupCloset, type GroupingKey } from "@/core/closet";
import { planTrip } from "@/core/recommend/plan";
import { deriveFromComposition } from "@/core/materials";
import { resolveBehavioralFacets } from "@/core/resolve";
import {
  parseProductHtml,
  toManufacturerEvidence,
  applyManufacturerOverlay,
  unknownBehavioralClassification,
  type ExtractedProduct,
} from "@/core/enrich";
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
 * The derive → resolve step of the classification pipeline (rule #2: stronger provenance wins).
 *
 * After the LLM classifies (and after any manufacturer overlay has set the authoritative composition),
 * derive the behavioral facets the composition determines and RESOLVE them against the LLM's values by
 * explicit precedence: `derived_from_material` corrects an `inferred` guess (e.g. cotton the LLM thought
 * "wicks" → "absorbs_holds"), while a low-confidence derived `warmth` defers to a stronger inference.
 * The persisted model is unchanged — one classification, its behavioral facets now carrying the winning
 * source. PURE + offline: derivation reads only the composition, never the network.
 */
function deriveAndResolve(classification: ItemClassification): ItemClassification {
  const derived = deriveFromComposition(classification.materials);
  return resolveBehavioralFacets(classification, derived);
}

/**
 * Classify a named item and store it as a DRAFT (not yet in the closet) for review. Checks the
 * self-building knowledge base FIRST, scoped to THIS user: a hit reuses a stored classification (no LLM
 * call) — the user's own override wins over the shared low-authority draft (ADR-0012 Element 5). A miss
 * classifies live/offline and writes the result back as a GLOBAL DRAFT (never a user override — only an
 * explicit correction/confirmation does that). The review step still gates everything.
 */
export async function classifyToDraft(
  name: string,
  text: string | undefined,
  inInventory: boolean,
  userId = DEFAULT_USER_ID,
): Promise<{ item: StoredItem; mode: AddMode; fromCache: boolean }> {
  const cache = getCacheRepository();
  const key = normalizeCacheKey(name);
  const hit = await cache.lookup(userId, key);

  let classification: ItemClassification;
  if (hit) {
    classification = hit.classification;
  } else {
    const { classify } = getClassifier();
    classification = await classify({ name, text });
    // Derive behavioral facets from composition and resolve them against the LLM's inference (stronger
    // provenance wins). Cache the RESOLVED classification so the knowledge base stores the corrected form.
    classification = deriveAndResolve(classification);
    // A classify-miss is a LOW-AUTHORITY draft — shared, but never attributed to this (or any) user.
    await cache.putDraft(key, name, classification, MODEL_ID);
  }

  const item = await getRepository().addItem(userId, { name, inInventory, draft: true, rawText: text, classification });
  return { item, mode: classifierMode(), fromCache: Boolean(hit) };
}

// ---- add-by-manufacturer-URL (review-before-save; authoritative enrichment) ----

export type EnrichResult = { ok: true; draftId: string } | { ok: false; reason: string };

/** Test seam: the network fetcher + the classifier are injectable so the orchestration is hermetic. */
export interface EnrichDeps {
  /** Defaults to the real SSRF-safe `fetchManufacturerHtml`. Passed `deps.fetcher` for a fixture in tests. */
  fetchHtml?: (url: string) => ReturnType<typeof fetchManufacturerHtml>;
  /** Defaults to the env-selected classifier from `getClassifier()`. */
  classify?: Classifier;
  /** Forwarded to the default fetcher (injected `fetchImpl`/`lookup`) when `fetchHtml` is not overridden. */
  fetcherDeps?: FetcherDeps;
}

/**
 * Add an item by pasting a MANUFACTURER PRODUCT URL: safely fetch + parse the page, classify the item,
 * then overlay the authoritative manufacturer facts ON TOP of the LLM's inference (manufacturer wins —
 * rule #2). Stores the result as a DRAFT for review and returns its id.
 *
 * Failure modes are returned as `{ ok:false, reason }`, never thrown:
 *   - the fetcher's prefixed reason (`url-shape:`/`private-ip:`/`http:`/`content-type:`/`size:`/…) is
 *     surfaced verbatim so the action can map it to a friendly message.
 *   - DEGRADED CLASSIFY: the offline classifier throws on items outside the prototype corpus (no API
 *     key). We CATCH that and still build a draft from the manufacturer facts overlaid on an
 *     all-unknown-behavioral scaffold — authoritative composition is NEVER lost just because the
 *     behavioral classifier was unavailable. (A *fetch* failure still aborts with no draft; only the
 *     classify step degrades.)
 */
export async function enrichFromUrlToDraft(
  userId: string,
  url: string,
  deps: EnrichDeps = {},
): Promise<EnrichResult> {
  const fetchHtml = deps.fetchHtml ?? ((u: string) => fetchManufacturerHtml(u, deps.fetcherDeps));

  const fetched = await fetchHtml(url);
  if (!fetched.ok) return { ok: false, reason: fetched.reason };

  // Pure extraction → validated manufacturer overlay. Never throws on arbitrary HTML.
  const extracted = parseProductHtml(fetched.html);
  const enrichment = toManufacturerEvidence(extracted);

  // Build the classify input from the manufacturer-stated facts: name = brand + model when present,
  // text = the stated composition / specs so the LLM infers behavioral facets from real evidence.
  const name = manufacturerName(enrichment.identity.brand.value, enrichment.identity.model.value, url);
  const text = manufacturerDetailText(extracted);

  const classify = deps.classify ?? getClassifier().classify;

  let classification: ItemClassification;
  try {
    classification = await classify({ name, text });
    classification = applyManufacturerOverlay(classification, enrichment);
  } catch {
    // DEGRADED PATH: no behavioral classifier could run (offline + unknown item). Preserve the
    // authoritative manufacturer facts on an honest all-unknown-behavioral scaffold rather than failing.
    classification = applyManufacturerOverlay(unknownBehavioralClassification(name), enrichment);
  }

  // Derive behavioral facets from the (now manufacturer-authoritative) composition and resolve them. On
  // the degraded path this fills the all-unknown scaffold straight from the stated composition — so even
  // with no classifier, a manufacturer-stated fabric yields its chemistry-determined behavior.
  classification = deriveAndResolve(classification);

  const item = await getRepository().addItem(userId, {
    name,
    inInventory: true,
    draft: true,
    rawText: text,
    classification,
  });
  return { ok: true, draftId: item.id };
}

/** Prefer "Brand Model"; fall back to model or brand alone; last resort, a label from the URL host. */
function manufacturerName(brand: string | null, model: string | null, url: string): string {
  const parts = [brand, model].filter((s): s is string => Boolean(s && s.trim()));
  if (parts.length > 0) return parts.join(" ");
  try {
    return `Item from ${new URL(url).hostname}`;
  } catch {
    return "Item from manufacturer URL";
  }
}

/** Compose the source-faithful detail string fed to the classifier (composition + weight + price). */
function manufacturerDetailText(p: ExtractedProduct): string | undefined {
  const lines: string[] = [];
  if (p.material_raw) lines.push(`Composition: ${p.material_raw}`);
  if (p.weight_grams != null) lines.push(`Weight: ${p.weight_grams} g`);
  if (p.price_cents != null) {
    lines.push(`Price: ${(p.price_cents / 100).toFixed(2)} ${p.price_currency ?? ""}`.trim());
  }
  for (const s of p.specs) {
    if (s && typeof s.name === "string" && typeof s.value === "string") {
      lines.push(`${s.name}: ${s.value}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Promote a reviewed draft into the closet. The confirmation endorses its classification as THIS
 *  user's override — scoped to them, so it never reshapes another user's next classification. */
export async function confirmDraft(id: string, userId = DEFAULT_USER_ID): Promise<StoredItem | null> {
  const item = await getRepository().setDraft(userId, id, false);
  if (item) {
    await getCacheRepository().putUserOverride(userId, normalizeCacheKey(item.name), item.name, item.classification);
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
    // A user correction is authoritative FOR THIS USER — feed it back as their override so future adds
    // of this item improve, WITHOUT poisoning any other user's classifications (ADR-0012 Element 5).
    await getCacheRepository().putUserOverride(userId, normalizeCacheKey(classification.name), classification.name, classification);
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

/** Rename a saved trip (user-scoped; no-op if it isn't theirs). */
export async function renameTrip(id: string, name: string, userId = DEFAULT_USER_ID): Promise<void> {
  return getRepository().renameTrip(userId, id, name);
}

/** Clone a trip's name + conditions into a NEW unplanned trip; returns it (for redirect). */
export async function cloneTrip(id: string, userId = DEFAULT_USER_ID): Promise<StoredTrip> {
  return getRepository().cloneTrip(userId, id);
}

/** Delete a saved trip (and its result snapshot), user-scoped. */
export async function deleteTrip(id: string, userId = DEFAULT_USER_ID): Promise<void> {
  return getRepository().deleteTrip(userId, id);
}

/**
 * Replace a trip's conditions. Per the port contract this drops the stale result (does NOT auto-replan)
 * — the trip reads as unplanned until re-planned against the current closet.
 */
export async function updateTripConditions(
  id: string,
  conditions: TripConditions,
  userId = DEFAULT_USER_ID,
): Promise<void> {
  return getRepository().updateTripConditions(userId, id, conditions);
}
