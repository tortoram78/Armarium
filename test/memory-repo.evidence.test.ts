// Data-layer tests for the in-memory GearRepository's item_evidence store (ADR-0012 Element 2).
// These pin the port contract deterministically with no DB and no LLM:
//   - replaceItemEvidence → getItemEvidence round-trips a MULTI-claim set (all fields preserved).
//   - REPLACE semantics: a second replace overwrites the prior set (never appends).
//   - user-scoping: user B cannot read user A's item evidence, and writing to a non-owned item is a
//     no-op (the parent-item gate the Postgres RLS EXISTS-on-parent policy enforces).
// This wave is the store ONLY — nothing here is wired into the classify pipeline.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { memoryRepository as repo } from "@/server/memory-repo";
import type { EvidenceClaim } from "@/core/ports";
import type { ItemClassification } from "@/core/classification";
import { SEED_CORPUS } from "@/core/seed-corpus";

// A unique user per test keeps the process-local store isolated (the repo seeds each user once).
const freshUser = () => randomUUID();
const SAMPLE_CLASSIFICATION: ItemClassification = SEED_CORPUS[0]!.classification;

async function addItem(user: string) {
  return repo.addItem(user, { name: "evidence-subject", inInventory: false, classification: SAMPLE_CLASSIFICATION });
}

const CLAIMS: EvidenceClaim[] = [
  {
    facetKey: "waterproofness",
    value: "waterproof",
    confidence: "high",
    source: "manufacturer",
    sourceUrl: "https://example.com/spec",
    extractorVersion: "v1",
    evidence: "stated 3L membrane, 28k mm",
    observedAt: "2026-06-24T00:00:00.000Z",
  },
  {
    // A facet whose value is an array (jsonb stores scalar OR array).
    facetKey: "activity_fit",
    value: ["alpine", "ski"],
    confidence: "medium",
    source: "inferred",
    evidence: "name + description",
  },
  {
    // A second claim for the SAME facet from another source (the resolver groups by facetKey later).
    facetKey: "waterproofness",
    value: "water_resistant",
    confidence: "low",
    source: "derived_from_material",
    evidence: "DWR face fabric",
  },
];

describe("memory repo — item evidence store", () => {
  it("round-trips a multi-claim set (all fields preserved, including array values)", async () => {
    const user = freshUser();
    const item = await addItem(user);

    await repo.replaceItemEvidence(user, item.id, CLAIMS);
    const read = await repo.getItemEvidence(user, item.id);

    expect(read.length).toBe(CLAIMS.length);
    // Each input claim is present with every field intact (order-independent; the resolver groups later).
    for (const claim of CLAIMS) {
      const match = read.find(
        (r) => r.facetKey === claim.facetKey && JSON.stringify(r.value) === JSON.stringify(claim.value),
      );
      expect(match, `missing claim ${claim.facetKey}=${JSON.stringify(claim.value)}`).toBeDefined();
      expect(match!.confidence).toBe(claim.confidence);
      expect(match!.source).toBe(claim.source);
      expect(match!.evidence).toBe(claim.evidence);
      expect(match!.sourceUrl ?? null).toBe(claim.sourceUrl ?? null);
      expect(match!.extractorVersion ?? null).toBe(claim.extractorVersion ?? null);
    }
    // observedAt defaults to a real ISO timestamp when the caller omitted it (mirrors DEFAULT now()).
    const inferred = read.find((r) => r.source === "inferred")!;
    expect(typeof inferred.observedAt).toBe("string");
    expect(Number.isNaN(Date.parse(inferred.observedAt!))).toBe(false);
    // An explicitly-supplied observedAt is preserved verbatim.
    const stamped = read.find((r) => r.source === "manufacturer")!;
    expect(stamped.observedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("REPLACE overwrites the prior set (never appends)", async () => {
    const user = freshUser();
    const item = await addItem(user);

    await repo.replaceItemEvidence(user, item.id, CLAIMS);
    expect((await repo.getItemEvidence(user, item.id)).length).toBe(CLAIMS.length);

    const next: EvidenceClaim[] = [
      { facetKey: "warmth", value: "warm", confidence: "medium", source: "inferred", evidence: "down fill" },
    ];
    await repo.replaceItemEvidence(user, item.id, next);
    const read = await repo.getItemEvidence(user, item.id);

    expect(read.length).toBe(1);
    expect(read[0]!.facetKey).toBe("warmth");
    // None of the original claims survive a replace.
    expect(read.some((r) => r.facetKey === "waterproofness")).toBe(false);

    // Replacing with an empty set clears all evidence for the item.
    await repo.replaceItemEvidence(user, item.id, []);
    expect(await repo.getItemEvidence(user, item.id)).toEqual([]);
  });

  it("is user-scoped — user B cannot read or overwrite user A's item evidence", async () => {
    const owner = freshUser();
    const other = freshUser();
    const item = await addItem(owner);

    await repo.replaceItemEvidence(owner, item.id, CLAIMS);

    // User B reading the owner's item id sees nothing (the parent-item gate).
    expect(await repo.getItemEvidence(other, item.id)).toEqual([]);

    // User B writing to the owner's item id is a no-op — the owner's evidence is untouched.
    await repo.replaceItemEvidence(other, item.id, [
      { facetKey: "warmth", value: "hot", confidence: "high", source: "user", evidence: "intruder write" },
    ]);
    const ownerStill = await repo.getItemEvidence(owner, item.id);
    expect(ownerStill.length).toBe(CLAIMS.length);
    expect(ownerStill.some((r) => r.evidence === "intruder write")).toBe(false);
  });

  it("writing evidence for an unknown item id is a no-op and reads empty", async () => {
    const user = freshUser();
    await repo.replaceItemEvidence(user, randomUUID(), CLAIMS);
    expect(await repo.getItemEvidence(user, randomUUID())).toEqual([]);
  });
});
