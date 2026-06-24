// Tests for the CLAIMS-based LLM contract (Phase 3 — ADR-0014 §2): the Zod schema, the live claims
// classifier (mocked client, offline), and the ingestion boundary (hard-fact demotion + novel-key parking
// + non-asserting drop). The OFFLINE classifier is unchanged (it emits a resolved classification, covered
// in classify.test.ts) — these tests are the new claims path only.

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { classifyItemClaims, ClaimsClassificationError } from "@/core/classify/classify-claims";
import { parseLlmClaims, type LlmClaimsOutput } from "@/core/classify/claims";
import { ingestLlmClaims, LLM_CLAIMS_EXTRACTOR_VERSION } from "@/core/resolve";

const fakeAnthropic = (text: string) =>
  ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } }) as unknown as Anthropic;

const sampleOutput: LlmClaimsOutput = {
  name: "Test Hoody",
  claims: [
    { facetKey: "universal.warmth", value: "minimal", confidence: "high", source: "inferred", evidence: "single-layer hoody" },
    { facetKey: "universal.waterproofness", value: "dwr", confidence: "medium", source: "inferred", evidence: "woven poly, DWR" },
    { facetKey: "multilabel.layering_role", value: ["next_to_skin", "standalone"], confidence: "high", source: "inferred", evidence: "sun hoody" },
  ],
  unresolvedQuestions: ["fill power not stated", "exact weight not stated"],
};

describe("LlmClaimsSchema / parseLlmClaims", () => {
  it("validates a well-formed claims object", () => {
    const out = parseLlmClaims(sampleOutput);
    expect(out.claims.length).toBe(3);
    expect(out.unresolvedQuestions).toContain("fill power not stated");
  });

  it("rejects a claim whose source is not the locked 'inferred'", () => {
    const bad = { ...sampleOutput, claims: [{ ...sampleOutput.claims[0], source: "manufacturer" }] };
    expect(() => parseLlmClaims(bad)).toThrow();
  });

  it("rejects an empty evidence string (rationale is mandatory)", () => {
    const bad = { ...sampleOutput, claims: [{ ...sampleOutput.claims[0], evidence: "" }] };
    expect(() => parseLlmClaims(bad)).toThrow();
  });
});

describe("classifyItemClaims (live path, mocked client)", () => {
  it("parses + validates a fenced claims object and forces the requested name", async () => {
    const res = await classifyItemClaims(
      { name: "My Hoody" },
      { anthropic: fakeAnthropic("```json\n" + JSON.stringify(sampleOutput) + "\n```") },
    );
    expect(res.name).toBe("My Hoody"); // the requested name wins even though the model said "Test Hoody"
    expect(res.claims.length).toBe(3);
  });

  it("throws a ClaimsClassificationError on non-JSON output", async () => {
    await expect(
      classifyItemClaims({ name: "x" }, { anthropic: fakeAnthropic("sorry, no json") }),
    ).rejects.toBeInstanceOf(ClaimsClassificationError);
  });
});

describe("ingestLlmClaims — the claim-ingestion boundary", () => {
  it("stamps source:inferred + extractor version and passes unresolvedQuestions through", () => {
    const { claims, unresolvedQuestions, pendingFacets } = ingestLlmClaims(sampleOutput);
    expect(claims.every((c) => c.source === "inferred")).toBe(true);
    expect(claims.every((c) => c.extractorVersion === LLM_CLAIMS_EXTRACTOR_VERSION)).toBe(true);
    expect(unresolvedQuestions).toEqual(sampleOutput.unresolvedQuestions);
    expect(pendingFacets).toEqual([]); // no novel keys here
  });

  it("DROPS an inferred hard fact (the demotion guard — it has nowhere to live)", () => {
    const out: LlmClaimsOutput = {
      name: "Sneaky",
      claims: [
        { facetKey: "identity.brand", value: "GuessCo", confidence: "high", source: "inferred", evidence: "from name" },
        { facetKey: "universal.upf", value: 40, confidence: "high", source: "inferred", evidence: "looks sunny" },
        { facetKey: "groups.insulation.fill_power", value: 800, confidence: "high", source: "inferred", evidence: "puffy" },
        { facetKey: "universal.warmth", value: "high", confidence: "high", source: "inferred", evidence: "thick" },
      ],
      unresolvedQuestions: [],
    };
    const { claims } = ingestLlmClaims(out);
    // Only the soft facet survives; every inferred hard fact was dropped at the boundary.
    expect(claims.map((c) => c.facetKey)).toEqual(["universal.warmth"]);
  });

  it("DROPS a non-asserting claim (confidence 'unknown' or null value)", () => {
    const out: LlmClaimsOutput = {
      name: "Unsure",
      claims: [
        { facetKey: "universal.warmth", value: "high", confidence: "unknown", source: "inferred", evidence: "not sure" },
        { facetKey: "universal.breathability", value: null, confidence: "high", source: "inferred", evidence: "no value" },
        { facetKey: "universal.packability", value: "packable", confidence: "low", source: "inferred", evidence: "thin" },
      ],
      unresolvedQuestions: [],
    };
    const { claims } = ingestLlmClaims(out);
    expect(claims.map((c) => c.facetKey)).toEqual(["universal.packability"]);
  });

  it("PARKS a novel (non-registry) facetKey in BOTH claims and pendingFacets (never silently dropped)", () => {
    const out: LlmClaimsOutput = {
      name: "Novel",
      claims: [
        { facetKey: "universal.warmth", value: "high", confidence: "high", source: "inferred", evidence: "thick" },
        { facetKey: "novel.uv_glow", value: "strong", confidence: "medium", source: "inferred", evidence: "glows" },
      ],
      unresolvedQuestions: [],
    };
    const { claims, pendingFacets } = ingestLlmClaims(out);
    // The novel key is persisted (in claims) AND queued for review (pendingFacets).
    expect(claims.some((c) => c.facetKey === "novel.uv_glow")).toBe(true);
    expect(pendingFacets.map((p) => p.facetKey)).toEqual(["novel.uv_glow"]);
  });
});
