// Ports (hexagonal): the persistence interface the app depends on. Core defines the contract; the
// edge provides an implementation (in-memory for dev/demo, Drizzle/Postgres for prod). This keeps the
// core pure and lets the same reasoning back any storage — or an MCP server later.

import type { ItemClassification } from "./classification";
import type { TripConditions } from "./conditions";
import type { RecommendationResult } from "./recommend";
import type { Source } from "./evidence";

// The classification-cache port lives with its types in ./cache (the split-store contract — ADR-0012
// Element 5). Re-exported here so existing importers of the persistence ports keep working.
export type { ClassificationCacheRepository } from "./cache";

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

/**
 * One persisted CLAIM about a single facet (one row in the item_evidence store — ADR-0012 Element 2).
 * Mirrors the resolver's `Claim<V>` (src/core/resolve/resolve-facet.ts) plus persistence provenance
 * (sourceUrl/extractorVersion/observedAt). `value` is a scalar OR an array. `confidence` is the graded
 * tier for an asserted value — note an item_evidence row only ever stores a real (asserting) claim, so
 * the "unknown" floor never lands here. The resolver later groups a facet's claims and decides the
 * winner via SOURCE_PRECEDENCE; this type is just the at-rest record. Persisted with REPLACE semantics
 * (a re-resolution writes the current full claim set for the item).
 */
export interface EvidenceClaim {
  facetKey: string;
  value: unknown;
  confidence: "low" | "medium" | "high";
  source: Source;
  sourceUrl?: string | null;
  extractorVersion?: string | null;
  evidence: string;
  /** ISO 8601 timestamp; defaults to now on insert when omitted. */
  observedAt?: string;
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

  /**
   * REPLACE an item's full evidence claim set (item_evidence store — ADR-0012 Element 2): delete the
   * item's existing claim rows, then insert `claims`. User-scoped (the item must belong to `userId`; RLS
   * is the second layer). A re-resolution writes the current full set, so this is replace, not append.
   * No-op if the item isn't the user's. Transactional where the backend supports it.
   */
  replaceItemEvidence(userId: string, itemId: string, claims: EvidenceClaim[]): Promise<void>;
  /**
   * Read ALL persisted claims for an item, flat (the resolver groups by facetKey later). User-scoped;
   * returns [] if the item isn't the user's or has no evidence.
   */
  getItemEvidence(userId: string, itemId: string): Promise<EvidenceClaim[]>;

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
