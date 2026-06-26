import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { classifyItem, ClassificationError } from "@/core/classify/classify";
import { classifyOffline, classifyOfflineSafe } from "@/core/classify/offline";
import { SEED_CORPUS } from "@/core/seed-corpus";

// A minimal fake Anthropic client returning a canned text block — exercises the live path offline.
const fakeAnthropic = (text: string) =>
  ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } }) as unknown as Anthropic;

describe("classifyItem (live path, mocked client)", () => {
  const sample = SEED_CORPUS[0]!.classification;

  it("parses + validates a well-formed JSON classification (fenced)", async () => {
    const res = await classifyItem({ name: sample.name }, { anthropic: fakeAnthropic("```json\n" + JSON.stringify(sample) + "\n```") });
    expect(res.name).toBe(sample.name);
    expect(res.universal.waterproofness.value).toBe("dwr");
  });

  it("throws a ClassificationError on non-JSON output", async () => {
    await expect(classifyItem({ name: "x" }, { anthropic: fakeAnthropic("sorry, no json here") })).rejects.toBeInstanceOf(ClassificationError);
  });

  it("demotes an inferred hard fact during validation", async () => {
    const tweaked = structuredClone(sample) as unknown as Record<string, any>;
    tweaked.universal.upf = { value: 40, source: "inferred", evidence: "guessed" };
    const res = await classifyItem({ name: sample.name }, { anthropic: fakeAnthropic(JSON.stringify(tweaked)) });
    expect(res.universal.upf.value).toBeNull();
  });
});

describe("classifyOffline (corpus-strict path)", () => {
  it("returns a known corpus classification by name", () => {
    expect(classifyOffline({ name: "Kelty Galactic 30" }).name).toBe("Kelty Galactic 30");
  });
  // The hard-fail contract is preserved on `classifyOffline` for callers that need the corpus invariant.
  it("throws for items outside the corpus", () => {
    expect(() => classifyOffline({ name: "Some Random Jacket 9000" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("classifyOfflineSafe (graceful degradation — the app-facing path)", () => {
  it("returns the corpus classification on a hit", () => {
    const result = classifyOfflineSafe({ name: "Kelty Galactic 30" });
    expect(result.name).toBe("Kelty Galactic 30");
  });

  // FLIPPED from the old hard-fail test: the safe path must degrade, not throw (Engineering lesson:
  // "a passing test can guard the bug" — the old test was asserting the wrong contract).
  it("degrades to all-unknown on a non-corpus name (no throw)", () => {
    const result = classifyOfflineSafe({ name: "Some Random Jacket 9000" });
    expect(result.name).toBe("Some Random Jacket 9000");
    expect(result.universal.waterproofness.value).toBeNull();
    expect(result.universal.warmth.value).toBeNull();
    expect(result.multilabel.layering_role).toEqual([]);
    expect(result.applicable_groups).toEqual([]);
  });

  it("degrades to all-unknown for a completely novel item", () => {
    const result = classifyOfflineSafe({ name: "Acme Unobtanium Tent Peg X9" });
    expect(result.name).toBe("Acme Unobtanium Tent Peg X9");
    expect(result.identity.brand.value).toBeNull();
    expect(result.identity.weight_grams.value).toBeNull();
    expect(result.materials).toEqual([]);
  });
});
