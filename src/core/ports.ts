// Ports (hexagonal): the persistence interface the app depends on. Core defines the contract; the
// edge provides an implementation (in-memory for dev/demo, Drizzle/Postgres for prod). This keeps the
// core pure and lets the same reasoning back any storage — or an MCP server later.

import type { ItemClassification } from "./classification";
import type { TripConditions } from "./conditions";
import type { RecommendationResult } from "./recommend";

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

export interface GearRepository {
  listItems(userId: string): Promise<StoredItem[]>;
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
}
