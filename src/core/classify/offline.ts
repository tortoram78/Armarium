// Offline classifier — used when no ANTHROPIC_API_KEY is available (sandbox/dev/demo). It only knows
// the prototype corpus; anything outside the corpus gracefully degrades to an all-unknown classification
// (via `classifyOfflineSafe`) so a user can add any item by name without an API key. The original
// `classifyOffline` still throws for callers that explicitly need the corpus-only invariant (tests).

import { SEED_CORPUS } from "../seed-corpus";
import type { ItemClassification } from "../classification";
import { unknownBehavioralClassification } from "../enrich/merge";
import type { ClassifyInput } from "./prompt";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Classify against the prototype corpus. Returns the corpus entry on a hit. Throws on a miss — this
 * allows callers that need the hard corpus invariant (e.g. internal tooling) to distinguish a miss from
 * a graceful degradation. Most app-facing callers should use `classifyOfflineSafe` instead.
 */
export function classifyOffline(input: ClassifyInput): ItemClassification {
  const n = norm(input.name);
  const hit = SEED_CORPUS.find(
    (e) => norm(e.classification.name) === n || norm(e.input.name) === n || (n.length > 3 && norm(e.classification.name).includes(n)),
  );
  if (!hit) {
    throw new Error(
      `Offline classifier only knows the prototype corpus. Set ANTHROPIC_API_KEY to classify "${input.name}".`,
    );
  }
  return structuredClone(hit.classification);
}

/**
 * Classify against the prototype corpus, degrading gracefully on a miss.
 *
 * - Corpus hit  → returns the cached classification (identical to `classifyOffline`).
 * - Corpus miss → returns `unknownBehavioralClassification(name)` — a fully-valid all-unknown
 *   classification — instead of throwing. This is the "record-only" safe path: the item is persisted
 *   immediately with honest "unknown" facets; the user can enrich later by setting an API key.
 *
 * This is the path app-service uses in the offline/no-key mode so a user can add any item by name.
 * NEVER fabricates facets — the all-unknown scaffold is the correct, honest representation.
 */
export function classifyOfflineSafe(input: ClassifyInput): ItemClassification {
  try {
    return classifyOffline(input);
  } catch {
    return unknownBehavioralClassification(input.name);
  }
}
