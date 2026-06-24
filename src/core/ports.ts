// Ports (hexagonal): the persistence interface the app depends on. Core defines the contract; the
// edge provides an implementation (in-memory for dev/demo, Drizzle/Postgres for prod). This keeps the
// core pure and lets the same reasoning back any storage — or an MCP server later.

import type { ItemClassification } from "./classification";
import type { TripConditions } from "./conditions";
import type { RecommendationResult } from "./recommend";
import type { CachedClassification, CacheUpsert } from "./cache";

export interface StoredItem {
  id: string;
  userId: string;
  name: string;
  inInventory: boolean;
  /** A draft is a freshly-classified candidate awaiting review/confirm; excluded from the closet. */
  draft: boolean;
  rawText?: string;
  classification: ItemClassification;
  createdAt: string;
}

export interface StoredTrip {
  id: string;
  userId: string;
  name: string;
  description?: string;
  conditions: TripConditions;
  result?: RecommendationResult;
  createdAt: string;
}

export interface AddItemInput {
  name: string;
  inInventory: boolean;
  /** Defaults to false (saved). The review-before-save flow adds with draft: true. */
  draft?: boolean;
  rawText?: string;
  classification: ItemClassification;
}

export interface SaveTripInput {
  name: string;
  description?: string;
  conditions: TripConditions;
  result?: RecommendationResult;
}

/** Options for keyset (cursor) pagination of items. */
export interface PageOpts {
  /** Opaque cursor from a previous page's `nextCursor`. Omit/undefined for the first page. */
  cursor?: string;
  /** Page size. Defaults to 50 in both implementations. */
  limit?: number;
}

/** A single page of items plus the cursor to fetch the next one (`null` when exhausted). */
export interface ItemsPage {
  items: StoredItem[];
  nextCursor: string | null;
}

export interface GearRepository {
  listItems(userId: string): Promise<StoredItem[]>;
  /**
   * Keyset-paginated items, newest-first, with a STABLE cursor over (createdAt, id). Additive to
   * `listItems`: recommend + emergent closet grouping still read ALL rows via `listItems`; this is for
   * paged browsing only. `nextCursor` is null when the last page is reached.
   */
  listItemsPage(userId: string, opts: PageOpts): Promise<ItemsPage>;
  getItem(userId: string, id: string): Promise<StoredItem | null>;
  addItem(userId: string, input: AddItemInput): Promise<StoredItem>;
  updateClassification(userId: string, id: string, classification: ItemClassification): Promise<StoredItem | null>;
  setInventory(userId: string, id: string, inInventory: boolean): Promise<StoredItem | null>;
  /** Confirm/unconfirm a draft. Confirming (draft=false) promotes a candidate into the closet. */
  setDraft(userId: string, id: string, draft: boolean): Promise<StoredItem | null>;
  deleteItem(userId: string, id: string): Promise<void>;

  listTrips(userId: string): Promise<StoredTrip[]>;
  getTrip(userId: string, id: string): Promise<StoredTrip | null>;
  saveTrip(userId: string, trip: SaveTripInput): Promise<StoredTrip>;
  /** Overwrite a saved trip's recommendation (used by re-plan after closet corrections). */
  updateTripResult(userId: string, id: string, result: RecommendationResult): Promise<StoredTrip | null>;
  /** Rename a saved trip. No-op if the trip doesn't belong to the user. */
  renameTrip(userId: string, id: string, name: string): Promise<void>;
  /** Replace a trip's stored conditions. The trip becomes stale until re-planned — does NOT auto-replan. */
  updateTripConditions(userId: string, id: string, conditions: TripConditions): Promise<void>;
  /**
   * Copy a trip's name (suffixed " (copy)") + conditions into a NEW trip id. Does NOT copy the result
   * snapshot — a fresh clone is unplanned until re-planned. User-scoped; returns the new trip.
   */
  cloneTrip(userId: string, id: string): Promise<StoredTrip>;
  /** Delete a saved trip (and its result snapshot), user-scoped. No-op if it isn't the user's. */
  deleteTrip(userId: string, id: string): Promise<void>;
}

/**
 * The self-building classification knowledge base. Reference data (not user-owned): a normalized name
 * → a validated classification, written by the LLM on first sight and upgraded to source:"user" by
 * corrections/confirmations. Lets repeat adds skip the LLM.
 */
export interface ClassificationCacheRepository {
  getCached(key: string): Promise<CachedClassification | null>;
  putCached(entry: CacheUpsert): Promise<void>;
}
