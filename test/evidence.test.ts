import { describe, it, expect } from "vitest";
import { z } from "zod";
import { hardFact, evidence, isConfident } from "@/core/evidence";

describe("hardFact demotion guard (rule #2: never fabricate specs)", () => {
  const upf = hardFact(z.number().int());

  it("demotes an inferred hard fact to null+unknown", () => {
    expect(upf.parse({ value: 40, source: "inferred", evidence: "guessed from fabric" })).toEqual({
      value: null,
      source: "unknown",
      evidence: "guessed from fabric",
    });
  });

  it("demotes a derived_from_material hard fact to null+unknown", () => {
    const r = upf.parse({ value: 50, source: "derived_from_material", evidence: "x" });
    expect(r.value).toBeNull();
    expect(r.source).toBe("unknown");
  });

  it("keeps an authoritative (manufacturer) hard fact", () => {
    expect(upf.parse({ value: 40, source: "manufacturer", evidence: "40 UPF stated" })).toEqual({
      value: 40,
      source: "manufacturer",
      evidence: "40 UPF stated",
    });
  });

  it("accepts an explicit known-unknown", () => {
    expect(upf.parse({ value: null, source: "unknown" })).toEqual({ value: null, source: "unknown" });
  });
});

describe("evidence soft facet shape", () => {
  const wp = evidence(z.enum(["none", "dwr", "wp_breathable"]));

  it("accepts a known value with confidence + source + evidence", () => {
    expect(wp.safeParse({ value: "dwr", confidence: "high", source: "manufacturer", evidence: "DWR" }).success).toBe(true);
  });

  it("accepts a known-unknown", () => {
    expect(wp.safeParse({ value: null, confidence: "unknown", source: "unknown" }).success).toBe(true);
  });

  it("rejects a known value missing its evidence", () => {
    expect(wp.safeParse({ value: "dwr", confidence: "high", source: "manufacturer" }).success).toBe(false);
  });

  it("rejects an out-of-vocabulary value", () => {
    expect(wp.safeParse({ value: "soaked", confidence: "high", source: "manufacturer", evidence: "x" }).success).toBe(false);
  });
});

describe("isConfident", () => {
  it("treats unknown / under-confident as not confident", () => {
    expect(isConfident({ value: null, confidence: "unknown", source: "unknown" })).toBe(false);
    expect(isConfident({ value: "x", confidence: "low", source: "inferred", evidence: "e" }, "medium")).toBe(false);
    expect(isConfident({ value: "x", confidence: "high", source: "manufacturer", evidence: "e" }, "medium")).toBe(true);
  });
});
