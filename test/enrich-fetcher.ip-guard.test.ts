import { describe, it, expect } from "vitest";
import { parseIp, isBlockedIp, isBlockedAddress, allAddressesPublic } from "@/server/enrich-fetcher";

/**
 * Boundary table for the private/reserved-IP block. This is the security primitive every fetch decision
 * rests on, so we pin the EXACT edges of each range: the last allowed address just below the range and
 * the first blocked address inside it (and vice-versa at the top edge where it matters).
 */
function blocked(addr: string): boolean {
  return isBlockedAddress(addr);
}

describe("isBlockedIp / isBlockedAddress — IPv4 range boundaries", () => {
  const v4Cases: Array<[string, boolean, string]> = [
    // 0.0.0.0/8
    ["0.0.0.0", true, "unspecified / this-network"],
    ["0.255.255.255", true, "top of 0/8"],
    ["1.0.0.0", false, "just above 0/8 is public"],
    // 10.0.0.0/8 (RFC1918)
    ["9.255.255.255", false, "just below 10/8"],
    ["10.0.0.0", true, "bottom of 10/8"],
    ["10.255.255.255", true, "top of 10/8"],
    ["11.0.0.0", false, "just above 10/8"],
    // 100.64.0.0/10 (CGNAT)
    ["100.63.255.255", false, "just below 100.64/10 is public"],
    ["100.64.0.0", true, "bottom of CGNAT 100.64/10"],
    ["100.127.255.255", true, "top of CGNAT 100.64/10"],
    ["100.128.0.0", false, "just above CGNAT is public"],
    // 127.0.0.0/8 (loopback)
    ["126.255.255.255", false, "just below loopback"],
    ["127.0.0.1", true, "classic loopback"],
    ["127.255.255.255", true, "top of loopback"],
    ["128.0.0.0", false, "just above loopback"],
    // 169.254.0.0/16 (link-local incl. cloud metadata)
    ["169.253.255.255", false, "just below link-local"],
    ["169.254.0.0", true, "bottom of link-local"],
    ["169.254.169.254", true, "CLOUD METADATA — must be blocked"],
    ["169.254.255.255", true, "top of link-local"],
    ["169.255.0.0", false, "just above link-local is public"],
    // 172.16.0.0/12 (RFC1918)
    ["172.15.255.255", false, "just below 172.16/12 is public"],
    ["172.16.0.0", true, "bottom of 172.16/12"],
    ["172.31.255.255", true, "top of 172.16/12"],
    ["172.32.0.0", false, "just above 172.16/12 is public"],
    // 192.168.0.0/16 (RFC1918)
    ["192.167.255.255", false, "just below 192.168/16"],
    ["192.168.0.0", true, "bottom of 192.168/16"],
    ["192.168.255.255", true, "top of 192.168/16"],
    ["192.169.0.0", false, "just above 192.168/16"],
    // A representative public address
    ["8.8.8.8", false, "public DNS is allowed"],
    ["104.18.0.1", false, "public CDN is allowed"],
  ];

  for (const [addr, expected, label] of v4Cases) {
    it(`${addr} ${expected ? "BLOCKED" : "allowed"} — ${label}`, () => {
      expect(blocked(addr)).toBe(expected);
    });
  }
});

