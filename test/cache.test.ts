// The self-building knowledge base. The offline classifier is corpus-only (throws on novel items), so
// the live miss→classify→store path needs a real key (exercised in the running app). Here we pin the
// two behaviours that don't need the LLM: the cache is consulted BEFORE the classifier, and a user
// correction/confirmation upserts an authoritative entry that the NEXT add reuses.

import { describe, it, expect } from "vitest";
import { normalizeCacheKey } from "@/core/cache";
import { classifyToDraft, updateItemClassification } from "@/server/app-service";
import { getCacheRepository } from "@/server/services";
import { applyUserCorrections } from "@/core/corrections";
import { SEED_CORPUS } from "@/core/seed-corpus";

const seededName = SEED_CORPUS[0]!.classification.name;

describe("normalizeCacheKey", () => {
  it("is case/space/punctuation-insensitive and idempotent", () => {
    const k = normalizeCacheKey("  Arc'teryx   Beta-AR  Jacket ");
    expect(k).toBe("arc teryx beta ar jacket");
    expect(normalizeCacheKey(k)).toBe(k);
  });
});

describe("classification cache (self-building KB)", () => {
  it("a known (seeded) item is served from the KB", async () => {
    const r = await classifyToDraft(seededName, undefined, true);
    expect(r.fromCache).toBe(true);
    expect(r.item.classification.name).toBe(seededName);
  });

  it("the cache is consulted BEFORE the classifier (a pre-seeded novel item never hits the LLM)", async () => {
    // Without the cache-first check this add would THROW (offline classifier rejects novel names),
    // so a clean fromCache:true result proves the ordering.
    const name = "Acme Test Widget 9000";
    const base = structuredClone(SEED_CORPUS[0]!.classification);
    base.name = name;
    await getCacheRepository().putCached({ key: normalizeCacheKey(name), name, classification: base, source: "llm", modelId: "test" });

    const r = await classifyToDraft(name, undefined, true);
    expect(r.fromCache).toBe(true);
    expect(r.item.classification.name).toBe(name);
  });

  it("a user correction feeds the KB — the next add reflects it", async () => {
    const name = "Acme Test Widget 9001";
    const base = structuredClone(SEED_CORPUS[0]!.classification);
    base.name = name;
    await getCacheRepository().putCached({ key: normalizeCacheKey(name), name, classification: base, source: "llm", modelId: "test" });

    const first = await classifyToDraft(name, undefined, true);
    const corrected = applyUserCorrections(first.item.classification, { "universal.warmth": "very_high" });
    await updateItemClassification(first.item.id, corrected);

    const next = await classifyToDraft(name, undefined, true);
    expect(next.fromCache).toBe(true);
    expect(next.item.classification.universal.warmth.value).toBe("very_high");
  });
});
