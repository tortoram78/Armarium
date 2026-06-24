// Tests the LLM token-usage surfacing channel added to the live classify + parse paths. The mechanism is
// an OPTIONAL `onUsage(usage)` callback in the existing deps — chosen because it leaves the resolved output
// shape (LlmClaimsOutput / TripConditions) and the classifier contract unchanged, so the many app-service
// call sites do not ripple. With a mock Anthropic client carrying a known `usage`, the caller receives
// `{ model, inputTokens, outputTokens }`; a mock with no usage reports zero cleanly; the offline heuristic
// never reports (no LLM call), which is the absent-usage default.

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { classifyItemClaims } from "@/core/classify/classify-claims";
import { parseTripConditions, parseConditionsHeuristic } from "@/core/recommend/parse-conditions";
import type { LlmUsage } from "@/core/obs/log";
import type { LlmClaimsOutput } from "@/core/classify/claims";

// Mock client: returns the given text and (optionally) a usage block, like the real SDK message.
const fakeAnthropic = (text: string, usage?: { input_tokens: number | null; output_tokens: number }) =>
  ({
    messages: { create: async () => ({ content: [{ type: "text", text }], usage }) },
  }) as unknown as Anthropic;

const claimsOutput: LlmClaimsOutput = {
  name: "Test Hoody",
  claims: [
    { facetKey: "universal.warmth", value: "minimal", confidence: "high", source: "inferred", evidence: "single-layer hoody" },
  ],
  unresolvedQuestions: [],
};
const claimsText = "```json\n" + JSON.stringify(claimsOutput) + "\n```";
const conditionsText = JSON.stringify({ temp_min_c: 2, temp_max_c: 10, exposure: "alpine" });

describe("classifyItemClaims — usage surfacing", () => {
  it("reports { model, inputTokens, outputTokens } from the response usage", async () => {
    const seen: LlmUsage[] = [];
    const out = await classifyItemClaims(
      { name: "My Hoody" },
      {
        anthropic: fakeAnthropic(claimsText, { input_tokens: 950, output_tokens: 120 }),
        model: "claude-test-model",
        onUsage: (u) => seen.push(u),
      },
    );
    expect(out.claims.length).toBe(1); // output shape unchanged
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ model: "claude-test-model", inputTokens: 950, outputTokens: 120 });
  });

  it("reports zero cleanly when the mock carries no usage", async () => {
    const seen: LlmUsage[] = [];
    await classifyItemClaims(
      { name: "My Hoody" },
      { anthropic: fakeAnthropic(claimsText), onUsage: (u) => seen.push(u) },
    );
    expect(seen[0]?.inputTokens).toBe(0);
    expect(seen[0]?.outputTokens).toBe(0);
  });

  it("works with no onUsage dep at all (absent channel is fine)", async () => {
    const out = await classifyItemClaims({ name: "My Hoody" }, { anthropic: fakeAnthropic(claimsText) });
    expect(out.name).toBe("My Hoody");
  });
});

describe("parseTripConditions — usage surfacing", () => {
  it("reports { model, inputTokens, outputTokens } from the response usage", async () => {
    const seen: LlmUsage[] = [];
    const conditions = await parseTripConditions("cold alpine summit", {
      anthropic: fakeAnthropic(conditionsText, { input_tokens: 300, output_tokens: 40 }),
      onUsage: (u) => seen.push(u),
    });
    expect(conditions.exposure).toBe("alpine"); // output shape unchanged
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ model: "claude-sonnet-4-6", inputTokens: 300, outputTokens: 40 });
  });

  it("reports zero cleanly when the mock carries no usage", async () => {
    const seen: LlmUsage[] = [];
    await parseTripConditions("warm day hike", {
      anthropic: fakeAnthropic(JSON.stringify({ temp_min_c: 12, temp_max_c: 22 })),
      onUsage: (u) => seen.push(u),
    });
    expect(seen[0]).toEqual({ model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0 });
  });

  it("offline heuristic reports no usage (no LLM call, no onUsage dep)", () => {
    // The heuristic has no usage channel by construction — it never calls a model. Asserting it parses
    // documents the absent-usage default for the offline path.
    const c = parseConditionsHeuristic("cold and windy alpine summit");
    expect(c.exposure).toBe("alpine");
  });
});