describe("isBlockedIp / isBlockedAddress — IPv6", () => {
  const v6Cases: Array<[string, boolean, string]> = [
    ["::1", true, "loopback"],
    ["::", true, "unspecified"],
    ["fc00::", true, "ULA bottom (fc00::/7)"],
    ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true, "ULA top (fd..)"],
    ["fe80::", true, "link-local bottom (fe80::/10)"],
    ["fe80::1", true, "link-local"],
    ["febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true, "link-local top"],
    ["fec0::", true, "deprecated site-local — blocked defensively (fec0::/10)"],
    ["ff02::1", true, "multicast"],
    // 6to4: an internal v4 smuggled inside 2002::/16 — must unwrap and block.
    ["2002:7f00:0001::", true, "6to4 wrapping 127.0.0.1 unwraps to loopback"],
    ["2002:a9fe:a9fe::", true, "6to4 wrapping 169.254.169.254 unwraps to metadata"],
    ["2002:0808:0808::", false, "6to4 wrapping public 8.8.8.8 is allowed"],
    ["2001:db8::1", true, "documentation 2001:db8::/32"],
    ["2606:4700:4700::1111", false, "public (Cloudflare) is allowed"],
    ["2001:4860:4860::8888", false, "public (Google) is allowed"],
    // IPv4-mapped IPv6 — MUST unwrap and re-check the embedded v4.
    ["::ffff:127.0.0.1", true, "IPv4-mapped loopback"],
    ["::ffff:7f00:1", true, "IPv4-mapped loopback (hex tail form)"],
    ["::ffff:169.254.169.254", true, "IPv4-mapped cloud metadata"],
    ["::ffff:10.0.0.5", true, "IPv4-mapped private"],
    ["::ffff:8.8.8.8", false, "IPv4-mapped PUBLIC is allowed"],
    ["::ffff:0808:0808", false, "IPv4-mapped public (hex tail) is allowed"],
    // IPv4-compatible (deprecated) ::a.b.c.d also unwraps.
    ["::127.0.0.1", true, "IPv4-compatible loopback unwraps"],
  ];

  for (const [addr, expected, label] of v6Cases) {
    it(`${addr} ${expected ? "BLOCKED" : "allowed"} — ${label}`, () => {
      expect(blocked(addr)).toBe(expected);
    });
  }
});

describe("parseIp", () => {
  it("parses a clean dotted-quad", () => {
    const p = parseIp("8.8.4.4");
    expect(p).toEqual({ kind: "v4", value: (8 * 256 ** 3 + 8 * 256 ** 2 + 4 * 256 + 4) >>> 0 });
  });

  it("rejects octal-style leading zeros (octal-spoof vector)", () => {
    // 0177.0.0.1 would be 127.0.0.1 if interpreted as octal — we refuse to parse it at all.
    expect(parseIp("0177.0.0.1")).toBeNull();
    expect(parseIp("010.0.0.1")).toBeNull();
  });

  it("rejects out-of-range octets and malformed quads", () => {
    expect(parseIp("256.0.0.1")).toBeNull();
    expect(parseIp("1.2.3")).toBeNull();
    expect(parseIp("1.2.3.4.5")).toBeNull();
    expect(parseIp("1.2.3.")).toBeNull();
    expect(parseIp("a.b.c.d")).toBeNull();
  });

  it("parses a compressed IPv6", () => {
    const p = parseIp("::1");
    expect(p).toEqual({ kind: "v6", value: 1n });
  });

  it("rejects a double '::' (ambiguous compression)", () => {
    expect(parseIp("1::2::3")).toBeNull();
  });
});

describe("isBlockedAddress fails closed; allAddressesPublic", () => {
  it("treats an un-parseable address as BLOCKED (fail closed)", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("999.999.999.999")).toBe(true);
  });

  it("isBlockedIp dispatches on a pre-parsed IP", () => {
    const lo = parseIp("127.0.0.1");
    const pub = parseIp("1.1.1.1");
    expect(lo && isBlockedIp(lo)).toBe(true);
    expect(pub && isBlockedIp(pub)).toBe(false);
  });

  it("allAddressesPublic: all-public => true", () => {
    expect(allAddressesPublic(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])).toBe(true);
  });

  it("allAddressesPublic: ANY private => false (mixed answer is dangerous)", () => {
    expect(allAddressesPublic(["1.1.1.1", "127.0.0.1"])).toBe(false);
    expect(allAddressesPublic(["8.8.8.8", "169.254.169.254"])).toBe(false);
  });

  it("allAddressesPublic: empty set => false (no safe address)", () => {
    expect(allAddressesPublic([])).toBe(false);
  });
});
