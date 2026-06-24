// Tests the SERVER telemetry wiring in services.ts: getClassifier()/getTripParser() pass an `onUsage`
// sink into the core deps, so each LIVE LLM call's token usage is logged as an `llm` event. We mock the
// Anthropic SDK so the constructed client returns a KNOWN `usage`, set ANTHROPIC_API_KEY to select the
// live path, and spy on console to assert exactly the right `llm` line. The OFFLINE path (no key) must
// log no LLM usage. This is the only telemetry seam the actions layer (wave B2) relies on.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Anthropic SDK with a class whose messages.create returns text + a known usage block. The
// returned text differs per call site (claims JSON vs conditions JSON); a single create handler emits a
// shape valid for BOTH parsers (claims output carries `name`+`claims`; conditions parse ignores extras).
const createMock = vi.fn(async () => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        // valid LlmClaimsOutput
        name: "X",
        claims: [],
        unresolvedQuestions: [],
        // valid partial TripConditions (extra keys are ignored by the claims parser)
        temp_min_c: 2,
        temp_max_c: 10,
        exposure: "alpine",
      }),
    },
  ],
  usage: { input_tokens: 777, output_tokens: 88 },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { getClassifier, getTripParser } from "@/server/services";

let logSpy: ReturnType<typeof vi.spyOn>;
const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  createMock.mockClear();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

// Find the parsed core JSON object of any logged `llm` line (skip the server stamp prefix).
function llmLines(): Record<string, unknown>[] {
  return logSpy.mock.calls
    .map((c) => c[0] as string)
    .map((line) => {
      const idx = line.indexOf("} {");
      return idx > -1 ? JSON.parse(line.slice(idx + 2)) : null;
    })
    .filter((o): o is Record<string, unknown> => o !== null && o.event === "llm");
}

describe("getClassifier — live path telemetry", () => {
  it("logs an llm event with the model's token usage on a live classify call", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const handle = getClassifier();
    expect(handle.mode).toBe("live");
    expect(handle.kind).toBe("claims");

    await handle.classify({ name: "My Hoody" });

    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      event: "llm",
      action: "classify",
      llm: { model: "claude-sonnet-4-6", inputTokens: 777, outputTokens: 88 },
    });
  });
});

describe("getTripParser — live path telemetry", () => {
  it("logs an llm event with the model's token usage on a live parse call", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const handle = getTripParser();
    expect(handle.mode).toBe("live");

    await handle.parse("cold alpine summit");

    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      event: "llm",
      action: "parse",
      llm: { model: "claude-sonnet-4-6", inputTokens: 777, outputTokens: 88 },
    });
  });
});

describe("offline path — no LLM telemetry", () => {
  it("logs no llm event when ANTHROPIC_API_KEY is absent (classify offline)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const handle = getClassifier();
    expect(handle.mode).toBe("offline");
    // The offline classifier resolves seed-corpus items and THROWS on an unknown one; either way it never
    // calls a model and constructs no onUsage sink — so no `llm` line is logged regardless of outcome.
    await handle.classify({ name: "Some Unknown Jacket" }).catch(() => undefined);
    expect(llmLines()).toHaveLength(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("logs no llm event when ANTHROPIC_API_KEY is absent (parse offline heuristic)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const handle = getTripParser();
    expect(handle.mode).toBe("offline");
    await handle.parse("warm day hike");
    expect(llmLines()).toHaveLength(0);
    expect(createMock).not.toHaveBeenCalled();
  });
});
