// ADR-0029 — open enrichment mode. An EMPTY allowlist lifts the host hardcap (any brand/site) while ALL
// other shape defenses remain. This locks the new contract: open mode widens coverage, it does NOT weaken
// the https-only / no-credentials / no-IP-literal shape checks (and the runtime IP-guard, tested
// separately in enrich.url-gate.test.ts, still blocks private addresses at fetch time).

import { describe, it, expect } from "vitest";
import { validateEnrichUrl } from "@/core/enrich";

const OPEN: readonly string[] = []; // empty allowlist = open mode

describe("open enrichment mode (ADR-0029): empty allowlist", () => {
  it("permits ANY public https host (the hardcap is gone)", () => {
    for (const url of [
      "https://www.osprey.com/atmos-ag-65",
      "https://example-gear-brand.co/products/thing",
      "https://shop.randombrand.io/item/42",
    ]) {
      expect(validateEnrichUrl(url, OPEN).ok).toBe(true);
    }
  });

  it("still enforces every other shape defense in open mode", () => {
    expect(validateEnrichUrl("http://insecure.com/x", OPEN).ok).toBe(false); // not https
    expect(validateEnrichUrl("https://user:pass@host.com/x", OPEN).ok).toBe(false); // credentials
    expect(validateEnrichUrl("https://169.254.169.254/latest/meta-data", OPEN).ok).toBe(false); // IP literal
    expect(validateEnrichUrl("https://host.com:8080/x", OPEN).ok).toBe(false); // non-default port
    expect(validateEnrichUrl("not-a-url", OPEN).ok).toBe(false);
  });

  it("still enforces a NON-empty allowlist exactly as before (default behavior unchanged)", () => {
    const list = ["patagonia.com"];
    expect(validateEnrichUrl("https://www.patagonia.com/p/x", list).ok).toBe(true);
    expect(validateEnrichUrl("https://evil.com/x", list).ok).toBe(false);
    expect(validateEnrichUrl("https://patagonia.com.evil.com/x", list).ok).toBe(false); // suffix-spoof
  });
});
