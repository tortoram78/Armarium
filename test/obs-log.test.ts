// Tests for the pure structured-log record contract. `formatLogLine` is the single source of truth for
// the log shape — these assert stable, round-trippable JSON with required fields present, optional fields
// omitted when unset, and the `llm` block included only when set. No sink (console/env) is touched.

import { describe, it, expect } from "vitest";
import { formatLogLine, toLlmUsage, type LogEvent } from "@/core/obs/log";

describe("formatLogLine", () => {
  it("emits the required fields and round-trips through JSON.parse", () => {
    const event: LogEvent = { level: "info", event: "classify", ok: true, durationMs: 42 };
    const line = formatLogLine(event);
    expect(typeof line).toBe("string");
    expect(line.includes("\n")).toBe(false); // single line
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({ level: "info", event: "classify", ok: true, durationMs: 42 });
  });

  it("omits unset optional fields entirely (never renders them as null)", () => {
    const line = formatLogLine({ level: "warn", event: "ratelimit.deny" });
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({ level: "warn", event: "ratelimit.deny" });
    expect("action" in parsed).toBe(false);
    expect("userId" in parsed).toBe(false);
    expect("llm" in parsed).toBe(false);
  });

  it("includes the llm block only when set", () => {
    const withLlm: LogEvent = {
      level: "info",
      event: "classify",
      action: "addByName",
      userId: "u1",
      ok: true,
      durationMs: 1200,
      llm: { model: "claude-sonnet-4-6", inputTokens: 800, outputTokens: 120 },
    };
    const parsed = JSON.parse(formatLogLine(withLlm));
    expect(parsed.llm).toEqual({ model: "claude-sonnet-4-6", inputTokens: 800, outputTokens: 120 });

    const withoutLlm = JSON.parse(formatLogLine({ level: "info", event: "classify" }));
    expect("llm" in withoutLlm).toBe(false);
  });

  it("carries an error event with a reason", () => {
    const parsed = JSON.parse(formatLogLine({ level: "error", event: "classify", ok: false, reason: "validation" }));
    expect(parsed.level).toBe("error");
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("validation");
  });

  it("produces a deterministic key order for diff-stable lines", () => {
    const a = formatLogLine({ event: "x", level: "info", ok: true });
    const b = formatLogLine({ level: "info", ok: true, event: "x" });
    expect(a).toBe(b); // field declaration order in the literal does not change the output
  });
});

describe("toLlmUsage", () => {
  it("normalizes a full Anthropic usage block", () => {
    expect(toLlmUsage("claude-sonnet-4-6", { input_tokens: 800, output_tokens: 120 })).toEqual({
      model: "claude-sonnet-4-6",
      inputTokens: 800,
      outputTokens: 120,
    });
  });

  it("coerces null/absent counts to zero (offline/mock-no-usage path)", () => {
    expect(toLlmUsage("m", { input_tokens: null, output_tokens: null })).toEqual({ model: "m", inputTokens: 0, outputTokens: 0 });
    expect(toLlmUsage("m", undefined)).toEqual({ model: "m", inputTokens: 0, outputTokens: 0 });
    expect(toLlmUsage("m", {})).toEqual({ model: "m", inputTokens: 0, outputTokens: 0 });
  });
});
