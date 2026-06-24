// SSRF private-IP guard for manufacturer-URL enrichment (Phase 3 step 2).
//
// SECURITY-CRITICAL. This is the network-layer half the pure core URL-shape gate (`validateEnrichUrl`)
// deliberately cannot do: the shape gate proves the URL *looks* like an allowlisted manufacturer host,
// but a host that passes the shape gate can still RESOLVE to a private/internal address (DNS rebinding,
// or simply a misconfigured/hostile DNS record), or a request can be *redirected* to one. So before any
// socket is opened to a resolved IP we classify that IP and REJECT anything that is not public.
//
// We parse IPs ourselves (no external dep) into a canonical numeric form and test membership in the
// blocked CIDR ranges. The ranges are spelled out explicitly below — never hand-wave an SSRF range.

/** A parsed IP: either a 32-bit IPv4 value, or a 128-bit IPv6 value held as a bigint. */
type ParsedIp =
  | { kind: "v4"; value: number } // 0 .. 0xffffffff
  | { kind: "v6"; value: bigint }; // 0 .. 2^128-1

/**
 * Parse a dotted-quad IPv4 string into its 32-bit unsigned value, or `null` if it is not a clean
 * dotted-quad. STRICT: exactly four octets, each 0..255, no leading-zero/octal tricks, no extra chars.
 * (Leading zeros like `0177.0.0.1` are rejected outright — they are an octal-spoof vector — so a host
 * that smuggles one is treated as un-parseable and, by the fetcher's fail-closed default, blocked.)
 */
function parseIpv4(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Digits only; reject empty, signs, whitespace, hex, etc.
    if (part.length === 0 || part.length > 3) return null;
    if (!/^[0-9]+$/.test(part)) return null;
    // Reject leading zeros ("01", "00") — octal-style spoofing. A single "0" is fine.
    if (part.length > 1 && part[0] === "0") return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  // Force unsigned 32-bit.
  return value >>> 0;
}

/**
 * Parse an IPv6 string (no zone id, no brackets) into a 128-bit bigint, or `null` if invalid.
 * Handles the `::` compression and an embedded dotted-quad IPv4 tail (`::ffff:a.b.c.d`).
 * This is intentionally a from-scratch parser so the SSRF check does not depend on Node's `net` module
 * accepting forms we have not reasoned about.
 */
function parseIpv6(input: string): bigint | null {
  let s = input;
  if (s.includes("%")) s = s.slice(0, s.indexOf("%")); // strip any zone id defensively
  if (s.length === 0) return null;

  // An embedded IPv4 tail (last group contains a dot) expands to two 16-bit groups.
  let tailGroups: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const afterLastColon = lastColon === -1 ? s : s.slice(lastColon + 1);
  if (afterLastColon.includes(".")) {
    const v4 = parseIpv4(afterLastColon);
    if (v4 === null) return null;
    tailGroups = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    s = s.slice(0, lastColon + 1) + "0"; // placeholder group we drop below
  }

  // Split on "::" (at most one occurrence) into head and tail halves.
  const doubleColonCount = s.split("::").length - 1;
  if (doubleColonCount > 1) return null;

  let headPart: string;
  let tailPart: string;
  let compressed: boolean;
  if (doubleColonCount === 1) {
    const idx = s.indexOf("::");
    headPart = s.slice(0, idx);
    tailPart = s.slice(idx + 2);
    compressed = true;
  } else {
    headPart = s;
    tailPart = "";
    compressed = false;
  }

  const headTokens = headPart === "" ? [] : headPart.split(":");
  let tailTokens = tailPart === "" ? [] : tailPart.split(":");

  // If we synthesized an IPv4 tail, the last placeholder token ("0") is dropped and replaced by the
  // two derived 16-bit groups.
  const parseHexGroups = (tokens: string[]): number[] | null => {
    const out: number[] = [];
    for (const t of tokens) {
      if (t.length === 0 || t.length > 4) return null;
      if (!/^[0-9a-fA-F]+$/.test(t)) return null;
      out.push(parseInt(t, 16));
    }
    return out;
  };

  let head = parseHexGroups(headTokens);
  if (head === null) return null;

  // Remove the placeholder we appended for the v4 tail, then append the real two groups.
  if (tailGroups.length === 2) {
    if (tailTokens.length === 0) return null;
    tailTokens = tailTokens.slice(0, -1); // drop the "0" placeholder
  }
  let tail = parseHexGroups(tailTokens);
  if (tail === null) return null;
  tail = tail.concat(tailGroups);

  const totalGroups = head.length + tail.length;
  let groups: number[];
  if (compressed) {
    // "::" stands for one-or-more all-zero groups filling to 8 total.
    const missing = 8 - totalGroups;
    if (missing < 0) return null; // too many groups even with compression
    groups = head.concat(new Array(missing).fill(0)).concat(tail);
  } else {
    if (totalGroups !== 8) return null;
    groups = head.concat(tail);
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (g < 0 || g > 0xffff) return null;
    value = (value << 16n) | BigInt(g);
  }
  return value;
}

/** Parse either family. `null` => not a recognizable IP literal (caller decides; the fetcher fails closed). */
export function parseIp(s: string): ParsedIp | null {
  const trimmed = s.trim();
  if (trimmed.includes(":")) {
    const v6 = parseIpv6(trimmed);
    return v6 === null ? null : { kind: "v6", value: v6 };
  }
  const v4 = parseIpv4(trimmed);
  return v4 === null ? null : { kind: "v4", value: v4 };
}

