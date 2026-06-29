// Application service — the thin layer the UI (pages, actions) calls. Ties the repository to the pure
// core (resolve, group, plan). Pages never import core reasoning directly; they go through here.

import { getRepository, getRepositoryFor, getCacheRepository, getClassifier, getTripParser, getWebSearchEnricher, getPackingEnricher, DEFAULT_USER_ID, type Classifier } from "./services";
import { fetchManufacturerHtml, type FetcherDeps } from "./enrich-fetcher";
import { fetchViaScrapfly, isScrapflyConfigured } from "./scrapfly-fetcher";
import { normalizeCacheKey } from "@/core/cache";
import { MODEL_ID } from "@/core/config";
import { resolveFromClassification, type ResolvedItem } from "@/core/resolved";
import { isGearClassified, isApparelClassified, modeledDomainsOf } from "@/core/domains";
import { findDuplicateIn, type DedupeFields } from "@/core/dedupe";
import { recordOnlyClassification } from "@/core/record";
import { normalizeTags, type InventoryMeta, type OwnershipStatus, type Condition } from "@/core/inventory";
import { groupCloset, type GroupingKey } from "@/core/closet";
import { planTrip } from "@/core/recommend/plan";
import type { RecommendationResult } from "@/core/recommend";
import { planPacking, tripContext, mergeEnrichment, type PackingOpts, type PackingPlan } from "@/core/packing";
import { deriveFromComposition } from "@/core/materials";
import {
  resolveBehavioralFacets,
  assembleClassification,
  decomposeToClaims,
  ingestLlmClaims,
  manufacturerClaims,
  derivedClaims,
  MATERIALS_FACET_KEY,
} from "@/core/resolve";
import type { LlmClaimsOutput } from "@/core/classify/claims";
import {
  parseProductHtml,
  toManufacturerEvidence,
  applyManufacturerOverlay,
  type ExtractedProduct,
  type WebSearchResult,
} from "@/core/enrich";
import { userCorrectionClaims } from "@/core/corrections";
import type { TripConditions } from "@/core/conditions";
import type { ItemClassification } from "@/core/classification";
import type { StoredItem, StoredTrip, EvidenceClaim, Collection } from "@/core/ports";

export function resolveItem(i: StoredItem): ResolvedItem {
  return resolveFromClassification(i.id, i.classification, i.inventory);
}

/** Whether an item is classified into the gear domain (ADR-0023) — gates the gear facet/capability UI.
 *  Reads the real `domains` marker OR any known gear facet signal (backfill-safe; see src/core/domains). */
export function isItemGear(i: StoredItem): boolean {
  return isGearClassified(resolveItem(i));
}

/** Whether an item is classified into the apparel domain (ADR-0026) — gates the apparel facet UI. */
export function isItemApparel(i: StoredItem): boolean {
  return isApparelClassified(resolveItem(i));
}

/** The modeled domains a classification shows signal in (['gear'], ['apparel'], ['gear','apparel'], or
 *  []). The single source for marking `inventory.domains` on classify/enrich — a fleece becomes both,
 *  a dress apparel-only, a no-signal item stays an unclassified possession (ADR-0023/0026). */
function domainsForClassification(c: ItemClassification): string[] {
  return modeledDomainsOf(resolveFromClassification("_", c));
}

export async function getAllItems(userId = DEFAULT_USER_ID): Promise<StoredItem[]> {
  return getRepositoryFor(userId).listItems(userId);
}

export async function getItem(id: string, userId = DEFAULT_USER_ID): Promise<StoredItem | null> {
  return getRepositoryFor(userId).getItem(userId, id);
}

/** The closet = owned, confirmed items. Drafts (awaiting review) are excluded.
 *  Reads route through `getRepositoryFor(userId)` so a GUEST_USER_ID is served the seeded sample closet
 *  from the in-memory repo even when DATABASE_URL is set — a guest never reads Postgres. */
