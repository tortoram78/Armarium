// ADR-0027 §B — the additive LLM layer (Layer B). Hermetic: an INJECTED fake client (no key, no network)
// locks the load-bearing contract — suggestions are ownership-FREE advisory gaps, dedup'd against the
// deterministic list, with invalid enums coerced; a malformed reply degrades to empty and NEVER throws.

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { planPacking, tripContext, enrichPlanWithLlm, mergeEnrichment } from "@/core/packing";
import { defaultConditions } from "@/core/conditions";

function fakeClient(reply: string): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: reply }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  } as unknown as Anthropic;
}

const COND = defaultConditions({
  temp_min_c: 3, temp_max_c: 12, exposure: "alpine", duration: "day", activities: ["alpine"],
});
const OPTS = { activities: ["alpine"] };

describe("Layer B enrichment", () => {
  it("yields ownership-free suggested gap lines + narration; dedups + coerces invalid enums", async () => {
    const plan = planPacking([], "T", COND, OPTS);
    const existingLabel = plan.sections[0]!.lines[0]!.label; // a deterministic line, to test dedup
    const reply =
      "```json\n" +
      JSON.stringify({
        narration: "Watch the wind.",
        suggestions: [
          { label: "Bear canister", category: "activity", severity: "high", rationale: "wildlife" },
          { label: "Mystery thing", category: "not_a_category", severity: "weird" }, // → activity / medium
          { label: existingLabel, category: "sun" }, // duplicate of a deterministic line → skipped
        ],
      }) +
      "\n```";
    const e = await enrichPlanWithLlm(plan, tripContext(COND, OPTS), { anthropic: fakeClient(reply) });

    expect(e.narration).toBe("Watch the wind.");
    expect(e.extraLines.length).toBe(2); // duplicate dropped
    for (const l of e.extraLines) {
      expect(l.suggested).toBe(true);
      expect(l.status).toBe("gap"); // never "owned"
      expect(l.ownedBy).toEqual([]); // NEVER asserts ownership
      expect(l.systemBy).toEqual([]);
      expect(l.verifyBy).toEqual([]);
    }
    const mystery = e.extraLines.find((l) => l.label === "Mystery thing")!;
    expect(mystery.category).toBe("activity"); // invalid category coerced
    expect(mystery.severity).toBe("medium"); // invalid severity coerced
  });

  it("degrades to empty (never throws) on a malformed reply", async () => {
    const plan = planPacking([], "T", COND);
    const e = await enrichPlanWithLlm(plan, tripContext(COND), { anthropic: fakeClient("no json here at all") });
    expect(e).toEqual({ narration: null, extraLines: [] });
  });

  it("mergeEnrichment folds in suggestions + narration and recomputes the summary", () => {
    const plan = planPacking([], "T", COND);
    const merged = mergeEnrichment(plan, {
      narration: "note",
      extraLines: [
        {
          key: "llm:x", label: "X", category: "activity", severity: "medium", status: "gap",
          quantity: null, consumable: false, ownedBy: [], systemBy: [], verifyBy: [], suggested: true,
        },
      ],
    });
    expect(merged.narration).toBe("note");
    expect(merged.summary.total).toBe(plan.summary.total + 1);
    expect(merged.summary.gap).toBe(plan.summary.gap + 1);
    expect(merged.sections.flatMap((s) => s.lines).some((l) => l.label === "X" && l.suggested)).toBe(true);
  });
});