/** Build the inclusive [low, high] 32-bit bounds of an IPv4 CIDR `a.b.c.d/prefix`. */
function v4Cidr(base: string, prefix: number): readonly [number, number] {
  const b = parseIpv4(base);
  if (b === null) throw new Error(`bad CIDR base ${base}`); // dev-time only; constants below are valid
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const low = (b & mask) >>> 0;
  const high = (low | (~mask >>> 0)) >>> 0;
  return [low, high];
}

// IPv4 blocked ranges — every range that must never be reached from a manufacturer fetch. Spelled out.
const V4_BLOCKED: ReadonlyArray<readonly [number, number]> = [
  v4Cidr("0.0.0.0", 8), // "this" network / unspecified
  v4Cidr("10.0.0.0", 8), // RFC1918 private
  v4Cidr("100.64.0.0", 10), // RFC6598 carrier-grade NAT
  v4Cidr("127.0.0.0", 8), // loopback
  v4Cidr("169.254.0.0", 16), // link-local — INCLUDES 169.254.169.254 cloud metadata (critical)
  v4Cidr("172.16.0.0", 12), // RFC1918 private
  v4Cidr("192.0.0.0", 24), // IETF protocol assignments
  v4Cidr("192.0.2.0", 24), // TEST-NET-1 (documentation)
  v4Cidr("192.168.0.0", 16), // RFC1918 private
  v4Cidr("198.18.0.0", 15), // benchmarking
  v4Cidr("198.51.100.0", 24), // TEST-NET-2 (documentation)
  v4Cidr("203.0.113.0", 24), // TEST-NET-3 (documentation)
  v4Cidr("224.0.0.0", 4), // multicast
  v4Cidr("240.0.0.0", 4), // reserved (includes 255.255.255.255 broadcast)
];

// The IPv4-mapped IPv6 prefix `::ffff:0:0/96` — addresses here carry an embedded v4 we must re-check.
const V6_MAPPED_PREFIX = 0xffffn << 32n; // ::ffff:0:0 .. ::ffff:ffff:ffff, low 32 bits = the v4
const V6_MAPPED_MASK = ((1n << 128n) - 1n) ^ ((1n << 32n) - 1n); // upper 96 bits

/** True if `value` lies in the IPv6 CIDR `base/prefix`. */
function inV6Cidr(value: bigint, baseHex: string, prefix: number): boolean {
  const base = parseIpv6(baseHex);
  if (base === null) throw new Error(`bad v6 CIDR base ${baseHex}`);
  if (prefix === 0) return true;
  const mask = ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
  return (value & mask) === (base & mask);
}

/**
 * The core decision: is this parsed IP one we must NEVER open a connection to? Covers loopback,
 * private (RFC1918 / ULA), link-local (incl. cloud metadata 169.254.169.254), CGNAT, unspecified,
 * multicast/reserved/documentation, and — crucially — IPv4-mapped IPv6 (`::ffff:a.b.c.d`), which is
 * UNWRAPPED to its embedded v4 and re-checked so an attacker can't smuggle 127.0.0.1 as `::ffff:127.0.0.1`.
 */
export function isBlockedIp(ip: ParsedIp): boolean {
  if (ip.kind === "v4") {
    return v4IsBlocked(ip.value);
  }

  const v = ip.value;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d): unwrap to the embedded v4 and apply the v4 policy.
  if ((v & V6_MAPPED_MASK) === V6_MAPPED_PREFIX) {
    const embedded = Number(v & 0xffffffffn) >>> 0;
    return v4IsBlocked(embedded);
  }
  // IPv4-compatible IPv6 (deprecated, ::a.b.c.d with upper 96 bits zero, excluding :: and ::1):
  // unwrap and re-check too — same smuggling concern.
  if (v >> 32n === 0n && v !== 0n && v !== 1n) {
    const embedded = Number(v & 0xffffffffn) >>> 0;
    return v4IsBlocked(embedded);
  }
  // 6to4 (2002:V4ADDR::/16): the embedded v4 (next 32 bits after the 2002: prefix) is the routed
  // destination — re-check it so an attacker can't smuggle an internal v4 inside a 6to4 address.
  if (v >> 112n === 0x2002n) {
    const embedded = Number((v >> 80n) & 0xffffffffn) >>> 0;
    return v4IsBlocked(embedded);
  }

  if (v === 0n) return true; // :: unspecified
  if (v === 1n) return true; // ::1 loopback
  if (inV6Cidr(v, "fc00::", 7)) return true; // fc00::/7 unique-local (ULA)
  if (inV6Cidr(v, "fe80::", 10)) return true; // fe80::/10 link-local
  if (inV6Cidr(v, "fec0::", 10)) return true; // fec0::/10 deprecated site-local — block defensively
  if (inV6Cidr(v, "ff00::", 8)) return true; // ff00::/8 multicast
  if (inV6Cidr(v, "2001:db8::", 32)) return true; // documentation
  if (inV6Cidr(v, "100::", 64)) return true; // discard-only

  return false;
}

function v4IsBlocked(value: number): boolean {
  const v = value >>> 0;
  for (const [low, high] of V4_BLOCKED) {
    if (v >= low && v <= high) return true;
  }
  return false;
}

/**
 * Convenience: classify a raw resolved-address STRING (as `dns.resolve*` returns) as blocked.
 * Fails CLOSED — if the string does not parse as an IP at all, treat it as blocked (we will not open a
 * socket to an address we cannot reason about).
 */
export function isBlockedAddress(addr: string): boolean {
  const parsed = parseIp(addr);
  if (parsed === null) return true; // fail closed: un-parseable => blocked
  return isBlockedIp(parsed);
}

/** True iff every resolved address is a public, non-blocked IP AND there is at least one address. */
export function allAddressesPublic(addrs: readonly string[]): boolean {
  if (addrs.length === 0) return false; // no address => cannot safely connect
  return addrs.every((a) => !isBlockedAddress(a));
}
