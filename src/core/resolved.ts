// The "resolved item" — the flat facet view that capability predicates and recommendations read.
// It is produced either from a fresh classification (seed / ingest) or, in Phase 2, rebuilt from the
// DB columns. Either way capabilities consume this single shape, so the reasoning layer never depends
// on how an item was stored.
//
// `inventory` carries the ownership/physical envelope (ownershipStatus, quantity, condition, …). It is
// passed in from the PERSISTENCE layer — it is NOT derived from the classification JSONB. When a caller
// does not supply it (e.g. existing tests, seed corpus paths), DEFAULT_INVENTORY is used so the field is
// always present and callers never need to null-check it.

import type { ItemClassification, UniversalFacets, MultiLabelFacets, FacetGroups } from "./classification";
import { type InventoryMeta, DEFAULT_INVENTORY } from "./inventory";

export interface ResolvedItem {
  id: string;
  name: string;
  universal: UniversalFacets;
  multilabel: MultiLabelFacets;
  groups: FacetGroups;
  /** Ownership / physical metadata from the persistence layer. Never derived from classification. */
  inventory: InventoryMeta;
  /** The item's known weight in grams (identity hard fact), or null if unknown. Surfaced here so the
   *  packing engine can total a pack weight without re-reading the full classification (ADR-0027 §Phase 4). */
  weightGrams: number | null;
}

export function resolveFromClassification(id: string, c: ItemClassification, inventory: InventoryMeta = DEFAULT_INVENTORY): ResolvedItem {
  return {
    id,
    name: c.name,
    universal: c.universal,
    multilabel: c.multilabel,
    groups: c.groups,
    inventory,
    weightGrams: c.identity.weight_grams.value,
  };
}
