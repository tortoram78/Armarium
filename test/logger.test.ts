// Tests for the SERVER logger (src/lib/logger.ts) — the one place a console sink wraps the pure
// `formatLogLine` contract. We spy on console.log/console.error to assert exactly one line per event, that
// the line carries both the server stamp (a valid JSON object) and the core JSON, and that timeAndLog logs
// the right outcome (ok:true + durationMs on success; ok:false + reason at error level on throw) and rethrows.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logEvent, timeAndLog } from "@/lib/logger";

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

// The first argument of a spy's first recorded call, as a string (the logged line).
function firstLine(spy: ReturnType<typeof vi.spyOn>): string {
  const arg = spy.mock.calls[0]?.[0];
  expect(typeof arg).toBe("string");
  return arg as string;
}

// The logger prepends `{ts,env,runtime} <core json>`; split off the stamp and parse the core object.
function parseCoreLine(line: string): Record<string, unknown> {
  const idx = line.indexOf("} {");
  expect(idx).toBeGreaterThan(-1); // the line has both the stamp object and the core object
  const stamp = JSON.parse(line.slice(0, idx + 1));
  const core = JSON.parse(line.slice(idx + 2));
  expect(typeof stamp.ts).toBe("string");
  expect(typeof stamp.env).toBe("string");
  expect(typeof stamp.runtime).toBe("string");
  return core;
}

describe("logEvent", () => {
  it("writes exactly one formatted line to console.log for a non-error event", () => {
    logEvent({ level: "info", event: "llm", action: "classify", llm: { model: "m", inputTokens: 10, outputTokens: 2 } });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    const line = firstLine(logSpy);
    expect(line.includes("\n")).toBe(false); // single line
    const core = parseCoreLine(line);
    expect(core).toEqual({
      level: "info",
      event: "llm",
      action: "classify",
      llm: { model: "m", inputTokens: 10, outputTokens: 2 },
    });
  });

  it("routes an error-level event to console.error (and not console.log)", () => {
    logEvent({ level: "error", event: "classify", ok: false, reason: "boom" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const core = parseCoreLine(firstLine(errorSpy));
    expect(core).toMatchObject({ level: "error", event: "classify", ok: false, reason: "boom" });
  });
});

describe("timeAndLog", () => {
  it("logs ok:true with a numeric durationMs on success and returns the value", async () => {
    const result = await timeAndLog({ event: "classify", action: "addByName", userId: "u1" }, async () => 42);
    expect(result).toBe(42);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const core = parseCoreLine(firstLine(logSpy));
    expect(core).toMatchObject({ level: "info", event: "classify", action: "addByName", userId: "u1", ok: true });
    expect(typeof core.durationMs).toBe("number");
    expect(core.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it("logs ok:false + reason at error level and rethrows on failure", async () => {
    await expect(
      timeAndLog({ event: "classify", action: "addByName" }, async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const core = parseCoreLine(firstLine(errorSpy));
    expect(core).toMatchObject({ level: "error", event: "classify", action: "addByName", ok: false, reason: "kaboom" });
    expect(typeof core.durationMs).toBe("number");
  });

  it("stringifies a non-Error throw into reason", async () => {
    await expect(
      timeAndLog({ event: "parse", action: "planTrip" }, async () => {
        throw "stringy failure";
      }),
    ).rejects.toBe("stringy failure");
    const core = parseCoreLine(firstLine(errorSpy));
    expect(core.reason).toBe("stringy failure");
  });
});
