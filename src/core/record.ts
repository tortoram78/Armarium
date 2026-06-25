// Record-only construction — decouples item creation from LLM classification.
//
// An item can be added to the inventory with zero behavioral knowledge. The `recordOnlyClassification`
// helper returns a fully-valid all-unknown classification: every behavioral facet is the canonical
// "unknown" literal (null + confidence/source markers), materials and treatments are empty, and no
// groups are present. This is the honest "we don't know" state — the same shape the assembler and
// capabilities consume, so no downstream code needs to special-case a record-only item.
//
// PURE: no next/*, no React, no DB, no networking. The LLM is never invoked here.

import type { ItemClassification } from "./classification";
import { unknownBehavioralClassification } from "./enrich/merge";

/**
 * Build a fully-valid, all-unknown `ItemClassification` for an item whose behavioral facets are not yet
 * known. Every soft facet is `{ value: null, confidence: "unknown", source: "unknown" }`; every hard
 * fact is `{ value: null, source: "unknown" }`; multilabel arrays are `[]`; groups is `{}`.
 *
 * Use this when you want to persist an item immediately (record-only path) without going through the
 * classifier. The result can be enriched later by running the classifier and merging claims.
 *
 * Does NOT invoke the offline classifier — it never throws for unknown names.
 */
export function recordOnlyClassification(name: string): ItemClassification {
  return unknownBehavioralClassification(name);
}
