// Ports (hexagonal): the persistence interface the app depends on. Core defines the contract; the
// edge provides an implementation (in-memory for dev/demo, Drizzle/Postgres for prod). This keeps the
// core pure and lets the same reasoning back any storage — or an MCP server later.

import type { ItemClassification } from "./classification";
import type { TripConditions } from "./conditions";
import type { RecommendationResult } from "./recommend";
import type { Source } from "./evidence";
import type { InventoryMeta, OwnershipStatus, Condition } from "./inventory";

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
  /**
   * Display-only photo: the object path in the PRIVATE `item-images` bucket
   * (`<user_id>/<item_id>/<uuid>.<ext>`), or null/undefined when there is no photo (ADR-0018). This is
   * decoration, NEVER a facet or capability input. The bucket is private, so this bare path is not a
   * public URL — the UI signs it via `getSignedItemImageUrl` (src/server/item-images.ts). Reads surface
   * it; the upload action that writes it is a later wave.
   */
  imagePath?: string | null;
  /**
   * Ownership / physical metadata from the inventory layer (ADR-0021, ADR-0022, ADR-0023). Populated
   * from typed columns; never derived from the classification JSONB. Defaults to DEFAULT_INVENTORY when
   * reading pre-migration rows (columns exist with DB defaults after the 0008 migration).
   */
  inventory: InventoryMeta;
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
  /**
   * Optional inventory/possession metadata. All fields optional; absent fields fall through to
   * DEFAULT_INVENTORY so existing callers in app-service.ts compile unchanged. When present, the
   * field values are persisted in the typed inventory columns (not in the classification JSONB).
   */
  inventory?: Partial<InventoryMeta>;
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
  /**
   * Free-text search: case-insensitive substring match over name/brand/model. Postgres uses ILIKE;
   * the in-memory impl mirrors with `itemMatchesSearch` so both paths return the same items.
   */
  search?: string;
  /** Filter to items whose ownershipStatus equals this value. */
  status?: OwnershipStatus;
  /** Filter to items whose condition equals this value. */
  condition?: Condition;
  /**
   * Filter to items where this string is a member of the `domains` array. Postgres uses `= ANY(domains)`;
   * the in-memory impl uses Array.includes. Useful for showing only fully-classified 'gear' items.
   */
  domain?: string;
  /**
   * Filter to items belonging to this collection (by collection id). Verifies the collection belongs to
   * the same userId — a non-owned collectionId returns an empty page. Composed with all other filters.
   */
  collectionId?: string;
  /**
   * Filter to items where this tag is a member of `userTags` (case-insensitive). Postgres uses
   * `ILIKE ANY(user_tags)` equivalently; the in-memory impl uses a case-insensitive includes check.
   */
  tag?: string;
  /** Sort order. 'newest' (default) = createdAt desc, id desc. 'name' = alphabetical ascending. */
  sort?: "newest" | "name";
}

/**
 * A user-curated named collection of items. Collections have no behavioral semantics — they are a
 * curation/browsing tool, entirely orthogonal to facets/capabilities. `itemCount` is the number of
 * items currently in the collection (denormalized for display; computed on read).
 */
export interface Collection {
  id: string;
  userId: string;
  name: string;
  /** Number of items currently in the collection. Computed on read; not a stored column. */
  itemCount: number;
  createdAt: string;
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
  /**
   * Set (or clear, with null) an item's display-only photo path — the object key in the PRIVATE
   * `item-images` bucket (`<user_id>/<item_id>/<uuid>.<ext>`, built by `buildItemImageObjectPath`).
   * Display decoration only (ADR-0018), NEVER a facet/capability input. User-scoped: the app-layer
   * `WHERE user_id = $userId` is the SOLE live tenant isolation (the owner connection bypasses RLS), so
   * setting another user's item is a no-op that returns null. Returns the updated row, or null if the
   * item isn't the user's.
   */
  setItemImagePath(userId: string, id: string, imagePath: string | null): Promise<StoredItem | null>;
  /**
   * Patch an item's inventory/possession metadata (ownershipStatus, condition, acquiredAt, …). Only
   * the supplied fields are updated; absent fields are left unchanged. User-scoped: a non-owned id is
   * a no-op. Does NOT touch the classification JSONB or any behavioral facet column. Inline edits
   * (the browse/closet UI) call this so users can update ownership state without re-classifying.
   */
  updateInventory(userId: string, id: string, patch: Partial<InventoryMeta>): Promise<void>;
  /**
   * Rename an item in-place: updates `items.name` AND `classification.name` inside the JSONB so that
   * both the hot column and the lossless source of truth stay in sync (reads reconstruct the display
   * name from classification, so drifting them apart causes stale names in the UI). User-scoped: a
   * non-owned id is a no-op returning null. Returns the updated StoredItem, or null if not found.
   */
  updateItemName(userId: string, id: string, name: string): Promise<StoredItem | null>;
  deleteItem(userId: string, id: string): Promise<void>;

  /**
   * REPLACE an item's full evidence claim set (item_evidence store — ADR-0012 Element 2): delete the
   * item's existing claim rows, then insert `claims`. User-scoped — the app-layer `userId` check is the
   * SOLE live tenant isolation (the owner connection bypasses RLS; the RLS policy guards only the public
   * PostgREST/anon surface). A re-resolution writes the current full set, so this is replace, not append.
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

  // ---- collections: user-curated named sets of items ----
  // Collections are curation/browsing tools; they carry NO behavioral semantics and are NOT facet
  // inputs. Every method is user-scoped — a non-owned id is always a no-op or returns empty/null.

  /** Create a new empty collection for the user. Returns the persisted Collection (itemCount = 0). */
  createCollection(userId: string, name: string): Promise<Collection>;
  /**
   * List all collections for the user, newest first, each with the current itemCount. An empty
   * array is returned (not an error) when the user has no collections.
   */
  listCollections(userId: string): Promise<Collection[]>;
  /** Rename a collection in place. No-op if the collection doesn't belong to the user. */
  renameCollection(userId: string, id: string, name: string): Promise<void>;
  /**
   * Delete a collection and all its membership rows (cascade via FK). No-op if the collection
   * doesn't belong to the user. Does NOT delete the items themselves.
   */
  deleteCollection(userId: string, id: string): Promise<void>;
  /**
   * Add an item to a collection. Idempotent — a duplicate add is silently ignored. Verifies BOTH
   * the collection AND the item belong to the same userId; a non-owned id on either side is a no-op.
   */
  addItemToCollection(userId: string, collectionId: string, itemId: string): Promise<void>;
  /** Remove an item from a collection. No-op if either id is not owned or the membership doesn't exist. */
  removeItemFromCollection(userId: string, collectionId: string, itemId: string): Promise<void>;
  /**
   * List item ids in a collection. Returns [] if the collection doesn't belong to the user or is empty.
   * Ordered by `addedAt` descending (most recently added first).
   */
  listCollectionItemIds(userId: string, collectionId: string): Promise<string[]>;
  /**
   * Return all collections (with itemCount) that contain the given item. Used by the item detail page
   * to show which collections an item belongs to. Returns [] if the item isn't the user's.
   */
  collectionsForItem(userId: string, itemId: string): Promise<Collection[]>;
}
