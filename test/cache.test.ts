// The self-building knowledge base — now a SPLIT store (ADR-0012 Element 5): a GLOBAL low-authority
// draft cache + a PER-USER override store. The offline classifier is corpus-only (throws on novel
// items), so the live miss→classify→store path needs a real key (exercised in the running app). Here we
// pin the behaviours that don't need the LLM:
//   - normalizeCacheKey invariants,
//   - the cache is consulted BEFORE the classifier,
//   - a user correction/confirmation feeds the KB so the NEXT add (by that user) reuses it,
//   - and — the security guarantee — one user's override NEVER leaks into another user's lookup.

import { describe, it, expect } from "vitest";
import { normalizeCacheKey } from "@/core/cache";
import { classifyToDraft, updateItemClassification } from "@/server/app-service";
import { getCacheRepository } from "@/server/services";
import { applyUserCorrections } from "@/core/corrections";
import { SEED_CORPUS } from "@/core/seed-corpus";

const seededName = SEED_CORPUS[0]!.classification.name;
const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

/** A throwaway classification with a chosen name, derived from a real seed entry so it validates. */
function fixtureClassification(name: string) {
  const c = structuredClone(SEED_CORPUS[0]!.classification);
  c.name = name;
  return c;
}

describe("normalizeCacheKey", () => {
  it("is case/space/punctuation-insensitive and idempotent", () => {
    const k = normalizeCacheKey("  Arc'teryx   Beta-AR  Jacket ");
    expect(k).toBe("arc teryx beta ar jacket");
    expect(normalizeCacheKey(k)).toBe(k);
  });
});

describe("classification cache (self-building KB — split store)", () => {
  it("a known (seeded) item is served from the KB as a draft", async () => {
    const r = await classifyToDraft(seededName, undefined, true);
    expect(r.fromCache).toBe(true);
    expect(r.item.classification.name).toBe(seededName);
  });

  it("the cache is consulted BEFORE the classifier (a pre-seeded draft never hits the LLM)", async () => {
    // Without the cache-first check this add would THROW (offline classifier rejects novel names),
    // so a clean fromCache:true result proves the ordering.
    const name = "Acme Test Widget 9000";
    await getCacheRepository().putDraft(normalizeCacheKey(name), name, fixtureClassification(name), "test");

    const r = await classifyToDraft(name, undefined, true);
    expect(r.fromCache).toBe(true);
    expect(r.item.classification.name).toBe(name);
  });

  it("a user correction feeds the KB — the next add by THAT user reflects it", async () => {
    const name = "Acme Test Widget 9001";
    await getCacheRepository().putDraft(normalizeCacheKey(name), name, fixtureClassification(name), "test");

    // Default-user path: classify (draft hit) → correct → re-add. The override now wins for this user.
    const first = await classifyToDraft(name, undefined, true);
    const corrected = applyUserCorrections(first.item.classification, { "universal.warmth": "very_high" });
    await updateItemClassification(first.item.id, corrected);

    const next = await classifyToDraft(name, undefined, true);
    expect(next.fromCache).toBe(true);
    expect(next.item.classification.universal.warmth.value).toBe("very_high");
  });
});

describe("cross-tenant isolation (the security guarantee)", () => {
  it("user A's override is invisible to user B, but A's own lookup sees it", async () => {
    const cache = getCacheRepository();
    const name = "Tenant Isolation Probe ZZZ";
    const key = normalizeCacheKey(name);

    // A stores a per-user override (a correction). No draft for this key exists.
    const aOverride = fixtureClassification(name);
    aOverride.universal.warmth = { value: "very_high", confidence: "high", source: "user", evidence: "user A" };
    await cache.putUserOverride(USER_A, key, name, aOverride);

    // A SEES its own override, with authority "user".
    const aHit = await cache.lookup(USER_A, key);
    expect(aHit).not.toBeNull();
    expect(aHit!.authority).toBe("user");
    expect(aHit!.classification.universal.warmth.value).toBe("very_high");

    // B does NOT see A's override. With no draft for this key, B falls through to null —
    // proving A's correction cannot poison B's classification.
    const bHit = await cache.lookup(USER_B, key);
    expect(bHit).toBeNull();
  });

  it("B falls through to the shared DRAFT (not A's override) when both exist", async () => {
    const cache = getCacheRepository();
    const name = "Tenant Draft Fallthrough YYY";
    const key = normalizeCacheKey(name);

    // A shared draft exists (e.g. an earlier LLM classify-miss)…
    const draft = fixtureClassification(name);
    draft.universal.warmth = { value: "minimal", confidence: "low", source: "inferred", evidence: "draft" };
    await cache.putDraft(key, name, draft, "test");

    // …and A overrides it with a different value.
    const aOverride = fixtureClassification(name);
    aOverride.universal.warmth = { value: "very_high", confidence: "high", source: "user", evidence: "user A" };
    await cache.putUserOverride(USER_A, key, name, aOverride);

    // A's lookup returns A's override (authority "user").
    const aHit = await cache.lookup(USER_A, key);
    expect(aHit!.authority).toBe("user");
    expect(aHit!.classification.universal.warmth.value).toBe("very_high");

    // B's lookup returns the shared DRAFT, NOT A's override — so A's correction never reaches B.
    const bHit = await cache.lookup(USER_B, key);
    expect(bHit).not.toBeNull();
    expect(bHit!.authority).toBe("draft");
    expect(bHit!.classification.universal.warmth.value).toBe("minimal");
  });

  it("a shared draft (no override) is visible to BOTH users", async () => {
    const cache = getCacheRepository();
    const name = "Shared Draft Both XXX";
    const key = normalizeCacheKey(name);
    await cache.putDraft(key, name, fixtureClassification(name), "test");

    const aHit = await cache.lookup(USER_A, key);
    const bHit = await cache.lookup(USER_B, key);
    expect(aHit!.authority).toBe("draft");
    expect(bHit!.authority).toBe("draft");
    expect(aHit!.classification.name).toBe(name);
    expect(bHit!.classification.name).toBe(name);
  });
});
