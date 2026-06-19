import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { classifyItem, ClassificationError } from "@/core/classify/classify";
import { classifyOffline } from "@/core/classify/offline";
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

describe("classifyOffline (no-key fallback)", () => {
  it("returns a known corpus classification by name", () => {
    expect(classifyOffline({ name: "Kelty Galactic 30" }).name).toBe("Kelty Galactic 30");
  });
  it("refuses unknown items with a clear message", () => {
    expect(() => classifyOffline({ name: "Some Random Jacket 9000" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
