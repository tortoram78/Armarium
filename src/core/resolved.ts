// The "resolved item" — the flat facet view that capability predicates and recommendations read.
// It is produced either from a fresh classification (seed / ingest) or, in Phase 2, rebuilt from the
// DB columns. Either way capabilities consume this single shape, so the reasoning layer never depends
// on how an item was stored.

import type { ItemClassification, UniversalFacets, MultiLabelFacets, FacetGroups } from "./classification";

export interface ResolvedItem {
  id: string;
  name: string;
  universal: UniversalFacets;
  multilabel: MultiLabelFacets;
  groups: FacetGroups;
}

export function resolveFromClassification(id: string, c: ItemClassification): ResolvedItem {
  return { id, name: c.name, universal: c.universal, multilabel: c.multilabel, groups: c.groups };
}
