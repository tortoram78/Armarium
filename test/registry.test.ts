import { describe, it, expect } from "vitest";
import { FACETS, FACET_KEYS, capabilityGateFacets } from "@/core/facets/registry";

describe("facet registry integrity", () => {
  it("has facets and every entry's key matches its map key", () => {
    expect(FACET_KEYS.length).toBeGreaterThan(20);
    for (const k of FACET_KEYS) expect(FACETS[k].key).toBe(k);
  });

  it("INVARIANT: capability-gating facets are stored hot (never JSONB)", () => {
    expect(capabilityGateFacets.length).toBeGreaterThan(0);
    for (const k of capabilityGateFacets) {
      expect(FACETS[k].capabilityGate).toBe(true);
      expect(FACETS[k].tier).not.toBe("jsonb");
    }
  });

  it("nominal and multilabel facets declare a non-empty level set", () => {
    for (const k of FACET_KEYS) {
      const f = FACETS[k];
      if (f.kind === "nominal" || f.kind === "multilabel") {
        expect(f.levels && f.levels.length).toBeGreaterThan(0);
      }
    }
  });
});
