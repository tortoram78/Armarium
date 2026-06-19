// Offline classifier — used when no ANTHROPIC_API_KEY is available (sandbox/dev/demo). It only knows
// the prototype corpus; anything else raises a clear error telling the caller to set a key. This keeps
// the app fully runnable without secrets, while never fabricating facets for unknown items.

import { SEED_CORPUS } from "../seed-corpus";
import type { ItemClassification } from "../classification";
import type { ClassifyInput } from "./prompt";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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
