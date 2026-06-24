import { describe, it, expect } from "vitest";
import { validateEnrichUrl, MANUFACTURER_ALLOWLIST } from "@/core/enrich";

describe("validateEnrichUrl — SSRF URL-shape gate", () => {
  it("accepts an allowlisted https host (exact registrable domain)", () => {
    const r = validateEnrichUrl("https://patagonia.com/product/nano-puff");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toContain("patagonia.com");
  });

  it("accepts a subdomain of an allowlisted host (www.)", () => {
    expect(validateEnrichUrl("https://www.arcteryx.com/us/en/shop/beta-ar").ok).toBe(true);
  });

  it("accepts a deeper subdomain of an allowlisted host", () => {
    expect(validateEnrichUrl("https://shop.eu.rei.com/item/123").ok).toBe(true);
  });

  it("REJECTS http (non-https) scheme", () => {
    const r = validateEnrichUrl("http://patagonia.com/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/https/);
  });

  it("REJECTS non-allowlisted host", () => {
    const r = validateEnrichUrl("https://random-shop.example.com/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allowlist/);
  });

  it("REJECTS an IPv4-literal host", () => {
    expect(validateEnrichUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false);
  });

  it("REJECTS an IPv6-literal host", () => {
    expect(validateEnrichUrl("https://[::1]/x").ok).toBe(false);
  });

  it("REJECTS embedded credentials (user:pass@)", () => {
    // The credential host targets patagonia.com but carries creds — still rejected.
    const r = validateEnrichUrl("https://user:pass@patagonia.com/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/credential/i);
  });

  it("REJECTS the suffix-spoof patagonia.com.evil.com", () => {
    const r = validateEnrichUrl("https://patagonia.com.evil.com/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allowlist/);
  });

  it("REJECTS a bare-prefix spoof evilpatagonia.com", () => {
    expect(validateEnrichUrl("https://evilpatagonia.com/x").ok).toBe(false);
  });

  it("REJECTS a non-default explicit port even on an allowlisted host", () => {
    const r = validateEnrichUrl("https://patagonia.com:8080/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/port/);
  });

  it("accepts an explicit default :443 port (URL normalizes it away)", () => {
    expect(validateEnrichUrl("https://patagonia.com:443/x").ok).toBe(true);
  });

  it("REJECTS non-http schemes (file:, data:)", () => {
    expect(validateEnrichUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateEnrichUrl("data:text/html,<h1>x</h1>").ok).toBe(false);
  });

  it("does not throw on junk / unparseable input", () => {
    expect(() => validateEnrichUrl("not a url at all")).not.toThrow();
    expect(validateEnrichUrl("not a url at all").ok).toBe(false);
    expect(validateEnrichUrl("").ok).toBe(false);
    // @ts-expect-error — exercising the runtime guard against non-string input
    expect(validateEnrichUrl(null).ok).toBe(false);
  });

  it("is case-insensitive on the host", () => {
    expect(validateEnrichUrl("https://WWW.Patagonia.COM/x").ok).toBe(true);
  });

  it("exposes a non-empty allowlist as the security boundary", () => {
    expect(MANUFACTURER_ALLOWLIST.length).toBeGreaterThan(0);
    expect(MANUFACTURER_ALLOWLIST).toContain("patagonia.com");
  });

  it("honors a caller-supplied allowlist", () => {
    expect(validateEnrichUrl("https://mybrand.io/x", ["mybrand.io"]).ok).toBe(true);
    expect(validateEnrichUrl("https://patagonia.com/x", ["mybrand.io"]).ok).toBe(false);
  });
});