export async function getInventory(userId = DEFAULT_USER_ID): Promise<StoredItem[]> {
  return (await getRepositoryFor(userId).listItems(userId)).filter((i) => i.inInventory && !i.draft);
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

// ---- closet-as-database: record-only capture + search + inline inventory edit (ADR-0021/0022) ----

/**
 * Record that the user OWNS something — instantly, with NO LLM call (ADR-0022, the keystone decouple).
 * Builds the all-unknown behavioral classification (`classification` stays NOT NULL) + DEFAULT_INVENTORY
 * with `ownershipStatus:'owned'`, and persists it as a NON-draft closet item the user sees immediately.
 * Enrichment (classify / URL tiers) is an OPTIONAL follow-up the user triggers later — it never blocks the
 * act of recording. `domains: []` marks it as not-yet-classified into any modeled domain (gear or other).
 * Write-gated by the caller (`requireUserId()`); `getRepository()` is the real repo (a guest cannot write).
 */
export async function recordOwnership(name: string, userId = DEFAULT_USER_ID): Promise<StoredItem> {
  return getRepository().addItem(userId, {
    name,
    inInventory: true,
    draft: false,
    classification: recordOnlyClassification(name),
    inventory: { ownershipStatus: "owned", domains: [] },
  });
}

/**
 * Patch an item's user-owned inventory metadata (status, quantity, condition, acquisition, location,
 * size/color, notes) WITHOUT touching its behavioral classification (ADR-0021 — inventory is mutable user
 * data, never a facet). User-scoped in the repo; a non-owned item is a no-op.
 */
export async function updateInventory(
  id: string,
  patch: Partial<InventoryMeta>,
  userId = DEFAULT_USER_ID,
): Promise<void> {
  return getRepository().updateInventory(userId, id, patch);
}

/**
 * The closet read with optional name/brand/model SEARCH + status filter + sort — routed through the keyset
 * `listItemsPage` query backbone (previously dead code; now the live closet path). Closet membership matches
 * the legacy `getCloset` (in-inventory, non-draft) so record-only and confirmed items both appear, while
 * drafts awaiting review stay out. Phase 1 uses one generous page; true infinite-scroll is Phase 2.
 */
export async function searchCloset(
  dimension: GroupingKey,
  opts: {
    search?: string;
    status?: OwnershipStatus;
    condition?: Condition;
    collectionId?: string;
    tag?: string;
    sort?: "newest" | "name";
    cursor?: string;
    limit?: number;
  } = {},
  userId = DEFAULT_USER_ID,
) {
  const page = await getRepositoryFor(userId).listItemsPage(userId, {
    search: opts.search,
    status: opts.status,
    condition: opts.condition,
    collectionId: opts.collectionId,
    tag: opts.tag,
    sort: opts.sort ?? "newest",
    cursor: opts.cursor,
    limit: opts.limit ?? 60,
  });
  // Closet membership = in-inventory, non-draft (drafts await review). Post-filter is safe with keyset
  // paging: nextCursor advances on the RAW last row, so load-more continues correctly even if a page
  // shows fewer than `limit` after filtering.
  const items = page.items.filter((i) => i.inInventory && !i.draft);
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const groups = groupCloset(items.map(resolveItem), dimension);
  return { items, byId, groups, nextCursor: page.nextCursor };
}

/** Inline rename — updates items.name AND classification.name in sync (ADR-0021 browse curation). */
export async function renameItem(
  id: string,
  name: string,
  userId = DEFAULT_USER_ID,
): Promise<StoredItem | null> {
  return getRepository().updateItemName(userId, id, name);
}

// ---- capture at scale: batch record-only + per-item async enrichment + dedupe (ADR-0022 §Phase 3) ----

/** Helper: read the dedupe fields off a stored item (name + manufacturer identity). */
function dedupeFields(i: StoredItem): DedupeFields {
  return { name: i.name, brand: i.classification.identity.brand.value, model: i.classification.identity.model.value };
}

/**
 * Find an already-owned item that likely duplicates `name` (ADR-0022 §Phase 3 dedupe). Used by the
 * quick-add / batch flows to offer "you may already own this — bump quantity?" instead of a silent dup.
 * Conservative (a missed dup beats a false block); a bare name has no brand/model so it matches mainly on
 * normalized name. Reads through `getRepositoryFor` so a guest's sample closet is deduped too.
 */
export async function findDuplicate(name: string, userId = DEFAULT_USER_ID): Promise<StoredItem | null> {
  const items = (await getRepositoryFor(userId).listItems(userId)).filter((i) => !i.draft);
  type Row = DedupeFields & { _item: StoredItem };
  const rows: Row[] = items.map((i) => ({ ...dedupeFields(i), _item: i }));
  return findDuplicateIn<Row>({ name }, rows)?._item ?? null;
}

/**
 * Record many possessions at once (ADR-0022 §Phase 3 batch). Each line becomes an instant record-only
 * item — NO LLM, never blocking — exactly like `recordOwnership`. Enrichment is the per-item async
 * follow-up the client orchestrates afterward (see `enrichItem`). Blank lines are skipped; returns the
 * created items in input order so the batch UI can drive enrichment over their ids.
 */
export async function recordOwnershipBatch(names: string[], userId = DEFAULT_USER_ID): Promise<StoredItem[]> {
  const created: StoredItem[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    created.push(await recordOwnership(name, userId));
  }
  return created;
}

/**
 * Enrich an EXISTING item in place (ADR-0022 §Phase 3): re-run the classify pipeline on the item's name
 * and overlay the resolved classification + evidence onto the row, marking the gear domain. This is the
 * non-blocking follow-up to record-only capture — the browser fires it per item after a batch/quick add,
 * so facets stream in while the item already lives in the closet. Cache-aware (the self-building KB,
 * user-scoped) and degrade-safe (offline non-corpus names resolve to all-unknown, never throw). Does NOT
 * write a user override (this is inference, not a user correction). Returns the updated item, or null if
 * it isn't the user's. Mirrors `classifyToDraft` but updates instead of creating a draft.
 */
export async function enrichItem(
  id: string,
  userId = DEFAULT_USER_ID,
  deps: ClassifyToDraftDeps = {},
  opts: { webSearch?: boolean } = {},
): Promise<StoredItem | null> {
  const repo = getRepository();
  const existing = await repo.getItem(userId, id);
  if (!existing) return null;
  const name = existing.name;

  let classification: ItemClassification;
  let claims: EvidenceClaim[] = [];
  try {
    const cache = getCacheRepository();
    const key = normalizeCacheKey(name);
    const hit = await cache.lookup(userId, key);
    if (hit) {
      classification = hit.classification;
      claims = decomposeToClaims(classification, OFFLINE_EXTRACTOR_VERSION);
    } else {
      const handle = deps.classifier ?? getClassifier();
      if (handle.kind === "claims") {
        const output = await handle.classify({ name, text: existing.rawText ?? undefined });
        const ingested = ingestLlmClaims(output);
        const resolved = resolveFromClaims(name, ingested.claims);
        classification = resolved.classification;
        claims = resolved.claims;
      } else {
        classification = deriveAndResolve(await handle.classify({ name, text: existing.rawText ?? undefined }));
        claims = decomposeToClaims(classification, OFFLINE_EXTRACTOR_VERSION);
      }
      await cache.putDraft(key, name, classification, MODEL_ID);
    }
  } catch {
    // Classify/enrich failed (LLM timeout/5xx/SDK error/validation) — DEGRADE: leave the item untouched
    // and return it, never throw (ADR-0017 §17.3 degrade-to-unknown). The caller renders the unchanged
    // item; the user can retry. A failed enrichment must never 500 ("brick") the page.
    return existing;
  }

  // AUTHORITATIVE OVERLAY (ADR-0028): pull manufacturer/retailer specs for the NAME via the citation-gated
  // web-search enricher and overlay them — identity (brand/model/price/weight) + composition WIN over the
  // classifier's inference (rule #2). This is what makes "Auto-fill from name" return real specs.
  //
  // OPT-IN (cost discipline — ADR-0030): the web-search call is EXPENSIVE (an outbound `web_search` loop,
  // billable, slow). It runs ONLY on the EXPLICIT single-item path (`opts.webSearch`, i.e. the user pressed
  // "Auto-fill from name") or when a `deps.webSearch` is injected (tests). The AUTOMATIC post-capture /
  // batch enrichment path does NOT pass it, so a paste-a-list of 200 items does not fire 200 web searches.
  // Degrade-safe: a failed/empty search keeps the inference-only classification; NEVER throws. (Caveat: the
  // overlay is applied to the resolved classification, not the persisted claim trail — reads use the
  // classification jsonb as source of truth; a fuller claims merge is future work.)
  const wsEnrich = deps.webSearch ?? (opts.webSearch ? getWebSearchEnricher().enrich : null);
  if (wsEnrich) {
    try {
      const ws = await wsEnrich({ name });
      if (ws.sourceUrl !== null) {
        classification = applyManufacturerOverlay(classification, toManufacturerEvidence(ws.extracted));
      }
    } catch {
      /* web-search unavailable/failed — keep the inference-only classification (degrade, never throw). */
    }
  }

  // Overlay the resolved classification + provenance onto the existing row. Raw repo.updateClassification
  // (NOT updateItemClassification) — enrichment is inference, not a user override, so it must not be
  // written back as this user's authoritative correction.
  await repo.updateClassification(userId, id, classification);
  await repo.replaceItemEvidence(userId, id, claims);
  // Promote to whatever modeled domains the classifier actually found signal in (gear, apparel, or both)
  // — ADR-0023/0026. A quick-added item with no signal (a water bottle, a camera) stays an honest
  // possession (domains []), never a domain item with empty facet sections. Unknown is first-class.
  const domains = modeledDomainsOf(resolveFromClassification(id, classification, existing.inventory));
  if (domains.length > 0) {
    await repo.updateInventory(userId, id, { domains });
  }
  return repo.getItem(userId, id);
}

// ---- curation + portability: collections (kits), tags, CSV export (ADR-0024) ----

/** Set an item's free-form user tags (ADR-0024). Tags are user-curated cross-cutting labels — never
 *  facets/categories. Accepts a raw comma/newline string or array; normalized (trim/dedupe) in core. */
export async function setItemTags(id: string, raw: string | string[], userId = DEFAULT_USER_ID): Promise<void> {
  return getRepository().updateInventory(userId, id, { userTags: normalizeTags(raw) });
}

export async function createCollection(name: string, userId = DEFAULT_USER_ID): Promise<Collection> {
  return getRepository().createCollection(userId, name);
}
export async function listCollections(userId = DEFAULT_USER_ID): Promise<Collection[]> {
  return getRepositoryFor(userId).listCollections(userId);
}
export async function renameCollection(id: string, name: string, userId = DEFAULT_USER_ID): Promise<void> {
  return getRepository().renameCollection(userId, id, name);
}
export async function deleteCollection(id: string, userId = DEFAULT_USER_ID): Promise<void> {
  return getRepository().deleteCollection(userId, id);
}
export async function addItemToCollection(collectionId: string, itemId: string, userId = DEFAULT_USER_ID): Promise<void> {
  return getRepository().addItemToCollection(userId, collectionId, itemId);
}
export async function removeItemFromCollection(collectionId: string, itemId: string, userId = DEFAULT_USER_ID): Promise<void> {
  return getRepository().removeItemFromCollection(userId, collectionId, itemId);
}
/** Which collections contain this item — for the item-detail "in collections" control. */
export async function collectionsForItem(itemId: string, userId = DEFAULT_USER_ID): Promise<Collection[]> {
  return getRepositoryFor(userId).collectionsForItem(userId, itemId);
}

/** One CSV cell — RFC-4180 quoting (wrap + double internal quotes when the value has a comma/quote/newline). */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export the user's whole closet as CSV (ADR-0024 — anti-lock-in / data portability). Pure string build,
 * no new dependency; drafts excluded. One row per owned item with identity + the full inventory layer +
 * tags + domains. Called by the export route handler, which streams it as a download.
 */
export async function exportClosetCsv(userId = DEFAULT_USER_ID): Promise<string> {
  const items = (await getRepositoryFor(userId).listItems(userId)).filter((i) => !i.draft);
  const header = [
    "Name", "Brand", "Model", "Status", "Quantity", "Condition", "Acquired", "Price paid",
    "Acquired from", "Storage location", "Size", "Color", "Tags", "Notes", "Domains",
  ];
  const rows = items.map((i) => {
    const inv = i.inventory;
    const id = i.classification.identity;
    return [
      i.name, id.brand.value ?? "", id.model.value ?? "", inv.ownershipStatus, inv.quantity,
      inv.condition ?? "", inv.acquiredAt ?? "",
      inv.pricePaidCents != null ? (inv.pricePaidCents / 100).toFixed(2) : "",
      inv.acquiredFrom ?? "", inv.storageLocation ?? "", inv.size ?? "", inv.color ?? "",
      inv.userTags.join("; "), (inv.userNotes ?? "").replace(/\r?\n/g, " "), inv.domains.join("; "),
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// ---- self-building product catalog: add-time autocomplete with specs (ADR-0025) ----

/** A catalog suggestion surfaced as the user types — a previously-classified product they can add WITH
 *  its specs in one tap. Drawn from the GLOBAL draft store (the self-building KB), never a user override. */
export interface CatalogSuggestion {
  key: string;
  name: string;
  brand: string | null;
  model: string | null;
}

/** Name-search the self-building catalog for add-time autocomplete (ADR-0025). */
export async function searchCatalog(query: string, _userId = DEFAULT_USER_ID, limit = 6): Promise<CatalogSuggestion[]> {
  const hits = await getCacheRepository().searchCatalog(query, limit);
  return hits.map((h) => ({
    key: h.key,
    name: h.name,
    brand: h.classification.identity.brand.value,
    model: h.classification.identity.model.value,
  }));
}

/**
 * Add a product from the catalog by its cache key — inherits the previously-classified specs in one tap
 * (ADR-0025), instead of a record-only all-unknown item. The classification comes from the GLOBAL draft
 * store (another user's enrichment, or the seed) via `lookup` — which returns this user's override first
 * if they happen to have one, else the shared draft. Lands straight in the closet (the specs are already
 * validated; the user chose the product) and can be corrected later. Marks the gear domain when the
 * inherited classification carries real gear signal. Returns null if the key is gone.
 */
export async function addFromCatalog(key: string, userId = DEFAULT_USER_ID): Promise<StoredItem | null> {
  const hit = await getCacheRepository().lookup(userId, key);
  if (!hit) return null;
  const classification = hit.classification;
  const item = await getRepository().addItem(userId, {
    name: classification.name,
    inInventory: true,
    draft: false,
    classification,
    inventory: { ownershipStatus: "owned", domains: domainsForClassification(classification) },
  });
  // Give the inherited item an auditable provenance trail (degraded — the source was the cache).
  await getRepository().replaceItemEvidence(userId, item.id, decomposeToClaims(classification, OFFLINE_EXTRACTOR_VERSION));
  return item;
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

/**
 * Plan a trip WITHOUT persisting it — the READ-ONLY path for the demo funnel (a guest, or a logged-in
 * user previewing before saving). Resolves the userId's inventory through `getInventoryResolved` (which
 * routes a GUEST_USER_ID to the seeded in-memory closet via `getRepositoryFor`) and returns the same
 * `RecommendationResult` the real engine produces over that closet — no `saveTrip`, no DB write.
 *
 * The reasoning is identical to `planAndSave`'s plan step (same `planTrip` over the same resolved
 * inventory); only the persistence is dropped. A guest preview therefore runs the REAL engine over the
 * SEED_CORPUS, surfacing genuine gaps (no hardcoding).
 */
export async function planPreview(
  name: string,
  conditions: TripConditions,
  description: string | undefined,
  userId = DEFAULT_USER_ID,
): Promise<RecommendationResult> {
  const inv = await getInventoryResolved(userId);
  return planTrip(inv, name, conditions, description);
}

/**
 * The REBUILT engine (ADR-0027): a trip → a quantified, gear-first packing CHECKLIST over the user's
 * resolved closet. Deterministic and computed at view-time, so it always reflects the CURRENT closet and
 * needs no persistence change (the saved trip stores only its conditions + the legacy result snapshot).
 * Guest-aware via `getInventoryResolved` (a guest plans against the seeded sample closet).
 *
 * `opts` (ADR-0027 Phase 2) carry the minimal trip-input extras — explicit `days`, `partySize`, and an
 * `activities` override — straight into the engine. They are LIVE-ONLY: nothing here is persisted, and
 * the trip schema has no day/party column, so they affect ONLY the immediate plan/preview render. The
 * durable trip inputs are the structured `conditions` (which DO carry `activities` + `duration`); a saved
 * trip re-planned from its stored conditions therefore plays back without any explicit day/party override.
 * Persisting day/party would require a schema change — deliberately out of scope (ADR-0027 Phase 2).
 */
export async function planPackingFor(
  name: string,
  conditions: TripConditions,
  userId = DEFAULT_USER_ID,
  opts: PackingOpts & { enrich?: boolean } = {},
): Promise<PackingPlan> {
  const inv = await getInventoryResolved(userId);
  const plan = planPacking(inv, name, conditions, opts);
  // Layer B (ADR-0027 §B): additive LLM breadth + guide narration over the deterministic plan. OPT-IN
  // ONLY (a user-triggered "expert suggestions" action) — never on every render, to bound LLM cost. The
  // keyless enricher is inert (available:false), so the deterministic plan stands alone offline.
  if (opts.enrich) {
    const enricher = getPackingEnricher();
    if (enricher.available) {
      const enrichment = await enricher.enrich(plan, tripContext(conditions, opts));
      return mergeEnrichment(plan, enrichment);
    }
  }
  return plan;
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

/** The extractor-version stamp for the claims an OFFLINE/cache classification decomposes into (ADR-0014
 *  §5). The offline classifier IS the seed corpus, so one stamp captures both honestly. */
const OFFLINE_EXTRACTOR_VERSION = "offline-classifier-v1";

/**
 * Resolve a full `ItemClassification` from a claim set (ADR-0014 §3) — the claims-based counterpart to
 * `deriveAndResolve`. Material behavior is derived from the RESOLVED composition (so a manufacturer
 * composition out-ranking an inferred one feeds the derivation), and those `derived_from_material` claims
 * join the set before the final assemble. Returns BOTH the resolved classification AND the full claim set
 * to persist (base + derived) — the durable provenance backing store.
 */
function resolveFromClaims(name: string, baseClaims: EvidenceClaim[]): { classification: ItemClassification; claims: EvidenceClaim[] } {
  // 1. Resolve the composition that wins among the base claims, then derive behavioral claims from it.
  const composition = resolvedComposition(name, baseClaims);
  const derived = derivedClaims(deriveFromComposition(composition));

  // 2. The full claim set = base (LLM/manufacturer/inferred) + derived; assemble the resolved view from it.
  const claims = [...baseClaims, ...derived];
  const classification = assembleClassification(name, claims);
  return { classification, claims };
}

/** Assemble just enough to read the RESOLVED composition (so derivation runs on the winning fabric, e.g.
 *  a manufacturer-stated composition that out-ranks the LLM's). DEFENSIVE: a malformed materials claim
 *  yields [] here (no derivation) rather than aborting — the FINAL assemble is the single Zod boundary
 *  that rejects a bad composition, so we never throw twice or hide the real validation error. */
function resolvedComposition(name: string, claims: EvidenceClaim[]): ItemClassification["materials"] {
  const materialClaims = claims.filter((c) => c.facetKey === MATERIALS_FACET_KEY);
  if (materialClaims.length === 0) return [];
  try {
    return assembleClassification(name, materialClaims).materials;
  } catch {
    return [];
  }
}

/** Test seam: the classifier handle is injectable so the claims path is hermetically testable without
 *  an API key (the real handle is env-selected by `getClassifier()`). */
export interface ClassifyToDraftDeps {
  classifier?: ReturnType<typeof getClassifier>;
  /**
   * Web-search product enrichment (ADR-0020, extended to the by-name path in ADR-0028). When available,
   * the by-name enrichment overlays authoritative manufacturer/retailer identity + composition specs on
   * top of the classifier's behavioral inference (citation-gated in core). Defaults to the env-selected
   * `getWebSearchEnricher()`; injected in tests. The keyless handle is inert (`available:false`), so the
   * hermetic gate is unchanged.
   */
  webSearch?: (query: { name?: string | null; url?: string | null }) => Promise<WebSearchResult>;
}

/**
 * Classify a named item and store it as a DRAFT (not yet in the closet) for review. Checks the
 * self-building knowledge base FIRST, scoped to THIS user: a hit reuses a stored classification (no LLM
 * call) — the user's own override wins over the shared low-authority draft (ADR-0012 Element 5). A miss
 * classifies live/offline and writes the result back as a GLOBAL DRAFT (never a user override — only an
 * explicit correction/confirmation does that). The review step still gates everything.
 *
 * ONLINE (LLM) classify emits CLAIMS (resolved here via the assembler); OFFLINE emits a resolved
 * classification directly. Either way the claim set is persisted to item_evidence (ADR-0014 §3/§5) and
 * `unresolvedQuestions` (online only) are surfaced on the returned draft for the review UI.
 */
export async function classifyToDraft(
  name: string,
  text: string | undefined,
  inInventory: boolean,
  userId = DEFAULT_USER_ID,
  deps: ClassifyToDraftDeps = {},
): Promise<{ item: StoredItem; mode: AddMode; fromCache: boolean; unresolvedQuestions: string[] }> {
  const cache = getCacheRepository();
  const key = normalizeCacheKey(name);
  const hit = await cache.lookup(userId, key);

  let classification: ItemClassification;
  // The claim set to persist alongside the resolved classification (item_evidence — ADR-0014). Empty for a
  // cache hit until we decompose the resolved view into a degraded trail (§5).
  let claims: EvidenceClaim[] = [];
  let unresolvedQuestions: string[] = [];

  if (hit) {
    // A cache hit is a resolved classification (a stored draft/override). Record its facets as a degraded
    // evidence trail (ADR-0014 §5) so even an offline-served item is auditable + re-resolvable.
    classification = hit.classification;
    claims = decomposeToClaims(classification, OFFLINE_EXTRACTOR_VERSION);
  } else {
    const handle = deps.classifier ?? getClassifier();
    if (handle.kind === "claims") {
      // ONLINE: the LLM emits CLAIMS. Ingest them (hard-fact demotion + novel-key parking), then resolve
      // the whole classification from claims (derive-from-composition claims join the set) — ADR-0014 §3.
      const output = await handle.classify({ name, text });
      const ingested = ingestLlmClaims(output);
      unresolvedQuestions = ingested.unresolvedQuestions;
      const resolved = resolveFromClaims(name, ingested.claims);
      classification = resolved.classification;
      claims = resolved.claims;
    } else {
      // OFFLINE/seed: the classifier emits a RESOLVED classification directly. Derive→resolve as before,
      // then decompose into a degraded evidence trail so even offline items get provenance (§5).
      classification = deriveAndResolve(await handle.classify({ name, text }));
      claims = decomposeToClaims(classification, OFFLINE_EXTRACTOR_VERSION);
    }
    // A classify-miss is a LOW-AUTHORITY draft — shared, but never attributed to this (or any) user.
    await cache.putDraft(key, name, classification, MODEL_ID);
  }

  // Mark the modeled domains the classification shows signal in (gear, apparel, or both) — ADR-0023/0026.
  const item = await getRepository().addItem(userId, { name, inInventory, draft: true, rawText: text, classification, inventory: { domains: domainsForClassification(classification) } });
  // Persist the claim set as the item's provenance backing store (a no-op-safe REPLACE, user-scoped).
  await getRepository().replaceItemEvidence(userId, item.id, claims);
  const mode = deps.classifier?.mode ?? classifierMode();
  return { item, mode, fromCache: Boolean(hit), unresolvedQuestions };
}

// ---- add-by-manufacturer-URL (review-before-save; authoritative enrichment) ----

export type EnrichResult = { ok: true; draftId: string } | { ok: false; reason: string };

/** Test seam: the network fetcher + the classifier are injectable so the orchestration is hermetic. */
export interface EnrichDeps {
  /** Defaults to the real SSRF-safe `fetchManufacturerHtml`. Passed `deps.fetcher` for a fixture in tests. */
  fetchHtml?: (url: string) => ReturnType<typeof fetchManufacturerHtml>;
  /**
   * Residential-proxy fallback (Scrapfly), tried ONLY when the direct fetch yields no product signal —
   * a bot wall (REI/TNF). Defaults to the real `fetchViaScrapfly`; injected in tests. The fallback path
   * is taken only when this is injected OR `SCRAPFLY_KEY` is configured, so the hermetic gate (no key) is
   * unchanged.
   */
  fetchScrapfly?: (url: string) => ReturnType<typeof fetchViaScrapfly>;
  /**
   * Web-search enrichment (ADR-0020), tried when direct + residential both yield no signal — the
   * universal tier that resolves even hard-walled brands (Patagonia). Defaults to the env-selected
   * `getWebSearchEnricher()`; injected in tests. Taken only when injected OR an ANTHROPIC_API_KEY is
   * configured, so the hermetic gate is unchanged. Citation-gated in core: only an allowlisted,
   * actually-returned source URL yields authoritative (`manufacturer`) facts.
   */
  webSearch?: (query: { name?: string | null; url?: string | null }) => Promise<WebSearchResult>;
  /** Defaults to the env-selected classifier from `getClassifier()`. */
  classify?: Classifier;
  /** Forwarded to the default fetcher (injected `fetchImpl`/`lookup`) when `fetchHtml` is not overridden. */
  fetcherDeps?: FetcherDeps;
}

/**
 * Add an item by pasting a MANUFACTURER PRODUCT URL: safely fetch + parse the page, classify the item,
 * then resolve the authoritative manufacturer CLAIMS against the inference's claims through the SAME
 * resolver (manufacturer out-ranks inferred by precedence — rule #2). Stores the result as a DRAFT for
 * review and returns its id. The full claim set (manufacturer + inference + derived) is persisted to
 * item_evidence (ADR-0014 §3).
 *
 * Failure modes are returned as `{ ok:false, reason }`, never thrown:
 *   - the fetcher's prefixed reason (`url-shape:`/`private-ip:`/`http:`/`content-type:`/`size:`/…) is
 *     surfaced verbatim so the action can map it to a friendly message.
 *   - DEGRADED CLASSIFY: the offline classifier throws on items outside the prototype corpus (no API
 *     key). We CATCH that (inference claims = []) and still build a draft from the manufacturer claims +
 *     the chemistry derived from the stated composition — authoritative facts are NEVER lost just because
 *     the behavioral classifier was unavailable. (A *fetch* failure still aborts with no draft; only the
 *     classify step degrades.)
 */
export async function enrichFromUrlToDraft(
  userId: string,
  url: string,
  deps: EnrichDeps = {},
  inInventory = true,
): Promise<EnrichResult> {
  // OPEN MODE (ADR-0029): `allowlist: []` lifts the domain hardcap so ANY public product URL can be
  // fetched. SSRF is still fully defended by the fetcher's DNS-resolve-all + private/loopback/reserved-IP
  // block + per-hop redirect re-validation; the host allowlist was defense-in-depth. A caller-supplied
  // `fetcherDeps` (tests) still wins.
  const fetchHtml = deps.fetchHtml ?? ((u: string) => fetchManufacturerHtml(u, { allowlist: [], ...deps.fetcherDeps }));
  const fetchScrapfly = deps.fetchScrapfly ?? ((u: string) => fetchViaScrapfly(u));

  // 1. DIRECT fetch first — free + fast. For non-walled brands this is the whole story.
  let fetched = await fetchHtml(url);
  let extracted = fetched.ok ? parseProductHtml(fetched.html) : null;
  let enrichment = extracted ? toManufacturerEvidence(extracted) : null;

  // 2. RESIDENTIAL fallback (ADR-0019): if the direct path got NO usable product signal — a bot wall
  //    serving a 200 challenge (REI/TNF), a 403, or a refused connection — retry through Scrapfly's
  //    residential + anti-bot pipeline when configured. A url-shape rejection is NEVER retried (a
  //    non-allowlisted URL must not be proxied). The shape gate runs again inside fetchViaScrapfly, so
  //    only allowlisted hosts are sent on. Taken only when injected (tests) or SCRAPFLY_KEY is set, so the
  //    hermetic gate is unchanged. (Patagonia stays walled even here → falls through to the no-signal guard.)
  const shapeRejected = !fetched.ok && fetched.reason.startsWith("url-shape:");
  const scrapflyAvailable = deps.fetchScrapfly != null || isScrapflyConfigured();
  if (!shapeRejected && !enrichment?.hasSignal && scrapflyAvailable) {
    const viaScrapfly = await fetchScrapfly(url);
    if (viaScrapfly.ok) {
      fetched = viaScrapfly;
      extracted = parseProductHtml(viaScrapfly.html);
      enrichment = toManufacturerEvidence(extracted);
    }
  }

  // 3. WEB-SEARCH fallback (ADR-0020): STILL no authoritative signal — a hard-walled brand (Patagonia,
  //    which even residential can't clear) or a page that didn't parse. Retrieve the specs from the search
  //    index via Claude's web_search tool, restricted to the manufacturer/retailer allowlist. A fact is
  //    authoritative ONLY when its citation is a REAL allowlisted result URL — the authority comes from the
  //    citation (validated in core), not the model. This can rescue even a FAILED direct fetch (a 403 /
  //    refused page that search can still find). A url-shape rejection is never searched (out-of-scope
  //    host). Taken only when injected (tests) or ANTHROPIC_API_KEY is set, so the hermetic gate is unchanged.
  if (!shapeRejected && !enrichment?.hasSignal) {
    const ws = deps.webSearch ? { enrich: deps.webSearch, available: true } : getWebSearchEnricher();
    if (ws.available) {
      const viaSearch = await ws.enrich({ url });
      if (viaSearch.sourceUrl) {
        extracted = viaSearch.extracted;
        enrichment = toManufacturerEvidence(extracted);
      }
    }
  }

  // 4. Resolve the outcome. We proceed iff SOME tier produced authoritative signal — even when the DIRECT
  //    fetch failed (web search can rescue a 403/walled page). Otherwise surface the original fetcher
  //    reason (direct failed, nothing rescued it) for the action's friendly mapping, else the honest
  //    no-signal message. Do NOT manufacture a junk "Item from <host>" draft with every field unknown (the
  //    "returned zero fields" symptom); fail honestly so the action steers the user to add-by-name.
  //    (Distinct from DEGRADED classify below: there the manufacturer signal IS present and is preserved.)
  if (!extracted || !enrichment || !enrichment.hasSignal) {
    if (!fetched.ok) return { ok: false, reason: fetched.reason };
    return { ok: false, reason: "no-signal: the page had no readable product details" };
  }

  // Build the classify input from the manufacturer-stated facts: name = brand + model when present,
  // text = the stated composition / specs so the LLM infers behavioral facets from real evidence.
  const name = manufacturerName(enrichment.identity.brand.value, enrichment.identity.model.value, url);
  const text = manufacturerDetailText(extracted);

  // The manufacturer-stated identity + composition become AUTHORITATIVE claims (source:"manufacturer").
  // They join the inference's claims and are adjudicated by the SAME resolver — replacing the bespoke
  // applyManufacturerOverlay merge with the general precedence policy (ADR-0014 §3). Manufacturer out-ranks
  // inferred for the facets it states; behavioral facets remain the inference's (the extractor states none).
  const mfrClaims = manufacturerClaims(enrichment, url);

  // Collect the INFERENCE claims (from the LLM-claims path, the offline resolved path decomposed to claims,
  // or — degraded — none). The classifier handle is injectable for hermetic tests.
  const inferenceClaims = await classifyToInferenceClaims(name, text, deps);

  // Resolve the full classification from the combined claim set (manufacturer + inference + derived).
  const { classification, claims } = resolveFromClaims(name, [...mfrClaims, ...inferenceClaims]);

  const item = await getRepository().addItem(userId, {
    name,
    inInventory,
    draft: true,
    rawText: text,
    classification,
    inventory: { domains: domainsForClassification(classification) }, // mark modeled domains (ADR-0023/0026)
  });
  // Persist the full claim set (manufacturer + inference + derived) as the item's provenance backing store.
  await getRepository().replaceItemEvidence(userId, item.id, claims);
  return { ok: true, draftId: item.id };
}

/**
 * Run the configured classifier for the enrichment path and return its output AS INFERENCE CLAIMS — so the
 * manufacturer claims and the inference compete in the SAME resolver. The classifier is the discriminated
 * handle (claims online / resolved offline), or an injected `deps.classify` (a resolved Classifier, the
 * established enrich test seam — its output is decomposed to claims). On a DEGRADED classify (the offline
 * classifier throws on an item outside the prototype corpus) we return [] — the manufacturer facts are
 * NEVER lost just because the behavioral classifier was unavailable.
 */
async function classifyToInferenceClaims(
  name: string,
  text: string | undefined,
  deps: EnrichDeps,
): Promise<EvidenceClaim[]> {
  try {
    if (deps.classify) {
      // Injected resolved-classifier seam (enrich tests): decompose its resolved output into inferred claims.
      const c = await deps.classify({ name, text });
      return decomposeToClaims(c, OFFLINE_EXTRACTOR_VERSION);
    }
    const handle = getClassifier();
    if (handle.kind === "claims") {
      const output: LlmClaimsOutput = await handle.classify({ name, text });
      return ingestLlmClaims(output).claims;
    }
    return decomposeToClaims(await handle.classify({ name, text }), OFFLINE_EXTRACTOR_VERSION);
  } catch {
    // DEGRADED: no behavioral classifier could run. The manufacturer claims still produce an honest draft
    // (authoritative identity + composition + the chemistry derived from that composition).
    return [];
  }
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

/**
 * The CLAIMS-based user-correction path (ADR-0014 §3): a user edit writes `source:"user"` claims to
 * item_evidence and RE-RESOLVES the item from its full stored claim set — WITHOUT calling the LLM. A user
 * is authoritative, so each corrected facet out-ranks every inferred/derived/manufacturer competitor and
 * actually flips a capability outcome. Re-resolving the whole item from its claims (not a single-facet
 * path) is the v1 design — the resolver is total and re-running it over N claims is cheap + order-independent.
 *
 * Returns the updated item (with the re-resolved classification persisted), or null if it isn't the user's.
 * No-op-safe: a correction with no asserting user claim leaves the stored evidence + classification as-is.
 */
export async function correctItemFromClaims(
  id: string,
  values: Record<string, string | string[] | undefined>,
  userId = DEFAULT_USER_ID,
): Promise<StoredItem | null> {
  const repo = getRepository();
  const existing = await repo.getItem(userId, id);
  if (!existing) return null;

  const userClaims = userCorrectionClaims(values);
  if (userClaims.length === 0) return existing; // nothing asserted → no re-resolve

  // The prior claim set. An item that predates the evidence store (a seed item, or one added before this
  // wave — ADR-0014 §5/§6 do NO backfill) has none; decompose its CURRENT resolved classification into an
  // inferred trail FIRST so the user correction layers onto the existing facets instead of erasing them.
  let priorClaims = await repo.getItemEvidence(userId, id);
  if (priorClaims.length === 0) {
    priorClaims = decomposeToClaims(existing.classification, OFFLINE_EXTRACTOR_VERSION);
  }

  // Merge: keep every prior claim EXCEPT a prior user claim for a facet the user is re-asserting (a fresh
  // user correction supersedes their own earlier one); then append the new user claims. Other sources'
  // claims are untouched — the resolver re-adjudicates the whole set.
  const supersededKeys = new Set(userClaims.filter((c) => c.source === "user").map((c) => c.facetKey));
  const retained = priorClaims.filter((c) => !(c.source === "user" && supersededKeys.has(c.facetKey)));
  const merged = [...retained, ...userClaims];

  // Re-resolve the whole classification from the merged claim set (no LLM). Material derivation re-runs on
  // the resolved composition, so a user composition correction propagates to the derived behavior too.
  const { classification, claims } = resolveFromClaims(existing.name, merged);

  await repo.replaceItemEvidence(userId, id, claims);
  return updateItemClassification(id, classification, userId);
}

export async function setInventory(id: string, inInventory: boolean, userId = DEFAULT_USER_ID) {
  return getRepository().setInventory(userId, id, inInventory);
}

/**
 * Set or clear an item's display-only photo path (ADR-0018). The bytes are uploaded client-direct to the
 * private `item-images` bucket; this only persists the resulting object key (or null to remove) on the
 * item row. User-scoped in the repo (the app-layer WHERE user_id is the sole live isolation) — a non-owned
 * item is a no-op returning null. Photo is decoration, never a facet/capability input.
 */
export async function setItemImagePath(
  id: string,
  imagePath: string | null,
  userId = DEFAULT_USER_ID,
): Promise<StoredItem | null> {
  return getRepository().setItemImagePath(userId, id, imagePath);
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
